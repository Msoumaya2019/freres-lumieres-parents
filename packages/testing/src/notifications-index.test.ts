/**
 * L'accord entre la requête de l'historique et l'index composite déclaré.
 *
 * ## Le défaut qu'il empêche
 *
 * Firestore refuse une requête dont la combinaison `where` + `orderBy` n'est
 * couverte par aucun index composite, et le message qu'il rend ne dit pas
 * **lequel** manque : il renvoie vers la console Firebase, où l'index suggéré
 * se génère à la main. Rien dans le code ne relie la requête écrite dans le
 * dépôt à la ligne correspondante de `firestore.indexes.json` — deux fichiers,
 * deux formats, et rien entre les deux.
 *
 * La panne a donc lieu au premier affichage de l'écran, en production, au
 * moment précis où quelqu'un cherche à prévenir huit cents familles. Et elle se
 * produirait aussi bien en ajoutant un filtre par catégorie — un geste anodin,
 * qui n'alerte aucun outil : ni TypeScript, ni ESLint, ni les tests.
 *
 * ## Ce qui est vérifié, et pourquoi c'est la requête qu'on lit
 *
 * Le dépôt est en lecture seule et son unique requête est écrite en toutes
 * lettres dans `notifications.ts`. La source est donc lue sur le disque, plutôt
 * que la requête reconstruite en important le module : c'est le seul moyen de
 * comparer ce qui sera **réellement envoyé** à ce qui est **déclaré**.
 *
 * Trois choses en découlent :
 *
 *  - la requête contraint `orgId` — ce n'est pas une optimisation mais une
 *    obligation, les règles n'étant pas des filtres ;
 *  - elle trie sur `sentAt` décroissant, ce que la phrase « du plus récent au
 *    plus ancien » promet à l'écran ;
 *  - un index composite couvre **exactement** cette combinaison, dans cet ordre.
 *
 * ## Pourquoi l'extraction lève au lieu de rendre une chaîne vide
 *
 * Un motif introuvable qui rendrait `''` ferait passer toutes les assertions
 * suivantes sur du vide : le test resterait vert après un renommage, en ne
 * vérifiant plus rien. C'est le motif déjà employé par `corpsDeLaFonction` dans
 * les fonctions, et par `paths.test.ts` : lever, jamais rendre une absence.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findRepoRoot } from './env.js';

/** Un champ trié, tel que la requête le demande. */
interface ChampTrie {
  readonly fieldPath: string;
  readonly order: 'ASCENDING' | 'DESCENDING';
}

/** Un index composite tel que `firestore.indexes.json` le déclare. */
interface IndexDeclare {
  readonly collectionGroup: string;
  readonly queryScope: string;
  readonly fields: readonly {
    readonly fieldPath?: string;
    readonly order?: string;
    readonly arrayConfig?: string;
  }[];
}

const SOURCE_DEPOT = 'packages/firebase/src/repositories/notifications.ts';
const SOURCE_CHEMINS = 'packages/firebase/src/paths.ts';
const SOURCE_INDEX = 'firebase/firestore.indexes.json';

/** Lit un fichier du dépôt, par un chemin en forme POSIX. */
function lire(cheminRelatif: string): string {
  return readFileSync(join(findRepoRoot(), ...cheminRelatif.split('/')), 'utf8');
}

/**
 * Corps de `buildQuery`, borné par la ligne qui le ferme.
 *
 * La borne est `\n  }` — deux espaces d'indentation —, qui ne peut appartenir
 * qu'à un bloc de premier niveau du fichier : les lignes du corps en portent
 * quatre ou plus.
 */
function corpsDeLaRequete(): string {
  const source = lire(SOURCE_DEPOT);
  const debut = source.indexOf('function buildQuery(');
  if (debut === -1) {
    throw new Error(`« function buildQuery( » introuvable dans ${SOURCE_DEPOT}.`);
  }

  const fin = source.indexOf('\n  }', debut);
  if (fin === -1) {
    throw new Error(`Fin de « buildQuery » introuvable dans ${SOURCE_DEPOT}.`);
  }

  return source.slice(debut, fin);
}

