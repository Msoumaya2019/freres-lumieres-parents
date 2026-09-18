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
 *  - **une inégalité écarte les documents qui ne portent pas le champ.** Ce
 *    n'est pas une commodité de comparaison : c'est la règle de Firestore, et
 *    elle porte une décision ici — un sondage **sans** échéance n'est jamais
 *    ramené par `endsAt <= maintenant`, donc n'est jamais clos automatiquement.
 *    Un faux qui traiterait l'absence comme une valeur petite aurait l'air de
 *    tout aussi bien marcher, tout en prouvant le contraire.
 *  - **`set` fusionne sur `{ merge: true }`, remplace sinon** : la distinction
 *    est celle qui empêche une clôture d'effacer la question du sondage.
 *
 * Le reste n'existe pas. Une méthode manquante doit lever : un faux trop
 * complaisant laisserait passer un appel qui, en production, ne compilerait pas.
 * C'est pourquoi un opérateur de requête non implémenté **lève** au lieu de
 * retomber sur une égalité — une retombée silencieuse rendrait vert un test qui
 * ne mesure rien.
 */
import type { Firestore } from 'firebase-admin/firestore';

/** Un document du faux Firestore : son identifiant, et ses champs. */
export type FauxDocument = { id: string } & Record<string, unknown>;

/** Référence de document, réduite à ce que le code testé transmet. */
export interface FauxDocumentRef {
  id: string;
  chemin: string;
  delete: () => Promise<void>;
  set: (donnees: Record<string, unknown>, options?: { readonly merge?: boolean }) => Promise<void>;
}

/**
 * Opérateurs de requête que le faux sait reproduire.
 *
 * Un opérateur absent de cette table **lève**, il ne retombe pas sur une
 * égalité : une retombée silencieuse rendrait vert un test qui ne mesure rien,
 * et c'est précisément ce que ce faux refuse d'être.
 */
const OPERATEURS: Record<string, (champ: unknown, valeur: unknown) => boolean> = {
  '==': (champ, valeur) => egal(champ, valeur),
  '<=': (champ, valeur) => comparable(champ, valeur, (a, b) => a <= b),
  '<': (champ, valeur) => comparable(champ, valeur, (a, b) => a < b),
  '>=': (champ, valeur) => comparable(champ, valeur, (a, b) => a >= b),
  '>': (champ, valeur) => comparable(champ, valeur, (a, b) => a > b),
};

/** Égalité, les dates se comparant par leur instant et non par leur identité. */
function egal(champ: unknown, valeur: unknown): boolean {
  if (champ instanceof Date && valeur instanceof Date) return champ.getTime() === valeur.getTime();
  return champ === valeur;
}

/**
 * Comparaison d'inégalité.
 *
 * Deux refus, et le premier est une décision, pas une approximation :
 *
 *  - un champ **absent** ne satisfait jamais la comparaison. C'est la règle de
 *    Firestore, et elle porte une décision ici — un sondage sans échéance n'est
 *    jamais ramené par `endsAt <= maintenant`, donc jamais clos
 *    automatiquement. Traiter l'absence comme une valeur très petite aurait
 *    l'air de tout aussi bien marcher, tout en prouvant le contraire.
 *  - une valeur qui n'est ni une date ni un nombre **lève** : Firestore
 *    comparerait deux chaînes lexicographiquement, et deviner cette sémantique
 *    serait inventer un comportement au lieu de le reproduire.
 */
function comparable(
  champ: unknown,
  valeur: unknown,
  comparer: (gauche: number, droite: number) => boolean,
): boolean {
  if (champ === undefined || champ === null) return false;
  return comparer(enNombre(champ), enNombre(valeur));
}

function enNombre(valeur: unknown): number {
  if (valeur instanceof Date) return valeur.getTime();
  if (typeof valeur === 'number') return valeur;
  throw new Error(
    `Le faux Firestore ne compare que des dates et des nombres, reçu ${typeof valeur}.`,
  );
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
    const filtres: {
      champ: string;
      comparer: (champ: unknown, valeur: unknown) => boolean;
      valeur: unknown;
    }[] = [];
    let maximum = Number.POSITIVE_INFINITY;

    const requete = {
      where(champ: string, operateur: string, valeur: unknown) {
        // La fonction est resolue **ici**, et non a chaque evaluation : un
        // operateur inconnu leve au moment ou la requete se construit, donc la
        // ou l'erreur se lit, plutot qu'au milieu d'un filtrage.
        const comparer = OPERATEURS[operateur];
        if (!comparer) {
          throw new Error(`Le faux Firestore n'implémente pas l'opérateur « ${operateur} ».`);
        }
        filtres.push({ champ, comparer, valeur });
        return requete;
      },
      limit(borne: number) {
        maximum = borne;
        return requete;
      },
      async get() {
        const trouves = documents
          .filter((document) =>
            filtres.every((filtre) => filtre.comparer(document[filtre.champ], filtre.valeur)),
          )
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
    const nom = chemin.slice(0, chemin.lastIndexOf('/'));

    return {
      id,
      chemin,
      delete: async () => {
        this.supprimes.push(chemin);
      },
      set: async (donnees, options) => {
        if (!this.collections.has(nom)) this.collections.set(nom, []);
        const documents = this.collections.get(nom) ?? [];
        const existant = documents.find((document) => document.id === id);

        if (!existant) {
          documents.push({ id, ...donnees });
          return;
        }

        // Sans `merge`, Firestore **remplace** le document : les champs absents
        // de l'écriture disparaissent. La distinction est mesurable, et c'est
        // elle qui empêche une clôture d'effacer la question du sondage.
        if (!options?.merge) {
          for (const champ of Object.keys(existant)) {
            if (champ !== 'id') delete existant[champ];
          }
        }
        Object.assign(existant, donnees);
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
