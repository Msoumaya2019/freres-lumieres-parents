import type {
  Attendance,
  Auditable,
  ChildId,
  ClassId,
  CollectiveIssueId,
  CommentId,
  CouncilItemId,
  DateLike,
  DeviceTokenId,
  DocumentId,
  EventId,
  FcpeTaskId,
  ISODate,
  ISODateTime,
  MessageId,
  ModerationReportId,
  NotificationId,
  OrganizationId,
  OrganizationScoped,
  PollId,
  PostId,
  ReportId,
  SchoolCouncilId,
  SchoolId,
  UserId,
} from './common.js';
import type { Audience } from './audience.js';
import type {
  AdminAction,
  ChannelType,
  ClassLevel,
  CollectiveIssueStatus,
  ContentStatus,
  CouncilAnswerSource,
  CouncilItemKind,
  CouncilItemStatus,
  DevicePlatform,
  DocumentCategory,
  EventType,
  FcpeTaskPriority,
  FcpeTaskStatus,
  IssueSupportValue,
  ModeratedStatus,
  ModerationAction,
  ModerationReason,
  ModerationStatus,
  ModerationTargetType,
  NotificationCategory,
  NotificationType,
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
} from './enums.js';

// ===========================================================================
//  1. Organisation, établissements, classes
// ===========================================================================

/**
 * Organisation propriétaire des contenus (aujourd'hui la FCPE de Montmagny,
 * demain une autre association). Point d'ancrage du multi-tenant.
 */
export interface Organization extends Auditable {
  id: OrganizationId;
  name: string;
  /** Identifiant lisible et stable, utilisé dans les URL. Ex. « fcpe-montmagny ». */
  slug: string;
  city: string;
  /** Préférences globales (rétention, modération, etc.). */
  settings: OrganizationSettings;
  active: boolean;
}

/**
 * Préférences globales de l'organisation.
 *
 * ## Pourquoi `urgentAlwaysNotifies` n'y est plus
 *
 * Le champ demandait si les alertes urgentes devaient toujours notifier, et il
 * n'était lu par aucun code. La question est maintenant tranchée : l'exception
 * est **absolue**, donc un booléen qui n'accepte qu'une valeur aurait laissé
 * croire qu'un administrateur pouvait l'affaiblir.
 *
 * La règle vit dans `MANDATORY_NOTIFICATION_CATEGORIES`, dans le code, et non
 * dans les données : elle ne se règle pas, elle s'applique.
 */
export interface OrganizationSettings {
  /** Durée de conservation des signalements clos, en jours. */
  reportRetentionDays: number;
  /** Nombre de signalements distincts déclenchant une proposition de sujet collectif. */
  collectiveIssueThreshold: number;
}

/** Établissement scolaire. */
export interface School extends Auditable, OrganizationScoped {
  id: SchoolId;
  name: string;
  level: SchoolLevel;
  address?: string;
  /** Niveaux de classes proposés, pour alimenter les formulaires. */
  classLevels: readonly ClassLevel[];
  active: boolean;
}

/** Classe (ex. « CE1 A »). Aucune donnée nominative d'enseignant n'est stockée. */
export interface SchoolClass extends Auditable, OrganizationScoped {
  id: ClassId;
  name: string;
  level: ClassLevel;
  /**
   * Établissement de rattachement.
   *
   * Redéclaré obligatoire ici, alors qu'il est facultatif dans
   * `OrganizationScoped` : une classe appartient toujours à une école précise.
   * C'est ce champ qui permet au formulaire d'inscription de ne proposer que
   * les classes de l'établissement choisi — sans lui, il faudrait filtrer sur
   * le seul niveau, et deux écoles proposant le même niveau (ULIS, par
   * exemple) deviendraient indiscernables.
   */
  schoolId: SchoolId;
  /** Année scolaire au format « 2026-2027 ». */
  academicYear: string;
}

// ===========================================================================
//  2. Utilisateurs et enfants
// ===========================================================================

/**
 * Profil utilisateur.
 *
 * Le document est la source de vérité pour l'affichage. Les décisions de
 * sécurité, elles, s'appuient sur les Custom Claims (voir `AuthClaims`) afin
 * d'éviter une lecture Firestore facturée à chaque évaluation de règle.
 */
