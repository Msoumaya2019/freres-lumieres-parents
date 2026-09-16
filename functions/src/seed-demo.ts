import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const projectId =
  process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? '';
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST ||
  !projectId.startsWith('demo-')
)
  throw new Error('Refus du seed hors émulateurs Firebase demo-*.');
initializeApp({ projectId });
const db = getFirestore();
const auth = getAuth();
const organizationId = 'freres-lumieres';
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
console.log(
  'Seed public et membres fictifs chargé dans les émulateurs Firebase.',
);
