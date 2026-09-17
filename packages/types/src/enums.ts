/**
 * Énumérations du domaine, exprimées en unions de chaînes littérales.
 *
 * Avantages par rapport à un `enum` TypeScript :
 *  - sérialisation JSON directe, sans code numérique ;
 *  - comparaison naturelle avec les valeurs stockées dans Firestore ;
 *  - aucune génération de code au runtime.
 *
 * Les tableaux de valeurs correspondants (pour itérer, valider, afficher)
 * se trouvent dans `@fl/shared/constants`.
 */

// ---------------------------------------------------------------------------
// Utilisateurs et rôles
// ---------------------------------------------------------------------------

/** Rôle applicatif. Stocké dans `users/{uid}.role` ET dans les Custom Claims. */
export type UserRole = 'parent' | 'fcpe' | 'moderator' | 'admin';

/** Cycle de vie d'un compte. Un compte `pending` n'accède à rien. */
export type UserStatus = 'pending' | 'active' | 'suspended' | 'rejected';

// ---------------------------------------------------------------------------
// Établissements, niveaux, classes
// ---------------------------------------------------------------------------

/** Niveau d'enseignement de l'établissement. */
export type SchoolLevel = 'maternelle' | 'elementaire' | 'primaire';

/** Niveau de classe, du plus jeune au plus âgé. */
export type ClassLevel =
  'PS' | 'MS' | 'GS' | 'CP' | 'CE1' | 'CE2' | 'CM1' | 'CM2' | 'ULIS' | 'autre';

// ---------------------------------------------------------------------------
// Publications
// ---------------------------------------------------------------------------

export type PostCategory =
  | 'information'
  | 'urgent'
  | 'cantine'
  | 'periscolaire'
  | 'travaux'
  | 'sortie_scolaire'
  | 'fcpe'
  | 'mairie'
  | 'evenement'
  | 'conseil_ecole'
  | 'autre';

/** Cycle de vie d'un contenu publié par la FCPE (publication, événement, document). */
export type ContentStatus = 'draft' | 'published' | 'hidden' | 'deleted' | 'archived';

/**
 * Cycle de vie d'un contenu écrit par un membre (commentaire, message).
 *
 * Volontairement distinct de `ContentStatus`, qui ne décrit pas ce cas : un
 * commentaire ne connaît ni le brouillon ni l'archivage — il naît visible ou
 * n'existe pas — et son état normal s'appelle `visible`, mot absent de
 * `ContentStatus`. Les règles Firestore s'appuient sur ce vocabulaire
 * (`resource.data.status == 'visible'` pour la lecture) et les requêtes du
 * client le filtrent à l'identique (`fetchComments`).
 *
 * Typer un commentaire en `ContentStatus` autorisait donc à écrire
 * `comment.status === 'published'` : du code qui compile, passe la revue, et ne
 * peut jamais être vrai. C'était le cas jusqu'ici.
 */
export type ModeratedStatus = 'visible' | 'hidden' | 'deleted';

// ---------------------------------------------------------------------------
// Audiences
// ---------------------------------------------------------------------------

export type AudienceType = 'all' | 'school' | 'level' | 'class' | 'fcpe';

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export type NotificationType =
  | 'post_published'
  | 'urgent_alert'
  | 'new_comment'
  | 'comment_reply'
  | 'new_message'
  | 'new_poll'
  | 'report_update'
  | 'event_reminder'
  | 'account_validated';

/**
 * Catégories de notifications.
 *
 * `urgent` en fait partie — une fermeture d'école est bien une notification —
 * mais elle n'est pas désactivable. Le commentaire précédent affirmait
 * l'inverse (« que le parent peut désactiver ») alors que le type contient
 * `urgent` : l'écart entre les deux était invisible pour le compilateur, donc
 * la distinction vit maintenant dans deux types dérivés.
 */
export type NotificationCategory =
  'urgent' | 'publications' | 'discussions' | 'sondages' | 'signalements' | 'agenda' | 'vie_fcpe';

/** Catégories que l'utilisateur ne peut pas désactiver. */
export type MandatoryNotificationCategory = 'urgent';

/**
 * Catégories que l'utilisateur peut désactiver.
 *
 * Dérivé de `NotificationCategory` : ajouter demain une catégorie obligatoire
 * la retire d'ici automatiquement, et le compilateur signalera les écrans de
 * préférences qui la proposaient encore.
 */