export interface UserProfile extends Auditable {
  id: UserId;
  firstName: string;
  lastName: string;
  email: string;
  /** Numéro de téléphone optionnel, utilisé uniquement pour les urgences. */
  phone?: string;
  role: UserRole;
  status: UserStatus;

  /** Organisation principale. Stockée à plat pour permettre les requêtes filtrées. */
  orgId: OrganizationId;
  /** Toutes les organisations auxquelles l'utilisateur a accès. */
  orgIds: readonly OrganizationId[];
  schoolIds: readonly SchoolId[];

  /**
   * Dénormalisation volontaire : niveaux et classes des enfants, recopiés
   * ici pour permettre le ciblage des notifications sans lire la
   * sous-collection `children` (une lecture par utilisateur économisée).
   */
  levels: readonly ClassLevel[];
  classIds: readonly ClassId[];

  /** Clés d'audience calculées, utilisées pour le fil d'actualité et les envois ciblés. */
  audienceKeys: readonly string[];

  /** Préférences de notification, une entrée par catégorie désactivable. */
  notificationPrefs: NotificationPreferences;

  /** Consentements explicites (RGPD). */
  consents: UserConsents;

  /** Dernière activité connue, alimentée au plus une fois par jour. */
  lastSeenAt?: DateLike;
  /** Horodatage de la validation par un administrateur. */
  approvedAt?: DateLike;
  approvedBy?: UserId;
  /** Motif de suspension ou de refus, visible par l'administrateur. */
  statusReason?: string;
  /** Version des règles de confidentialité acceptées. */
  privacyPolicyVersion?: string;
}

export interface NotificationPreferences {
  /** Interrupteur général. */
  enabled: boolean;
  /** Catégories désactivées par l'utilisateur. */
  disabledCategories: readonly NotificationCategory[];
}

export interface UserConsents {
  /** Acceptation de la politique de confidentialité (obligatoire à l'inscription). */
  privacyPolicy: boolean;
  /** Acceptation du règlement des discussions (obligatoire à l'inscription). */
  communityRules: boolean;
  /** Autorisation d'être contacté par la FCPE (facultatif). */
  fcpeContact: boolean;
}

/**
 * Enfant rattaché à un parent — données strictement minimales.
 *
 * Aucun nom, aucune date de naissance, aucun identifiant d'élève.
 * Le prénom est facultatif et n'est jamais exposé publiquement.
 */
export interface ChildProfile extends Auditable {
  id: ChildId;
  /** Prénom facultatif, pour l'affichage dans l'espace du parent uniquement. */
  firstName?: string;
  schoolId: SchoolId;
  level: ClassLevel;
  classId?: ClassId;
  academicYear: string;
}

/**
 * Jeton d'appareil pour les notifications. Collection racine `deviceTokens`.
 *
 * ## Deux champs appartiennent au serveur, le reste au client
 *
 * `audienceKeys` et `disabledCategories` sont recopiés du profil par une
 * Cloud Function. Les règles Firestore refusent toute écriture du client sur
 * ces deux champs : ils sont vides à la création, puis figés.
 *
 * La raison est différente pour chacun :
 *
 *  - `audienceKeys` est une **autorisation**. Le serveur sélectionne les
 *    destinataires d'une notification en le lisant ; déclaré par le client, il
 *    permettrait à un parent de s'abonner à l'audience de la FCPE ou à la
 *    classe d'un autre. Les règles ne peuvent pas vérifier une clé `class:` ou
 *    `level:` — elles ne lisent pas les enfants de l'appelant.
 *  - `disabledCategories` est une **préférence**, donc inoffensive en soi. Mais
 *    elle est posée par utilisateur et recopiée par appareil : un client ne
 *    peut atteindre que l'appareil courant, donc les autres divergeraient.
 *    Un parent désactivant « discussions » sur son téléphone continuerait de
 *    les recevoir sur sa tablette, alors que l'écran de préférences affiche
 *    l'inverse.
 *
 * `enabled`, lui, reste au client : c'est l'interrupteur de **cet appareil**,
 * qui ne concerne que lui.
 */
