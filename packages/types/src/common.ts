/**
 * Types transverses et primitives du domaine.
 *
 * Ce package ne contient AUCUN code exécutable : uniquement des types.
 * Les valeurs (tableaux de constantes, libellés, validateurs) vivent dans
 * `@fl/shared`. La direction des dépendances est donc toujours :
 *
 *     @fl/types  <--  @fl/shared  <--  @fl/firebase  <--  apps/*
 */

/**
 * Identifiants.
 *
 * Volontairement de simples alias de `string` plutôt que des types
 * « brandés » : sur un projet maintenu par une personne seule, le coût
 * des conversions explicites à chaque appel dépasse le bénéfice.
 * L'alias documente l'intention et reste lisible dans l'IDE.
 */
export type OrganizationId = string;
export type SchoolId = string;
export type ClassId = string;
export type UserId = string;
export type ChildId = string;
export type PostId = string;
export type CommentId = string;
export type ChannelId = string;
export type MessageId = string;
export type PollId = string;
export type ReportId = string;
export type CollectiveIssueId = string;
export type EventId = string;
export type DocumentId = string;
export type SchoolCouncilId = string;
export type CouncilItemId = string;
export type NotificationId = string;
export type ModerationReportId = string;
export type AdminLogId = string;
export type FcpeTaskId = string;
export type DeviceTokenId = string;

/** Date au format ISO 8601 (ex. « 2026-09-15T10:30:00.000Z »). */
export type ISODateTime = string;

/** Date au format ISO 8601 sans heure (ex. « 2026-09-15 »). */
export type ISODate = string;

/**
 * Représentation structurelle minimale d'un `Timestamp` Firestore.
 *
 * On ne dépend pas de `firebase/firestore` ici afin de garder ce package
 * totalement isolé : il est consommé par le mobile, l'admin, les Cloud
 * Functions et les tests, sans imposer le SDK Firebase à chacun.
 * `toDate()` est présent sur les vrais Timestamps Firestore.
 */
export interface FirestoreTimestamp {
  readonly seconds: number;
  readonly nanoseconds: number;
  toDate(): Date;
  toMillis(): number;
}

/** Valeur de date telle qu'elle peut provenir de Firestore. */
export type DateLike = FirestoreTimestamp | Date | ISODateTime;

/** Métadonnées de traçabilité présentes sur la plupart des documents. */
export interface Auditable {
  createdAt: DateLike;
  updatedAt?: DateLike;
  createdBy?: UserId;
}

/** Champs présents sur tout document rattaché à une organisation (multi-tenant). */
export interface OrganizationScoped {
  /** Organisation propriétaire (ex. « FCPE Montmagny »). */
  orgId: OrganizationId;
  /** École concernée, si le contenu est propre à un établissement. */
  schoolId?: SchoolId;
}

/** Enveloppe de résultat explicite, utilisée par la couche services. */
export type Result<T, E = AppError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** Erreur applicative normalisée (jamais de message technique brut côté UI). */
export interface AppError {
  /** Code stable, utilisable pour la traduction et les tests. */
  readonly code: AppErrorCode;
  /** Message destiné aux développeurs / logs. */
  readonly message: string;
  /** Détail optionnel (champ concerné, identifiant, etc.). */
  readonly details?: Record<string, unknown>;
  /** Cause technique d'origine, pour le débogage. */
  readonly cause?: unknown;
}

export type AppErrorCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'not-found'
  | 'already-exists'
  | 'invalid-argument'
  | 'failed-precondition'
  | 'resource-exhausted'
  | 'rate-limited'
  | 'network'
  | 'unknown';

/** Page de résultats pour toute liste paginée. */
export interface Page<T> {
  readonly items: readonly T[];
  /** Curseur opaque à repasser pour obtenir la page suivante. */
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/** État standard d'une requête asynchrone, côté UI. */
export type AsyncState<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'success'; readonly data: T }
  | { readonly status: 'error'; readonly error: AppError };

/** Préférence binaire « je participe / je ne participe pas ». */
export type Attendance = 'going' | 'not_going' | 'maybe';
