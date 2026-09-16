/**
 * Constantes dupliquées entre `@fl/shared` et les règles de sécurité.
 *
 * ## Le problème
 *
 * Une règle Firestore ne peut pas importer de constante TypeScript : elle est
 * écrite dans son propre langage, évaluée par le serveur. Toute liste partagée
 * entre le code et les règles est donc **recopiée à la main**, et rien ne
 * signale une divergence — ni le compilateur, ni le linter, ni le déploiement.
 *
 * La liste des emojis de réaction est dans ce cas. Une divergence produit un
 * bug particulièrement désagréable : l'application propose un emoji que les
 * règles refusent. L'utilisateur tape, Firestore répond « permission denied »,
 * et rien dans le code n'explique pourquoi — la liste est ailleurs, dans un
 * fichier que TypeScript ne lit pas.
 *
 * ## Pourquoi ce test vit ici
 *
 * `@fl/testing` est le harnais des règles : c'est le seul paquet qui sait lire
 * `firebase/firestore.rules`. Ce test-ci est **pur** — pas d'émulateur, donc pas
 * de Java — et s'exécute avec `npm run test`. Le fichier voisin
 * `firestore.rules.test.ts` s'auto-ignore quand l'émulateur est absent ; ce
 * fichier-ci ne s'ignore jamais, car la divergence qu'il traque ne dépend
 * d'aucun environnement.
 *
 * Ajouter une constante aux règles ? Ajouter ici la vérification qui
 * l'épingle.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REACTION_EMOJIS } from '@fl/shared';
import { describe, expect, it } from 'vitest';

import { findRepoRoot } from './env.js';

const rulesSource = readFileSync(join(findRepoRoot(), 'firebase', 'firestore.rules'), 'utf8');

/**
 * Emojis déclarés dans la règle de réaction.
 *
 * Le motif est cherché partout dans le fichier : `emoji` n'apparaît que dans
 * `validReaction`. Si le bloc disparaît, on **lève** au lieu de renvoyer une
 * liste vide — comparer deux listes vides passerait au vert en ne vérifiant
 * rien.
 */
function emojisDeclaredInRules(source: string): string[] {
  const declaration = /d\.emoji in \[([^\]]*)\]/.exec(source);

  if (!declaration) {
    throw new Error(
      'Aucune déclaration `d.emoji in [...]` dans firebase/firestore.rules : ' +
        'la règle de réaction a été renommée ou supprimée. Adapter ce test.',
    );
  }

  return [...(declaration[1] ?? '').matchAll(/'([^']*)'/g)].map((emoji) => emoji[1] ?? '');
}

describe('Constantes dupliquées dans les règles', () => {
  it('la liste des emojis des règles est identique à REACTION_EMOJIS', () => {
    expect(emojisDeclaredInRules(rulesSource)).toEqual([...REACTION_EMOJIS]);
  });
});
