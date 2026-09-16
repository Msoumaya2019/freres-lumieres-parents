/**
 * Schémas de validation (Zod).
 *
 * Principe : **une seule définition, trois usages**.
 *  1. l'application mobile valide le formulaire avant l'envoi ;
 *  2. l'interface d'administration fait de même ;
 *  3. les Cloud Functions revalident le même schéma côté serveur.
 *
 * Une validation uniquement côté client ne protège de rien : un appel
 * Firestore direct la contourne. La validation serveur est la seule qui
 * compte, celle du client sert au confort (messages d'erreur immédiats).
 */
import { z } from 'zod';

import {
  AUDIENCE_TYPES,
  CLASS_LEVELS,
  CONTENT_STATUSES,
  DOCUMENT_CATEGORIES,
  EVENT_TYPES,
  ISSUE_SUPPORT_VALUES,
  MODERATION_REASONS,
  NOTIFICATION_CATEGORIES,
  POLL_RESULTS_VISIBILITIES,
  POST_CATEGORIES,
  REPORT_CATEGORIES,
  TEXT_LIMITS,
  UPLOAD_LIMITS,
  USER_ROLES,
} from './constants.js';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Adresse e-mail invalide.' }));

/**
 * Mot de passe : au moins 10 caractères, une lettre et un chiffre.
 * Volontairement pas de règle de symbole obligatoire — elles poussent les
 * utilisateurs vers des mots de passe plus faibles et plus difficiles à
 * retenir. La longueur est le facteur le plus utile ici.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Le mot de passe doit contenir au moins 10 caractères.')
  .max(128, 'Le mot de passe est trop long.')
  .regex(/[a-zA-Z]/, 'Le mot de passe doit contenir au moins une lettre.')
  .regex(/[0-9]/, 'Le mot de passe doit contenir au moins un chiffre.');

export const idSchema = z.string().trim().min(1).max(128);

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Ce champ est obligatoire.')
  .max(TEXT_LIMITS.userName, `Maximum ${TEXT_LIMITS.userName} caractères.`);

/** Identifiant de document Firestore : lettres, chiffres, tirets, underscores. */
export const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Utilisez uniquement des minuscules, chiffres et tirets.');

// ---------------------------------------------------------------------------
// Lecture d'un résultat de validation
// ---------------------------------------------------------------------------

/**
 * Forme minimale d'une erreur de validation, sans dépendre de Zod.
 *
 * Structurelle à dessein : un écran lit un résultat de validation sans avoir à
 * importer la bibliothèque, et un objet qui présente ces trois propriétés est
 * accepté tel quel. Zod satisfait cette forme, elle n'est donc jamais un
 * obstacle.
 */
export interface ValidationIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/**
 * Première erreur par champ, pour l'affichage.
 *
 * Une seule par champ : empiler « trop court » puis « doit contenir un
 * chiffre » sous le même champ brouille le message plus qu'il n'aide.
 *
 * La clé de regroupement est le chemin de l'erreur joint par des points —
 * `['children', 0, 'schoolId']` donne `children.0.schoolId` —, ce qui permet à
 * un formulaire de retrouver l'erreur d'un champ répété sans connaître
 * l'indexation de Zod. La **première** erreur d'un champ l'emporte : Zod
 * rapporte les problèmes dans l'ordre de déclaration du schéma, qui va du plus
 * général au plus fin.
 *
 * Vit ici, et non dans un écran, parce que trois formulaires s'en servent
 * déjà : l'inscription mobile, la publication mobile et l'éditeur
 * d'administration. Trois copies d'une règle d'affichage, c'est trois
 * occasions de ne plus présenter les erreurs de la même façon.
 */
export function firstIssueByField(issues: readonly ValidationIssue[]): Record<string, string> {
  const messages: Record<string, string> = {};

  for (const issue of issues) {
    const field = issue.path.join('.');
    if (!messages[field]) messages[field] = issue.message;
  }

  return messages;
}

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

