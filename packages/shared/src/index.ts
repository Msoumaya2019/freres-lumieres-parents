import type { UserRole, UserStatus } from '@flp/types';

export const PERMISSIONS = [
  'readPublicContent',
  'createComment',
  'createDiscussionMessage',
  'votePoll',
  'createReport',
  'createCouncilQuestion',
  'accessFcpeArea',
  'viewReports',
  'createPost',
  'sendNotification',
  'moderateContent',
  'updateReports',
  'manageUsers',
  'manageRoles',
  'manageSchools',
  'manageSettings',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const parentPermissions: readonly Permission[] = [
  'readPublicContent',
  'createComment',
  'createDiscussionMessage',
  'votePoll',
  'createReport',
  'createCouncilQuestion',
];

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  parent: parentPermissions,
  fcpe: [...parentPermissions, 'accessFcpeArea', 'viewReports'],
  moderator: [
    ...parentPermissions,
    'accessFcpeArea',
    'viewReports',
    'moderateContent',
    'updateReports',
  ],
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
