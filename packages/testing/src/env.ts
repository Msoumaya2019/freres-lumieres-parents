/**
 * Harnais de tests des règles de sécurité.
 *
 * ## Pourquoi ces tests existent
 *
 * Les règles Firestore sont la **seule** barrière réelle du système : la
 * configuration Firebase est publique, donc n'importe qui peut interroger la
 * base avec un script, sans passer par l'application. Une règle trop permissive
 * ne se voit pas à l'écran — elle se voit dans un test.
 *
 * ## Comment ils s'exécutent
 *
 * `npm run rules:test` démarre les émulateurs puis lance Vitest à l'intérieur
 * (`firebase emulators:exec`). Aucun projet Firebase réel n'est touché, aucune
 * donnée réelle n'est lue, et les tests peuvent donc être exécutés par
 * n'importe qui, y compris en intégration continue.
 *
 * ## Écriture des tests
 *
 * Deux règles de rédaction, apprises à la dure :
 *  - **Toujours tester le refus autant que l'autorisation.** Un test qui ne
 *    vérifie que les cas autorisés passe aussi quand la règle a été supprimée.
 *  - **Tester la requête, pas seulement la lecture unitaire.** Firestore
 *    n'évalue pas les règles de la même façon pour un `get` et pour un `list` :
 *    une règle peut autoriser `getDoc` et faire échouer `getDocs`.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';

/**
 * Identifiants de test.
 *
 * `orgIds` est présent dans les claims parce que le jeton réel en contient
 * toujours : un test qui l'omettrait ne reproduirait pas les conditions de
 * production.
 */
export const TEST_ORG = 'fcpe-montmagny';
export const TEST_OTHER_ORG = 'fcpe-ailleurs';

export const CLAIMS = {
  parent: { role: 'parent', status: 'active', orgId: TEST_ORG, orgIds: [TEST_ORG] },
  pending: { role: 'parent', status: 'pending', orgId: TEST_ORG, orgIds: [TEST_ORG] },
  suspended: { role: 'parent', status: 'suspended', orgId: TEST_ORG, orgIds: [TEST_ORG] },
  rejected: { role: 'parent', status: 'rejected', orgId: TEST_ORG, orgIds: [TEST_ORG] },
  fcpe: { role: 'fcpe', status: 'active', orgId: TEST_ORG, orgIds: [TEST_ORG] },
  moderator: { role: 'moderator', status: 'active', orgId: TEST_ORG, orgIds: [TEST_ORG] },
  admin: { role: 'admin', status: 'active', orgId: TEST_ORG, orgIds: [TEST_ORG] },
  // Un parent actif, mais rattaché à un autre groupe scolaire : sert à
  // vérifier qu'aucune donnée ne fuit d'une organisation à l'autre.
  parentOtherOrg: {
    role: 'parent',
    status: 'active',
    orgId: TEST_OTHER_ORG,
    orgIds: [TEST_OTHER_ORG],
  },
  // Rôles habilités d'une **autre** organisation. Un rôle privilégié ne doit
  // pas franchir la frontière d'organisation : c'est le cas que les tests de
  // cloisonnement oubliaient, et c'est celui qui laisse passer une lecture
  // entière de collection — une règle qui s'appuie sur le seul rôle est
  // satisfaite par Firestore sans contraindre aucun champ.
  fcpeOtherOrg: {
    role: 'fcpe',
    status: 'active',
    orgId: TEST_OTHER_ORG,
    orgIds: [TEST_OTHER_ORG],
  },
  moderatorOtherOrg: {
    role: 'moderator',
    status: 'active',
    orgId: TEST_OTHER_ORG,
    orgIds: [TEST_OTHER_ORG],
  },
} as const;

/** Identifiants d'utilisateurs fictifs, réutilisés dans tous les tests. */
export const UID = {
  parent: 'parent-1',
  otherParent: 'parent-2',
  fcpe: 'membre-fcpe',
  moderator: 'moderateur',
  admin: 'administrateur',
} as const;

/**
 * Remonte l'arborescence jusqu'à la racine du dépôt.
 *
 * On ne peut pas se fier au répertoire courant : `npm run test -w @fl/testing`
 * s'exécute depuis le paquet, alors que `firebase emulators:exec` s'exécute
 * depuis la racine. La racine est donc reconnue à la présence du fichier de
 * règles, ce qui fonctionne dans les deux cas.
 */
export function findRepoRoot(startDirectory: string = process.cwd()): string {
  let directory = resolve(startDirectory);

  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(directory, 'firebase', 'firestore.rules'))) {
      return directory;
    }

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  throw new Error(
    `Racine du dépôt introuvable depuis « ${startDirectory} » : ` +
      'aucun fichier firebase/firestore.rules trouvé dans les répertoires parents.',
  );
}

/** Adresse de l'émulateur Firestore, fournie par `firebase emulators:exec`. */
function emulatorEndpoint(): { host: string; port: number } {
  const raw = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  const [hostPart, portPart] = raw.split(':');

  return {
    host: hostPart ?? '127.0.0.1',
    port: Number(portPart ?? '8080'),
  };
}

/**
 * Prépare un environnement de test isolé, avec les règles réellement
 * déployées.
 *
 * Le fichier de règles est lu depuis le disque, jamais recopié : un test qui
 * s'exécuterait contre une copie pourrait passer au vert alors que la règle
 * déployée est différente.
 */
export async function createRulesTestEnvironment(
  projectId = 'demo-fl-rules-test',
): Promise<RulesTestEnvironment> {
  const repoRoot = findRepoRoot();
  const { host, port } = emulatorEndpoint();

  return initializeTestEnvironment({
    projectId,
    firestore: {
      host,
      port,
      rules: await readRulesFile(repoRoot),
    },
  });
}

async function readRulesFile(repoRoot: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return readFile(join(repoRoot, 'firebase', 'firestore.rules'), 'utf8');
}

export type { RulesTestEnvironment };
