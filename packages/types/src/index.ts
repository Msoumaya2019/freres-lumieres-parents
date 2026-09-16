export const USER_ROLES = ['fcpe', 'moderator', 'admin'] as const;
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
export interface MemberProfile {
  id: EntityId;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  organizationId: EntityId;
  declaredFunction?: string;
  createdAt: DateValue;
  updatedAt: DateValue;
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
export interface SchoolLevel {
  id: EntityId;
  organizationId: EntityId;
  schoolId: EntityId;
  name: string;
  order: number;
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

export const POST_CATEGORIES = [
  'information',
  'urgent',
  'canteen',
  'after_school',
  'works',
  'school_trip',
  'fcpe',
  'city',
  'event',
  'school_council',
  'other',
] as const;
export type PostCategory = (typeof POST_CATEGORIES)[number];
export interface Post {
  id: EntityId;
  organizationId: EntityId;
  authorId: EntityId;
  title: string;
  body: string;
  category: PostCategory;
  audience: Audience;
  imagePaths: string[];
  flyerPath?: string;
  pdfPath?: string;
  linkUrl?: string;
  pinned: boolean;
  importance: 'normal' | 'important' | 'urgent';
  status: 'draft' | 'scheduled' | 'published' | 'archived';
  publishedAt?: DateValue;
  createdAt: DateValue;
  updatedAt: DateValue;
}
export interface Event {
  id: EntityId;
  organizationId: EntityId;
  title: string;
  description: string;
  type:
    | 'meeting'
    | 'school_council'
    | 'trip'
    | 'fair'
    | 'holiday'
    | 'election'
    | 'school_event'
    | 'other';
  audience: Audience;
  startsAt: DateValue;
  endsAt?: DateValue;
  location?: string;
  documentId?: EntityId;
  linkUrl?: string;
  reminderEnabled: boolean;
  published: boolean;
  createdAt: DateValue;
  updatedAt: DateValue;
}
export interface CanteenMenu {
  id: EntityId;
  organizationId: EntityId;
  title: string;
  description?: string;
  startsOn: string;
  endsOn: string;
  imagePath?: string;
  pdfPath?: string;
  published: boolean;
  createdAt: DateValue;
  updatedAt: DateValue;
}
export interface Document {
  id: EntityId;
  organizationId: EntityId;
  title: string;
  category: 'flyer' | 'canteen' | 'minutes' | 'city' | 'fcpe' | 'other';
  year: number;
  audience: Audience;
  storagePath: string;
  contentType: string;
  sizeBytes: number;
  published: boolean;
  createdAt: DateValue;
  updatedAt: DateValue;
}
export interface SchoolCouncil {
  id: EntityId;
  organizationId: EntityId;
  schoolId: EntityId;
  title: string;
  scheduledAt: DateValue;
  publicAgenda: string[];
  publicDecisions: string[];
  publicDocumentIds: EntityId[];
  audience: Audience;
  published: boolean;
  createdAt: DateValue;
  updatedAt: DateValue;
}
export interface SchoolCouncilPreparation {
  id: EntityId;
  councilId: EntityId;
  organizationId: EntityId;
  notes: string;
  questionIds: EntityId[];
  internalDocumentIds: EntityId[];
  updatedAt: DateValue;
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
  audience: Audience;
  endsAt?: DateValue;
  published: boolean;
  createdAt: DateValue;
}
export interface PollResponse {
  id: EntityId;
  pollId: EntityId;
  installationHash: string;
  optionIds: EntityId[];
  createdAt: DateValue;
}

export const CONTACT_CATEGORIES = [
  'canteen',
  'after_school',
  'teaching',
  'safety',
  'school_council',
  'event',
  'other',
] as const;
export const CONTACT_STATUSES = [
  'new',
  'in_progress',
  'forwarded_school',
  'forwarded_city',
  'resolved',
  'closed',
  'blocked',
] as const;
export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];
export type ContactStatus = (typeof CONTACT_STATUSES)[number];
export interface ContactConversation {
  id: EntityId;
  organizationId: EntityId;
  secretHash: string;
  category: ContactCategory;
  status: ContactStatus;
  displayName?: string;
  schoolId?: EntityId;
  levelId?: EntityId;
  email?: string;
  pushTokenCiphertext?: string;
  assignedMemberId?: EntityId;
  tags: string[];
  createdAt: DateValue;
  updatedAt: DateValue;
  closedAt?: DateValue;
  retentionUntil: DateValue;
}
export interface ContactMessage {
  id: EntityId;
  conversationId: EntityId;
  authorType: 'public' | 'member';
  authorMemberId?: EntityId;
  body: string;
  imagePaths: string[];
  status: 'visible' | 'removed';
  createdAt: DateValue;
}
export interface ContactInternalNote {
  id: EntityId;
  conversationId: EntityId;
  authorMemberId: EntityId;
  body: string;
  createdAt: DateValue;
}

export interface FcpeChannel {
  id: EntityId;
  organizationId: EntityId;
  name: string;
  active: boolean;
  createdAt: DateValue;
}
export interface FcpeMessage {
  id: EntityId;
  channelId: EntityId;
  organizationId: EntityId;
  authorId: EntityId;
  body: string;
  attachmentPaths: string[];
  replyToId?: EntityId;
  reactionCounts: Record<string, number>;
  status: 'visible' | 'hidden' | 'deleted';
  createdAt: DateValue;
}
export interface NotificationCampaign {
  id: EntityId;
  organizationId: EntityId;
  authorId: EntityId;
  title: string;
  body: string;
  topic: string;
  urgency: 'normal' | 'urgent';
  targetType?: 'post' | 'event' | 'document' | 'conversation';
  targetId?: EntityId;
  status: 'draft' | 'sent' | 'failed';
  createdAt: DateValue;
  sentAt?: DateValue;
}

export type AdminLogAction =
  | 'MEMBER_APPROVED'
  | 'MEMBER_REJECTED'
  | 'MEMBER_SUSPENDED'
  | 'MEMBER_REACTIVATED'
  | 'ROLE_CHANGED'
  | 'POST_CREATED'
  | 'POST_DELETED'
  | 'NOTIFICATION_SENT'
  | 'CONTACT_ASSIGNED'
  | 'CONTACT_STATUS_CHANGED'
  | 'CONTACT_BLOCKED';
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
