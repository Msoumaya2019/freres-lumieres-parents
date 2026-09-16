/**
 * Décompte des réactions d'un commentaire.
 *
 * Ces tests portent sur une estimation locale — celle qui s'affiche entre le
 * toucher et la réponse de la Cloud Function. Elle est remplacée au prochain
 * chargement, mais elle est visible : un décompte faux pendant deux secondes
 * se remarque, et une entrée qui tombe sous zéro ne remonte jamais.
 */
import { describe, expect, it } from 'vitest';

import { reactionCountsAfter } from './reactions.js';

describe('reactionCountsAfter', () => {
  it('ajoute une première réaction', () => {
    expect(reactionCountsAfter({}, undefined, '👍')).toEqual({ '👍': 1 });
  });

  it('ajoute la sienne à celles des autres', () => {
    expect(reactionCountsAfter({ '👍': 3 }, undefined, '👍')).toEqual({ '👍': 4 });
  });

  it('retire la sienne', () => {
    expect(reactionCountsAfter({ '👍': 3 }, '👍', undefined)).toEqual({ '👍': 2 });
  });

  it('retire l’entrée quand le décompte tombe à zéro', () => {
    // Laisser `{ '👍': 0 }` ne changerait rien à l'affichage, qui filtre les
    // zéros, mais rendrait la carte locale différente de celle du serveur.
    expect(reactionCountsAfter({ '👍': 1 }, '👍', undefined)).toEqual({});
  });

  it('ne descend jamais sous zéro', () => {
    // Cas d'une carte désynchronisée : le serveur ne connaît pas ma réaction
    // alors que je crois l'avoir posée.
    expect(reactionCountsAfter({}, '👍', undefined)).toEqual({});
  });

  it('remplace une réaction par une autre', () => {
    expect(reactionCountsAfter({ '👍': 2, '🎉': 1 }, '👍', '🎉')).toEqual({ '👍': 1, '🎉': 2 });
  });

  it('ne compte pas deux fois la même réaction', () => {
    // Un double toucher rapide : sans ce garde, le décompte local monterait à 3
    // et ne redescendrait qu'au rechargement suivant.
    expect(reactionCountsAfter({ '👍': 2 }, '👍', '👍')).toEqual({ '👍': 2 });
  });

  it('ne modifie pas le décompte reçu', () => {
    const counts = { '👍': 2 };
    reactionCountsAfter(counts, undefined, '🎉');

    expect(counts).toEqual({ '👍': 2 });
  });
});
