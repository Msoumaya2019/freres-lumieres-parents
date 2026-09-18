/**
 * L'accord entre la requête de la liste d'administration et l'index déclaré.
 *
 * ## Le défaut qu'il empêche
 *
 * Firestore refuse une requête dont la combinaison `where` + `orderBy` n'est
 * couverte par aucun index composite, et le message qu'il rend ne dit pas
 * **lequel** manque : il renvoie vers la console Firebase, où l'index suggéré se
 * génère à la main. Rien dans le code ne relie la requête écrite dans
 * `polls.ts` à la ligne correspondante de `firestore.indexes.json` — deux
 * fichiers, deux formats, et rien entre les deux.
 *
 * La panne aurait donc lieu au premier affichage de l'écran de suivi, en
 * production, au moment précis où la FCPE cherche à clore un sondage. Et elle se
 * produirait aussi bien en ajoutant un filtre de statut — un geste anodin, qui
 * n'alerte aucun outil : ni TypeScript, ni ESLint, ni les tests.
 *
 * ## Pourquoi ce test vit ici, et non dans les fonctions
 *
 * Parce que la requête est ici. Le test d'accord de la clôture automatique vit
 * dans `functions/src/polls/` pour la raison inverse : sa requête est dans
 * `close-due.ts`. Le principe est le même dans les deux cas — le test se pose
 * **à côté de ce qu'il lit**.
 *
 * ## Ce qui est vérifié, et ce que l'absence de filtre signifie
 *
 * La requête est lue sur le disque plutôt que reconstruite en important le
 * module : c'est le seul moyen de comparer ce qui sera **réellement envoyé** à ce
 * qui est **déclaré**. Trois choses en découlent :
 *
 *  - la requête contraint `orgId`, et **seulement** `orgId`. Ce n'est pas une
 *    optimisation : les règles ne sont pas des filtres, une requête est
 *    autorisée ou refusée **entière**, et Firestore n'évalue la règle qu'à
 *    partir des contraintes que la requête porte. La branche FCPE exige
 *    `orgId` — c'est donc exactement ce qu'il faut contraindre ;
 *  - elle **ne filtre pas** le statut, et c'est délibéré : la FCPE suit un
 *    brouillon comme un sondage ouvert, et un filtre les ferait disparaître de
 *    l'écran. Un test l'affirme, pour qu'un ajout de filtre se voie ;
 *  - elle trie sur `startsAt` décroissant, ce que la phrase « du plus récent au
 *    plus ancien » promet à l'écran, et un index composite couvre **exactement**
 *    cette combinaison, dans cet ordre.
 *
 * ## Pourquoi l'extraction lève au lieu de rendre une chaîne vide
 *
 * Un motif introuvable qui rendrait `''` ferait passer toutes les assertions
 * suivantes sur du vide : le test resterait vert après un renommage, en ne
 * vérifiant plus rien. C'est le motif déjà employé par `notifications-index.test.ts`
 * et par `corpsDeLaFonction` dans les fonctions : lever, jamais rendre une
 * absence.
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

const SOURCE_DEPOT = 'packages/firebase/src/repositories/polls.ts';
const SOURCE_CHEMINS = 'packages/firebase/src/paths.ts';
const SOURCE_INDEX = 'firebase/firestore.indexes.json';

/**
 * Bornes du corps de la requête, dans `fetchForAdmin`.
 *
 * Deux marqueurs plutôt qu'un seul : `buildQuery` apparaît aussi dans les autres
 * dépôts, et une borne unique attraperait la première venue. Ici les deux
 * marqueurs appartiennent au même appel de `paginate`, et la région qu'ils
 * délimitent ne peut contenir que la construction de la requête.
 */
const DEBUT_REQUETE = 'buildQuery:';
const FIN_REQUETE = 'mapDocument:';

/** Lit un fichier du dépôt, par un chemin en forme POSIX. */
function lire(cheminRelatif: string): string {
  return readFileSync(join(findRepoRoot(), ...cheminRelatif.split('/')), 'utf8');
}

/** Corps de la requête de `fetchForAdmin`, ou une levée s'il est introuvable. */
function corpsDeLaRequete(): string {
  const source = lire(SOURCE_DEPOT);
  const debut = source.indexOf(DEBUT_REQUETE);
  if (debut === -1) {
    throw new Error(`« ${DEBUT_REQUETE} » introuvable dans ${SOURCE_DEPOT}.`);
  }

  const fin = source.indexOf(FIN_REQUETE, debut);
  if (fin === -1) {
    throw new Error(`« ${FIN_REQUETE} » introuvable après la requête dans ${SOURCE_DEPOT}.`);
  }

  return source.slice(debut, fin);
}

