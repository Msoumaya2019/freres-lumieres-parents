/**
 * Lecture de la source, pour les décisions qu'aucun comportement ne départage.
 *
 * ## Pourquoi ce module existe
 *
 * Certaines décisions de ce projet ne sont observables par aucun test de
 * comportement : « la requête ne contraint pas `enabled` », « `deliveredCount`
 * vient des reçus et non des tickets acceptés », « la mise à jour de
 * l'historique vient après la purge ». Les écrire sous forme d'appel exigerait
 * un émulateur Firestore et un réseau simulé, pour vérifier une **forme de
 * code**, pas un résultat.
 *
 * Ces tests-là lisent donc le fichier sur le disque. Le motif est établi depuis
 * `paths.test.ts` — comparer deux tables de collections sans importer le SDK
 * client — et repris ici parce que `functions/` ne peut pas dépendre de
 * `@fl/testing`, qui traîne le harnais d'émulateur.
 *
 * ## La règle qui rend ces tests honnêtes
 *
 * Un motif introuvable ne doit pas faire passer une assertion : il doit la faire
 * **échouer**. Sans cela, renommer une fonction suffit à neutraliser la garde
 * sans que rien ne le signale — le test passe au vert sur une chaîne vide. C'est
 * pourquoi `corpsDeLaFonction` lève, et pourquoi `lireSource` lève aussi quand
 * le fichier repère est absent : un chemin de travers ne doit pas ressembler à
 * un fichier vide.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Fichier repère, relatif à la racine du dépôt.
 *
 * `npm run test -w @fl/functions` s'exécute depuis le paquet, un lancement
 * depuis la racine s'exécute depuis la racine. La racine est reconnue à la
 * présence de ce fichier, qui ne bougera pas.
 */
export const REPERE: readonly string[] = ['functions', 'src', 'notifications', 'send.ts'];

/** Remonte l'arborescence jusqu'à la racine du dépôt, ou lève. */
export function findRepoRoot(startDirectory: string = process.cwd()): string {
  let directory = resolve(startDirectory);

  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(directory, ...REPERE))) return directory;

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  throw new Error(
    `Racine du dépôt introuvable depuis « ${startDirectory} » : aucun ` +
      `${REPERE.join('/')} dans les répertoires parents.`,
  );
}

/** Contenu d'un fichier du dépôt, désigné par son chemin relatif découpé. */
export function lireSource(cheminRelatif: readonly string[]): string {
  return readFileSync(join(findRepoRoot(), ...cheminRelatif), 'utf8');
}

/**
 * Corps d'une fonction, d'une fonction appelable ou d'un déclencheur, ou
 * **lève** si introuvable.
 *
 * ## Trois formes, et leurs fins de corps
 *
 *  - `function <nom>(` — sans exiger `export` : la plupart des fonctions qui
 *    portent une décision dans ce projet sont privées, c'est même un signe
 *    qu'elles sont au bon endroit, et exiger `export` obligerait à ouvrir une
 *    fonction uniquement pour la tester. Le corps s'arrête à la première
 *    accolade fermante en début de ligne ;
 *  - `const <nom> = ` — la forme d'une fonction **appelable** (`onCall`) ou
 *    d'un **déclencheur** (`onDocumentCreated`, `onDocumentWritten`,
 *    `onSchedule`). Elle s'achève par `});` pour la première et par `);` pour
 *    les seconds, et chercher l'accolade en colonne zéro ne trouverait rien
 *    pour aucune des deux.
 *
 * Les deux fins sont donc essayées pour la seconde forme, et c'est la plus
 * proche qui l'emporte : une fonction appelable contient les deux, un
 * déclencheur n'a que la seconde. Prendre systématiquement la seconde rendrait
 * le corps d'une fonction appelable plus long qu'elle — l'inverse, systématiser
 * la première, ferait **lever** sur tout déclencheur.
 *
 * Un comptage d'accolades serait plus général, et il a été écarté : il faudrait
 * ignorer celles qui vivent dans une chaîne ou un littéral de gabarit, et ce
 * projet en contient — `paths.ts` en est plein. Une règle fausse appliquée
 * partout vaut moins que deux règles justes, chacune pour sa forme.
 *
 * ## La limite, écrite
 *
 * Une fonction dont le corps contiendrait lui-même une accolade en colonne zéro
 * — ou un `\n});` — serait tronquée : le test resterait vert, mais sur un
 * fragment. Préférer alors un motif cherché dans le fichier entier.
 */
export function corpsDeLaFonction(
  source: string,
  nom: string,
  cheminRelatif: readonly string[] = REPERE,
): string {
  const formes: readonly { debut: string; fins: readonly string[] }[] = [
    { debut: `function ${nom}(`, fins: ['\n}'] },
    { debut: `const ${nom} = `, fins: ['\n});', '\n);'] },
  ];

  for (const forme of formes) {
    const debut = source.indexOf(forme.debut);
    if (debut === -1) continue;

    const positions = forme.fins
      .map((fin) => source.indexOf(fin, debut))
      .filter((position) => position !== -1);
    if (positions.length === 0) break;

    return source.slice(debut, Math.min(...positions));
  }

  throw new Error(
    `Fonction « ${nom} » introuvable dans ${cheminRelatif.join('/')}. ` +
      'Le format a changé : adapter ce test plutôt que le neutraliser.',
  );
}
