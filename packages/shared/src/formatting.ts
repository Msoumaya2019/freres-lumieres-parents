/**
 * Formatage et petits utilitaires métier.
 *
 * Règle : aucune dépendance externe. Ces fonctions sont utilisées dans le
 * mobile, dans l'admin et dans les Cloud Functions, et doivent rester
 * prévisibles et testables.
 */
import type { DateLike, PostCategory } from '@fl/types';

import { POST_CATEGORIES } from './constants.js';

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Convertit une valeur Firestore (Timestamp, Date, ISO) en objet `Date`. */
export function toDate(value: DateLike | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate();
  }
  return null;
}

/** Convertit en chaîne ISO, ou `null` si la valeur est absente. */
export function toIso(value: DateLike | null | undefined): string | null {
  return toDate(value)?.toISOString() ?? null;
}

const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const timeFormatter = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
});

const weekdayFormatter = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

export function formatDate(value: DateLike | null | undefined): string {
  const date = toDate(value);
  return date ? dateFormatter.format(date) : '';
}

export function formatDateTime(value: DateLike | null | undefined): string {
  const date = toDate(value);
  return date ? dateTimeFormatter.format(date) : '';
}

export function formatTime(value: DateLike | null | undefined): string {
  const date = toDate(value);
  return date ? timeFormatter.format(date) : '';
}

export function formatWeekday(value: DateLike | null | undefined): string {
  const date = toDate(value);
  if (!date) return '';
  return weekdayFormatter.format(date).replace(/^./, (char) => char.toUpperCase());
}

const relativeFormatter = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });

/**
 * Formatage relatif adapté aux fils d'actualité : « il y a 5 min »,
 * « hier », « le 12 mars ».
 */
export function formatRelative(value: DateLike | null | undefined, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return '';

  const diffMs = date.getTime() - now.getTime();
  const diffMinutes = Math.round(diffMs / 60_000);

  if (Math.abs(diffMinutes) < 1) return "à l'instant";
  if (Math.abs(diffMinutes) < 60) return relativeFormatter.format(diffMinutes, 'minute');

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return relativeFormatter.format(diffHours, 'hour');

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 7) return relativeFormatter.format(diffDays, 'day');

  return formatDate(date);
}

/** L'événement est-il dans les 7 prochains jours ? */
export function isWithinNextWeek(
  value: DateLike | null | undefined,
  now: Date = new Date(),
): boolean {
  const date = toDate(value);
  if (!date) return false;
  const diff = date.getTime() - now.getTime();
  return diff >= 0 && diff <= 7 * 24 * 60 * 60 * 1000;
}

/** L'événement est-il passé ? */
export function isPast(value: DateLike | null | undefined, now: Date = new Date()): boolean {
  const date = toDate(value);
  return date ? date.getTime() < now.getTime() : false;
}

/**
 * Année scolaire d'une date, au format « 2026-2027 ».
 *
 * L'année scolaire bascule le **1er août**, pas au 1er janvier : en janvier
 * 2027, on est toujours sur « 2026-2027 ». Un calcul naïf sur l'année civile
 * se tromperait pendant huit mois sur douze — un défaut qui ne se manifeste
 * qu'une fois par an, donc jamais pendant les tests.
 *
 * ## Pourquoi août plutôt que la rentrée de septembre
 *
 * Parce que c'est en été que le travail d'amorçage se fait. Un membre de la
 * FCPE crée les classes de l'année à venir pendant les vacances, et les
 * familles pré-inscrivent leurs enfants à la même période. Avec une bascule en
 * août, les classes créées portent immédiatement la bonne année et les
 * rattachements concordent dès le premier jour d'école. Avec une bascule en
 * septembre, les classes créées en août seraient étiquetées de l'année
 * sortante et il faudrait tout rejouer le jour de la rentrée — une étape que
 * personne ne pense à faire.
 *
 * ## Source de vérité unique
 *
 * Le script d'amorçage et l'application mobile appellent **cette** fonction.
 * Deux copies de ce calcul divergeraient en août, silencieusement, sur les
 * données réelles des familles — c'est précisément ce qui s'était produit
 * entre `scripts/seed-reference-data.mjs` (septembre) et ce fichier (août).
 *
 * @param date Date de référence. Injectable pour rendre les tests déterministes.
 */
export function getAcademicYear(date: Date = new Date()): string {
  const year = date.getFullYear();
  const startsNewYear = date.getMonth() >= 7; // août = index 7
  return startsNewYear ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

/**
 * Bornes d'une année scolaire, pour les filtres de documents.
 *
 * Accepte « 2026 » comme « 2026-2027 » : les deux formats circulent dans le
 * modèle (`documentInputSchema.year` les autorise), et refuser l'un des deux
 * rendrait une borne légitime incalculable. Seule une valeur non numérique
 * est rejetée.
 */
export function getAcademicYearRange(academicYear: string): { start: Date; end: Date } {
  const [startYearRaw] = academicYear.split('-');
  const startYear = Number.parseInt(startYearRaw ?? '', 10);
  if (Number.isNaN(startYear)) {
    throw new Error(`Année scolaire invalide : ${academicYear}`);
  }
  return {
    start: new Date(Date.UTC(startYear, 7, 1)),
    end: new Date(Date.UTC(startYear + 1, 6, 31, 23, 59, 59)),
  };
}

// ---------------------------------------------------------------------------
// Nombres et tailles
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} o`;
  const units = ['Ko', 'Mo', 'Go'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

/** « 1 parent », « 37 parents ». */
export function pluralize(count: number, singular: string, plural?: string): string {
  return count > 1 ? `${count} ${plural ?? `${singular}s`}` : `${count} ${singular}`;
}

/** Arrondit un pourcentage en évitant les décimales inutiles. */
export function formatPercent(part: number, total: number): string {
  if (total <= 0) return '0 %';
  const value = Math.round((part / total) * 100);
  return `${value} %`;
}

// ---------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/** Initiales pour les avatars, sans jamais exposer le nom complet. */
export function initials(firstName: string, lastName: string): string {
  const first = firstName.trim().charAt(0).toUpperCase();
  const last = lastName.trim().charAt(0).toUpperCase();
  return `${first}${last}` || '?';
}

/** « Marie Dupont » → « Marie D. », affichage par défaut dans les discussions. */
export function displayName(firstName: string, lastName: string): string {
  const lastInitial = lastName.trim().charAt(0).toUpperCase();
  return lastInitial ? `${firstName.trim()} ${lastInitial}.` : firstName.trim();
}

/** Nom d'un fichier sûr pour Firebase Storage (sans accents ni espaces). */
export function sanitizeFileName(fileName: string): string {
  return fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 120);
}

/** Convertit un texte en identifiant lisible : « Vie de la FCPE » → « vie-de-la-fcpe ». */
export function slugify(value: string): string {
  return sanitizeFileName(value.replace(/\s+/g, '-'));
}

// ---------------------------------------------------------------------------
// Logique métier légère
// ---------------------------------------------------------------------------

/** Catégories qui doivent remonter en tête de fil et déclencher une alerte. */
export const URGENT_CATEGORIES: readonly PostCategory[] = ['urgent'];

export function isUrgentCategory(category: PostCategory): boolean {
  return URGENT_CATEGORIES.includes(category);
}

/** Trie une liste de catégories selon l'ordre d'affichage officiel. */
export function sortCategories(categories: readonly PostCategory[]): PostCategory[] {
  return [...categories].sort((a, b) => POST_CATEGORIES.indexOf(a) - POST_CATEGORIES.indexOf(b));
}

/** Échappe les caractères sensibles avant affichage dans un contexte HTML (admin). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
