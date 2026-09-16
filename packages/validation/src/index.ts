import { z } from 'zod';
import { REPORT_STATUSES, USER_ROLES, USER_STATUSES } from '@flp/types';

const id = z.string().min(1).max(128);
const dateValue = z.union([
  z.date(),
  z.iso.datetime(),
  z.object({ seconds: z.number(), nanoseconds: z.number() }),
]);
export const audienceSchema = z.object({
  type: z.enum(['all', 'school', 'level', 'class', 'fcpe']),
  ids: z.array(id).max(20),
});

export const userSchema = z.object({
  id,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.email().max(254),
  role: z.enum(USER_ROLES),
  status: z.enum(USER_STATUSES),
  organizationId: id,
  schoolIds: z.array(id).max(10),
  levelIds: z.array(id).max(10),
  classIds: z.array(id).max(10),
  notificationPreferences: z.record(z.string(), z.boolean()),
  createdAt: dateValue,
  updatedAt: dateValue,
});

export const loginSchema = z.object({
  email: z.email('Saisissez une adresse email valide.').trim().max(254),
  password: z.string().min(1, 'Saisissez votre mot de passe.'),
});

export const childRegistrationSchema = z.object({
  schoolId: id,
  levelId: id,
  classId: id.optional(),
});

export const registrationProfileSchema = z.object({
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(2).max(80),
  organizationId: id,
  children: z.array(childRegistrationSchema).min(1).max(5),
});

export const registrationSchema = registrationProfileSchema.extend({
  email: z.email('Saisissez une adresse email valide.').trim().max(254),
  password: z
    .string()
    .min(12, 'Le mot de passe doit contenir au moins 12 caractères.')
    .max(128)
    .regex(/[a-z]/, 'Ajoutez une lettre minuscule.')
    .regex(/[A-Z]/, 'Ajoutez une lettre majuscule.')
    .regex(/[0-9]/, 'Ajoutez un chiffre.'),
});

export type RegistrationInput = z.infer<typeof registrationSchema>;
export type RegistrationProfileInput = z.infer<
  typeof registrationProfileSchema
>;

export const postSchema = z.object({
  id,
  organizationId: id,
  authorId: id,
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(20_000),
  category: z.enum([
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
  ]),
  audience: audienceSchema,
  attachmentIds: z.array(id).max(10),
  commentsEnabled: z.boolean(),
  pinned: z.boolean(),
  publishedAt: dateValue,
  createdAt: dateValue,
  updatedAt: dateValue,
});

export const reportSchema = z.object({
  id,
  organizationId: id,
  authorId: id,
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(10).max(10_000),
  category: z.enum([
    'canteen',
    'safety',
    'bullying',
    'after_school',
    'premises',
    'teaching',
    'transport',
    'other',
  ]),
  status: z.enum(REPORT_STATUSES),
  visibility: z.enum(['owner_moderators', 'fcpe']),
  photoPaths: z.array(z.string().max(500)).max(5),
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
  anonymous: z.boolean(),
  audience: audienceSchema,
  endsAt: dateValue.optional(),
  createdAt: dateValue,
});

export const eventSchema = z.object({
  id,
  organizationId: id,
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(10_000),
  audience: audienceSchema,
  startsAt: dateValue,
  endsAt: dateValue.optional(),
  location: z.string().trim().max(300).optional(),
  volunteerTarget: z.number().int().positive().max(1_000).optional(),
  participantCount: z.number().int().nonnegative(),
  createdAt: dateValue,
});
