import type { UserRole, UserStatus } from '@flp/types';

export const PUBLIC_NOTIFICATION_TOPICS = [
  'all_public',
  'school_maternelle',
  'school_elementaire',
  'canteen',
  'events',
  'school_councils',
] as const;
export const PERMISSIONS = [
  'accessFcpeArea',
  'readParentRequests',
  'replyParentRequests',
  'createFcpeMessage',
  'readInternalDocuments',
  'createPost',
  'sendNotification',
  'moderateContent',
  'assignContacts',
  'manageMembers',
  'manageRoles',
  'manageSchools',
  'manageSettings',
] as const;
export type Permission = (typeof PERMISSIONS)[number];
const fcpePermissions: readonly Permission[] = [
  'accessFcpeArea',
  'readParentRequests',
  'replyParentRequests',
  'createFcpeMessage',
  'readInternalDocuments',
];
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  fcpe: fcpePermissions,
  moderator: [...fcpePermissions, 'moderateContent', 'assignContacts'],
  admin: PERMISSIONS,
};
export function hasPermission(
  user: { role: UserRole; status: UserStatus } | null | undefined,
  permission: Permission,
): boolean {
  return (
    user?.status === 'active' &&
    ROLE_PERMISSIONS[user.role].includes(permission)
  );
}
