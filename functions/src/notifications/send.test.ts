/**
 * Ce que la requête d'envoi ne doit pas contraindre.
 *
 * ## La décision que ce test tient
 *
 * `queryTokensByAudience` lit les jetons d'une audience. Elle ne contraint
 * **pas** `enabled`, et c'est une décision, pas un oubli : une contrainte à cet
 * endroit écarte un appareil éteint **avant** `filterRecipients`, qui ne peut
 * alors plus rien pour lui. Un parent ayant coupé les notifications de son
 * téléphone ne recevrait plus aucune alerte urgente — exactement le cas que
 * l'exception doit couvrir.
 *
 * ## Pourquoi il lit la source au lieu d'appeler la fonction
 *
 * `send.ts` importe `firebase-admin` et `firebase-functions` : l'importer
 * demanderait un émulateur et une application initialisée. Or la propriété
 * vérifiée n'est pas un comportement mais une **forme de requête**, et elle se
 * lit. Même choix que `paths.test.ts`, qui compare deux tables de collections
 * sans jamais importer le SDK client.
 *
 * Ce test est pur : ni émulateur, ni Java.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/** Fichier lu, relatif à la racine du dépôt. */
const SOURCE_SEND = ['functions', 'src', 'notifications', 'send.ts'];

/**
 * Remonte l'arborescence jusqu'à la racine du dépôt.
 *
 * On ne peut pas se fier au répertoire courant : `npm run test -w @fl/functions`
 * s'exécute depuis le paquet, alors qu'un lancement depuis la racine s'exécute
 * depuis la racine. La racine est reconnue à la présence du fichier lu.
 *
 * Même logique que `findRepoRoot` dans `@fl/testing`. La duplication est
 * assumée : `@fl/testing` est le harnais des émulateurs, l'importer ici
 * traînerait `@firebase/rules-unit-testing` dans les tests des fonctions.
 */
function findRepoRoot(startDirectory: string = process.cwd()): string {
  let directory = resolve(startDirectory);

  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(directory, ...SOURCE_SEND))) return directory;

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  throw new Error(
    `Racine du dépôt introuvable depuis « ${startDirectory} » : aucun ` +
      `${SOURCE_SEND.join('/')} dans les répertoires parents.`,
  );
}

const SOURCE = readFileSync(join(findRepoRoot(), ...SOURCE_SEND), 'utf8');

/**
 * Corps d'une fonction exportée, ou **lève** si elle est introuvable.
 *
 * Volontairement strict : un motif introuvable ne fait pas échouer une
 * assertion, il la fait passer sur une chaîne vide. Sans cette garde, renommer
 * la fonction suffirait à neutraliser les tests ci-dessous sans que rien ne le
 * signale — le piège que `declaredKeys` évite dans `paths.test.ts`.
 */
function corpsDeLaFonction(nom: string): string {
  const debut = SOURCE.indexOf(`export async function ${nom}(`);
  const fin = debut === -1 ? -1 : SOURCE.indexOf('\n}', debut);

  if (debut === -1 || fin === -1) {
    throw new Error(
      `Fonction « ${nom} » introuvable dans ${SOURCE_SEND.join('/')}. ` +
        'Le format a changé : adapter ce test plutôt que le neutraliser.',
    );
  }

  return SOURCE.slice(debut, fin);
}

describe('queryTokensByAudience', () => {
  it('ne contraint pas l’interrupteur de l’appareil', () => {
    // La décision : `enabled` est écarté par `filterRecipients`, qui fait passer
    // les alertes obligatoires outre. Le contraindre ici rendrait la requête
    // sourde à cette exception, et personne ne le verrait — l'appareil éteint
    // serait simplement absent de la liste, indiscernable d'un appareil qui
    // n'existe pas.
    expect(corpsDeLaFonction('queryTokensByAudience')).not.toContain("where('enabled'");
  });

  it('contraint l’organisation et l’audience', () => {
    // La contrepartie, et elle est nécessaire : le test précédent passerait
    // aussi sur une fonction vidée de son corps.
    const corps = corpsDeLaFonction('queryTokensByAudience');

    expect(corps).toContain("where('orgId', '==', orgId)");
    expect(corps).toContain("where('audienceKeys', 'array-contains-any', lot)");
  });
});
