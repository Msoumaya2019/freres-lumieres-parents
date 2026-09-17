/**
 * Retrouver la racine du dépôt depuis un test.
 *
 * ## Pourquoi ce fichier n'est pas un module du paquet
 *
 * Il lit le disque (`node:fs`), ce qu'aucun module de `@fl/shared` n'a le droit
 * de faire : le paquet est consommé par React Native, où ces API n'existent
 * pas. `portability.test.ts` refuse d'ailleurs tout import `node:*` dans
 * `src/`. Ce fichier est donc exclu de la compilation — voir `tsconfig.json` —
 * et rangé sous `test-helpers/`, que la garde ne parcourt pas.
 *
 * ## Pourquoi remonter au lieu de compter les `../`
 *
 * Un chemin relatif dépend de l'emplacement du fichier **et** du répertoire
 * d'exécution, qui change selon qu'on lance `npm run test -w @fl/shared` ou une
 * suite depuis la racine. La racine est donc reconnue à un fichier qui n'existe
 * qu'à cet endroit.
 *
 * Même logique que `findRepoRoot` dans `@fl/testing` et dans les tests des
 * fonctions. La duplication est assumée : faire dépendre `@fl/shared` d'un
 * paquet de test serait pire que quinze lignes recopiées.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Fichier présent à la racine du dépôt, et nulle part ailleurs. */
const MARQUEUR = ['firebase.json'];

/**
 * Racine du dépôt, trouvée en remontant depuis le répertoire d'exécution.
 *
 * Lève plutôt que de rendre `null` : un test qui compare deux chemins vides
 * passerait au vert en ne vérifiant rien.
 */
export function findRepoRoot(startDirectory: string = process.cwd()): string {
  let directory = resolve(startDirectory);

  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(directory, ...MARQUEUR))) return directory;

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  throw new Error(
    `Racine du dépôt introuvable depuis « ${startDirectory} » : aucun ` +
      `${MARQUEUR.join('/')} dans les répertoires parents.`,
  );
}
