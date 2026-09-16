/**
 * Chemins Firestore — source de vérité unique.
 *
 * Aucune chaîne de collection ne doit être écrite ailleurs dans le projet.
 * Toutes les règles de sécurité, tous les index et tous les repositories
 * s'appuient sur ces constantes. Une faute de frappe devient alors une erreur
 * de compilation plutôt qu'un bug silencieux en production.
 *
 * Les sous-collections ont aussi leur constructeur, ce qui évite les
 * concaténations de chaînes dispersées.
 */
import type {
  ChannelId,
  ClassId,
  CollectiveIssueId,
  DocumentId,
  EventId,
  OrganizationId,
  PostId,
  PollId,
  ReportId,
  SchoolCouncilId,
  SchoolId,
  UserId,
} from '@fl/types';

/** Noms des collections racine. */
export const COLLECTIONS = {
  organizations: 'organizations',
  schools: 'schools',
  classes: 'classes',
  users: 'users',
  deviceTokens: 'deviceTokens',
  posts: 'posts',
  channels: 'channels',
  polls: 'polls',
  reports: 'reports',
  collectiveIssues: 'collectiveIssues',
  events: 'events',
  documents: 'documents',
  schoolCouncils: 'schoolCouncils',
  notifications: 'notifications',
  moderationReports: 'moderationReports',
  adminLogs: 'adminLogs',
  fcpeTasks: 'fcpeTasks',
  counters: 'counters',
  highlights: 'highlights',
} as const;

/** Noms des sous-collections. */
export const SUBCOLLECTIONS = {
  children: 'children',
  tokens: 'tokens',
  private: 'private',
  comments: 'comments',
  messages: 'messages',
  votes: 'votes',
  replies: 'replies',
  supporters: 'supporters',
  participants: 'participants',
  items: 'items',
} as const;

// ---------------------------------------------------------------------------
// Chemins
// ---------------------------------------------------------------------------

export const paths = {
  organizations: () => COLLECTIONS.organizations,
  organization: (orgId: OrganizationId) => `${COLLECTIONS.organizations}/${orgId}`,

  schools: () => COLLECTIONS.schools,
  school: (schoolId: SchoolId) => `${COLLECTIONS.schools}/${schoolId}`,

  classes: () => COLLECTIONS.classes,
  schoolClass: (classId: ClassId) => `${COLLECTIONS.classes}/${classId}`,

  users: () => COLLECTIONS.users,
  user: (uid: UserId) => `${COLLECTIONS.users}/${uid}`,
  userChildren: (uid: UserId) => `${COLLECTIONS.users}/${uid}/${SUBCOLLECTIONS.children}`,
  userChild: (uid: UserId, childId: string) =>
    `${COLLECTIONS.users}/${uid}/${SUBCOLLECTIONS.children}/${childId}`,
  /** Jetons push : lecture interdite au client, réservée aux Cloud Functions. */
  userTokens: (uid: UserId) => `${COLLECTIONS.users}/${uid}/${SUBCOLLECTIONS.tokens}`,
  userToken: (uid: UserId, tokenId: string) =>
    `${COLLECTIONS.users}/${uid}/${SUBCOLLECTIONS.tokens}/${tokenId}`,
  /** Compteurs internes (rate limiting) : jamais lisibles par le client. */
  userPrivate: (uid: UserId) => `${COLLECTIONS.users}/${uid}/${SUBCOLLECTIONS.private}`,
  userRateLimits: (uid: UserId) =>
    `${COLLECTIONS.users}/${uid}/${SUBCOLLECTIONS.private}/rateLimits`,

  deviceTokens: () => COLLECTIONS.deviceTokens,
  deviceToken: (token: string) => `${COLLECTIONS.deviceTokens}/${token}`,

  posts: () => COLLECTIONS.posts,
  post: (postId: PostId) => `${COLLECTIONS.posts}/${postId}`,
  postComments: (postId: PostId) => `${COLLECTIONS.posts}/${postId}/${SUBCOLLECTIONS.comments}`,
  postComment: (postId: PostId, commentId: string) =>
    `${COLLECTIONS.posts}/${postId}/${SUBCOLLECTIONS.comments}/${commentId}`,

  channels: () => COLLECTIONS.channels,
  channel: (channelId: ChannelId) => `${COLLECTIONS.channels}/${channelId}`,
  channelMessages: (channelId: ChannelId) =>
    `${COLLECTIONS.channels}/${channelId}/${SUBCOLLECTIONS.messages}`,
  channelMessage: (channelId: ChannelId, messageId: string) =>
    `${COLLECTIONS.channels}/${channelId}/${SUBCOLLECTIONS.messages}/${messageId}`,

  polls: () => COLLECTIONS.polls,
  poll: (pollId: PollId) => `${COLLECTIONS.polls}/${pollId}`,
  pollVotes: (pollId: PollId) => `${COLLECTIONS.polls}/${pollId}/${SUBCOLLECTIONS.votes}`,
  pollVote: (pollId: PollId, voterKey: string) =>
    `${COLLECTIONS.polls}/${pollId}/${SUBCOLLECTIONS.votes}/${voterKey}`,

  reports: () => COLLECTIONS.reports,
  report: (reportId: ReportId) => `${COLLECTIONS.reports}/${reportId}`,
  reportReplies: (reportId: ReportId) =>
    `${COLLECTIONS.reports}/${reportId}/${SUBCOLLECTIONS.replies}`,
  reportReply: (reportId: ReportId, replyId: string) =>
    `${COLLECTIONS.reports}/${reportId}/${SUBCOLLECTIONS.replies}/${replyId}`,

  collectiveIssues: () => COLLECTIONS.collectiveIssues,
  collectiveIssue: (issueId: CollectiveIssueId) => `${COLLECTIONS.collectiveIssues}/${issueId}`,
  issueSupporters: (issueId: CollectiveIssueId) =>
    `${COLLECTIONS.collectiveIssues}/${issueId}/${SUBCOLLECTIONS.supporters}`,
  issueSupporter: (issueId: CollectiveIssueId, uid: UserId) =>
    `${COLLECTIONS.collectiveIssues}/${issueId}/${SUBCOLLECTIONS.supporters}/${uid}`,

  events: () => COLLECTIONS.events,
  event: (eventId: EventId) => `${COLLECTIONS.events}/${eventId}`,
  eventParticipants: (eventId: EventId) =>
    `${COLLECTIONS.events}/${eventId}/${SUBCOLLECTIONS.participants}`,
  eventParticipant: (eventId: EventId, uid: UserId) =>
    `${COLLECTIONS.events}/${eventId}/${SUBCOLLECTIONS.participants}/${uid}`,

  documents: () => COLLECTIONS.documents,
  document: (docId: DocumentId) => `${COLLECTIONS.documents}/${docId}`,

  schoolCouncils: () => COLLECTIONS.schoolCouncils,
  schoolCouncil: (councilId: SchoolCouncilId) => `${COLLECTIONS.schoolCouncils}/${councilId}`,
  councilItems: (councilId: SchoolCouncilId) =>
    `${COLLECTIONS.schoolCouncils}/${councilId}/${SUBCOLLECTIONS.items}`,
  councilItem: (councilId: SchoolCouncilId, itemId: string) =>
    `${COLLECTIONS.schoolCouncils}/${councilId}/${SUBCOLLECTIONS.items}/${itemId}`,

  notifications: () => COLLECTIONS.notifications,
  notification: (notificationId: string) => `${COLLECTIONS.notifications}/${notificationId}`,

  moderationReports: () => COLLECTIONS.moderationReports,
  moderationReport: (reportId: string) => `${COLLECTIONS.moderationReports}/${reportId}`,

  adminLogs: () => COLLECTIONS.adminLogs,
  adminLog: (logId: string) => `${COLLECTIONS.adminLogs}/${logId}`,

  fcpeTasks: () => COLLECTIONS.fcpeTasks,
  fcpeTask: (taskId: string) => `${COLLECTIONS.fcpeTasks}/${taskId}`,

  counters: () => COLLECTIONS.counters,
  counter: (orgId: OrganizationId) => `${COLLECTIONS.counters}/${orgId}`,

  highlights: () => COLLECTIONS.highlights,
  highlight: (orgId: OrganizationId) => `${COLLECTIONS.highlights}/${orgId}`,
} as const;

