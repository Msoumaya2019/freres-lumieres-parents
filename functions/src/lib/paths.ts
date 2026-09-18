/**
 * Chemins Firestore côté serveur.
 *
 * Volontairement dupliqués depuis `@fl/firebase` plutôt qu'importés : le
 * package `@fl/firebase` embarque le SDK client (browser/React Native), qu'il
 * serait inutile et risqué de charger dans une Cloud Function.
 *
 * Les noms de collections sont donc la seule chose partagée — et parce qu'ils
 * sont recopiés, ils peuvent diverger en silence : une fonction écrirait alors
 * dans un chemin que le client ne lit jamais, sans qu'aucune compilation ne
 * proteste. `paths.test.ts` compare les deux tables en lisant la source du
 * package client sur le disque. Toute collection ajoutée d'un côté doit l'être
 * de l'autre.
 */

export const COLLECTIONS = {
  organizations: 'organizations',
  schools: 'schools',
  classes: 'classes',
  users: 'users',
  deviceTokens: 'deviceTokens',
  pushTickets: 'pushTickets',
  posts: 'posts',
  channels: 'channels',
  channelDigests: 'channelDigests',
  polls: 'polls',
  pollResults: 'pollResults',
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
  reactions: 'reactions',
} as const;

export const paths = {
  user: (uid: string) => `${COLLECTIONS.users}/${uid}`,
  userChildren: (uid: string) => `${COLLECTIONS.users}/${uid}/${SUBCOLLECTIONS.children}`,
  userPrivate: (uid: string) => `${COLLECTIONS.users}/${uid}/${SUBCOLLECTIONS.private}`,
  userRateLimits: (uid: string) =>
    `${COLLECTIONS.users}/${uid}/${SUBCOLLECTIONS.private}/rateLimits`,
  deviceToken: (token: string) => `${COLLECTIONS.deviceTokens}/${token}`,
  pushTicket: (ticketId: string) => `${COLLECTIONS.pushTickets}/${ticketId}`,
  notification: (notificationId: string) => `${COLLECTIONS.notifications}/${notificationId}`,
  counter: (orgId: string) => `${COLLECTIONS.counters}/${orgId}`,
  highlight: (orgId: string) => `${COLLECTIONS.highlights}/${orgId}`,
  adminLog: (logId: string) => `${COLLECTIONS.adminLogs}/${logId}`,

  post: (postId: string) => `${COLLECTIONS.posts}/${postId}`,
  postComments: (postId: string) => `${COLLECTIONS.posts}/${postId}/${SUBCOLLECTIONS.comments}`,
  comment: (postId: string, commentId: string) =>
    `${COLLECTIONS.posts}/${postId}/${SUBCOLLECTIONS.comments}/${commentId}`,
  commentReactions: (postId: string, commentId: string) =>
    `${COLLECTIONS.posts}/${postId}/${SUBCOLLECTIONS.comments}/${commentId}/${SUBCOLLECTIONS.reactions}`,

  poll: (pollId: string) => `${COLLECTIONS.polls}/${pollId}`,
  pollVotes: (pollId: string) => `${COLLECTIONS.polls}/${pollId}/${SUBCOLLECTIONS.votes}`,
  pollVote: (pollId: string, voterKey: string) =>
    `${COLLECTIONS.polls}/${pollId}/${SUBCOLLECTIONS.votes}/${voterKey}`,
  // Les résultats vivent **hors** du document de sondage : celui-ci est lisible
  // par tout parent de l'organisation, et les totaux y seraient donc publics.
  // L'identifiant du document de résultats est celui du sondage, ce qui rend
  // impossible d'en avoir deux.
  pollResult: (pollId: string) => `${COLLECTIONS.pollResults}/${pollId}`,

  channel: (channelId: string) => `${COLLECTIONS.channels}/${channelId}`,
  channelMessages: (channelId: string) =>
    `${COLLECTIONS.channels}/${channelId}/${SUBCOLLECTIONS.messages}`,
  channelMessage: (channelId: string, messageId: string) =>
    `${COLLECTIONS.channels}/${channelId}/${SUBCOLLECTIONS.messages}/${messageId}`,
  channelDigest: (channelId: string) => `${COLLECTIONS.channelDigests}/${channelId}`,
} as const;

/** Noms d'action journalisés dans `adminLogs`. */
export const ADMIN_ACTIONS = {
  userApprove: 'user.approve',
  userReject: 'user.reject',
  userSuspend: 'user.suspend',
  userReactivate: 'user.reactivate',
  userRoleChange: 'user.role_change',
  userDelete: 'user.delete',
  userExportData: 'user.export_data',
  notificationSend: 'notification.send',
  settingsUpdate: 'settings.update',
} as const;