export const audienceSchema = z.discriminatedUnion(
  'type',
  [
    z.object({ type: z.literal('all') }),
    z.object({ type: z.literal('school'), schoolId: idSchema }),
    z.object({ type: z.literal('level'), schoolId: idSchema, level: z.enum(CLASS_LEVELS) }),
    z.object({ type: z.literal('class'), classId: idSchema }),
    z.object({ type: z.literal('fcpe') }),
  ],
  { error: "Type d'audience inconnu." },
);

export const audienceTypeSchema = z.enum(AUDIENCE_TYPES);

// ---------------------------------------------------------------------------
// Pièces jointes
// ---------------------------------------------------------------------------

export const attachmentSchema = z.object({
  storagePath: z.string().trim().min(1).max(1024),
  contentType: z.enum([...UPLOAD_LIMITS.image.mimeTypes, ...UPLOAD_LIMITS.document.mimeTypes] as [
    string,
    ...string[],
  ]),
  fileName: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

// ---------------------------------------------------------------------------
// Inscription et profil
// ---------------------------------------------------------------------------

/**
 * Rattachement d'un enfant.
 * Aucune donnée nominative obligatoire : le prénom reste facultatif.
 */
export const childInputSchema = z.object({
  firstName: z.string().trim().max(TEXT_LIMITS.userName).optional(),
  schoolId: idSchema,
  level: z.enum(CLASS_LEVELS),
  classId: idSchema.optional(),
  academicYear: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{4}$/, 'Format attendu : 2026-2027.'),
});

/**
 * Rattachement d'un enfant **tel qu'il est saisi** dans le formulaire.
 *
 * Distinct de `childInputSchema`, qui décrit ce qui est **stocké**. Le niveau
 * et l'année scolaire figurent dans le document, mais le parent ne les saisit
 * pas : ils se déduisent de la classe choisie. Les redemander créerait trois
 * réponses à tenir cohérentes entre elles, qui finiraient par se contredire —
 * un enfant enregistré en « CE1 » dans une classe de CP.
 *
 * En ne demandant que l'établissement et la classe, le formulaire ne *peut
 * pas* produire d'incohérence : il n'y a rien à faire concorder.
 */
export const childDraftSchema = z
  .object({
    firstName: z.string().trim().max(TEXT_LIMITS.userName).optional(),
    schoolId: z.string().trim().min(1, 'Choisissez un établissement.'),
    classId: z.string().trim().min(1, 'Choisissez une classe.'),
  })
  .strict();

/** Liste des enfants saisis. Même exigence de minimum que l'inscription. */
export const childrenDraftSchema = z
  .array(childDraftSchema)
  .min(1, 'Renseignez au moins un enfant.')
  .max(10, 'Dix enfants au maximum.');

/**
 * Liste des enfants rattachés.
 *
 * Extraite du schéma d'inscription pour être validée **séparément** : le
 * parcours mobile se remplit en deux temps — identité, puis enfants — et
 * chaque étape doit pouvoir être validée seule. Dupliquer la règle « au moins
 * un enfant » dans l'écran serait la garantie qu'elle finisse par diverger.
 *
 * Le minimum d'un enfant n'est pas une contrainte de confort : sans
 * rattachement, aucune information ne peut être ciblée vers ce parent, et son
 * compte n'aurait aucune raison d'être validé par la FCPE.
 */
export const childrenListSchema = z
  .array(childInputSchema)
  .min(1, 'Renseignez au moins un enfant.')
  .max(10, 'Dix enfants au maximum.');

/**
 * Champs d'identité et de consentement.
 *
 * Déclarés une seule fois, puis assemblés en deux schémas : celui de l'étape
 * d'identité et celui de l'inscription complète. Les deux ne peuvent donc pas
 * se contredire.
 */
const registrationIdentityFields = {
  firstName: nameSchema,
  lastName: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  acceptPrivacyPolicy: z.literal(true, {
    error: 'Vous devez accepter la politique de confidentialité.',
  }),
  acceptCommunityRules: z.literal(true, {
    error: 'Vous devez accepter le règlement des discussions.',
  }),
  /** Facultatif : autorise la FCPE à recontacter le parent. */
  acceptFcpeContact: z.boolean().default(false),
};

/** Première étape du parcours d'inscription : identité et consentements. */
export const registrationIdentitySchema = z.object(registrationIdentityFields).strict();

export const registrationSchema = z
  .object({
    ...registrationIdentityFields,
    children: childrenListSchema,
  })
  .strict();

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Mot de passe requis.'),
});

