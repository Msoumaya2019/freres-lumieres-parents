/**
 * Matrice de permissions — source de vérité unique.
 *
 * Elle est déclarée comme une table `Permission -> rôles autorisés`, puis
 * transformée en ensembles indexés pour des vérifications en O(1).
 *
 * ## Synchronisation avec les Security Rules — à faire à la main
 *
 * Cette matrice et `firebase/firestore.rules` décrivent les mêmes décisions
 * d'autorisation dans deux langages différents, et **rien ne vérifie
 * automatiquement qu'elles concordent**. Les tests de
 * `packages/testing/src/firestore.rules.test.ts` portent sur le comportement
 * réel des règles (cloisonnement entre organisations, refus par défaut,
 * comptes non validés) ; ils ne comparent pas les règles à cette table.
 *
 * Conséquence pratique : toute modification d'un côté doit être reportée de
 * l'autre dans le même changement. C'est le prix de deux vocabulaires
 * distincts — l'alternative serait de générer les règles depuis cette table,
 * ce qui reste possible mais n'est pas fait aujourd'hui.
 */
import type { Permission, PollResultsVisibility, PollStatus, UserRole } from '@fl/types';

/** Rôles autorisés pour chaque permission. */
export const PERMISSION_MATRIX = {
  // --- Publications ---------------------------------------------------------
  // Seuls la FCPE et au-dessus publient dans le fil d'actualité.
  // Un parent s'exprime via les discussions, les signalements et les sondages.
  'post.create': ['fcpe', 'moderator', 'admin'],
  'post.update.own': ['fcpe', 'moderator', 'admin'],
  'post.update.any': ['moderator', 'admin'],
  'post.delete.own': ['fcpe', 'admin'],
  'post.delete.any': ['admin'],
  'post.pin': ['moderator', 'admin'],
  'post.archive': ['moderator', 'admin'],

  // --- Commentaires ---------------------------------------------------------
  'comment.create': ['parent', 'fcpe', 'moderator', 'admin'],
  'comment.delete.own': ['parent', 'fcpe', 'moderator', 'admin'],
  'comment.hide.any': ['moderator', 'admin'],
  'comment.delete.any': ['admin'],

  // --- Discussions ----------------------------------------------------------
  'channel.create': ['admin'],
  'channel.update': ['moderator', 'admin'],
  'channel.delete': ['admin'],
  'message.create': ['parent', 'fcpe', 'moderator', 'admin'],
  'message.delete.own': ['parent', 'fcpe', 'moderator', 'admin'],
  'message.hide.any': ['moderator', 'admin'],
  'message.delete.any': ['admin'],

  // --- Sondages -------------------------------------------------------------
  'poll.create': ['fcpe', 'moderator', 'admin'],
  'poll.update.own': ['fcpe', 'moderator', 'admin'],
  'poll.update.any': ['moderator', 'admin'],
  'poll.close': ['fcpe', 'moderator', 'admin'],
  'poll.vote': ['parent', 'fcpe', 'moderator', 'admin'],

  // --- Signalements ---------------------------------------------------------
  'report.create': ['parent', 'fcpe', 'moderator', 'admin'],
  'report.read.own': ['parent', 'fcpe', 'moderator', 'admin'],
  'report.read.any': ['fcpe', 'moderator', 'admin'],
  'report.update.status': ['fcpe', 'moderator', 'admin'],
  'report.reply.public': ['fcpe', 'moderator', 'admin'],
  'report.reply.internal': ['fcpe', 'moderator', 'admin'],
  'report.escalate': ['fcpe', 'moderator', 'admin'],

  // --- Sujets collectifs ----------------------------------------------------
  'issue.create': ['fcpe', 'moderator', 'admin'],
  'issue.update': ['fcpe', 'moderator', 'admin'],
  'issue.support': ['parent', 'fcpe', 'moderator', 'admin'],

  // --- Agenda et événements -------------------------------------------------
  'event.create': ['fcpe', 'moderator', 'admin'],
  'event.update': ['fcpe', 'moderator', 'admin'],
  'event.delete': ['moderator', 'admin'],
  'event.register': ['parent', 'fcpe', 'moderator', 'admin'],

  // --- Documents ------------------------------------------------------------
  'document.upload': ['fcpe', 'moderator', 'admin'],
  'document.update': ['fcpe', 'moderator', 'admin'],
  'document.delete': ['moderator', 'admin'],
  'document.read.internal': ['fcpe', 'moderator', 'admin'],

  // --- Conseils d'école -----------------------------------------------------
  'council.item.propose': ['parent', 'fcpe', 'moderator', 'admin'],
  'council.manage': ['fcpe', 'moderator', 'admin'],
  'council.answer.record': ['fcpe', 'moderator', 'admin'],

  // --- Espace privé FCPE ----------------------------------------------------
  'fcpe.access': ['fcpe', 'moderator', 'admin'],
  'fcpe.task.manage': ['fcpe', 'moderator', 'admin'],

  // --- Modération -----------------------------------------------------------
  'moderation.queue.read': ['moderator', 'admin'],
  'moderation.resolve': ['moderator', 'admin'],

  // --- Utilisateurs et administration ---------------------------------------
  'user.read.any': ['fcpe', 'moderator', 'admin'],
  'user.approve': ['admin'],
  'user.suspend': ['moderator', 'admin'],
  'user.role.change': ['admin'],
  'user.delete': ['admin'],
  'user.export': ['admin'],
  'notification.send': ['fcpe', 'moderator', 'admin'],
  'settings.update': ['admin'],
  'audit.read': ['admin'],
} as const satisfies Record<Permission, readonly UserRole[]>;

