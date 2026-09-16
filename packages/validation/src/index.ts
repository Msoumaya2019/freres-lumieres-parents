import { z } from 'zod';
import {
  CONTACT_CATEGORIES,
  CONTACT_STATUSES,
  POST_CATEGORIES,
  USER_ROLES,
  USER_STATUSES,
} from '@flp/types';

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const dateValue = z.union([
  z.date(),
  z.iso.datetime(),
  z.object({ seconds: z.number(), nanoseconds: z.number() }),
]);
export const audienceSchema = z.object({
  type: z.enum(['all', 'school', 'level', 'class', 'fcpe']),
  ids: z.array(id).max(20),
});
export const loginSchema = z.object({
  email: z.email('Saisissez une adresse email valide.').trim().max(254),
  password: z.string().min(1, 'Saisissez votre mot de passe.'),
});
export const memberProfileSchema = z.object({
  id,
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(2).max(80),
  email: z.email().max(254),
  role: z.enum(USER_ROLES),
  status: z.enum(USER_STATUSES),
  organizationId: id,
  declaredFunction: z.string().trim().max(120).optional(),
  createdAt: dateValue,
  updatedAt: dateValue,
});
export const memberRegistrationProfileSchema = z.object({
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(2).max(80),
  organizationId: id,
  declaredFunction: z.string().trim().max(120).optional(),
});
export const memberRegistrationSchema = memberRegistrationProfileSchema.extend({
  email: z.email('Saisissez une adresse email valide.').trim().max(254),
  password: z
    .string()
    .min(12, 'Le mot de passe doit contenir au moins 12 caractères.')
    .max(128)
    .regex(/[a-z]/, 'Ajoutez une lettre minuscule.')
    .regex(/[A-Z]/, 'Ajoutez une lettre majuscule.')
    .regex(/[0-9]/, 'Ajoutez un chiffre.'),
});
export type MemberRegistrationInput = z.infer<typeof memberRegistrationSchema>;

export const postSchema = z.object({
  id,
  organizationId: id,
  authorId: id,
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(20_000),
  category: z.enum(POST_CATEGORIES),
  audience: audienceSchema,
  imagePaths: z.array(z.string().max(500)).max(10),
  flyerPath: z.string().max(500).optional(),
  pdfPath: z.string().max(500).optional(),
  linkUrl: z.url().max(2_000).optional(),
  pinned: z.boolean(),
  importance: z.enum(['normal', 'important', 'urgent']),
  status: z.enum(['draft', 'scheduled', 'published', 'archived']),
  publishedAt: dateValue.optional(),
  createdAt: dateValue,
  updatedAt: dateValue,
});
export const eventSchema = z.object({
  id,
  organizationId: id,
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(10_000),
  type: z.enum([
    'meeting',
    'school_council',
    'trip',
    'fair',
    'holiday',
    'election',
    'school_event',
    'other',
  ]),
  audience: audienceSchema,
  startsAt: dateValue,
  endsAt: dateValue.optional(),
  location: z.string().trim().max(300).optional(),
  documentId: id.optional(),
  linkUrl: z.url().max(2_000).optional(),
  reminderEnabled: z.boolean(),
  published: z.boolean(),
  createdAt: dateValue,
  updatedAt: dateValue,
});
export const canteenMenuSchema = z.object({
  id,
  organizationId: id,
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(5_000).optional(),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  imagePath: z.string().max(500).optional(),
  pdfPath: z.string().max(500).optional(),
  published: z.boolean(),
  createdAt: dateValue,
  updatedAt: dateValue,
});
export const pollSchema = z.object({
  id,
  organizationId: id,
  authorId: id,
  question: z.string().trim().min(1).max(300),
  options: z
    .array(
      z.object({
        id,
        label: z.string().trim().min(1).max(200),
        order: z.number().int().nonnegative(),
      }),
    )
    .min(2)
    .max(20),
  multipleChoice: z.boolean(),
  audience: audienceSchema,
  endsAt: dateValue.optional(),
  published: z.boolean(),
  createdAt: dateValue,
});
export const contactConversationSchema = z.object({
  category: z.enum(CONTACT_CATEGORIES),
  displayName: z.string().trim().max(80).optional(),
  schoolId: id.optional(),
  levelId: id.optional(),
  email: z.email().max(254).optional(),
  initialMessage: z.string().trim().min(1).max(4_000),
  pushToken: z.string().max(4_096).optional(),
});
export const contactMessageSchema = z.object({
  conversationId: id,
  secret: z.string().min(32).max(512),
  body: z.string().trim().min(1).max(4_000),
  attachmentIds: z.array(id).max(3),
});
export const contactStatusSchema = z.enum(CONTACT_STATUSES);
export const notificationCampaignSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(500),
  topic: z.enum([
    'all_public',
    'school_maternelle',
    'school_elementaire',
    'canteen',
    'events',
    'school_councils',
  ]),
  urgency: z.enum(['normal', 'urgent']),
  targetType: z.enum(['post', 'event', 'document', 'conversation']).optional(),
  targetId: id.optional(),
});
