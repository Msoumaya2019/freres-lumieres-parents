/**
 * Valeurs de référence du domaine.
 *
 * Chaque tableau est typé sur l'union littérale correspondante de `@fl/types`.
 * Conséquence importante : si une valeur est ajoutée à l'union sans être
 * ajoutée ici, TypeScript signale l'oubli — impossible de désynchroniser
 * silencieusement le modèle et les listes déroulantes.
 */
import type {
  AdminAction,
  AudienceType,
  ChannelType,
  ClassLevel,
  CollectiveIssueStatus,
  ContentStatus,
  CouncilItemStatus,
  DevicePlatform,
  DocumentCategory,
  EventType,
  FcpeTaskPriority,
  FcpeTaskStatus,
  IssueSupportValue,
  MandatoryNotificationCategory,
  ModeratedStatus,
  ModerationAction,
  ModerationReason,
  ModerationStatus,
  ModerationTargetType,
  NotificationCategory,
  NotificationType,
  OptionalNotificationCategory,
  PollResultsVisibility,
  PollStatus,
  PostCategory,
  ReportCategory,
  ReportStatus,
  ReportVisibility,
  SchoolCouncilStatus,
  SchoolCouncilType,
  SchoolLevel,
  UserRole,
  UserStatus,
} from '@fl/types';

export const USER_ROLES = [
  'parent',
  'fcpe',
  'moderator',
  'admin',
] as const satisfies readonly UserRole[];

export const USER_STATUSES = [
  'pending',
  'active',
  'suspended',
  'rejected',
] as const satisfies readonly UserStatus[];

export const SCHOOL_LEVELS = [
  'maternelle',
  'elementaire',
  'primaire',
] as const satisfies readonly SchoolLevel[];

/** Niveaux ordonnés du plus jeune au plus âgé. */
export const CLASS_LEVELS = [
  'PS',
  'MS',
  'GS',
  'CP',
  'CE1',
  'CE2',
  'CM1',
  'CM2',
  'ULIS',
  'autre',
] as const satisfies readonly ClassLevel[];

/** Sous-ensemble utilisé pour les filtres « maternelle / élémentaire ». */
export const MATERNELLE_LEVELS = ['PS', 'MS', 'GS'] as const satisfies readonly ClassLevel[];
export const ELEMENTAIRE_LEVELS = [
  'CP',
  'CE1',
  'CE2',
  'CM1',
  'CM2',
] as const satisfies readonly ClassLevel[];

export const POST_CATEGORIES = [
  'information',
  'urgent',
  'cantine',
  'periscolaire',
  'travaux',
  'sortie_scolaire',
  'fcpe',
  'mairie',
  'evenement',
  'conseil_ecole',
  'autre',
] as const satisfies readonly PostCategory[];

/**
 * Réactions autorisées sur un commentaire.
 *
 * Liste **fermée**, et reprise en littéral dans `firebase/firestore.rules` :
 * une règle ne peut pas importer une constante TypeScript. La concordance est
 * donc manuelle, comme celle de la matrice de permissions — toute modification
 * ici doit être reportée là-bas dans le même changement.
 *
 * Les emojis choisis sont tous d'un seul point de code. Les variantes comme
 * « ❤️ » en comptent deux (cœur + sélecteur de variante) : elles resteraient
 * valides, mais exigeraient que la source TypeScript et le fichier de règles
 * portent exactement la même séquence d'octets. Autant éviter la question.
 */
export const REACTION_EMOJIS = ['👍', '🎉', '🙏', '😮', '😍'] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

/** Garde de type : refuse tout ce qui n'est pas dans la liste ci-dessus. */
export function isReactionEmoji(value: string): value is ReactionEmoji {
  return (REACTION_EMOJIS as readonly string[]).includes(value);
}

/**
 * Nom lisible d'une réaction, destiné aux lecteurs d'écran.
 *
 * Sans cette traduction, VoiceOver énonce « visage avec des étoiles, 2 » —
 * incompréhensible hors contexte visuel. Le libellé vit à côté de la liste des
 * émoticônes, et son type est `Record<ReactionEmoji, string>` : ajouter une
 * émoticône sans lui donner de nom ne compile pas.
 */
export const REACTION_LABELS: Record<ReactionEmoji, string> = {
  '👍': 'approbation',
  '🎉': 'bravo',
  '🙏': 'merci',
  '😮': 'surprise',
  '😍': 'soutien',
};

export const CONTENT_STATUSES = [
  'draft',
  'published',
  'hidden',
  'deleted',
  'archived',
] as const satisfies readonly ContentStatus[];

/**
 * États d'un contenu écrit par un membre (commentaire, message).
 *
 * Distincts de `CONTENT_STATUSES` : un commentaire n'est ni brouillon ni
 * archivé, et son état normal s'appelle `visible`. Ces trois valeurs sont
 * recopiées dans `firebase/firestore.rules` (`d.status == 'visible'` pour la
 * création, `in ['visible', 'hidden']` pour la modération) — une règle ne peut
 * pas importer de constante TypeScript.
 */
