import { deleteApp, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';
import {
  deleteApp as deleteAdminApp,
  initializeApp as initializeAdminApp,
} from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const projectId = 'demo-freres-lumieres';
const adminApp = initializeAdminApp({ projectId }, 'phase-2-integration-admin');
const db = getFirestore(adminApp);
const adminAuth = getAdminAuth(adminApp);
const parentApp = initializeApp(
  { projectId, apiKey: 'demo-api-key' },
  'phase-2-parent',
);
const adminClientApp = initializeApp(
  { projectId, apiKey: 'demo-api-key' },
  'phase-2-admin',
);
const parentAuth = getAuth(parentApp);
const adminClientAuth = getAuth(adminClientApp);
const parentFunctions = getFunctions(parentApp, 'europe-west1');
const adminFunctions = getFunctions(adminClientApp, 'europe-west1');

connectAuthEmulator(parentAuth, 'http://127.0.0.1:9099', {
  disableWarnings: true,
});
connectAuthEmulator(adminClientAuth, 'http://127.0.0.1:9099', {
  disableWarnings: true,
});
connectFunctionsEmulator(parentFunctions, '127.0.0.1', 5001);
connectFunctionsEmulator(adminFunctions, '127.0.0.1', 5001);

beforeAll(async () => {
  await db.doc('registrationOptions/org-1').set({
    active: true,
    organizationId: 'org-1',
    organizationName: 'Organisation de test',
    schools: [
      {
        id: 'school-1',
        name: 'École test',
        levels: [{ id: 'ce1', name: 'CE1' }],
      },
    ],
  });
  await adminAuth.createUser({
    uid: 'admin-phase-2',
    email: 'admin-phase2@example.test',
    password: 'Admin-Password-2026!',
  });
  await adminAuth.setCustomUserClaims('admin-phase-2', {
    role: 'admin',
    status: 'active',
    organizationId: 'org-1',
    schoolIds: [],
    levelIds: [],
    classIds: [],
  });
  await db.doc('users/admin-phase-2').set({
    id: 'admin-phase-2',
    firstName: 'Admin',
    lastName: 'Test',
    email: 'admin-phase2@example.test',
    role: 'admin',
    status: 'active',
    organizationId: 'org-1',
    schoolIds: [],
    levelIds: [],
    classIds: [],
    notificationPreferences: {},
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
});

afterAll(async () => {
  await Promise.all([
    deleteApp(parentApp),
    deleteApp(adminClientApp),
    deleteAdminApp(adminApp),
  ]);
});

describe('Phase 2 authentication and user lifecycle', () => {
  it('rejects an unknown class instead of trusting client scope data', async () => {
    await createUserWithEmailAndPassword(
      parentAuth,
      'invalid-class-phase2@example.test',
      'Parent-Password-2026!',
    );
    await expect(
      httpsCallable(
        parentFunctions,
        'registerParentProfile',
      )({
        firstName: 'Parent',
        lastName: 'Sans classe',
        organizationId: 'org-1',
        children: [
          {
            schoolId: 'school-1',
            levelId: 'ce1',
            classId: 'classe-inconnue',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    const account = await adminAuth.getUserByEmail(
      'invalid-class-phase2@example.test',
    );
    expect((await db.doc(`users/${account.uid}`).get()).exists).toBe(false);
    await signOut(parentAuth);
  }, 15_000);

  it('registers a minimal pending parent profile and child through the server', async () => {
    const credential = await createUserWithEmailAndPassword(
      parentAuth,
      'parent-phase2@example.test',
      'Parent-Password-2026!',
    );
    await httpsCallable(
      parentFunctions,
      'registerParentProfile',
    )({
      firstName: 'Samira',
      lastName: 'Parent',
      organizationId: 'org-1',
      children: [{ schoolId: 'school-1', levelId: 'ce1' }],
    });
    const profile = await db.doc(`users/${credential.user.uid}`).get();
    expect(profile.data()).toMatchObject({
      role: 'parent',
      status: 'pending',
      schoolIds: ['school-1'],
      levelIds: ['ce1'],
    });
    const children = await db
      .collection('childProfiles')
      .where('parentUserId', '==', credential.user.uid)
      .get();
    expect(children.size).toBe(1);
    const token = await credential.user.getIdTokenResult(true);
    expect(token.claims.status).toBe('pending');
    await signOut(parentAuth);
    await expect(
      signInWithEmailAndPassword(
        parentAuth,
        'parent-phase2@example.test',
        'Parent-Password-2026!',
      ),
    ).resolves.toBeDefined();
  });

  it('lets an active admin approve the parent and refreshes server claims', async () => {
    await signInWithEmailAndPassword(
      adminClientAuth,
      'admin-phase2@example.test',
      'Admin-Password-2026!',
    );
    const parent = await adminAuth.getUserByEmail('parent-phase2@example.test');
    await httpsCallable(adminFunctions, 'approveUser')({ uid: parent.uid });
    expect((await db.doc(`users/${parent.uid}`).get()).data()?.status).toBe(
      'active',
    );
    expect((await adminAuth.getUser(parent.uid)).customClaims?.status).toBe(
      'active',
    );
  });
});