export type OptionalNotificationCategory = Exclude<
  NotificationCategory,
  MandatoryNotificationCategory
>;

export type DevicePlatform = 'ios' | 'android' | 'web';

// ---------------------------------------------------------------------------
// Discussions
// ---------------------------------------------------------------------------

export type ChannelType = 'general' | 'school' | 'level' | 'theme' | 'fcpe';

// ---------------------------------------------------------------------------
// Sondages
// ---------------------------------------------------------------------------

export type PollStatus = 'draft' | 'open' | 'closed' | 'archived';

/** Qui peut voir les résultats, et quand. */
export type PollResultsVisibility = 'always' | 'after_vote' | 'after_end';

// ---------------------------------------------------------------------------
// Signalements
// ---------------------------------------------------------------------------

export type ReportCategory =
  | 'cantine'
  | 'securite'
  | 'harcelement'
  | 'periscolaire'
  | 'locaux'
  | 'enseignement'
  | 'transport'
  | 'autre';

export type ReportStatus =
  'received' | 'in_progress' | 'forwarded_school' | 'forwarded_city' | 'resolved' | 'closed';

/** Visibilité d'un signalement. `private` par défaut, jamais public. */
export type ReportVisibility = 'private' | 'collective';

// ---------------------------------------------------------------------------
// Sujets collectifs
// ---------------------------------------------------------------------------

export type CollectiveIssueStatus =
  | 'open'
  | 'in_progress'
  | 'forwarded_school'
  | 'forwarded_city'
  | 'validated'
  | 'resolved'
  | 'rejected';

/** Position d'un parent sur un sujet collectif. */
export type IssueSupportValue = 'concerned' | 'for' | 'against';

// ---------------------------------------------------------------------------
// Agenda et événements
// ---------------------------------------------------------------------------

export type EventType =
  | 'conseil_ecole'
  | 'reunion'
  | 'sortie'
  | 'vacances'
  | 'kermesse'
  | 'election'
  | 'evenement_fcpe'
  | 'evenement_scolaire'
  | 'autre';

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export type DocumentCategory =
  'compte_rendu' | 'flyer' | 'menu' | 'reglement' | 'document_mairie' | 'document_fcpe' | 'autre';

// ---------------------------------------------------------------------------
// Conseils d'école
// ---------------------------------------------------------------------------

export type SchoolCouncilType = 'maternelle' | 'elementaire' | 'extraordinaire';

export type SchoolCouncilStatus = 'planned' | 'held' | 'closed' | 'cancelled';

/** Nature d'un point soumis au conseil d'école. */
export type CouncilItemKind = 'question' | 'topic';

export type CouncilItemStatus =
  'draft' | 'submitted' | 'on_agenda' | 'answered' | 'deferred' | 'dropped';

/** Qui a répondu à la question. */
export type CouncilAnswerSource = 'school' | 'city' | 'fcpe';

// ---------------------------------------------------------------------------
// Modération
// ---------------------------------------------------------------------------

export type ModerationTargetType = 'post' | 'comment' | 'message';

export type ModerationReason =
  | 'spam'
  | 'insulte'
  | 'harcelement'
  | 'hors_sujet'
  | 'donnees_personnelles'
  | 'contenu_choquant'
  | 'autre';

export type ModerationStatus = 'open' | 'in_review' | 'resolved' | 'dismissed';

/** Sanction appliquée suite à un signalement. */
export type ModerationAction = 'none' | 'hidden' | 'deleted' | 'warned' | 'suspended';

// ---------------------------------------------------------------------------
// Journal d'administration
// ---------------------------------------------------------------------------

export type AdminAction =
  | 'user.approve'
  | 'user.reject'
  | 'user.suspend'
  | 'user.reactivate'
  | 'user.role_change'
  | 'user.delete'
  | 'user.export_data'
  | 'post.create'
  | 'post.update'
  | 'post.delete'
  | 'post.pin'
  | 'content.hide'
  | 'content.restore'
  | 'notification.send'
  | 'settings.update'
  | 'report.update'
  | 'poll.close';

// ---------------------------------------------------------------------------
// Tâches internes FCPE
// ---------------------------------------------------------------------------

export type FcpeTaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
export type FcpeTaskPriority = 'low' | 'normal' | 'high';