export interface DeviceToken {
  id: DeviceTokenId;
  uid: UserId;
  orgId: OrganizationId;
  token: string;
  platform: DevicePlatform;
  /**
   * Clés d'audience recopiées du profil, pour cibler sans lire le profil.
   *
   * Vide tant que le compte n'est pas `active`, ou que l'interrupteur général
   * des notifications est éteint : un appareil dont on ne veut plus rien
   * savoir ne doit rien recevoir, et le repli doit être fermé.
   */
  audienceKeys: readonly string[];
  /** Catégories désactivées, recopiées du profil par la même Cloud Function. */
  disabledCategories: readonly NotificationCategory[];
  locale?: string;
  appVersion?: string;
  /** Interrupteur propre à cet appareil, actionnable par le client. */
  enabled: boolean;
  createdAt: DateLike;
  lastUsedAt: DateLike;
}

// ===========================================================================
//  3. Publications et commentaires
// ===========================================================================

/** Pièce jointe stockée dans Firebase Storage. */
export interface Attachment {
  /** Chemin dans le bucket (jamais une URL signée : elle expire). */
  storagePath: string;
  /** Type MIME validé à l'upload. */
  contentType: string;
  fileName: string;
  /** Taille en octets, après compression. */
  size: number;
  width?: number;
  height?: number;
}

/** Publication du fil d'actualité. */
export interface Post extends Auditable, OrganizationScoped {
  id: PostId;
  title: string;
  body: string;
  category: PostCategory;
  audience: Audience;
  /** Clés d'audience dénormalisées (voir `AudienceKey`). */
  audienceKeys: readonly string[];
  attachments: readonly Attachment[];
  /** Lien externe facultatif. */
  linkUrl?: string;
  authorId: UserId;
  authorName: string;
  authorRole: UserRole;
  commentsEnabled: boolean;
  pinned: boolean;
  status: ContentStatus;
  publishedAt: DateLike;
  /** Compteurs dénormalisés, maintenus par Cloud Functions. */
  stats: PostStats;
  /** Horodatage du dernier envoi de notification, pour éviter les doublons. */
  notifiedAt?: DateLike;
  /** Épinglage programmé : date de fin d'épinglage automatique. */
  pinnedUntil?: DateLike;
}

export interface PostStats {
  commentCount: number;
  reactionCount: number;
  /** Nombre de destinataires estimé au moment de la notification. */
  notifiedCount?: number;
}

/** Commentaire, stocké en sous-collection de la publication. */
export interface Comment extends Auditable {
  id: CommentId;
  postId: PostId;
  authorId: UserId;
  authorName: string;
  authorRole: UserRole;
  body: string;
  /** Identifiant du commentaire parent, pour les réponses à un niveau. */
  parentId?: CommentId;
  /** Réponses reçues, compteur dénormalisé. */
  replyCount: number;
  reactions: Readonly<Record<string, number>>;
  status: ModeratedStatus;
  reportCount: number;
}

// ===========================================================================
//  4. Discussions
// ===========================================================================

/** Canal de discussion collectif. Les messageries privées 1-à-1 sont exclues de la V1. */
export interface Channel extends Auditable, OrganizationScoped {
  id: string;
  name: string;
  description?: string;
  type: ChannelType;
  level?: ClassLevel;
  /** Audience du canal ; un canal `fcpe` est réservé aux membres. */
  audience: Audience;
  audienceKeys: readonly string[];
  /** Ordre d'affichage dans la liste. */
  order: number;
  /** Canal en lecture seule (archives, annonces). */
  readOnly: boolean;
  status: ContentStatus;
  stats: ChannelStats;
}

export interface ChannelStats {
  messageCount: number;
  /** Dénormalisation : évite une requête supplémentaire pour la liste des canaux. */
  lastMessageAt?: DateLike;
  lastMessagePreview?: string;
  lastMessageAuthorName?: string;
}

/** Message d'un canal, stocké en sous-collection. */
export interface ChannelMessage extends Auditable {
  id: MessageId;
  channelId: string;
  authorId: UserId;
  authorName: string;
  authorRole: UserRole;
  body: string;
  attachments: readonly Attachment[];
  /** Message auquel on répond (fil linéaire, pas d'arborescence profonde). */
  replyToId?: MessageId;
  replyToPreview?: string;
  reactions: Readonly<Record<string, number>>;
  status: ModeratedStatus;
  reportCount: number;
}

