/**
 * Cohérence entre la liste d'actions et leurs libellés.
 *
 * `ADMIN_ACTION_LABELS` est exhaustif par construction : son type est
 * `Record<AdminAction, string>`, donc ajouter une action au type sans lui
 * donner de libellé ne compile pas. `ADMIN_ACTIONS`, lui, est un tableau
 * ordonné — il fixe l'ordre du filtre à l'écran, groupé par domaine. Rien
 * n'oblige les deux à rester d'accord : une action ajoutée d'un côté seulement
 * passerait la compilation et disparaîtrait silencieusement du menu.
 *
 * C'est cet écart-là que ces tests interdisent.
 */
import { describe, expect, it } from 'vitest';

import { ADMIN_ACTIONS } from './constants.js';
import { ADMIN_ACTION_LABELS, adminActionLabel } from './labels.js';

describe('libellés des actions d’administration', () => {
  it('la liste ordonnée couvre exactement les libellés déclarés', () => {
    // L'égalité dans les deux sens : ni action sans libellé, ni libellé orphelin.
    expect([...ADMIN_ACTIONS].sort()).toEqual(Object.keys(ADMIN_ACTION_LABELS).sort());
  });

  it('aucune action n’est listée deux fois', () => {
    expect(new Set(ADMIN_ACTIONS).size).toBe(ADMIN_ACTIONS.length);
  });

  it('aucun libellé n’est vide', () => {
    for (const action of ADMIN_ACTIONS) {
      expect(adminActionLabel(action).trim().length).toBeGreaterThan(0);
    }
  });

  it('une action inconnue s’affiche telle quelle plutôt que de disparaître', () => {
    // Un journal survit au code qui l'a écrit : une action retirée dans une
    // version ultérieure doit rester lisible, pas devenir une ligne vide.
    expect(adminActionLabel('action.retiree')).toBe('action.retiree');
  });
});
