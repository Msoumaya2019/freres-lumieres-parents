/**
 * Faux Firestore en mémoire.
 *
 * ## Pourquoi il existe
 *
 * Deux garanties du code de nettoyage ne se lisent pas dans la source : « toutes
 * les publications sont traitées, pas seulement le premier lot » et « aucun lot
 * ne dépasse la limite d'écritures du service ». Un test de source vérifierait
 * qu'une boucle existe ; il ne vérifierait pas qu'un parent de mille deux cents
 * publications est **entièrement** anonymisé.
 *
 * ## Ce qu'il imite, et c'est délibérément peu
 *
 *  - **les écritures d'un lot ne sont appliquées qu'au `commit`** : c'est ce qui
 *    permet de mesurer la taille d'un lot avant qu'il soit écrit, donc de
 *    constater un dépassement de la limite du service ;
 *  - **une requête rend au plus `limit(n)` documents** : c'est ce qui reproduit
 *    la pagination qu'une version fautive prenait pour une fin de parcours ;
 *  - **un lot refuse deux écritures sur le même document**. Firestore lève, et
 *    ce n'est pas un détail de confort : sans cette contrainte, le
 *    dédoublonnage de `purgeDeviceTokens` ne serait éprouvé par rien, puisque
 *    le faux se contenterait d'écrire deux fois la même chose sans broncher. Un
 *    faux plus permissif que le service ne prouve rien.
 *
 * Le reste n'existe pas. Une méthode manquante doit lever : un faux trop
 * complaisant laisserait passer un appel qui, en production, ne compilerait pas.
 */
import type { Firestore } from 'firebase-admin/firestore';

/** Un document du faux Firestore : son identifiant, et ses champs. */
export type FauxDocument = { id: string } & Record<string, unknown>;

/** Référence de document, réduite à ce que le code testé transmet. */
export interface FauxDocumentRef {
  id: string;
  chemin: string;
  delete: () => Promise<void>;
}

/** Faux Firestore portant une base en mémoire. */
export class FauxFirestore {
  /** Taille de chaque lot commité, dans l'ordre. */
  readonly lots: number[] = [];
  /** Chemins supprimés hors lot (`doc(...).delete()`). */
  readonly supprimes: string[] = [];

  private readonly collections = new Map<string, FauxDocument[]>();

  constructor(contenu: Record<string, FauxDocument[]>) {
    for (const [nom, documents] of Object.entries(contenu)) {
      this.collections.set(nom, documents);
    }
  }

  /** Documents encore présents dans une collection. */
  restants(nom: string): readonly FauxDocument[] {
    return this.collections.get(nom) ?? [];
  }

  collection(nom: string): unknown {
    const documents = this.collections.get(nom) ?? [];
    const filtres: { champ: string; valeur: unknown }[] = [];
    let maximum = Number.POSITIVE_INFINITY;

    const requete = {
      where(champ: string, _operateur: string, valeur: unknown) {
        filtres.push({ champ, valeur });
        return requete;
      },
      limit(borne: number) {
        maximum = borne;
        return requete;
      },
      async get() {
        const trouves = documents
          .filter((document) => filtres.every((filtre) => document[filtre.champ] === filtre.valeur))
          .slice(0, maximum);

        return {
          empty: trouves.length === 0,
          size: trouves.length,
          docs: trouves.map((document) => ({ id: document.id, ref: document })),
        };
      },
    };

    return requete;
  }

  batch(): unknown {
    const operations: (() => void)[] = [];
    const cibles = new Set<string>();

    return {
      update: (ref: FauxDocument, donnees: Record<string, unknown>) => {
        reserver(ref.id);
        operations.push(() => Object.assign(ref, donnees));
      },
      delete: (ref: FauxDocumentRef) => {
        reserver(ref.id);
        operations.push(() => this.retirerParId(ref.id));
      },
      commit: async () => {
        // Relevée **avant** application : c'est la taille que le service
        // refuse au-delà de 500, et le test doit la voir telle quelle.
        this.lots.push(operations.length);
        for (const appliquer of operations) appliquer();
      },
    };

    function reserver(id: string): void {
      if (cibles.has(id)) {
        throw new Error(`Un lot Firestore refuse deux écritures sur le document ${id}.`);
      }
      cibles.add(id);
    }
  }

  doc(chemin: string): FauxDocumentRef {
    const id = chemin.slice(chemin.lastIndexOf('/') + 1);
    return {
      id,
      chemin,
      delete: async () => {
        this.supprimes.push(chemin);
      },
    };
  }

  private retirerParId(id: string): void {
    for (const documents of this.collections.values()) {
      const index = documents.findIndex((document) => document.id === id);
      if (index >= 0) documents.splice(index, 1);
    }
  }
}

/** Le faux, vu comme la base réelle par le code testé. */
export function base(contenu: Record<string, FauxDocument[]>): {
  faux: FauxFirestore;
  db: Firestore;
} {
  const faux = new FauxFirestore(contenu);
  return { faux, db: faux as unknown as Firestore };
}