/**
 * Lot de messages d'un canal en attente d'être annoncé.
 *
 * ## Pourquoi ce document existe
 *
 * Un canal actif ne doit pas produire quarante notifications : les messages
 * sont **regroupés** sur une fenêtre de cinq minutes, et une seule notification
 * annonce le lot. Ce document est l'état de cette fenêtre.
 *
 * ## Pourquoi la liste, et pas un compteur
 *
 * Un compteur incrémenté à chaque message dérive dès qu'un événement est livré
 * deux fois — les déclencheurs Firestore s'exécutent « au moins une fois ». La
 * liste dédoublonnée ne peut pas compter deux fois le même message, et elle
 * donne au passage de quoi vérifier que les messages sont encore lisibles : le
 * compte annoncé est celui des messages **relus**, pas celui des messages
 * arrivés.
 *
 * ## Ce que le document ne porte pas
 *
 * Ni le nom du canal, ni son audience, ni le texte des messages. Tout cela est
 * relu au moment de l'annonce, pour qu'un canal renommé, une audience élargie
 * ou un message masqué dans l'intervalle soient annoncés sous leur état réel.
 *
 * Ce document est **inaccessible au client** : c'est un état de service.
 */
export interface ChannelDigest {
  channelId: string;
  orgId: string;
  /** Messages du lot, dans leur ordre d'arrivée, sans doublon. */
  messageIds: readonly MessageId[];
  /** Instant à partir duquel le lot peut être annoncé. */
  flushAt: DateLike;
}

// ===========================================================================
//  5. Sondages
// ===========================================================================

/**
 * Réponse possible à un sondage.
 *
 * Elle ne porte **pas** son nombre de voix, et ce n'est pas un rangement : le
 * document de sondage est lisible par tout parent de l'organisation — c'est ce
 * qui permet de poser la question avant d'y répondre. Y écrire les totaux
 * reviendrait donc à publier les résultats en permanence, quel que soit
 * `resultsVisibility`. Les compteurs vivent dans `PollResults`.
 */
export interface PollOption {
  id: string;
  label: string;
  order: number;
}

export interface Poll extends Auditable, OrganizationScoped {
  id: PollId;
  question: string;
  description?: string;
  options: readonly PollOption[];
  /** Autorise plusieurs réponses. */
  allowMultiple: boolean;
  /**
   * Sondage anonyme : le document de vote ne porte **aucun** champ `uid`.
   *
   * ## Ce que cela garantit, et ce que cela ne garantit pas
   *
   * L'identifiant du document de vote est l'UID de l'électeur, et non une
   * empreinte. Ce n'est pas un oubli : c'est **cela** qui rend le double vote
   * impossible, parce que les règles l'exigent
   * (`voterKey == request.auth.uid`). Une empreinte calculée par le client ne
   * pourrait pas être vérifiée par elles, si bien qu'un électeur déterminé
   * voterait autant de fois qu'il écrirait d'empreintes. L'unicité et
   * l'anonymat par empreinte s'excluent, et c'est l'unicité qui a été retenue.
   *
   * L'anonymat est donc **vis-à-vis de l'application**, et il est réel : la
   * règle de lecture n'autorise chacun à lire que son propre vote, et les
   * résultats ne sont publiés que sous forme d'agrégats. Il ne protège pas
   * contre quelqu'un qui aurait accès à la base : l'identifiant du document
   * relie le vote à la personne, même sans champ `uid`.
   *
   * C'est donc une promesse **d'interface**, pas une promesse
   * cryptographique — et l'écran qui la présente aux parents doit dire
   * exactement cela.
   */
  anonymous: boolean;
  /** Autorise la modification de son vote tant que le sondage est ouvert. */
  allowChangeVote: boolean;
  audience: Audience;
  audienceKeys: readonly string[];
  resultsVisibility: PollResultsVisibility;
  status: PollStatus;
  startsAt: DateLike;
  endsAt?: DateLike;
  closedAt?: DateLike;
}