export const passwordResetSchema = z.object({ email: emailSchema });

export const profileUpdateSchema = z
  .object({
    firstName: nameSchema.optional(),
    lastName: nameSchema.optional(),
    phone: z
      .string()
      .trim()
      .max(20)
      .regex(/^[+0-9 ().-]*$/, 'Numéro de téléphone invalide.')
      .optional(),
  })
  .strict();

export const notificationPrefsSchema = z.object({
  enabled: z.boolean(),
  disabledCategories: z.array(z.enum(NOTIFICATION_CATEGORIES)).max(NOTIFICATION_CATEGORIES.length),
});

export const consentsSchema = z.object({
  privacyPolicy: z.boolean(),
  communityRules: z.boolean(),
  fcpeContact: z.boolean(),
});

// ---------------------------------------------------------------------------
// Publications et commentaires
// ---------------------------------------------------------------------------

export const postInputSchema = z
  .object({
    title: z.string().trim().min(3, 'Le titre est trop court.').max(TEXT_LIMITS.postTitle),
    body: z.string().trim().min(1, 'Le contenu est obligatoire.').max(TEXT_LIMITS.postBody),
    category: z.enum(POST_CATEGORIES),
    audience: audienceSchema,
    attachments: z.array(attachmentSchema).max(UPLOAD_LIMITS.maxAttachmentsPerPost).default([]),
    linkUrl: z.url({ message: 'Lien invalide.' }).max(2048).optional(),
    commentsEnabled: z.boolean().default(true),
    pinned: z.boolean().default(false),
    /** Publier immédiatement ou enregistrer en brouillon. */
    status: z.enum(['draft', 'published']).default('published'),
    /** Déclencher ou non une notification push à la publication. */
    notify: z.boolean().default(false),
  })
  .strict();

export const postUpdateSchema = postInputSchema.partial().strict();

export const commentInputSchema = z
  .object({
    body: z.string().trim().min(1, 'Le message est vide.').max(TEXT_LIMITS.commentBody),
    parentId: idSchema.optional(),
  })
  .strict();

export const messageInputSchema = z
  .object({
    body: z.string().trim().min(1, 'Le message est vide.').max(TEXT_LIMITS.messageBody),
    replyToId: idSchema.optional(),
    attachments: z.array(attachmentSchema).max(3).default([]),
  })
  .strict();

export const channelInputSchema = z
  .object({
    name: z.string().trim().min(2).max(TEXT_LIMITS.channelName),
    description: z.string().trim().max(TEXT_LIMITS.channelDescription).optional(),
    type: z.enum(['general', 'school', 'level', 'theme', 'fcpe']),
    level: z.enum(CLASS_LEVELS).optional(),
    audience: audienceSchema,
    readOnly: z.boolean().default(false),
  })
  .strict();

// ---------------------------------------------------------------------------
// Sondages
// ---------------------------------------------------------------------------

export const pollOptionSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1).max(TEXT_LIMITS.pollOptionLabel),
  order: z.number().int().min(0),
});

export const pollInputSchema = z
  .object({
    question: z.string().trim().min(5).max(TEXT_LIMITS.pollQuestion),
    description: z.string().trim().max(TEXT_LIMITS.pollDescription).optional(),
    options: z
      .array(pollOptionSchema)
      .min(2, 'Un sondage doit proposer au moins deux réponses.')
      .max(TEXT_LIMITS.pollMaxOptions),
    allowMultiple: z.boolean().default(false),
    anonymous: z.boolean().default(false),
    allowChangeVote: z.boolean().default(true),
    audience: audienceSchema,
    resultsVisibility: z.enum(POLL_RESULTS_VISIBILITIES).default('after_vote'),
    endsAt: z.coerce.date().optional(),
    notify: z.boolean().default(true),
  })
  .strict();