/** Champ de la clause `where`, ou une levée s'il n'y en a pas. */
function champContraint(): string {
  const correspondance = /where\(\s*'([^']+)'/.exec(corpsDeLaRequete());
  if (!correspondance?.[1]) {
    throw new Error('Aucune clause « where » dans buildQuery : la requête n’est pas contrainte.');
  }
  return correspondance[1];
}

/** Champ et sens du tri, ou une levée s'il n'y en a pas. */
function triDemande(): ChampTrie {
  const correspondance = /orderBy\(\s*'([^']+)'\s*,\s*'(asc|desc)'/.exec(corpsDeLaRequete());
  if (!correspondance?.[1] || !correspondance[2]) {
    throw new Error('Aucun « orderBy » dans buildQuery : l’historique n’a pas d’ordre garanti.');
  }

  return {
    fieldPath: correspondance[1],
    order: correspondance[2] === 'desc' ? 'DESCENDING' : 'ASCENDING',
  };
}

/** Nom Firestore de la collection, lu dans la table des chemins. */
function nomDeLaCollection(): string {
  const correspondance = /^\s*notifications: '([^']+)',$/m.exec(lire(SOURCE_CHEMINS));
  if (!correspondance?.[1]) {
    throw new Error(`Entrée « notifications » introuvable dans ${SOURCE_CHEMINS}.`);
  }
  return correspondance[1];
}

/** Tous les index déclarés. */
function indexDeclares(): readonly IndexDeclare[] {
  const contenu = JSON.parse(lire(SOURCE_INDEX)) as { indexes?: IndexDeclare[] };
  const indexes = contenu.indexes ?? [];
  if (indexes.length === 0) {
    throw new Error(`${SOURCE_INDEX} ne déclare aucun index : la lecture porterait sur du vide.`);
  }
  return indexes;
}

/**
 * Index couvrant **exactement** la requête : même collection, mêmes champs, dans
 * le même ordre, et mêmes sens de tri.
 *
 * L'ordre compte, et c'est le point que la lecture rapide manque : un index
 * `(sentAt, orgId)` ne couvre pas une requête `where orgId orderBy sentAt`, et
 * Firestore ne le dira qu'en la refusant.
 */
function indexCouvrant(collection: string, champs: readonly ChampTrie[]): IndexDeclare | undefined {
  return indexDeclares().find(
    (index) =>
      index.collectionGroup === collection &&
      index.queryScope === 'COLLECTION' &&
      index.fields.length === champs.length &&
      index.fields.every((champ, rang) => {
        const attendu = champs[rang];
        return (
          attendu !== undefined &&
          champ.fieldPath === attendu.fieldPath &&
          champ.order === attendu.order
        );
      }),
  );
}

describe('requête de l’historique des notifications', () => {
  it('contraint l’organisation', () => {
    // Les règles ne sont pas des filtres : un `list` qui ne contraint pas
    // `orgId` est refusé. La contrainte est donc une obligation, pas un
    // confort — et elle est aussi ce qui empêche l'écran d'une organisation
    // d'afficher les envois d'une autre.
    expect(champContraint()).toBe('orgId');
  });

  it('trie du plus récent envoi au plus ancien', () => {
    // L'écran l'affirme en toutes lettres. Sans `orderBy`, Firestore rend un
    // ordre par identifiant de document : ni erreur, ni message, une liste
    // simplement mélangée.
    expect(triDemande()).toEqual({ fieldPath: 'sentAt', order: 'DESCENDING' });
  });

  it('un index composite déclaré couvre exactement la requête', () => {
    const index = indexCouvrant(nomDeLaCollection(), [
      { fieldPath: champContraint(), order: 'ASCENDING' },
      triDemande(),
    ]);

    // Le message nomme l'index à écrire : c'est ce que Firestore ne fait pas,
    // et c'est la raison d'être de ce test.
    expect(
      index,
      `Aucun index ${nomDeLaCollection()}(orgId ↑, sentAt ↓) dans ${SOURCE_INDEX} : ` +
        'la requête sera refusée à l’exécution.',
    ).toBeDefined();
  });
});
