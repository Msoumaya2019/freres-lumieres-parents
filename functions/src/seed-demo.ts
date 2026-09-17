import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const projectId =
  process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? '';
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST ||
  !process.env.FIREBASE_STORAGE_EMULATOR_HOST ||
  !projectId.startsWith('demo-')
)
  throw new Error('Refus du seed hors émulateurs Firebase demo-*.');
initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
const db = getFirestore();
const auth = getAuth();
const bucket = getStorage().bucket();
const organizationId = 'freres-lumieres';
const day = 24 * 60 * 60 * 1_000;
const fromNow = (days: number, hour = 9) => {
  const date = new Date(Date.now() + days * day);
  date.setHours(hour, 0, 0, 0);
  return Timestamp.fromDate(date);
};
const isoDate = (days: number) =>
  new Date(Date.now() + days * day).toISOString().slice(0, 10);
const members = [
  {
    uid: 'demo-admin',
    email: 'admin@example.test',
    firstName: 'Camille',
    lastName: 'Admin',
    role: 'admin',
    status: 'active',
  },
  {
    uid: 'demo-fcpe',
    email: 'fcpe@example.test',
    firstName: 'Sofia',
    lastName: 'FCPE',
    role: 'fcpe',
    status: 'pending',
  },
] as const;
for (const member of members) {
  try {
    await auth.createUser({
      uid: member.uid,
      email: member.email,
      password: 'Demo-Password-2026!',
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('already exists'))
      throw error;
  }
  await auth.setCustomUserClaims(member.uid, {
    role: member.role,
    status: member.status,
    organizationId,
  });
  await db.doc(`memberProfiles/${member.uid}`).set({
    ...member,
    id: member.uid,
    organizationId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}
await db.doc(`organizations/${organizationId}`).set({
  id: organizationId,
  name: 'Groupe scolaire Frères Lumières',
  slug: organizationId,
  active: true,
});
await db.doc('schools/elementary').set({
  id: 'elementary',
  organizationId,
  name: 'École élémentaire Frères Lumières',
  type: 'elementary',
  active: true,
});
await db.doc('schools/kindergarten').set({
  id: 'kindergarten',
  organizationId,
  name: 'École maternelle Frères Lumières',
  type: 'kindergarten',
  active: true,
});
await db.doc('posts/demo-greve').set({
  id: 'demo-greve',
  organizationId,
  authorId: 'demo-admin',
  title: 'Mouvement de grève vendredi',
  body: 'Donnée fictive réservée au développement local.',
  category: 'urgent',
  audience: { type: 'all', ids: [] },
  imagePaths: [],
  pinned: true,
  importance: 'urgent',
  status: 'published',
  publishedAt: FieldValue.serverTimestamp(),
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});
await db.doc('posts/demo-reunion').set({
  id: 'demo-reunion',
  organizationId,
  authorId: 'demo-admin',
  title: 'Réunion des parents d’élèves',
  body: 'Rendez-vous dans la salle polyvalente pour échanger sur les projets de l’école.',
  category: 'information',
  audience: { type: 'school', ids: ['elementary'] },
  imagePaths: [],
  pinned: false,
  importance: 'normal',
  status: 'published',
  publishedAt: fromNow(-1),
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});
await db.doc('posts/demo-kermesse').set({
  id: 'demo-kermesse',
  organizationId,
  authorId: 'demo-admin',
  title: 'Kermesse des Frères Lumières',
  body: 'Une journée chaleureuse avec stands, jeux et goûter pour toutes les familles.',
  category: 'event',
  audience: { type: 'all', ids: [] },
  imagePaths: [],
  pinned: false,
  importance: 'important',
  status: 'published',
  publishedAt: fromNow(-2),
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});
await db.doc('events/demo-council').set({
  id: 'demo-council',
  organizationId,
  title: 'Conseil d’école élémentaire',
  description:
    'Présentation des projets et questions des représentants de parents.',
  type: 'school_council',
  audience: { type: 'school', ids: ['elementary'] },
  startsAt: fromNow(14, 18),
  location: 'École élémentaire',
  reminderEnabled: true,
  published: true,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});
await db.doc('events/demo-fair').set({
  id: 'demo-fair',
  organizationId,
  title: 'Kermesse de l’école',
  description:
    'Animations et moments conviviaux pour les enfants et leurs familles.',
  type: 'fair',
  audience: { type: 'all', ids: [] },
  startsAt: fromNow(30, 14),
  location: 'Cour de l’école',
  reminderEnabled: true,
  published: true,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});
await db.doc('canteenMenus/demo-current').set({
  id: 'demo-current',
  organizationId,
  title: 'Menu de la semaine',
  description:
    'Lundi : crudités, poulet et légumes. Mardi : salade, poisson et riz. Jeudi : repas végétarien. Vendredi : menu du marché.',
  startsOn: isoDate(0),
  endsOn: isoDate(4),
  published: true,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});
await db.doc('canteenMenus/demo-next').set({
  id: 'demo-next',
  organizationId,
  title: 'Menu de la semaine prochaine',
  description: 'Menu fictif de démonstration, susceptible d’être modifié.',
  startsOn: isoDate(7),
  endsOn: isoDate(11),
  published: true,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});
const demoPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
await bucket.file('documents/demo-flyer/flyer.png').save(demoPng, {
  metadata: { contentType: 'image/png' },
});
await db.doc('documents/demo-flyer').set({
  id: 'demo-flyer',
  organizationId,
  title: 'Flyer de bienvenue FCPE',
  category: 'flyer',
  year: new Date().getFullYear(),
  audience: { type: 'all', ids: [] },
  storagePath: 'documents/demo-flyer/flyer.png',
  contentType: 'image/png',
  sizeBytes: demoPng.byteLength,
  published: true,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});
await db.doc('schoolCouncils/demo-council').set({
  id: 'demo-council',
  organizationId,
  schoolId: 'elementary',
  title: 'Conseil d’école élémentaire',
  scheduledAt: fromNow(14, 18),
  publicAgenda: [
    'Projets pédagogiques du trimestre',
    'Organisation de la kermesse',
    'Questions des représentants de parents',
  ],
  publicDecisions: [],
  publicDocumentIds: ['demo-flyer'],
  audience: { type: 'school', ids: ['elementary'] },
  published: true,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});
console.log(
  'Seed Phase 3 public et membres fictifs chargé dans les émulateurs Firebase.',
);