export const pollVoteSchema = z
  .object({
    optionIds: z.array(idSchema).min(1, 'Sélectionnez au moins une réponse.'),
  })
  .strict();

// ---------------------------------------------------------------------------
// Signalements et sujets collectifs
// ---------------------------------------------------------------------------

export const reportInputSchema = z
  .object({
    title: z.string().trim().min(5).max(TEXT_LIMITS.reportTitle),
    description: z.string().trim().min(10).max(TEXT_LIMITS.reportDescription),
    category: z.enum(REPORT_CATEGORIES),
    attachments: z.array(attachmentSchema).max(3).default([]),
    /** Consentement explicite pour rendre le signalement visible collectivement. */
    shareAsCollective: z.boolean().default(false),
  })
  .strict();

export const reportReplySchema = z
  .object({
    body: z.string().trim().min(1).max(TEXT_LIMITS.reportReply),
    internal: z.boolean().default(false),
  })
  .strict();

export const collectiveIssueInputSchema = z
  .object({
    title: z.string().trim().min(5).max(TEXT_LIMITS.reportTitle),
    summary: z.string().trim().min(10).max(TEXT_LIMITS.reportDescription),
    category: z.enum(REPORT_CATEGORIES),
    supportTarget: z.number().int().min(1).max(2000).optional(),
    published: z.boolean().default(true),
  })
  .strict();