/**
 * Résultats d'un sondage — document **séparé**, et c'est une décision de
 * sécurité, pas de rangement.
 *
 * ## Pourquoi ils ne peuvent pas vivre dans le sondage
 *
 * `polls/{pollId}` est lisible par **tout parent de l'organisation** : c'est ce
 * qui permet de poser la question avant d'y répondre. Y écrire les totaux
 * reviendrait donc à publier les résultats en permanence — et
 * `resultsVisibility`, qui existe, est validé et est stocké depuis l'origine,
 * ne serait lu par personne. Une promesse que les règles ne tiennent pas n'est
 * pas tenue.
 *
 * On ne peut pas non plus se contenter de **masquer** les totaux à l'écran :
 * une règle de lecture ne filtre pas des champs, elle ouvre ou ferme un
 * document entier. Et la fenêtre entre le vote et la réécriture du décompte
 * suffirait à les laisser filtrer par le cache local.
 *
 * ## L'identifiant du document **est** celui du sondage
 *
 * `pollResults/{pollId}`, et non une sous-collection à identifiant fixe : il ne
 * peut donc pas exister deux documents de résultats pour un sondage, et il n'y
 * a aucune constante à faire diverger entre le client et le serveur. La garde
 * de couverture des règles exige d'ailleurs la comparaison d'organisation sur
 * cette collection, puisqu'elle est de premier niveau.
 *
 * ## Un seul écrivain
 *
 * La Cloud Function `onPollVoteWritten`. Aucun client ne peut l'écrire — les
 * règles le refusent — si bien que le décompte est **infalsifiable par
 * construction**, et non par confiance dans le client.
 *
 * Le document peut être **absent** : un sondage sans voix n'en a pas. L'absence
 * vaut zéro, et l'écran doit la traiter comme telle plutôt que d'attendre un
 * document qui ne viendra qu'au premier vote.
 */
export interface PollResultsOption {
  id: string;
  votes: number;
}

export interface PollResults extends OrganizationScoped {
  /** Nombre de participants distincts. La vérité est dans `votes/{uid}`. */
  totalVoters: number;
  /** Toutes les options du sondage, dans son ordre, y compris à zéro voix. */
  options: readonly PollResultsOption[];
  updatedAt: DateLike;
}

/**
 * Vote. L'identifiant du document est l'UID de l'électeur — **jamais une
 * empreinte**, y compris pour un sondage anonyme : voir `Poll.anonymous` pour
 * la raison, et pour ce que cela garantit réellement.
 */
export interface PollVote {
  id: string;
  pollId: PollId;
  /** Absent lorsque le sondage est anonyme. */
  uid?: UserId;
  optionIds: readonly string[];
  createdAt: DateLike;
  updatedAt?: DateLike;
}

// ===========================================================================
//  6. Signalements et sujets collectifs
// ===========================================================================

/** Étape de la timeline affichée au parent. */
export interface ReportTimelineEntry {
  status: ReportStatus;
  at: DateLike;
  /** Nom affiché de la personne ayant fait évoluer le statut. */
  byName: string;
  byId?: UserId;
  note?: string;
}

export interface Report extends Auditable, OrganizationScoped {
  id: ReportId;
  title: string;
  description: string;
  category: ReportCategory;
  attachments: readonly Attachment[];
  authorId: UserId;
  authorName: string;
  status: ReportStatus;
  /**
   * `private` par défaut. Un signalement n'est jamais visible publiquement
   * sans décision explicite de la FCPE (passage en `collective`).
   */
  visibility: ReportVisibility;
  timeline: readonly ReportTimelineEntry[];
  /** Membre FCPE en charge du dossier. */
  assignedTo?: UserId;
  assignedToName?: string;
  replyCount: number;
  lastReplyAt?: DateLike;
  /** Sujet collectif auquel ce signalement a été rattaché. */
  linkedIssueId?: CollectiveIssueId;
  /** Compteur de signalements similaires, alimenté par la FCPE. */
  similarCount: number;
}

/** Réponse de la FCPE à un signalement. */
export interface ReportReply extends Auditable {
  id: string;
  reportId: ReportId;
  authorId: UserId;
  authorName: string;
  body: string;
  /** Note interne : invisible pour le parent auteur du signalement. */
  internal: boolean;
}

