export const USER_ROLES = ['parent', 'fcpe', 'moderator', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = [
  'pending',
  'active',
  'suspended',
  'rejected',
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export type EntityId = string;
export type DateValue =
  Date | string | { seconds: number; nanoseconds: number };

export interface Audience {
  type: 'all' | 'school' | 'level' | 'class' | 'fcpe';
  ids: EntityId[];
}

export interface User {
  id: EntityId;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  organizationId: EntityId;
  schoolIds: EntityId[];
  levelIds: EntityId[];
  classIds: EntityId[];
  notificationPreferences: Record<string, boolean>;
  createdAt: DateValue;
  updatedAt: DateValue;
}

export interface ChildProfile {
  id: EntityId;
  parentUserId: EntityId;
  organizationId: EntityId;
  schoolId: EntityId;
  levelId: EntityId;
  classId?: EntityId;
  label?: string;
  createdAt: DateValue;
}

export interface Organization {
  id: EntityId;
  name: string;
  slug: string;
  active: boolean;
}
export interface School {
  id: EntityId;
  organizationId: EntityId;
  name: string;
  type: 'kindergarten' | 'elementary' | 'other';
  active: boolean;
}
export interface ClassGroup {
  id: EntityId;
  organizationId: EntityId;
  schoolId: EntityId;
  levelId: EntityId;
  name: string;
  schoolYear: string;
  active: boolean;
}

export interface SchoolLevel {
  id: EntityId;
  organizationId: EntityId;
  schoolId: EntityId;
  name: string;
  order: number;
  active: boolean;
}

export interface RegistrationOption {
  id: EntityId;
  name: string;
  levels: Array<{ id: EntityId; name: string }>;
}

export interface RegistrationConfig {
  organizationId: EntityId;
  organizationName: string;
  active: boolean;
  schools: RegistrationOption[];
}

export interface Post {
  id: EntityId;
  organizationId: EntityId;
  authorId: EntityId;
  title: string;
  body: string;
  category:
    | 'information'
    | 'urgent'
    | 'canteen'
    | 'after_school'
    | 'works'
    | 'school_trip'
    | 'fcpe'
    | 'city'
    | 'event'
    | 'school_council'
    | 'other';
  audience: Audience;
  attachmentIds: EntityId[];
  commentsEnabled: boolean;
  pinned: boolean;
  publishedAt: DateValue;
  createdAt: DateValue;
  updatedAt: DateValue;
}

export interface Comment {
  id: EntityId;
  postId: EntityId;
  organizationId: EntityId;
  authorId: EntityId;
  body: string;
  status: 'visible' | 'hidden' | 'deleted';
  createdAt: DateValue;
  updatedAt: DateValue;
}
export interface DiscussionChannel {
  id: EntityId;
  organizationId: EntityId;
  name: string;
  description?: string;
  audience: Audience;
  active: boolean;
}
export interface Message {
  id: EntityId;
  channelId: EntityId;
  organizationId: EntityId;
  authorId: EntityId;
  body: string;
  imagePath?: string;
  replyToId?: EntityId;
  reactionCounts: Record<string, number>;
  status: 'visible' | 'hidden' | 'deleted';
  createdAt: DateValue;
}

export interface PollOption {
  id: EntityId;
  label: string;
  order: number;
}
export interface Poll {
  id: EntityId;
  organizationId: EntityId;
  authorId: EntityId;
  question: string;
  options: PollOption[];
  multipleChoice: boolean;
  anonymous: boolean;
  audience: Audience;
  endsAt?: DateValue;
  createdAt: DateValue;
}
export interface PollVote {
  id: EntityId;
  pollId: EntityId;
  userId: EntityId;
  optionIds: EntityId[];
  createdAt: DateValue;
}

export const REPORT_STATUSES = [
  'received',
  'in_progress',
  'forwarded_school',
  'forwarded_city',
  'resolved',
  'closed',
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export interface Report {
  id: EntityId;
  organizationId: EntityId;
  authorId: EntityId;
  title: string;
  description: string;
  category:
    | 'canteen'
    | 'safety'
    | 'bullying'
    | 'after_school'
    | 'premises'
    | 'teaching'
    | 'transport'
    | 'other';
  status: ReportStatus;
  visibility: 'owner_moderators' | 'fcpe';
  photoPaths: string[];
  createdAt: DateValue;
  updatedAt: DateValue;
}
export interface CollectiveIssue {
  id: EntityId;
  organizationId: EntityId;
  title: string;
  category: string;
  status: string;
  supporterCount: number;
  audience: Audience;
  createdAt: DateValue;
}
export interface Event {
  id: EntityId;
  organizationId: EntityId;
  title: string;
  description: string;
  audience: Audience;
  startsAt: DateValue;
  endsAt?: DateValue;
  location?: string;
  volunteerTarget?: number;
  participantCount: number;
  createdAt: DateValue;
}
export interface Document {
  id: EntityId;
  organizationId: EntityId;
  title: string;
  category: string;
  year: number;
  schoolId?: EntityId;
  audience: Audience;
  storagePath: string;
  contentType: string;
  sizeBytes: number;
  createdAt: DateValue;
}
export interface SchoolCouncil {
  id: EntityId;
  organizationId: EntityId;
  schoolId: EntityId;
  title: string;
  scheduledAt: DateValue;
  agenda: string[];
  audience: Audience;
  documentIds: EntityId[];
  createdAt: DateValue;
}
export interface ModerationReport {
  id: EntityId;
  organizationId: EntityId;
  reporterId: EntityId;
  targetType: 'post' | 'comment' | 'message';
  targetId: EntityId;
  reason: string;
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
  assignedTo?: EntityId;
  createdAt: DateValue;
  updatedAt: DateValue;
}
export interface Notification {
  id: EntityId;
  organizationId: EntityId;
  type: string;
  title: string;
  body: string;
  audience: Audience;
  targetId?: EntityId;
  createdAt: DateValue;
}
export type AdminLogAction =
  | 'USER_APPROVED'
  | 'USER_SUSPENDED'
  | 'USER_REACTIVATED'
  | 'USER_REJECTED'
  | 'USER_SET_PENDING'
  | 'ROLE_CHANGED'
  | 'POST_HIDDEN'
  | 'POST_DELETED'
  | 'COMMENT_HIDDEN'
  | 'MESSAGE_HIDDEN'
  | 'REPORT_STATUS_CHANGED';
export interface AdminLog {
  id: EntityId;
  organizationId: EntityId;
  actorUserId: EntityId;
  action: AdminLogAction;
  targetType: string;
  targetId: EntityId;
  metadata: Record<string, unknown>;
  createdAt: DateValue;
}