/** Liste exhaustive des permissions déclarées. */
export const ALL_PERMISSIONS = Object.keys(PERMISSION_MATRIX) as Permission[];

/** Index inverse : permission -> ensemble des rôles autorisés. */
const PERMISSION_TO_ROLES: Record<string, ReadonlySet<UserRole>> = Object.fromEntries(
  Object.entries(PERMISSION_MATRIX).map(([permission, roles]) => [
    permission,
    new Set(roles as readonly UserRole[]),
  ]),
);

/** Index direct : rôle -> ensemble des permissions accordées. */
export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = (
  ['parent', 'fcpe', 'moderator', 'admin'] as const
).reduce(
  (acc, role) => {
    acc[role] = new Set(
      ALL_PERMISSIONS.filter((permission) => PERMISSION_TO_ROLES[permission]?.has(role)),
    );
    return acc;
  },
  {} as Record<UserRole, ReadonlySet<Permission>>,
);

/**
 * Vérification de permission.
 *
 * ATTENTION : ceci sert à adapter l'interface et à échouer vite côté client.
 * La décision d'autorisation réelle appartient aux Security Rules et aux
 * Cloud Functions. Un utilisateur malveillant peut appeler Firestore
 * directement : c'est là que la vérification compte.
 */
export function hasPermission(role: UserRole | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

/** Vérifie plusieurs permissions d'un coup (toutes requises par défaut). */
export function hasEveryPermission(
  role: UserRole | undefined | null,
  permissions: readonly Permission[],
  mode: 'every' | 'some' = 'every',
): boolean {
  if (!role) return false;
  const granted = ROLE_PERMISSIONS[role];
  if (!granted) return false;
  return mode === 'every'
    ? permissions.every((permission) => granted.has(permission))
    : permissions.some((permission) => granted.has(permission));
}

/**
 * Autorisation d'agir sur une ressource dont on connaît l'auteur.
 *
 * Combine la permission « sur sa propre ressource » et la permission
 * « sur n'importe quelle ressource ». C'est le schéma utilisé partout dans
 * l'application (publications, commentaires, messages).
 */
export function canActOnOwnedResource(params: {
  role: UserRole | undefined | null;
  permissionOwn: Permission;
  permissionAny: Permission;
  resourceAuthorId: string;
  currentUserId: string | undefined | null;
}): boolean {
  const { role, permissionOwn, permissionAny, resourceAuthorId, currentUserId } = params;
  if (!role || !currentUserId) return false;
  if (resourceAuthorId === currentUserId) {
    return hasPermission(role, permissionOwn);
  }
  return hasPermission(role, permissionAny);
}

/** Rôles disposant d'un accès à l'espace privé de la FCPE. */
export function canAccessFcpeSpace(role: UserRole | undefined | null): boolean {
  return hasPermission(role, 'fcpe.access');
}

/**
 * Un rôle peut-il modérer (masquer, traiter les signalements) ?
 * Raccourci de lecture, utilisé dans l'interface d'administration.
 */
export function isModeratorOrAbove(role: UserRole | undefined | null): boolean {
  return role === 'moderator' || role === 'admin';
}

// ---------------------------------------------------------------------------
// Visibilité des résultats de sondage
// ---------------------------------------------------------------------------

export interface PollResultsVisibilityInput {
  readonly role: UserRole | undefined | null;
  readonly status: PollStatus;
  /** Absent d'un document antérieur : voir le repli ci-dessous. */
  readonly resultsVisibility: PollResultsVisibility | undefined;
  /** Ai-je voté sur ce sondage ? */
  readonly hasVoted: boolean;
}

/**
 * Ai-je le droit de demander les résultats d'un sondage ?
 *
 * ## Pourquoi cette fonction existe
 *
 * `getResults` **lève** quand les règles refusent, et une règle de lecture ne
 * filtre pas : elle ouvre ou ferme un document entier. Un écran qui demanderait
 * les résultats « pour voir » se heurterait donc à un refus, et un abonnement
 * refusé ne se rouvre pas tout seul. L'écran doit décider **avant** d'appeler —
 * ce qui suppose de savoir répondre à cette question sans interroger le
 * serveur.
 *
 * ## Elle reproduit `resultatsVisibles()` de `firebase/firestore.rules`
 *
 * L'échelle est **emboîtée** : `always` ⊃ `after_vote` ⊃ `after_end`.
 *
 * | Valeur       | Sondage ouvert                | Sondage clos |
 * | ------------ | ----------------------------- | ------------ |
 * | `always`     | lisible par tout membre actif | lisible      |
 * | `after_vote` | lisible par qui a voté        | lisible      |
 * | `after_end`  | lisible par la FCPE seule     | lisible      |
 *
 * Deux sources qui portent la même vérité sans pouvoir se lire : `permissions.test.ts`
 * lit `firebase/firestore.rules` sur le disque et **échoue** si les trois
 * branches de la règle cessent de correspondre à celles-ci. Sans ce contrôle,
 * une règle resserrée ferait échouer la lecture d'un écran qui se croit
 * autorisé — et rien ne le signalerait avant qu'un parent ne voie un message
 * d'erreur à la place d'un décompte.
 *
 * ## Avoir voté n'ouvre pas `after_end`
 *
 * C'est le point que la règle a d'abord manqué, en écrivant `aVote()` comme un
 * `||` inconditionnel : `after_end` et `after_vote` ne différaient plus que
 * pour un non-votant, et la troisième valeur ne tenait pas la promesse que son
 * libellé affiche. Voir le commentaire de `resultatsVisibles()`.
 *
 * ## Elle est plus stricte que la règle, jamais plus large
 *
 * Elle refuse quand le rôle est inconnu, ce que la règle ne fait pas : elle
 * ignore `role` pour `always`, et s'en remet à `isActive()`. Un écart n'est
 * donc possible que dans le sens qui **referme** — un écran renoncera à
 * demander des résultats qu'il aurait pu lire, jamais l'inverse. C'est le seul
 * sens acceptable pour une divergence entre deux sources.
 */
export function canReadPollResults(input: PollResultsVisibilityInput): boolean {
  // Échec **fermé** sur un rôle inconnu, et c'est une condition de plus que la
  // règle : celle-ci n'exige pas de rôle pour `always`, seulement `isActive()`
  // — une propriété du jeton que le client ne voit pas ici. Mais « je ne sais
  // pas encore qui je suis » ne doit pas ouvrir une permission. C'est la
  // convention de tout ce module, et un profil non résolu ne devrait pas faire
  // décider un écran : le prédicat est donc plus strict que la règle, jamais
  // plus large.
  if (!input.role) return false;

  // La FCPE voit toujours : c'est elle qui administre le sondage et qui doit
  // pouvoir en suivre le décompte avant de le clore.
  if (canAccessFcpeSpace(input.role)) return true;

  // Un brouillon n'a pas de résultats lisibles par un parent : personne ne l'a
  // voté, et le publier révélerait la question avant sa publication.
  if (input.status !== 'open' && input.status !== 'closed') return false;

  // Fermer un sondage publie ses résultats à tout le monde, y compris à qui
  // n'a pas voté. C'est ce que veut dire `after_end`, qui sans cela serait
  // identique à « jamais ».
  if (input.status === 'closed') return true;

  // Le repli est **fermé**, sur la plus restrictive des trois valeurs. Le
  // défaut du schéma, lui, est `after_vote` — mais une permission ne s'ouvre
  // pas par omission, et la règle lit un champ absent en levant.
  const visibilite = input.resultsVisibility ?? 'after_end';

  if (visibilite === 'always') return true;

  return visibilite === 'after_vote' && input.hasVoted;
}
