import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ALL_PERMISSIONS,
  PERMISSION_MATRIX,
  ROLE_PERMISSIONS,
  canReadPollResults,
  hasPermission,
  hasPollEnded,
  isPollOpen,
  pollEffectiveStatus,
} from './permissions.js';
import { MANDATORY_NOTIFICATION_CATEGORIES, POLL_STATUSES } from './constants.js';
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
      'poll.open',
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

  it('confie à la FCPE l’ouverture d’un brouillon comme sa clôture', () => {
    // Les deux listes sont **identiques**, et ce n'est pas une recopie :
    // `poll.create` accorde déjà le pouvoir de publier, par `notify: true`.
    // Une liste plus étroite interdirait au bouton ce que le formulaire de
    // création autorise au même acteur — la FCPE enregistre un brouillon
    // exprès pour l'ouvrir plus tard.
    //
    // C'est donc l'**égalité** qui est la propriété à tenir, et non chacune
    // des deux listes prise seule : le jour où l'on voudra qu'un modérateur
    // publie sans pouvoir clore, ou l'inverse, ce test forcera à le décider
    // au lieu de le laisser dériver.
    expect(PERMISSION_MATRIX['poll.open']).toEqual(PERMISSION_MATRIX['poll.close']);

    expect(hasPermission('fcpe', 'poll.open')).toBe(true);
    expect(hasPermission('moderator', 'poll.open')).toBe(true);
    expect(hasPermission('admin', 'poll.open')).toBe(true);
    expect(hasPermission('parent', 'poll.open')).toBe(false);
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

describe('échéance d’un sondage', () => {
  const echeance = new Date('2026-06-01T20:00:00Z');
  const secondeAvant = new Date('2026-06-01T19:59:59Z');
  const secondeApres = new Date('2026-06-01T20:00:01Z');

  it('n’est pas dépassée une seconde avant, et l’est une seconde après', () => {
    // Le témoin de chaque côté de la borne, à une seconde près : c'est ce qui
    // distingue « l'échéance est lue » de « quelque chose ferme le sondage ».
    expect(hasPollEnded({ endsAt: echeance, now: secondeAvant })).toBe(false);
    expect(hasPollEnded({ endsAt: echeance, now: secondeApres })).toBe(true);
  });

  it('l’est à l’instant même de l’échéance', () => {
    // La borne est **inclusive**, et c'est le choix de la règle — `<=`. Un
    // sondage « jusqu'à 20 h » n'accepte donc pas de vote à 20 h 00 mn 00 s :
    // l'écart entre les deux conventions n'est que d'une seconde, mais il
    // doit être le même des deux côtés, sinon le bouton et la règle se
    // contrediraient à cet instant précis.
    expect(hasPollEnded({ endsAt: echeance, now: echeance })).toBe(true);
  });

  it('n’est pas dépassée quand le sondage n’a pas d’échéance', () => {
    // Le cas le plus courant : un sondage ouvert jusqu'à ce que la FCPE le
    // close. L'absence de date ne ferme rien — et une échéance illisible se
    // replie du même côté, pour ne pas fermer un sondage par accident.
    expect(hasPollEnded({ now: secondeApres })).toBe(false);
    expect(hasPollEnded({ endsAt: null, now: secondeApres })).toBe(false);
  });

  it('lit les trois formes de date que Firestore rend', () => {
    // Un `Date` après une écriture locale, une chaîne ISO après une
    // sérialisation, un `Timestamp` dans un instantané : les trois arrivent
    // selon le chemin, et la décision ne doit pas dépendre du chemin.
    const horodatage = {
      seconds: Math.floor(echeance.getTime() / 1000),
      nanoseconds: 0,
      toDate: () => echeance,
      toMillis: () => echeance.getTime(),
    };

    expect(hasPollEnded({ endsAt: horodatage, now: secondeApres })).toBe(true);
    expect(hasPollEnded({ endsAt: echeance.toISOString(), now: secondeApres })).toBe(true);
    expect(hasPollEnded({ endsAt: echeance, now: secondeApres })).toBe(true);
  });

  it('ferme le vote à l’échéance, et l’ouvre avant', () => {
    expect(isPollOpen({ status: 'open', endsAt: echeance, now: secondeAvant })).toBe(true);
    expect(isPollOpen({ status: 'open', endsAt: echeance, now: secondeApres })).toBe(false);
  });

  it('ne rouvre jamais ce qui n’était pas votable', () => {
    // L'échéance ne fait que **fermer** : une date passée ne rend votable ni
    // un brouillon, ni un sondage clos.
    expect(isPollOpen({ status: 'draft', endsAt: echeance, now: secondeAvant })).toBe(false);
    expect(isPollOpen({ status: 'closed', endsAt: echeance, now: secondeAvant })).toBe(false);
  });

  it('rend un statut effectif qui s’accorde avec le droit de voter', () => {
    // L'accord est vérifié sur le **produit** des statuts et des trois régimes
    // d'échéance — absente, à venir, dépassée — plutôt que sur quelques cas
    // choisis : c'est un accord entre deux fonctions, et un cas oublié serait
    // précisément celui où les deux dérivations divergeraient.
    const regimes = [
      { nom: 'sans échéance', endsAt: undefined, now: secondeApres },
      { nom: 'échéance à venir', endsAt: echeance, now: secondeAvant },
      { nom: 'échéance dépassée', endsAt: echeance, now: secondeApres },
    ] as const;

    for (const statut of POLL_STATUSES) {
      for (const regime of regimes) {
        const entree = { status: statut, endsAt: regime.endsAt, now: regime.now };
        expect(
          isPollOpen(entree),
          `${statut} / ${regime.nom} : le droit de voter et le statut effectif se contredisent`,
        ).toBe(pollEffectiveStatus(entree) === 'open');
      }
    }
  });

  it('ne publie pas un brouillon en le déclarant clos', () => {
    // Le repli qui attrape tout fermerait le vote d'un brouillon, mais il le
    // ferait aussi passer pour **publié** : la règle de lecture ouvre aux
    // parents les statuts `open` et `closed`, pas `draft`. Un brouillon dont
    // l'échéance est passée reste donc un brouillon.
    expect(pollEffectiveStatus({ status: 'draft', endsAt: echeance, now: secondeApres })).toBe(
      'draft',
    );
    expect(pollEffectiveStatus({ status: 'archived', endsAt: echeance, now: secondeApres })).toBe(
      'archived',
    );
  });

  it('nomme la clôture que la règle applique déjà, et que le document ignore', () => {
    // Le cas que cette fonction existe pour couvrir : `open` au document,
    // clos par la règle. L'écran doit dire « Clôturé » — l'administration,
    // elle, doit encore pouvoir **inscrire** cette clôture, ce qui est une
    // autre décision, prise à partir du statut enregistré.
    expect(pollEffectiveStatus({ status: 'open', endsAt: echeance, now: secondeApres })).toBe(
      'closed',
    );
    expect(pollEffectiveStatus({ status: 'open', endsAt: echeance, now: secondeAvant })).toBe(
      'open',
    );
  });

  it('publie les résultats à l’échéance, sans clôture enregistrée', () => {
    // La seconde moitié de la promesse affichée, et elle ne dépend pas du
    // statut : le sondage est toujours `open`, c'est l'échéance qui publie.
    const ouvert = {
      role: 'parent' as const,
      status: 'open' as const,
      resultsVisibility: 'after_end' as const,
      hasVoted: false,
      endsAt: echeance,
    };

    expect(canReadPollResults({ ...ouvert, now: secondeApres })).toBe(true);
    // Le témoin : même document, même lecteur, seule la seconde change.
    expect(canReadPollResults({ ...ouvert, now: secondeAvant })).toBe(false);
  });

  it('ne publie pas les résultats d’un brouillon dont l’échéance est passée', () => {
    // Le filtre de statut passe **avant** l'échéance, dans le prédicat comme
    // dans la règle : une date de clôture saisie à l'avance ne publie rien
    // tant que la FCPE n'a pas ouvert le sondage.
    expect(
      canReadPollResults({
        role: 'parent',
        status: 'draft',
        resultsVisibility: 'always',
        hasVoted: false,
        endsAt: echeance,
        now: secondeApres,
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

  it('fait de l’échéance une branche de l’échelle, au même titre que la clôture', () => {
    // Sans elle, la règle fermerait le vote à l'heure annoncée sans publier le
    // décompte : l'écran dirait « ce sondage est clos » en annonçant des
    // résultats à venir, et les deux moitiés de la promesse ne se
    // rejoindraient qu'au passage du planificateur.
    expect(bloc('function resultatsVisibles()')).toContain('echeancePassee(s)');
  });

  it('ferme le vote à l’échéance, et pas seulement à la clôture enregistrée', () => {
    // C'est le vote qui compte : un vote accepté après l'heure annoncée change
    // le résultat lui-même, quand une clôture enregistrée en retard ne change
    // qu'un affichage.
    expect(bloc('function sondageOuvert()')).toContain('!echeancePassee(sondage())');
  });

  it('éprouve la présence du champ avant de le comparer', () => {
    // Lire un champ absent lève, et une erreur vaut refus : sans le `in`, un
    // sondage sans date de clôture — le cas le plus courant — deviendrait
    // invotable, et sa lecture des résultats échouerait pour une raison qui ne
    // nomme aucune clause.
    const corps = bloc('function echeancePassee(s)');
    expect(corps).toContain("'endsAt' in s");
    expect(corps).toContain('s.endsAt <= request.time');
  });

  it('exige qu’une échéance présente soit un horodatage', () => {
    // La comparaison porterait sinon sur un type inattendu, ce qui **lève** :
    // le sondage serait fermé à tout le monde, FCPE comprise, sans que rien ne
    // dise pourquoi. Le contrôle appartient à `validPoll()`, donc à
    // l'écriture — une fois le document écrit, la comparaison est sûre.
    expect(bloc('function validPoll()')).toContain('d.endsAt is timestamp');
  });
});