/** Les clauses `where`, dans l'ordre où elles sont écrites. */
function clauses(): readonly { champ: string; operateur: string }[] {
  const corps = corpsDeLaRequete();
  const trouvees: { champ: string; operateur: string }[] = [];
  const motif = /where\(\s*'([^']+)'\s*,\s*'([^']+)'/g;

  let trouve = motif.exec(corps);
  while (trouve !== null) {
    const [, champ, operateur] = trouve;
    if (champ !== undefined && operateur !== undefined) {
      trouvees.push({ champ, operateur });
    }
    trouve = motif.exec(corps);
  }

  if (trouvees.length === 0) {
    throw new Error(
      `Aucune clause « where » dans la requête de ${SOURCE_DEPOT} : elle n’est pas contrainte.`,
    );
  }

  return trouvees;
}

/** Champ et sens du tri, ou une levée s'il n'y en a pas. */
function triDemande(): ChampTrie {
  const correspondance = /orderBy\(\s*'([^']+)'\s*,\s*'(asc|desc)'/.exec(corpsDeLaRequete());
  if (!correspondance?.[1] || !correspondance[2]) {
    throw new Error(
      `Aucun « orderBy » dans la requête de ${SOURCE_DEPOT} : la liste n’a pas d’ordre garanti.`,
    );
  }

  return {
    fieldPath: correspondance[1],
    order: correspondance[2] === 'desc' ? 'DESCENDING' : 'ASCENDING',
  };
}

/** Nom Firestore de la collection, lu dans la table des chemins. */
function nomDeLaCollection(): string {
  const correspondance = /^\s*polls: '([^']+)',$/m.exec(lire(SOURCE_CHEMINS));
  if (!correspondance?.[1]) {
    throw new Error(`Entrée « polls » introuvable dans ${SOURCE_CHEMINS}.`);
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
 * `(startsAt, orgId)` ne couvre pas une requête `where orgId orderBy startsAt`, et
 * Firestore ne le dira qu'en la refusant. De même, l'index
 * `(orgId, status, audienceKeys, startsAt)` — déclaré pour l'écran mobile — ne
 * couvre pas cette requête : Firestore ne sert qu'un **préfixe** des champs d'un
 * index, et `status` s'interpose entre `orgId` et `startsAt`.
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

describe('requête de la liste d’administration des sondages', () => {
  it('ne contraint que l’organisation, et c’est délibéré', () => {
    // Une requête est autorisée ou refusée **entière**, et Firestore n'évalue la
    // règle qu'à partir des contraintes qu'elle porte : la branche FCPE exige
    // `orgId`, donc `orgId` suffit. Ajouter un filtre de statut ne démontrerait
    // rien de plus, et retirer `orgId` ferait refuser la requête.
    expect(clauses()).toEqual([{ champ: 'orgId', operateur: '==' }]);
  });

  it('ne filtre pas le statut : un brouillon doit rester visible', () => {
    // La FCPE suit un brouillon comme un sondage ouvert — c'est elle qui l'a
    // enregistré, et c'est elle qui l'ouvrira. Ce test existe pour qu'un filtre
    // ajouté par réflexe se voie, plutôt que de faire disparaître des sondages
    // de l'écran sans que rien ne le signale.
    const champs = clauses().map((clause) => clause.champ);
    expect(champs).not.toContain('status');
  });

  it('trie du plus récent sondage au plus ancien', () => {
    // L'écran l'affirme en toutes lettres. Sans `orderBy`, Firestore rend un
    // ordre par identifiant de document : ni erreur, ni message, une liste
    // simplement mélangée.
    expect(triDemande()).toEqual({ fieldPath: 'startsAt', order: 'DESCENDING' });
  });

  it('un index composite déclaré couvre exactement la requête', () => {
    const collection = nomDeLaCollection();
    const index = indexCouvrant(collection, [
      { fieldPath: 'orgId', order: 'ASCENDING' },
      triDemande(),
    ]);

    // Le message nomme l'index à écrire : c'est ce que Firestore ne fait pas,
    // et c'est la raison d'être de ce test.
    expect(
      index,
      `Aucun index ${collection}(orgId ↑, startsAt ↓) dans ${SOURCE_INDEX} : ` +
        'la liste d’administration sera refusée à l’exécution.',
    ).toBeDefined();
  });
});