// ---------------------------------------------------------------------------
// Chemins Storage
// ---------------------------------------------------------------------------

/**
 * Chemins de stockage des fichiers.
 *
 * Tous cloisonnés par organisation : les Storage Rules peuvent ainsi vérifier
 * l'appartenance sans lire de document, et un chemin d'une autre organisation
 * est immédiatement rejeté.
 *
 * Le nom de fichier est horodaté et assaini pour éviter les collisions et les
 * caractères problématiques dans les URL.
 */
export const storagePaths = {
  postAttachment: (orgId: OrganizationId, postId: PostId, fileName: string) =>
    `orgs/${orgId}/posts/${postId}/${fileName}`,

  reportAttachment: (orgId: OrganizationId, reportId: ReportId, fileName: string) =>
    `orgs/${orgId}/reports/${reportId}/${fileName}`,

  messageAttachment: (orgId: OrganizationId, channelId: ChannelId, fileName: string) =>
    `orgs/${orgId}/channels/${channelId}/${fileName}`,

  document: (orgId: OrganizationId, documentId: DocumentId, fileName: string) =>
    `orgs/${orgId}/documents/${documentId}/${fileName}`,

  eventAttachment: (orgId: OrganizationId, eventId: EventId, fileName: string) =>
    `orgs/${orgId}/events/${eventId}/${fileName}`,

  userAvatar: (orgId: OrganizationId, uid: UserId, fileName: string) =>
    `orgs/${orgId}/avatars/${uid}/${fileName}`,
} as const;

/** Identifiant de stockage déterministe, horodaté pour éviter les collisions. */
export function buildStorageFileName(prefix: string, originalName: string, now: number): string {
  const dotIndex = originalName.lastIndexOf('.');
  const extension = dotIndex > 0 ? originalName.slice(dotIndex).toLowerCase() : '';
  const base = dotIndex > 0 ? originalName.slice(0, dotIndex) : originalName;
  const safeBase = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60);
  return `${prefix}-${now}-${safeBase}${extension}`;
}
