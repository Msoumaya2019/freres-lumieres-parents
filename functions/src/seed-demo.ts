import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const projectId =
  process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? '';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

if (!emulatorHost || !authEmulatorHost || !projectId.startsWith('demo-')) {
  throw new Error(
    'Refus du seed : les hôtes Auth/Firestore Emulator et un projectId demo-* sont obligatoires.',
  );
}

initializeApp({ projectId });
const db = getFirestore();
const auth = getAuth();
const organizationId = 'freres-lumieres';

const users = [
  {
    uid: 'demo-parent',
    email: 'parent@example.test',
    firstName: 'Mohamed',
    lastName: 'Parent',
    role: 'parent',
    status: 'active',
  },
  {
    uid: 'demo-admin',
    email: 'admin@example.test',
    firstName: 'Camille',
    lastName: 'Admin',
    role: 'admin',
    status: 'active',
  },
  {
    uid: 'demo-pending',
    email: 'pending@example.test',
    firstName: 'Sofia',
    lastName: 'En attente',
    role: 'parent',
    status: 'pending',
  },
];

for (const user of users) {
  try {
    await auth.createUser({
      uid: user.uid,
      email: user.email,
      password: 'Demo-Password-2026!',
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('already exists'))
      throw error;
  }
  await auth.setCustomUserClaims(user.uid, {
    role: user.role,
    status: user.status,
    organizationId,
    schoolIds: ['elementary'],
    levelIds: ['ce1'],
    classIds: [],
  });
  await db.doc(`users/${user.uid}`).set({
    ...user,
    id: user.uid,
    status: user.status,
    organizationId,
    schoolIds: ['elementary'],
    levelIds: ['ce1'],
    classIds: [],
    notificationPreferences: {},
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

const registrationSchools = [
  {
    id: 'kindergarten',
    name: 'École maternelle Frères Lumières',
    levels: [
      { id: 'ps', name: 'Petite Section' },
      { id: 'ms', name: 'Moyenne Section' },
      { id: 'gs', name: 'Grande Section' },
    ],
  },
  {
    id: 'elementary',
    name: 'École élémentaire Frères Lumières',
    levels: [
      { id: 'cp', name: 'CP' },
      { id: 'ce1', name: 'CE1' },
      { id: 'ce2', name: 'CE2' },
      { id: 'cm1', name: 'CM1' },
      { id: 'cm2', name: 'CM2' },
    ],
  },
];

await db.doc(`registrationOptions/${organizationId}`).set({
  organizationId,
  organizationName: 'Groupe scolaire Frères Lumières',
  active: true,
  schools: registrationSchools,
  updatedAt: FieldValue.serverTimestamp(),
});

for (const school of registrationSchools) {
  for (const [order, level] of school.levels.entries()) {
    await db.doc(`levels/${level.id}`).set({
      ...level,
      organizationId,
      schoolId: school.id,
      order,
      active: true,
    });
  }
}
await db.doc('posts/demo-greve').set({
  id: 'demo-greve',
  organizationId,
  authorId: 'demo-admin',
  title: 'Mouvement de grève vendredi',
  body: 'Donnée fictive réservée au développement local.',
  category: 'urgent',
  audience: { type: 'all', ids: [] },
  attachmentIds: [],
  commentsEnabled: true,
  pinned: true,
  status: 'published',
  publishedAt: FieldValue.serverTimestamp(),
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});

console.log('Seed fictif chargé dans les émulateurs Firebase.');
