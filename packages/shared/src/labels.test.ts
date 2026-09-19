/**
 * Cohérence entre la liste des actions auditées et leurs libellés.
 *
 * ## Ce que le compilateur tient déjà, et ce que ces tests tiennent en plus
 *
 * `ADMIN_ACTION_LABELS` est exhaustif par construction : son type est
 * `Record<AdminAction, string>`, donc une action du vocabulaire sans libellé ne
 * compile pas. `AUDITED_ACTIONS` est un sous-ensemble déclaré `satisfies
 * readonly AdminAction[]`, donc chacune de ses valeurs est du vocabulaire, donc
 * libellée. **L'appartenance est tenue par le type**, et il serait malhonnête
 * de la refaire passer pour un contrôle : le jour où quelqu'un retire le
 * `satisfies`, c'est le compilateur qu'il faudra regarder, pas ce fichier.
 *
 * Restent quatre choses que le compilateur ne voit pas, et c'est ce que ces
 * tests mesurent : une liste **vide** (qui passerait toutes les boucles au
 * vert), un **doublon**, un libellé **vide**, et un libellé qui n'est que la
 * valeur brute — auquel cas l'écran affiche `user.approve` et l'on croit à
 * tort que le repli a joué.
 */
import { describe, expect, it } from 'vitest';

import { AUDITED_ACTIONS } from './constants.js';
import { ADMIN_ACTION_LABELS, adminActionLabel } from './labels.js';

describe('libellés des actions d’administration', () => {
  it('la liste des actions auditées n’est pas vide', () => {
    // Sans cette assertion, une liste vidée par erreur rendrait les trois tests
    // suivants verts en ne mesurant rien du tout.
    expect(AUDITED_ACTIONS.length).toBeGreaterThan(0);
  });

  it('aucune action auditée n’est listée deux fois', () => {
    expect(new Set(AUDITED_ACTIONS).size).toBe(AUDITED_ACTIONS.length);
  });

  it('chaque action auditée est libellée, et son libellé n’est pas la valeur brute', () => {
    for (const action of AUDITED_ACTIONS) {
      const label = adminActionLabel(action);
      expect(label.trim().length).toBeGreaterThan(0);
      // Si les deux sont égaux, c'est le repli qui a répondu : la table des
      // libellés ne couvre pas cette action, et l'écran affichera une clé
      // technique au lieu d'une phrase.
      expect(label).not.toBe(action);
    }
  });

  it('chaque action auditée figure au vocabulaire, et y porte un libellé', () => {
    // Le compilateur tient déjà cette appartenance. L'assertion est ici pour
    // qu'un lecteur qui ouvre ce fichier en changeant la liste la voie écrite,
    // et pour qu'un futur relâchement du `satisfies` ne passe pas en silence.
    const vocabulaire = Object.keys(ADMIN_ACTION_LABELS);
    for (const action of AUDITED_ACTIONS) {
      expect(vocabulaire).toContain(action);
    }
  });

  it('une action inconnue s’affiche telle quelle plutôt que de disparaître', () => {
    // Un journal survit au code qui l'a écrit : une action retirée dans une
    // version ultérieure doit rester lisible, pas devenir une ligne vide.
    expect(adminActionLabel('action.retiree')).toBe('action.retiree');
  });
});
