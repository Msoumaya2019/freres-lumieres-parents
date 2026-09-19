/**
 * Le filtre du journal d'audit : ce qu'il reconnaît, et ce que le menu propose.
 *
 * ## Les deux moitiés du même défaut
 *
 * Un filtre d'audit peut se tromper de deux façons, et la seconde est pire.
 *
 * **Proposer trop.** Une option que rien n'écrit ne retourne jamais rien, et
 * une page vide se lit « il ne s'est jamais rien passé ». C'est le défaut réel :
 * le menu offrait dix-sept actions quand sept étaient écrites. Il se corrige en
 * lisant `AUDITED_ACTIONS`, et il se mesure **par élément** — chaque action de
 * la liste doit être reconnue, une boucle qui compterait ne verrait pas ce qui
 * manque une fois.
 *
 * **Reconnaître trop peu.** Si le menu proposait une action que la conversion
 * ne reconnaît pas, le filtre retomberait sur « tout le journal » : l'écran
 * afficherait alors le journal entier **sous l'étiquette d'un filtre**. C'est
 * le même mensonge, mais il ne ressemble pas à une page vide — il ressemble à
 * une réponse.
 *
 * La première moitié se mesure sur la conversion, la seconde sur la source de
 * l'écran. `apps/admin` n'a ni jsdom ni bibliothèque de rendu ; en ajouter deux
 * pour cette assertion serait disproportionné, et c'est pourquoi la conversion
 * a été sortie de l'écran — pour être éprouvée directement.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AUDITED_ACTIONS } from '@fl/shared';

import { toFilter } from './audit-filter';

/** L'écran, lu depuis le disque : c'est lui qui remplit le menu. */
const ECRAN = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'features',
  'audit',
  'audit-view.tsx',
);

describe('conversion de la valeur du filtre', () => {
  it('la liste des actions auditées n’est pas vide', () => {
    // Sans cette assertion, la boucle suivante passerait sur une liste vide.
    expect(AUDITED_ACTIONS.length).toBeGreaterThan(0);
  });

  it('chaque action auditée est reconnue, et produit son propre filtre', () => {
    for (const action of AUDITED_ACTIONS) {
      expect(toFilter(action)).toEqual({ kind: 'action', action });
    }
  });

  it('une action du vocabulaire mais non auditée retombe sur tout le journal', () => {
    // `post.pin` est un vrai `AdminAction` — il a un libellé, il figure au
    // vocabulaire — mais aucun code ne l'écrit. Le filtre ne doit pas le
    // reconnaître : l'offrir donnerait une page vide qui se lit comme un fait.
    expect(toFilter('post.pin')).toEqual({ kind: 'all' });
  });

  it('la valeur vide — l’option « toutes les actions » — ne filtre rien', () => {
    expect(toFilter('')).toEqual({ kind: 'all' });
  });

  it('une valeur arbitraire ne construit jamais un filtre invalide', () => {
    expect(toFilter('valeur.modifiee.a.la.main')).toEqual({ kind: 'all' });
  });
});

describe('menu de l’écran d’audit', () => {
  it('l’écran est bien celui qu’on lit', () => {
    // Un chemin déplacé ferait passer le test suivant sur une source vide, qui
    // ne contiendrait ni la liste attendue ni l'ancienne — donc au vert.
    expect(existsSync(ECRAN)).toBe(true);
    expect(readFileSync(ECRAN, 'utf8').length).toBeGreaterThan(0);
  });

  it('le menu est rempli à partir de la liste partagée, en entier', () => {
    // `AUDITED_ACTIONS.map(` : la liste entière, pas un sous-ensemble recopié.
    // Le compilateur garantit qu'une option est un `AuditedAction` ; il ne
    // garantit pas qu'on les propose toutes, et c'est ce qui manque ici.
    expect(readFileSync(ECRAN, 'utf8')).toContain('AUDITED_ACTIONS.map(');
  });

  it('l’écran ne déclare pas sa propre liste d’actions', () => {
    // Le compilateur interdit d'importer `ADMIN_ACTIONS` — il n'existe plus.
    // Une liste **redéclarée** sur place, elle, compilerait : c'est ce que
    // cette assertion refuse, et c'est la seule façon de réintroduire le défaut
    // sans que rien ne proteste.
    expect(readFileSync(ECRAN, 'utf8')).not.toContain('ADMIN_ACTIONS');
  });
});
