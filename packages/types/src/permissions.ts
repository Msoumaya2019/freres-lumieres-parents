/**
 * Permissions applicatives.
 *
 * Cette matrice est la RÉFÉRENCE UNIQUE du projet. Elle est utilisée par :
 *  - l'interface mobile et l'admin, pour masquer les actions interdites ;
 *  - la couche services, pour refuser une action avant l'appel réseau ;
 *  - les tests, pour vérifier que la matrice et `firestore.rules` concordent.
 *
 * ATTENTION : masquer un bouton n'est jamais une mesure de sécurité.
 * Les Security Rules et les Cloud Functions restent seuls juges.
 */
export type Permission =
  // --- Publications ---------------------------------------------------------
  | 'post.create'
  | 'post.update.own'
  | 'post.update.any'
  | 'post.delete.own'
  | 'post.delete.any'
  | 'post.pin'
  | 'post.archive'
  // --- Commentaires ---------------------------------------------------------
  | 'comment.create'
  | 'comment.delete.own'
  | 'comment.hide.any'
  | 'comment.delete.any'
  // --- Discussions ----------------------------------------------------------
  | 'channel.create'
  | 'channel.update'
  | 'channel.delete'
  | 'message.create'
  | 'message.delete.own'
  | 'message.hide.any'
  | 'message.delete.any'
  // --- Sondages -------------------------------------------------------------
  | 'poll.create'
  | 'poll.update.own'
  | 'poll.update.any'
  | 'poll.open'
  | 'poll.close'
  | 'poll.vote'
  // --- Signalements ---------------------------------------------------------
  | 'report.create'
  | 'report.read.own'
  | 'report.read.any'
  | 'report.update.status'
  | 'report.reply.public'
  | 'report.reply.internal'
  | 'report.escalate'
  // --- Sujets collectifs ----------------------------------------------------
  | 'issue.create'
  | 'issue.update'
  | 'issue.support'
  // --- Agenda et événements -------------------------------------------------
  | 'event.create'
  | 'event.update'
  | 'event.delete'
  | 'event.register'
  // --- Documents ------------------------------------------------------------
  | 'document.upload'
  | 'document.update'
  | 'document.delete'
  | 'document.read.internal'
  // --- Conseils d'école -----------------------------------------------------
  | 'council.item.propose'
  | 'council.manage'
  | 'council.answer.record'
  // --- Espace privé FCPE ----------------------------------------------------
  | 'fcpe.access'
  | 'fcpe.task.manage'
  // --- Modération -----------------------------------------------------------
  | 'moderation.queue.read'
  | 'moderation.resolve'
  // --- Utilisateurs et administration ---------------------------------------
  | 'user.read.any'
  | 'user.approve'
  | 'user.suspend'
  | 'user.role.change'
  | 'user.delete'
  | 'user.export'
  | 'notification.send'
  | 'settings.update'
  | 'audit.read';

/** Rôle minimal capable d'exécuter une action sensible. */
export interface PermissionRule {
  readonly permission: Permission;
  /** Rôles autorisés. Un rôle « supérieur » n'hérite PAS automatiquement. */
  readonly allowedRoles: readonly ('parent' | 'fcpe' | 'moderator' | 'admin')[];
  /** L'utilisateur doit-il être l'auteur de la ressource ? */
  readonly ownerOnly?: boolean;
  /** Description lisible, affichée dans la documentation et les tests. */
  readonly description: string;
}

/** Claim « role » tel qu'il est injecté dans le jeton Firebase. */
export interface AuthClaims {
  readonly role: 'parent' | 'fcpe' | 'moderator' | 'admin';
  readonly status: 'pending' | 'active' | 'suspended' | 'rejected';
  /** Organisation principale de l'utilisateur. */
  readonly orgId: string;
  /** Toutes les organisations auxquelles l'utilisateur a accès. */
  readonly orgIds: readonly string[];
}
