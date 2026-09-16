/**
 * Parité des tables de chemins entre le serveur et le client.
 *
 * ## Ce que ce test protège
 *
 * `functions/src/lib/paths.ts` recopie `packages/firebase/src/paths.ts` au lieu
 * de l'importer — délibérément : `@fl/firebase` embarque le SDK client, qu'il
 * serait absurde de charger dans une Cloud Function. La contrepartie est qu'une
 * collection ajoutée d'un seul côté **ne casse rien à la compilation**. La
 * fonction écrirait alors dans un chemin que personne ne lit, ou lirait un
 * chemin que personne n'écrit, et le symptôme serait un compteur qui reste à
 * zéro — sans erreur nulle part.
 *
 * Ce n'est pas hypothétique : la sous-collection `reactions` a été ajoutée au
 * client et oubliée ici. C'est ce test qui l'a mis au jour.
 *
 * ## Pourquoi il lit la source au lieu d'importer
 *
 * Importer `@fl/firebase` depuis `functions` créerait une arête de dépendance
 * entre le serveur et le SDK client — précisément ce que la duplication évite.
 * Le fichier est donc lu depuis le disque, comme `@fl/testing` lit
 * `firestore.rules`. La comparaison porte sur les **noms déclarés**, seule
 * chose que les deux tables doivent partager ; les constructeurs de chemins,
 * eux, diffèrent légitimement (le client en a davantage).
 *
 * Ce test est pur : il ne demande ni émulateur, ni Java.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { COLLECTIONS, SUBCOLLECTIONS } from './paths.js';

/** Chemin du fichier client, relatif à la racine du dépôt. */
const CLIENT_PATHS = ['packages', 'firebase', 'src', 'paths.ts'];

/**
 * Remonte l'arborescence jusqu'à la racine du dépôt.
 *
 * On ne peut pas se fier au répertoire courant : `npm run test -w @fl/functions`
 * s'exécute depuis le paquet, alors qu'un lancement depuis la racine s'exécute
 * depuis la racine. La racine est reconnue à la présence du fichier client.
 *
 * Même logique que `findRepoRoot` dans `@fl/testing`. La duplication est
 * assumée : `@fl/testing` est le harnais des émulateurs, l'importer ici
 * traînerait `@firebase/rules-unit-testing` dans les tests des fonctions.
 */
function findRepoRoot(startDirectory: string = process.cwd()): string {
  let directory = resolve(startDirectory);

  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(directory, ...CLIENT_PATHS))) return directory;

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  throw new Error(
    `Racine du dépôt introuvable depuis « ${startDirectory} » : aucun ` +
      `${CLIENT_PATHS.join('/')} dans les répertoires parents.`,
  );
}

/**
 * Extrait les clés d'un bloc `export const X = { … } as const;`.
 *
 * Volontairement strict : si le bloc est introuvable, on **lève** au lieu de
 * renvoyer une liste vide. Un test qui comparerait une liste vide à une liste
 * vide passerait au vert en ne vérifiant rien — c'est le même piège que
 * `assertFails`, qui accepte n'importe quel refus.
 */
function declaredKeys(source: string, blockName: string): string[] {
  const block = new RegExp(`export const ${blockName} = \\{([\\s\\S]*?)\\n\\} as const;`).exec(
    source,
  );

  if (!block) {
    throw new Error(
      `Bloc « ${blockName} » introuvable dans ${CLIENT_PATHS.join('/')}. ` +
        'Le format a changé : adapter ce test plutôt que le neutraliser.',
    );
  }

  return [...(block[1] ?? '').matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*):/gm)]
    .map((entry) => entry[1] ?? '')
    .sort();
}

const clientSource = readFileSync(join(findRepoRoot(), ...CLIENT_PATHS), 'utf8');

describe('Parité des chemins Firestore', () => {
  it('déclare les mêmes collections racine que le client', () => {
    expect(declaredKeys(clientSource, 'COLLECTIONS')).toEqual(Object.keys(COLLECTIONS).sort());
  });

  it('déclare les mêmes sous-collections que le client', () => {
    expect(declaredKeys(clientSource, 'SUBCOLLECTIONS')).toEqual(
      Object.keys(SUBCOLLECTIONS).sort(),
    );
  });
});