/** Sujet collectif suivi publiquement par la FCPE. */
export interface CollectiveIssue extends Auditable, OrganizationScoped {
  id: CollectiveIssueId;
  title: string;
  summary: string;
  category: ReportCategory;
  status: CollectiveIssueStatus;
  /** Seuil affiché, ex. « objectif 50 parents ». */
  supportTarget?: number;
  /** Compteurs dénormalisés, maintenus par Cloud Function. */
  supportersCount: number;
  concernedCount: number;
  /** Le sujet est-il visible par tous les parents de l'audience ? */
  published: boolean;
  /** Dernière mise à jour affichée dans la liste. */
  lastUpdateAt?: DateLike;
  lastUpdateNote?: string;
  linkedReportCount: number;
}

/** Position d'un parent sur un sujet collectif (id du document = UID). */
export interface IssueSupporter {
  id: UserId;
  issueId: CollectiveIssueId;
  value: IssueSupportValue;
  createdAt: DateLike;
  /** Message facultatif joint au soutien. */
  comment?: string;
}

// ===========================================================================
//  7. Agenda et événements
// ===========================================================================

export interface Event extends Auditable, OrganizationScoped {
  id: EventId;
  title: string;
  description?: string;
  type: EventType;
  audience: Audience;
  audienceKeys: readonly string[];
  /** Événement sur une journée entière (masque les heures). */
  allDay: boolean;
  startAt: DateLike;
  endAt?: DateLike;
  location?: string;
  /** Inscription ouverte. */
  registrationEnabled: boolean;
  /** Réponse obligatoire (participe / ne participe pas). */
  requiresAnswer: boolean;
  capacity?: number;
  /** Nombre de bénévoles recherchés, 0 si aucun besoin. */
  volunteerSlotsNeeded: number;
  volunteerSlotsFilled: number;
  attachments: readonly Attachment[];
  participantCount: number;
  /** Rappel déjà envoyé, pour ne pas notifier deux fois. */
  reminderSentAt?: DateLike;
  /** Délai de rappel avant l'événement, en heures. */
  reminderHoursBefore?: number;
  status: ContentStatus;
}

/** Participation à un événement (id du document = UID). */
export interface EventParticipant {
  id: UserId;
  eventId: EventId;
  attendance: Attendance;
  /** Le parent propose son aide comme bénévole. */
  volunteer: boolean;
  /** Nombre de personnes supplémentaires amenées. */
  guests: number;
  note?: string;
  createdAt: DateLike;
  updatedAt?: DateLike;
}

// ===========================================================================
//  8. Documents
// ===========================================================================

export interface LibraryDocument extends Auditable, OrganizationScoped {
  id: DocumentId;
  title: string;
  description?: string;
  category: DocumentCategory;
  /** Année scolaire ou année civile de rattachement, ex. « 2026 » ou « 2026-2027 ». */
  year: string;
  tags: readonly string[];
  audience: Audience;
  audienceKeys: readonly string[];
  attachment: Attachment;
  uploadedBy: UserId;
  uploadedByName: string;
  /** Document interne FCPE, invisible pour les parents. */
  internal: boolean;
  downloadCount: number;
  status: ContentStatus;
}

// ===========================================================================
//  9. Conseils d'école
// ===========================================================================

export interface SchoolCouncil extends Auditable, OrganizationScoped {
  id: SchoolCouncilId;
  title: string;
  type: SchoolCouncilType;
  status: SchoolCouncilStatus;
  /** Date de la séance. */
  date: ISODateTime;
  location?: string;
  /** Ordre du jour publié, rédigé par la FCPE. */
  agenda: readonly CouncilAgendaEntry[];
  /** Compte rendu, une fois la séance tenue. */
  minutesDocumentId?: DocumentId;
  minutesSummary?: string;
  /** Nombre de questions reçues, pour l'affichage. */
  questionCount: number;
  /** Prochaine séance : indique au client de mettre en avant cette entrée. */
  isNext: boolean;
}

export interface CouncilAgendaEntry {
  id: CouncilItemId;
  title: string;
  order: number;
}