export const issueSupportSchema = z
  .object({
    value: z.enum(ISSUE_SUPPORT_VALUES),
    comment: z.string().trim().max(500).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Agenda et événements
// ---------------------------------------------------------------------------

export const eventInputSchema = z
  .object({
    title: z.string().trim().min(3).max(TEXT_LIMITS.eventTitle),
    description: z.string().trim().max(TEXT_LIMITS.eventDescription).optional(),
    type: z.enum(EVENT_TYPES),
    audience: audienceSchema,
    allDay: z.boolean().default(false),
    startAt: z.coerce.date(),
    endAt: z.coerce.date().optional(),
    location: z.string().trim().max(200).optional(),
    registrationEnabled: z.boolean().default(false),
    requiresAnswer: z.boolean().default(false),
    capacity: z.number().int().min(1).max(5000).optional(),
    volunteerSlotsNeeded: z.number().int().min(0).max(200).default(0),
    reminderHoursBefore: z.number().int().min(1).max(336).default(24),
    notify: z.boolean().default(true),
  })
  .strict()
  .refine((value) => !value.endAt || value.endAt >= value.startAt, {
    message: 'La date de fin doit être postérieure à la date de début.',
    path: ['endAt'],
  });

export const eventRegistrationSchema = z
  .object({
    attendance: z.enum(['going', 'not_going', 'maybe']),
    volunteer: z.boolean().default(false),
    guests: z.number().int().min(0).max(10).default(0),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const documentInputSchema = z
  .object({
    title: z.string().trim().min(3).max(TEXT_LIMITS.documentTitle),
    description: z.string().trim().max(TEXT_LIMITS.documentDescription).optional(),
    category: z.enum(DOCUMENT_CATEGORIES),
    year: z
      .string()
      .trim()
      .regex(/^(\d{4}|\d{4}-\d{4})$/, 'Format attendu : 2026 ou 2026-2027.'),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
    audience: audienceSchema,
    attachment: attachmentSchema,
    internal: z.boolean().default(false),
  })
  .strict();

// ---------------------------------------------------------------------------
// Conseils d'école
// ---------------------------------------------------------------------------

export const councilItemInputSchema = z
  .object({
    kind: z.enum(['question', 'topic']).default('question'),
    title: z.string().trim().min(5).max(TEXT_LIMITS.councilItemTitle),
    body: z.string().trim().min(10).max(TEXT_LIMITS.councilItemBody),
    visibility: z.enum(['public', 'fcpe']).default('public'),
  })
  .strict();

export const councilAnswerSchema = z
  .object({
    body: z.string().trim().min(1).max(TEXT_LIMITS.councilItemBody),
    source: z.enum(['school', 'city', 'fcpe']),
    plannedAction: z.string().trim().max(2000).optional(),
    status: z.enum(['submitted', 'on_agenda', 'answered', 'deferred', 'dropped']).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Modération
// ---------------------------------------------------------------------------

export const moderationReportInputSchema = z
  .object({
    targetType: z.enum(['post', 'comment', 'message']),
    targetId: idSchema,
    reason: z.enum(MODERATION_REASONS),
    details: z.string().trim().max(1000).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

/*
 * Les trois schémas ci-dessous ne sont **volontairement pas `.strict()`**,
 * contrairement à tous les autres de ce fichier.
 *
 * Raison : ils ne valident pas une charge utile complète, mais la partie
 * « décision » d'un appel de Cloud Function. La cible (`uid`) voyage dans le
 * même `request.data`, à côté des champs décrits ici, et le serveur la lit
 * séparément :
 *
 *     const parsed = userStatusUpdateSchema.safeParse(request.data);
 *     const { uid } = request.data as { uid?: string };
 *
 * En mode strict, `uid` serait une clé inconnue : le parse échouerait et les
 * trois fonctions d'administration répondraient « Demande invalide » à
 * l'exécution — sans qu'aucune erreur de compilation ne l'annonce.
 *
 * Corollaire : ne pas ajouter `.strict()` « par cohérence ». Si un jour la
 * cible doit être validée par le même schéma, il faut l'y intégrer
 * explicitement (`uid: idSchema`) et retirer la lecture parallèle côté
 * serveur — les deux modifications ensemble, jamais l'une sans l'autre.
 */

export const userRoleUpdateSchema = z.object({
  role: z.enum(USER_ROLES),
  reason: z.string().trim().max(500).optional(),
});

export const userStatusUpdateSchema = z.object({
  status: z.enum(['pending', 'active', 'suspended', 'rejected']),
  reason: z.string().trim().max(500).optional(),
});

export const contentStatusUpdateSchema = z.object({
  status: z.enum(CONTENT_STATUSES),
  reason: z.string().trim().max(500).optional(),
});

export const notificationSendSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    body: z.string().trim().min(3).max(400),
    category: z.enum(NOTIFICATION_CATEGORIES),
    audience: audienceSchema,
    deeplink: z.string().trim().max(1024).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Types inférés — à réutiliser partout plutôt que de les réécrire à la main
// ---------------------------------------------------------------------------

export type RegistrationInput = z.infer<typeof registrationSchema>;
export type RegistrationIdentityInput = z.infer<typeof registrationIdentitySchema>;
export type ChildInput = z.infer<typeof childInputSchema>;
export type ChildDraftInput = z.infer<typeof childDraftSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type PostInput = z.infer<typeof postInputSchema>;
export type PostUpdateInput = z.infer<typeof postUpdateSchema>;
export type CommentInput = z.infer<typeof commentInputSchema>;
export type MessageInput = z.infer<typeof messageInputSchema>;
export type ChannelInput = z.infer<typeof channelInputSchema>;
export type PollInput = z.infer<typeof pollInputSchema>;
export type PollVoteInput = z.infer<typeof pollVoteSchema>;
export type ReportInput = z.infer<typeof reportInputSchema>;
export type ReportReplyInput = z.infer<typeof reportReplySchema>;
export type CollectiveIssueInput = z.infer<typeof collectiveIssueInputSchema>;
export type IssueSupportInput = z.infer<typeof issueSupportSchema>;
export type EventInput = z.infer<typeof eventInputSchema>;
export type EventRegistrationInput = z.infer<typeof eventRegistrationSchema>;
export type DocumentInput = z.infer<typeof documentInputSchema>;
export type CouncilItemInput = z.infer<typeof councilItemInputSchema>;
export type CouncilAnswerInput = z.infer<typeof councilAnswerSchema>;
export type ModerationReportInput = z.infer<typeof moderationReportInputSchema>;
export type NotificationSendInput = z.infer<typeof notificationSendSchema>;
export type UserRoleUpdateInput = z.infer<typeof userRoleUpdateSchema>;
export type UserStatusUpdateInput = z.infer<typeof userStatusUpdateSchema>;
export type NotificationPrefsInput = z.infer<typeof notificationPrefsSchema>;
