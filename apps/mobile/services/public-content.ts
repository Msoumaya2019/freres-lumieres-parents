import type {
  Audience,
  CanteenMenu,
  DateValue,
  Document,
  Event,
  Post,
  SchoolCouncil,
} from '@flp/types';
import {
  canteenMenuSchema,
  documentSchema,
  eventSchema,
  postSchema,
  schoolCouncilSchema,
} from '@flp/validation';
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';
import { firestore, storage } from '../lib/firebase';

export const organizationId =
  typeof process.env.EXPO_PUBLIC_ORGANIZATION_ID === 'string' &&
  process.env.EXPO_PUBLIC_ORGANIZATION_ID.length > 0
    ? process.env.EXPO_PUBLIC_ORGANIZATION_ID
    : 'freres-lumieres';
const publicAudienceTypes = ['all', 'school', 'level', 'class'] as const;

function validated<T>(
  snapshots: QueryDocumentSnapshot<DocumentData>[],
  schema: {
    safeParse: (
      value: unknown,
    ) => { success: true; data: T } | { success: false };
  },
): T[] {
  return snapshots.flatMap((snapshot) => {
    const result = schema.safeParse({ id: snapshot.id, ...snapshot.data() });
    return result.success ? [result.data] : [];
  });
}

export async function loadPublicPosts(): Promise<Post[]> {
  const snapshot = await getDocs(
    query(
      collection(firestore, 'posts'),
      where('organizationId', '==', organizationId),
      where('status', '==', 'published'),
      where('audience.type', 'in', [...publicAudienceTypes]),
      orderBy('publishedAt', 'desc'),
      limit(30),
    ),
  );
  return validated(snapshot.docs, postSchema);
}

export async function loadPublicEvents(): Promise<Event[]> {
  const snapshot = await getDocs(
    query(
      collection(firestore, 'events'),
      where('organizationId', '==', organizationId),
      where('published', '==', true),
      where('audience.type', 'in', [...publicAudienceTypes]),
      orderBy('startsAt', 'asc'),
      limit(40),
    ),
  );
  return validated(snapshot.docs, eventSchema);
}

export async function loadPublicCanteenMenus(): Promise<CanteenMenu[]> {
  const snapshot = await getDocs(
    query(
      collection(firestore, 'canteenMenus'),
      where('organizationId', '==', organizationId),
      where('published', '==', true),
      orderBy('startsOn', 'desc'),
      limit(12),
    ),
  );
  return validated(snapshot.docs, canteenMenuSchema);
}

export async function loadPublicDocuments(): Promise<Document[]> {
  const snapshot = await getDocs(
    query(
      collection(firestore, 'documents'),
      where('organizationId', '==', organizationId),
      where('published', '==', true),
      where('audience.type', 'in', [...publicAudienceTypes]),
      orderBy('createdAt', 'desc'),
      limit(40),
    ),
  );
  return validated(snapshot.docs, documentSchema);
}

export async function loadPublicSchoolCouncils(): Promise<SchoolCouncil[]> {
  const snapshot = await getDocs(
    query(
      collection(firestore, 'schoolCouncils'),
      where('organizationId', '==', organizationId),
      where('published', '==', true),
      where('audience.type', 'in', [...publicAudienceTypes]),
      orderBy('scheduledAt', 'desc'),
      limit(20),
    ),
  );
  return validated(snapshot.docs, schoolCouncilSchema);
}

export async function publicAssetUrl(path: string): Promise<string> {
  return getDownloadURL(ref(storage, path));
}

export function dateFrom(value: DateValue): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  return new Date(value.seconds * 1_000);
}

export function audienceLabel(audience: Audience): string {
  if (audience.type === 'all') return 'Toutes les familles';
  if (audience.type === 'fcpe') return 'Membres FCPE';
  const labels = audience.ids.map((id) => {
    if (id === 'kindergarten') return 'Maternelle';
    if (id === 'elementary') return 'Élémentaire';
    return id;
  });
  return labels.join(' · ') || 'Public ciblé';
}