/** Question de parent ou sujet préparé par la FCPE. */
export interface CouncilItem extends Auditable {
  id: CouncilItemId;
  councilId: SchoolCouncilId;
  kind: CouncilItemKind;
  title: string;
  body: string;
  /** `public` = question d'un parent ; `fcpe` = préparation interne. */
  visibility: 'public' | 'fcpe';
  authorId: UserId;
  authorName: string;
  /** Nombre de parents ayant soutenu la question. */
  supportCount: number;
  status: CouncilItemStatus;
  /** Réponses obtenues après la séance. */
  schoolAnswer?: CouncilAnswer;
  cityAnswer?: CouncilAnswer;
  fcpeAnswer?: CouncilAnswer;
  plannedAction?: string;
}

export interface CouncilAnswer {
  body: string;
  answeredAt: DateLike;
  source: CouncilAnswerSource;
  /** Nom affiché de la personne ayant rapporté la réponse. */
  reportedBy?: string;
}

// ===========================================================================
//  10. Notifications, modération, administration
// ===========================================================================

/**
 * Journal d'un envoi de notification (conservé pour l'historique admin).
 *
 * ## Ce que ces compteurs disent, et ce qu'ils ne disent pas
 *
 * **Aucun ne compte les parents qui ont vu l'information** : le service Expo ne
 * le sait pas. Un écran qui intitulerait `deliveredCount` « reçues » serait faux
 * deux fois — le reçu dit que le **transport** a reçu, pas le téléphone.
 *
 *  - `recipientCount` — appareils visés, après filtrage des préférences. C'est
 *    la marche du haut, et la seule que l'application connaisse seule.
 *  - `acceptedCount` — messages pris en charge par Expo (ticket `ok`). Connu dès
 *    l'envoi, et c'est le seul que l'envoi lui-même peut garantir.
 *  - `deliveredCount` — messages remis à FCM ou APNs (reçu `ok`). **`null` tant
 *    que les reçus n'ont pas été relus** : « pas encore su » n'est pas « zéro »,
 *    et afficher 0 serait un mensonge par défaut.
 *  - `failedCount` — refusés, **à l'une ou l'autre des deux étapes**. Un message
 *    peut être accepté puis refusé par le transport ; le document finit par
 *    compter tout ce qui n'est pas arrivé.
 *  - `pendingCount` — identifiants dont le reçu n'était pas encore disponible à
 *    la relecture. Ni livrés, ni échoués : on ne sait pas encore.
 *
 * Les reçus ne sont disponibles qu'un moment après l'envoi — Expo recommande de
 * les relire **quinze minutes** plus tard, et les efface au bout de 24 heures.
 * D'où `ticketIds` et `receiptsChecked` : l'envoi ne peut pas attendre, et une
 * seconde passe doit pouvoir retrouver ce qu'il y a à relire.
 */
export interface NotificationLog {
  id: NotificationId;
  orgId: OrganizationId;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  body: string;
  /**
   * Audience adressée, quand l'envoi en vise une.
   *
   * Absente pour un envoi **ciblé** : un commentaire s'adresse à une personne —
   * l'auteur de la publication, ou celui du commentaire auquel on répond —, et
   * aucune audience ne décrit cet ensemble. Recopier celle de la publication
   * décrirait un envoi de masse qui n'a pas eu lieu, dans la collection même où
   * l'administration lit ce qui est réellement parti.
   *
   * C'est le `type` qui dit alors quelle règle a désigné le destinataire :
   * `new_comment` vise l'auteur de la publication, `comment_reply` celui du
   * commentaire parent.
   */
  audience?: Audience;
  /** Clés d'audience adressées. Vide pour un envoi ciblé. */
  audienceKeys: readonly string[];
  /** Contenu à l'origine de l'envoi, s'il existe. */
  sourceType?: 'post' | 'poll' | 'event' | 'report' | 'message' | 'manual';
  sourceId?: string;
  /** Lien profond ouvert au tap sur la notification. */
  deeplink?: string;
  sentBy: UserId;
  sentByName: string;
  sentAt: DateLike;
  /** Appareils visés, après filtrage des préférences. */
  recipientCount: number;
  /** Messages acceptés par le service Expo (ticket `ok`). */
  acceptedCount: number;
  /** Messages remis au transport (reçu `ok`), ou `null` si non relu. */
  deliveredCount: number | null;
  /** Refusés, à l'envoi **ou** à la relecture des reçus. */
  failedCount: number;
  /** Reçus pas encore disponibles à la relecture. */
  pendingCount: number;
  /** Identifiants de ticket, conservés pour relire les reçus plus tard. */
  ticketIds: readonly string[];
  /** Vrai une fois les reçus relus — ou quand il n'y avait rien à relire. */
  receiptsChecked: boolean;
  /** Mode d'envoi réellement utilisé. */
  delivery: 'immediate' | 'scheduled' | 'cancelled';
}

