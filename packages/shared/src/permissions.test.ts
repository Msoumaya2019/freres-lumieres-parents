import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ALL_PERMISSIONS,
  PERMISSION_MATRIX,
  ROLE_PERMISSIONS,
  canReadPollResults,
  hasPermission,
} from './permissions.js';
import { MANDATORY_NOTIFICATION_CATEGORIES } from './constants.js';
import { findRepoRoot } from './test-helpers/repo-root.js';

describe('matrice de permissions', () => {
  it('déclare chaque permission pour au moins un rôle', () => {
    for (const [permission, roles] of Object.entries(PERMISSION_MATRIX)) {
      expect(roles.length, `${permission} n'est accordée à aucun rôle`).toBeGreaterThan(0);
    }
  });

  it('ne donne aucune permission d’administration à un parent', () => {
    const parentPermissions = ROLE_PERMISSIONS.parent;
    const forbidden = [
      'post.create',
      'post.delete.any',
      'user.approve',
      'user.role.change',
      'user.delete',
      'settings.update',
      'audit.read',
      'moderation.queue.read',
      'fcpe.access',
      'report.read.any',
    ] as const;

    for (const permission of forbidden) {
      expect(
        parentPermissions.has(permission),
        `un parent ne doit pas pouvoir « ${permission} »`,
      ).toBe(false);
    }
  });

  it('réserve les actions les plus sensibles à l’administrateur', () => {
    const adminOnly = [
      'user.approve',
      'user.role.change',
      'user.delete',
      'user.export',
      'settings.update',
      'audit.read',
      'channel.create',
      'channel.delete',
    ] as const;

    for (const permission of adminOnly) {
      expect(PERMISSION_MATRIX[permission]).toEqual(['admin']);
    }
  });

  it('autorise un modérateur à masquer du contenu mais pas à supprimer un compte', () => {
    expect(hasPermission('moderator', 'comment.hide.any')).toBe(true);
    expect(hasPermission('moderator', 'message.hide.any')).toBe(true);
    expect(hasPermission('moderator', 'user.suspend')).toBe(true);
    expect(hasPermission('moderator', 'user.delete')).toBe(false);
    expect(hasPermission('moderator', 'user.role.change')).toBe(false);
  });

  it('autorise la FCPE à publier et à répondre aux signalements', () => {
    expect(hasPermission('fcpe', 'post.create')).toBe(true);
    expect(hasPermission('fcpe', 'report.read.any')).toBe(true);
    expect(hasPermission('fcpe', 'report.reply.internal')).toBe(true);
    expect(hasPermission('fcpe', 'poll.create')).toBe(true);
  });

  it('autorise tous les rôles validés à participer aux discussions et aux sondages', () => {
    for (const role of ['parent', 'fcpe', 'moderator', 'admin'] as const) {
      expect(hasPermission(role, 'comment.create')).toBe(true);
      expect(hasPermission(role, 'message.create')).toBe(true);
      expect(hasPermission(role, 'poll.vote')).toBe(true);
      expect(hasPermission(role, 'report.create')).toBe(true);
      expect(hasPermission(role, 'council.item.propose')).toBe(true);
    }
  });

  it('refuse tout pour un rôle absent ou inconnu', () => {
    expect(hasPermission(undefined, 'comment.create')).toBe(false);
    expect(hasPermission(null, 'post.create')).toBe(false);
  });

  it('couvre l’ensemble des permissions déclarées sans doublon', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    expect(ALL_PERMISSIONS.length).toBeGreaterThan(40);
  });
});

describe('catégories de notifications', () => {
  it('protège les alertes urgentes', () => {
    expect(MANDATORY_NOTIFICATION_CATEGORIES).toContain('urgent');
  });
});

