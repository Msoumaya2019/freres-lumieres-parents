import { deleteApp, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore as getClientFirestore,
} from 'firebase/firestore';
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
const emulatorTestTimeout = 60_000;
const adminApp = initializeAdminApp({ projectId }, 'phase-2-member-admin');
const db = getFirestore(adminApp);
const adminAuth = getAdminAuth(adminApp);
const memberApp = initializeApp(
  { projectId, apiKey: 'demo-api-key' },
  'phase-2-member-client',
);
const adminClientApp = initializeApp(
  { projectId, apiKey: 'demo-api-key' },
  'phase-2-admin-client',
);
const memberAuth = getAuth(memberApp);
const adminClientAuth = getAuth(adminClientApp);
const memberFirestore = getClientFirestore(memberApp);
const memberFunctions = getFunctions(memberApp, 'europe-west1');
const adminFunctions = getFunctions(adminClientApp, 'europe-west1');

connectAuthEmulator(memberAuth, 'http://127.0.0.1:9099', {
  disableWarnings: true,
});
connectAuthEmulator(adminClientAuth, 'http://127.0.0.1:9099', {
  disableWarnings: true,
});
connectFirestoreEmulator(memberFirestore, '127.0.0.1', 8080);
connectFunctionsEmulator(memberFunctions, '127.0.0.1', 5001);
connectFunctionsEmulator(adminFunctions, '127.0.0.1', 5001);

let memberUid = '';

beforeAll(async () => {
  await db.doc('organizations/org-1').set({
    id: 'org-1',
    name: 'Organisation de test',
    slug: 'org-1',
    active: true,
  });
  await db.doc('posts/fcpe-private').set({
    organizationId: 'org-1',
    authorId: 'admin-phase-2',
    status: 'published',
    audience: { type: 'fcpe', ids: [] },
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
  });
  await db.doc('memberProfiles/admin-phase-2').set({
    id: 'admin-phase-2',
    firstName: 'Admin',
    lastName: 'Test',
    email: 'admin-phase2@example.test',
    role: 'admin',
    status: 'active',
    organizationId: 'org-1',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
});

afterAll(async () => {
  await Promise.all([
    deleteApp(memberApp),
    deleteApp(adminClientApp),
    deleteAdminApp(adminApp),
  ]);
});

describe('Phase 2 member lifecycle', () => {
  it(
    'rejects an inactive or unknown organization',
    async () => {
      const credential = await createUserWithEmailAndPassword(
        memberAuth,
        'unknown-org@example.test',
        'Member-Password-2026!',
      );
      await expect(
        httpsCallable(
          memberFunctions,
          'registerMemberProfile',
        )({
          firstName: 'Membre',
          lastName: 'Sans organisation',
          organizationId: 'unknown-org',
        }),
      ).rejects.toMatchObject({ code: 'functions/failed-precondition' });
      expect(
        (await db.doc(`memberProfiles/${credential.user.uid}`).get()).exists,
      ).toBe(false);
      await signOut(memberAuth);
    },
    emulatorTestTimeout,
  );

  it(
    'creates one idempotent FCPE pending profile readable by its owner',
    async () => {
      const credential = await createUserWithEmailAndPassword(
        memberAuth,
        'member-phase2@example.test',
        'Member-Password-2026!',
      );
      memberUid = credential.user.uid;
      const payload = {
        firstName: 'Samira',
        lastName: 'Membre',
        organizationId: 'org-1',
        declaredFunction: 'Représentante',
      };
      await httpsCallable(memberFunctions, 'registerMemberProfile')(payload);
      await credential.user.getIdToken(true);
      await expect(
        httpsCallable(memberFunctions, 'registerMemberProfile')(payload),
      ).resolves.toMatchObject({ data: { ok: true, status: 'pending' } });
      const profile = await db.doc(`memberProfiles/${memberUid}`).get();
      expect(profile.data()).toMatchObject({
        role: 'fcpe',
        status: 'pending',
        organizationId: 'org-1',
      });
      const ownProfile = await getDoc(
        doc(memberFirestore, `memberProfiles/${memberUid}`),
      );
      expect(ownProfile.exists()).toBe(true);
      await expect(
        getDoc(doc(memberFirestore, 'posts/fcpe-private')),
      ).rejects.toBeDefined();
      await expect(
        httpsCallable(
          memberFunctions,
          'setMemberRole',
        )({
          uid: memberUid,
          role: 'admin',
        }),
      ).rejects.toMatchObject({ code: 'functions/permission-denied' });
    },
    emulatorTestTimeout,
  );

  it(
    'lets an admin approve, promote and suspend the member',
    async () => {
      await signInWithEmailAndPassword(
        adminClientAuth,
        'admin-phase2@example.test',
        'Admin-Password-2026!',
      );
      await httpsCallable(adminFunctions, 'approveMember')({ uid: memberUid });
      await httpsCallable(
        adminFunctions,
        'setMemberRole',
      )({
        uid: memberUid,
        role: 'moderator',
      });
      let token = await memberAuth.currentUser?.getIdTokenResult(true);
      expect(token?.claims).toMatchObject({
        role: 'moderator',
        status: 'active',
        organizationId: 'org-1',
      });
      const privatePost = await getDoc(
        doc(memberFirestore, 'posts/fcpe-private'),
      );
      expect(privatePost.exists()).toBe(true);

      await httpsCallable(
        adminFunctions,
        'setMemberStatus',
      )({
        uid: memberUid,
        status: 'suspended',
      });
      token = await memberAuth.currentUser?.getIdTokenResult(true);
      expect(token?.claims.status).toBe('suspended');
      await expect(
        getDoc(doc(memberFirestore, 'posts/fcpe-private')),
      ).rejects.toBeDefined();
    },
    emulatorTestTimeout,
  );
});