/** Signalement d'un contenu par un utilisateur. */
export interface ModerationReport {
  id: ModerationReportId;
  orgId: OrganizationId;
  targetType: ModerationTargetType;
  targetId: string;
  /** Chemin Firestore complet, pour permettre la résolution générique. */
  targetPath: string;
  /** Auteur du contenu signalé. */
  targetAuthorId: UserId;
  targetAuthorName: string;
  /** Extrait du contenu, figé au moment du signalement. */
  targetExcerpt: string;
  reason: ModerationReason;
  details?: string;
  reporterId: UserId;
  reporterName: string;
  status: ModerationStatus;
  handledBy?: UserId;
  handledByName?: string;
  handledAt?: DateLike;
  action?: ModerationAction;
  actionNote?: string;
  createdAt: DateLike;
}

/** Journal des actions sensibles. Immuable, en écriture seule côté serveur. */
export interface AdminLog {
  id: string;
  actorId: UserId;
  actorName: string;
  actorRole: UserRole;
  action: AdminAction;
  targetType: string;
  targetId: string;
  /** Contexte utile à l'audit (avant/après pour les changements de rôle). */
  metadata: Readonly<Record<string, unknown>>;
  at: DateLike;
}

/** Tâche interne de l'espace FCPE. */
export interface FcpeTask extends Auditable, OrganizationScoped {
  id: FcpeTaskId;
  title: string;
  description?: string;
  status: FcpeTaskStatus;
  priority: FcpeTaskPriority;
  assigneeId?: UserId;
  assigneeName?: string;
  dueAt?: DateLike;
  /** Référence à l'élément du domaine concerné (signalement, conseil, sujet…). */
  relatedType?: 'report' | 'issue' | 'council' | 'event' | 'none';
  relatedId?: string;
  doneAt?: DateLike;
}

// ===========================================================================
//  11. Compteurs agrégés (optimisation des coûts)
// ===========================================================================

/**
 * Compteurs du tableau de bord, maintenus par Cloud Functions.
 *
 * Sans eux, afficher « 312 parents actifs » ou « 4 signalements ouverts »
 * nécessiterait des requêtes d'agrégation à chaque ouverture du tableau de
 * bord. Un document unique se lit pour un coût négligeable.
 */
export interface DashboardCounters {
  id: OrganizationId;
  updatedAt: DateLike;
  users: {
    total: number;
    pending: number;
    active: number;
    suspended: number;
    rejected: number;
    activeLast7Days: number;
  };
  content: {
    postsPublished: number;
    postsLast7Days: number;
    commentsTotal: number;
    messagesTotal: number;
  };
  moderation: {
    reportsOpen: number;
    reportsInProgress: number;
    moderationQueueOpen: number;
  };
  engagement: {
    openPolls: number;
    openCollectiveIssues: number;
    upcomingEvents: number;
    pendingCouncilQuestions: number;
  };
}

/** Métadonnée d'amorçage : où trouver le prochain conseil, le dernier sondage, etc. */
export interface OrganizationHighlights {
  id: OrganizationId;
  updatedAt: DateLike;
  nextEventId?: EventId;
  nextEventTitle?: string;
  nextEventAt?: ISODateTime;
  latestPollId?: PollId;
  latestPollQuestion?: string;
  nextCouncilId?: SchoolCouncilId;
  nextCouncilAt?: ISODate;
}

/** Date de référence pour les calculs d'année scolaire. */
export type { ISODate, ISODateTime };