describe('visibilité des résultats de sondage', () => {
  const parent = { role: 'parent' as const, hasVoted: false };

  it('publie les résultats d’un sondage en « always » à tout parent', () => {
    expect(canReadPollResults({ ...parent, status: 'open', resultsVisibility: 'always' })).toBe(
      true,
    );
  });

  it('n’ouvre « after_vote » qu’à qui a voté', () => {
    const ouvert = {
      ...parent,
      status: 'open' as const,
      resultsVisibility: 'after_vote' as const,
    };
    expect(canReadPollResults(ouvert)).toBe(false);
    expect(canReadPollResults({ ...ouvert, hasVoted: true })).toBe(true);
  });

  it('n’ouvre pas « after_end » à qui a voté, tant que le sondage est ouvert', () => {
    // Le point où l'échelle se referme, et le défaut trouvé dans la règle :
    // `aVote()` y était un `||` inconditionnel, si bien qu'un votant lisait le
    // décompte en cours d'un sondage `after_end`. `after_end` et `after_vote`
    // ne différaient alors plus que pour un non-votant, et la troisième valeur
    // ne tenait pas la promesse que son libellé affiche.
    expect(
      canReadPollResults({
        ...parent,
        status: 'open',
        resultsVisibility: 'after_end',
        hasVoted: true,
      }),
    ).toBe(false);
  });

  it('publie les résultats à tous dès que le sondage est clos', () => {
    // C'est ce que veut dire `after_end`, qui sans cela serait identique à
    // « jamais » : la clôture rattrape celui qui n'a pas voté.
    for (const resultsVisibility of ['always', 'after_vote', 'after_end'] as const) {
      expect(
        canReadPollResults({ ...parent, status: 'closed', resultsVisibility }),
        `un sondage clos doit publier ses résultats (${resultsVisibility})`,
      ).toBe(true);
    }
  });

  it('ne publie rien d’un brouillon, même en « always »', () => {
    // Publier les résultats d'un sondage non publié révélerait la question
    // avant l'heure.
    expect(canReadPollResults({ ...parent, status: 'draft', resultsVisibility: 'always' })).toBe(
      false,
    );
  });

  it('referme un champ de visibilité absent', () => {
    // Le défaut du schéma est `after_vote`, mais une permission ne s'ouvre pas
    // par omission : la règle lit un champ absent en **levant**, et le refus
    // qui en résulte ne nomme aucune clause.
    expect(
      canReadPollResults({
        ...parent,
        status: 'open',
        resultsVisibility: undefined,
        hasVoted: true,
      }),
    ).toBe(false);
  });

  it('laisse la FCPE lire quel que soit le statut et la visibilité', () => {
    // C'est elle qui administre le sondage et qui doit pouvoir en suivre le
    // décompte avant de le clore — un brouillon compris.
    for (const role of ['fcpe', 'moderator', 'admin'] as const) {
      for (const status of ['draft', 'open', 'closed'] as const) {
        for (const resultsVisibility of ['always', 'after_vote', 'after_end'] as const) {
          expect(
            canReadPollResults({ role, status, resultsVisibility, hasVoted: false }),
            `${role} doit lire les résultats (${status}, ${resultsVisibility})`,
          ).toBe(true);
        }
      }
    }
  });

  it('refuse tout pour un rôle absent', () => {
    expect(
      canReadPollResults({
        role: undefined,
        status: 'open',
        resultsVisibility: 'always',
        hasVoted: true,
      }),
    ).toBe(false);
  });
});

/**
 * Le prédicat et la règle portent la même décision, dans deux langages, et
 * **rien ne les lit ensemble** : les règles ne sont pas accessibles depuis le
 * client, et `packages/testing` ne connaît pas `@fl/shared`.
 *
 * Ce bloc est le seul endroit où les deux sources se rencontrent. Il lit le
 * fichier de règles sur le disque, comme `deeplinks.test.ts` lit `app.json` et
 * le dossier des routes.
 *
 * Il doit **échouer** si le motif disparaît — un test de forme qui ne trouve
 * pas ce qu'il cherche est un test qui ne mesure rien, et le pire des échecs
 * est celui qui rassure.
 */
describe('accord entre le prédicat et les règles Firestore', () => {
  /**
   * Contenu d'un bloc des règles, lu par profondeur d'accolades.
   *
   * La profondeur plutôt que l'indentation : un bloc réindenté ferait échouer
   * une extraction écrite en espaces fixes, et l'alerte porterait alors sur la
   * mise en forme au lieu de la décision.
   */
  function bloc(repere: string): string {
    const chemin = join(findRepoRoot(), 'firebase', 'firestore.rules');
    const lignes = readFileSync(chemin, 'utf8').split('\n');
    const debut = lignes.findIndex((ligne) => ligne.includes(repere));

    if (debut === -1) {
      throw new Error(
        `« ${repere} » est introuvable dans firebase/firestore.rules : ` +
          "canReadPollResults() n'est plus vérifié contre quoi que ce soit.",
      );
    }

    let profondeur = 0;
    const corps: string[] = [];

    for (let index = debut; index < lignes.length; index += 1) {
      const ligne = lignes[index] ?? '';
      corps.push(ligne);
      profondeur += (ligne.match(/\{/g) ?? []).length;
      profondeur -= (ligne.match(/\}/g) ?? []).length;
      if (index > debut && profondeur === 0) break;
    }

    return corps.join(' ').replace(/\s+/g, ' ');
  }

  it('porte les trois branches de l’échelle', () => {
    const corps = bloc('function resultatsVisibles()');
    expect(corps).toContain("visibilite() == 'always'");
    expect(corps).toContain("s.status == 'closed'");
    // La garde est ce qui fait tenir l'emboîtement. `aVote()` seul rouvrirait
    // `after_end` à un votant : c'est exactement le défaut trouvé, et c'est
    // cette assertion qui empêche de le réintroduire sans le voir.
    expect(corps).toContain("(visibilite() == 'after_vote' && aVote())");
  });

  it('referme le repli sur la plus restrictive des trois valeurs', () => {
    // Un repli ouvert publierait les résultats d'un sondage dont le champ a
    // disparu — au lieu de les refermer, comme le prédicat le fait.
    expect(bloc('function visibilite()')).toContain(": 'after_end';");
  });

  it('réserve à la FCPE la branche qui ne dépend pas de la visibilité', () => {
    // Le pendant de `canAccessFcpeSpace(role)` dans le prédicat. La clause est
    // citée en entier, et non par le mot `isFcpe()` : le bloc fait quatre-vingt
    // douze lignes, et « le mot apparaît quelque part » ne dirait rien de la
    // branche. `isActive()` y figure aussi, et c'est ce qui rend un refus de
    // `getMyVote()` inatteignable tant que le sondage est lisible — la branche
    // parent l'exige déjà.
    expect(bloc('match /pollResults/{pollId}')).toContain(
      'isFcpe() || (isActive() && resultatsVisibles())',
    );
  });
});