export const MODERATED_STATUSES = [
  'visible',
  'hidden',
  'deleted',
] as const satisfies readonly ModeratedStatus[];

export const AUDIENCE_TYPES = [
  'all',
  'school',
  'level',
  'class',
  'fcpe',
] as const satisfies readonly AudienceType[];

export const NOTIFICATION_TYPES = [
  'post_published',
  'urgent_alert',
  'new_comment',
  'comment_reply',
  'new_message',
  'new_poll',
  'report_update',
  'event_reminder',
  'account_validated',
] as const satisfies readonly NotificationType[];

export const NOTIFICATION_CATEGORIES = [
  'urgent',
  'publications',
  'discussions',
  'sondages',
  'signalements',
  'agenda',
  'vie_fcpe',
] as const satisfies readonly NotificationCategory[];

/**
 * Catégories que l'utilisateur ne peut PAS désactiver.
 *
 * Les alertes urgentes doivent toujours passer : une fermeture d'école
 * annoncée trop tard ne se rattrape pas.
 *
 * Cette liste est la **source unique** de l'exception, et elle est lue par les
 * deux endroits qui l'appliquent :
 *
 *  - `notificationPrefsSchema` refuse ces valeurs dans `disabledCategories` —
 *    une préférence sans effet serait un mensonge à l'utilisateur ;
 *  - `filterRecipients` ne filtre jamais ces catégories à l'envoi. C'est la
 *    garantie réelle, celle qui tient même si un document en base porte la
 *    valeur : les règles Firestore ne valident pas `notificationPrefs`, donc
 *    un document écrit par une version antérieure, ou par un client qui
 *    contourne le schéma, peut très bien la contenir.
 */
export const MANDATORY_NOTIFICATION_CATEGORIES = [
  'urgent',
] as const satisfies readonly MandatoryNotificationCategory[];

/** Vrai si la catégorie ne peut pas être désactivée par l'utilisateur. */
export function isMandatoryNotificationCategory(category: NotificationCategory): boolean {
  return (MANDATORY_NOTIFICATION_CATEGORIES as readonly NotificationCategory[]).includes(category);
}

/**
 * Catégories que l'utilisateur PEUT désactiver : toutes sauf les obligatoires.
 *
 * Dérivée de `NOTIFICATION_CATEGORIES` plutôt que recopiée, pour que l'écran de
 * préférences ne puisse ni proposer un interrupteur sans effet, ni oublier une
 * catégorie ajoutée plus tard.
 */
export const OPTIONAL_NOTIFICATION_CATEGORIES: readonly OptionalNotificationCategory[] =
  NOTIFICATION_CATEGORIES.filter(
    (category): category is OptionalNotificationCategory =>
      !isMandatoryNotificationCategory(category),
  );

export const DEVICE_PLATFORMS = [
  'ios',
  'android',
  'web',
] as const satisfies readonly DevicePlatform[];

export const CHANNEL_TYPES = [
  'general',
  'school',
  'level',
  'theme',
  'fcpe',
] as const satisfies readonly ChannelType[];

export const POLL_STATUSES = [
  'draft',
  'open',
  'closed',
  'archived',
] as const satisfies readonly PollStatus[];

export const POLL_RESULTS_VISIBILITIES = [
  'always',
  'after_vote',
  'after_end',
] as const satisfies readonly PollResultsVisibility[];

export const REPORT_CATEGORIES = [
  'cantine',
  'securite',
  'harcelement',
  'periscolaire',
  'locaux',
  'enseignement',
  'transport',
  'autre',
] as const satisfies readonly ReportCategory[];

/** Ordre chronologique du parcours d'un signalement. */
export const REPORT_STATUSES = [
  'received',
  'in_progress',
  'forwarded_school',
  'forwarded_city',
  'resolved',
  'closed',
] as const satisfies readonly ReportStatus[];

export const REPORT_VISIBILITIES = [
  'private',
  'collective',
] as const satisfies readonly ReportVisibility[];

export const COLLECTIVE_ISSUE_STATUSES = [
  'open',
  'in_progress',
  'forwarded_school',
  'forwarded_city',
  'validated',
  'resolved',
  'rejected',
] as const satisfies readonly CollectiveIssueStatus[];

export const ISSUE_SUPPORT_VALUES = [
  'concerned',
  'for',
  'against',
] as const satisfies readonly IssueSupportValue[];

export const EVENT_TYPES = [
  'conseil_ecole',
  'reunion',
  'sortie',
  'vacances',
  'kermesse',
  'election',
  'evenement_fcpe',
  'evenement_scolaire',
  'autre',
] as const satisfies readonly EventType[];

