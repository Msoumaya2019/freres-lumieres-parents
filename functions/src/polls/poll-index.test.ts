/**
 * L'accord entre la requête de clôture automatique et l'index composite déclaré.
 *
 * ## Le défaut qu'il empêche
 *
 * Firestore refuse une requête dont la combinaison de `where` n'est couverte par
 * aucun index composite, et le message qu'il rend ne dit pas **lequel** manque :
 * il renvoie vers la console, où l'index suggéré se génère à la main. Rien dans
 * le code ne relie la requête écrite dans `close-due.ts` à la ligne
 * correspondante de `firestore.indexes.json` — deux fichiers, deux formats, et
 * rien entre les deux.
 *
 * La panne aurait lieu au premier passage du planificateur, en production, et
 * **silencieusement du point de vue des parents** : un sondage échu resterait
 * affiché « ouvert » alors que la règle refuse déjà les votes. C'est le genre de
 * défaut qui ne se voit pas parce qu'il ne casse rien — il laisse une promesse
 * d'affichage non tenue.
 *
 * ## Pourquoi ce test vit ici, et non dans `@fl/testing`
 *
 * Parce que la requête est ici. Le test d'accord de l'historique des
 * notifications vit dans `@fl/testing` pour la raison inverse : sa requête est
 * dans `packages/firebase`. Le principe est le même dans les deux cas — le test
 * se pose **à côté de ce qu'il lit**.
 *
 * ## Ce qui est vérifié, et pourquoi c'est la source qu'on lit
 *
 * La requête est lue sur le disque plutôt que reconstruite en important le
 * module : c'est le seul moyen de comparer ce qui sera **réellement envoyé** à
 * ce qui est **déclaré**. Trois choses en découlent :
 *
 *  - l'égalité **précède** l'inégalité. Ce n'est pas un détail de style : c'est
 *    cet ordre qui rend l'index composite nécessaire, et c'est lui qui fixe
 *    l'ordre des champs dans l'index. Un index `(endsAt, status)` ne couvrirait
 *    pas la requête, et Firestore ne le dirait qu'en la refusant ;
 *  - la requête n'est **pas** cloisonnée par organisation, et c'est délibéré :
 *    le planificateur balaie toutes les organisations en un passage ;
 *  - un index composite couvre **exactement** cette combinaison, dans cet ordre.
 *
 * ## Pourquoi l'extraction lève au lieu de rendre une chaîne vide
 *
 * Un motif introuvable qui rendrait `''` ferait passer toutes les assertions
 * suivantes sur du vide : le test resterait vert après un renommage, en ne
 * vérifiant plus rien. C'est le motif déjà employé par `corpsDeLaFonction` et
 * par `notifications-index.test.ts` : lever, jamais rendre une absence.
 */
import { describe, expect, it } from 'vitest';

import { corpsDeLaFonction, lireSource } from '../test-helpers/source.js';

/** Un champ trié, tel que l'index doit le déclarer. */
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

const SOURCE_REQUETE: readonly string[] = ['functions', 'src', 'polls', 'close-due.ts'];
const SOURCE_CHEMINS: readonly string[] = ['functions', 'src', 'lib', 'paths.ts'];
const SOURCE_INDEX: readonly string[] = ['firebase', 'firestore.indexes.json'];

/**
 * Ce que l'index doit porter, dans cet ordre.
 *
 * Le sens du champ d'inégalité est `ASCENDING` : c'est celui que Firestore
 * suggère pour une égalité suivie d'un `<=`, et un index descendant servirait
 * la même requête — mais déclarer autre chose que ce que le service propose
 * reviendrait à s'en écarter sans raison.
 */
const CHAMPS_ATTENDUS: readonly ChampTrie[] = [
  { fieldPath: 'status', order: 'ASCENDING' },
  { fieldPath: 'endsAt', order: 'ASCENDING' },
];

/** Les clauses `where` de la requête, dans l'ordre où elles sont écrites. */
function clauses(): readonly { champ: string; operateur: string }[] {
  const source = lireSource(SOURCE_REQUETE);
  const corps = corpsDeLaFonction(source, 'closeDuePolls', SOURCE_REQUETE);

  const trouvees: { champ: string; operateur: string }[] = [];
  const motif = /\.where\(\s*'([^']+)'\s*,\s*'([^']+)'/g;

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
      `Aucune clause « where » dans closeDuePolls (${SOURCE_REQUETE.join('/')}) : ` +
        'la requête n’est pas contrainte.',
    );
  }

  return trouvees;
}

/** Nom Firestore de la collection, lu dans la table des chemins. */
function nomDeLaCollection(): string {
  const correspondance = /^\s*polls: '([^']+)',$/m.exec(lireSource(SOURCE_CHEMINS));
  if (!correspondance?.[1]) {
    throw new Error(`Entrée « polls » introuvable dans ${SOURCE_CHEMINS.join('/')}.`);
  }
  return correspondance[1];
}

/** Tous les index déclarés. */
function indexDeclares(): readonly IndexDeclare[] {
  const contenu = JSON.parse(lireSource(SOURCE_INDEX)) as { indexes?: IndexDeclare[] };
  const indexes = contenu.indexes ?? [];
  if (indexes.length === 0) {
    throw new Error(
      `${SOURCE_INDEX.join('/')} ne déclare aucun index : la lecture porterait sur du vide.`,
    );
  }
  return indexes;
}

/**
 * Index couvrant **exactement** la requête : même collection, mêmes champs, dans
 * le même ordre, et mêmes sens.
 *
 * L'ordre compte, et c'est le point que la lecture rapide manque : un index
 * `(endsAt, status)` ne couvre pas une requête `where status == … where
 * endsAt <= …`, et Firestore ne le dira qu'en la refusant.
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

describe('requête de clôture automatique des sondages', () => {
  it('contraint le statut par égalité, puis l’échéance par inégalité', () => {
    // L'ordre est le sujet de ce test, et non la liste : c'est lui qui rend
    // l'index composite nécessaire, et c'est lui qui fixe l'ordre de ses
    // champs. Firestore exige l'égalité d'abord.
    expect(clauses()).toEqual([
      { champ: 'status', operateur: '==' },
      { champ: 'endsAt', operateur: '<=' },
    ]);
  });

  it('ne cloisonne pas par organisation, et c’est délibéré', () => {
    // Un balayage par organisation obligerait à connaître la liste des
    // organisations, et multiplierait les lectures pour un résultat identique.
    // La frontière reste tenue : la règle de lecture exige `orgId` pour chaque
    // client, et l'écriture ne touche que les champs de clôture.
    const champs = clauses().map((clause) => clause.champ);
    expect(champs).not.toContain('orgId');
  });

  it('un index composite déclaré couvre exactement la requête', () => {
    const collection = nomDeLaCollection();
    const index = indexCouvrant(collection, CHAMPS_ATTENDUS);

    // Le message nomme l'index à écrire : c'est ce que Firestore ne fait pas,
    // et c'est la raison d'être de ce test.
    expect(
      index,
      `Aucun index ${collection}(status ↑, endsAt ↑) dans ${SOURCE_INDEX.join('/')} : ` +
        'la clôture automatique sera refusée à l’exécution.',
    ).toBeDefined();
  });
});
