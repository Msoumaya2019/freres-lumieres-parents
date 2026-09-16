/**
 * Chemins Firestore côté serveur.
 *
 * Volontairement dupliqués depuis `@fl/firebase` plutôt qu'importés : le
 * package `@fl/firebase` embarque le SDK client (browser/React Native), qu'il
 * serait inutile et risqué de charger dans une Cloud Function.
 *
 * Les noms de collections sont donc la seule chose partagée, et un test
 * vérifie qu'ils correspondent bien à ceux du package client.
 */

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

export const paths = {
  user: (uid: string) => `${COLLECTIONS.users}/${uid}`,
  userChildren: (uid: string) => `${COLLECTIONS.users}/${uid}/${SUBCOLLECTIONS.children}`,
  userPrivate: (uid: string) => `${COLLECTIONS.users}/${uid}/${SUBCOLLECTIONS.private}`,
  userRateLimits: (uid: string) =>
    `${COLLECTIONS.users}/${uid}/${SUBCOLLECTIONS.private}/rateLimits`,
  deviceToken: (token: string) => `${COLLECTIONS.deviceTokens}/${token}`,
  counter: (orgId: string) => `${COLLECTIONS.counters}/${orgId}`,
  highlight: (orgId: string) => `${COLLECTIONS.highlights}/${orgId}`,
  adminLog: (logId: string) => `${COLLECTIONS.adminLogs}/${logId}`,
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