export const DOCUMENT_CATEGORIES = [
  'compte_rendu',
  'flyer',
  'menu',
  'reglement',
  'document_mairie',
  'document_fcpe',
  'autre',
] as const satisfies readonly DocumentCategory[];

export const SCHOOL_COUNCIL_TYPES = [
  'maternelle',
  'elementaire',
  'extraordinaire',
] as const satisfies readonly SchoolCouncilType[];

export const SCHOOL_COUNCIL_STATUSES = [
  'planned',
  'held',
  'closed',
  'cancelled',
] as const satisfies readonly SchoolCouncilStatus[];

export const COUNCIL_ITEM_STATUSES = [
  'draft',
  'submitted',
  'on_agenda',
  'answered',
  'deferred',
  'dropped',
] as const satisfies readonly CouncilItemStatus[];

export const MODERATION_TARGET_TYPES = [
  'post',
  'comment',
  'message',
] as const satisfies readonly ModerationTargetType[];

export const MODERATION_REASONS = [
  'spam',
  'insulte',
  'harcelement',
  'hors_sujet',
  'donnees_personnelles',
  'contenu_choquant',
  'autre',
] as const satisfies readonly ModerationReason[];

export const MODERATION_STATUSES = [
  'open',
  'in_review',
  'resolved',
  'dismissed',
] as const satisfies readonly ModerationStatus[];

export const MODERATION_ACTIONS = [
  'none',
  'hidden',
  'deleted',
  'warned',
  'suspended',
] as const satisfies readonly ModerationAction[];

export const ADMIN_ACTIONS = [
  'user.approve',
  'user.reject',
  'user.suspend',
  'user.reactivate',
  'user.role_change',
  'user.delete',
  'user.export_data',
  'post.create',
  'post.update',
  'post.delete',
  'post.pin',
  'content.hide',
  'content.restore',
  'notification.send',
  'settings.update',
  'report.update',
  'poll.close',
] as const satisfies readonly AdminAction[];

export const FCPE_TASK_STATUSES = [
  'todo',
  'in_progress',
  'done',
  'cancelled',
] as const satisfies readonly FcpeTaskStatus[];

export const FCPE_TASK_PRIORITIES = [
  'low',
  'normal',
  'high',
] as const satisfies readonly FcpeTaskPriority[];

// ---------------------------------------------------------------------------
// Règles métier paramétrables
// ---------------------------------------------------------------------------

/** Limites d'upload, appliquées côté client ET côté Storage Rules. */
export const UPLOAD_LIMITS = {
  image: {
    /** Taille maximale après compression, en octets (2 Mio). */
    maxBytes: 2 * 1024 * 1024,
    /** Taille maximale du fichier d'origine accepté par le sélecteur. */
    maxSourceBytes: 15 * 1024 * 1024,
    /** Résolution maximale après redimensionnement. */
    maxWidth: 1600,
    maxHeight: 1600,
    /** Qualité JPEG/WEBP appliquée à la compression. */
    quality: 0.8,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  document: {
    /** Taille maximale d'un PDF (10 Mio). */
    maxBytes: 10 * 1024 * 1024,
    mimeTypes: ['application/pdf'],
  },
  /** Nombre maximal de pièces jointes par publication. */
  maxAttachmentsPerPost: 5,
} as const;

/** Longueurs maximales des textes, appliquées côté client et par Zod. */
export const TEXT_LIMITS = {
  postTitle: 140,
  postBody: 8000,
  commentBody: 2000,
  messageBody: 2000,
  reportTitle: 140,
  reportDescription: 4000,
  reportReply: 2000,
  pollQuestion: 200,
  pollDescription: 1000,
  pollOptionLabel: 120,
  pollMaxOptions: 10,
  eventTitle: 140,
  eventDescription: 4000,
  documentTitle: 140,
  documentDescription: 1000,
  userName: 60,
  channelName: 60,
  channelDescription: 300,
  councilItemTitle: 200,
  councilItemBody: 4000,
} as const;

/** Pagination : taille de page par défaut, choisie pour limiter les lectures. */
export const PAGE_SIZES = {
  feed: 10,
  comments: 20,
  messages: 30,
  channels: 30,
  documents: 20,
  events: 20,
  reports: 20,
  users: 25,
  moderationQueue: 20,
  polls: 15,
} as const;

/** Anti-spam : fenêtres glissantes appliquées côté Cloud Functions. */
export const RATE_LIMITS = {
  postsPerHour: 5,
  commentsPerHour: 30,
  messagesPerMinute: 10,
  reportsPerDay: 5,
  moderationReportsPerDay: 20,
  pollVotesPerHour: 20,
} as const;

/** Délai avant de pouvoir modifier ou supprimer son propre contenu (minutes). */
export const EDIT_WINDOW_MINUTES = 30;
