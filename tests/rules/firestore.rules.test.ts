import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

const publicAudienceTypes = ['all', 'school', 'level', 'class'];

let env: RulesTestEnvironment;
function endpoint(value: string | undefined, fallbackPort: number) {
  const [host = '127.0.0.1', port = String(fallbackPort)] = (value ?? '').split(
    ':',
  );
  return { host, port: Number(port) };
}
const claims = (role: 'fcpe' | 'moderator' | 'admin', status = 'active') => ({
  role,
  status,
  organizationId: 'org-1',
});
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-freres-lumieres',
    firestore: {
      ...endpoint(process.env.FIRESTORE_EMULATOR_HOST, 8080),
      rules: readFileSync(resolve('firebase/firestore.rules'), 'utf8'),
    },
    storage: {
      ...endpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 9199),
      rules: readFileSync(resolve('firebase/storage.rules'), 'utf8'),
    },
  });
});
afterEach(async () => env.clearFirestore());
afterAll(async () => env.cleanup());

async function seed() {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'posts/public'), {
      organizationId: 'org-1',
      authorId: 'admin-1',
      status: 'published',
      audience: { type: 'all', ids: [] },
      publishedAt: new Date('2026-09-01T08:00:00Z'),
    });
    await setDoc(doc(db, 'posts/draft'), {
      organizationId: 'org-1',
      authorId: 'admin-1',
      status: 'draft',
      audience: { type: 'all', ids: [] },
    });
    await setDoc(doc(db, 'posts/private'), {
      organizationId: 'org-1',
      authorId: 'admin-1',
      status: 'published',
      audience: { type: 'fcpe', ids: [] },
    });
    await setDoc(doc(db, 'canteenMenus/week'), {
      organizationId: 'org-1',
      published: true,
      startsOn: '2026-09-14',
    });
    await setDoc(doc(db, 'events/public'), {
      organizationId: 'org-1',
      published: true,
      audience: { type: 'all', ids: [] },
      startsAt: new Date('2026-09-22T16:30:00Z'),
    });
    await setDoc(doc(db, 'documents/public'), {
      organizationId: 'org-1',
      published: true,
      audience: { type: 'school', ids: ['elementary'] },
      createdAt: new Date('2026-09-01T08:00:00Z'),
    });
    await setDoc(doc(db, 'schoolCouncils/public'), {
      organizationId: 'org-1',
      published: true,
      audience: { type: 'school', ids: ['elementary'] },
      scheduledAt: new Date('2026-10-01T16:30:00Z'),
    });
    await setDoc(doc(db, 'memberProfiles/fcpe-1'), {
      id: 'fcpe-1',
      organizationId: 'org-1',
      role: 'fcpe',
      status: 'active',
    });
    await setDoc(doc(db, 'contactConversations/contact-1'), {
      organizationId: 'org-1',
      secretHash: 'hash',
      status: 'new',
    });
    await setDoc(doc(db, 'contactMessages/message-1'), {
      conversationId: 'contact-1',
      body: 'privé',
    });
    await setDoc(doc(db, 'contactInternalNotes/note-1'), {
      conversationId: 'contact-1',
      body: 'interne',
    });
    await setDoc(doc(db, 'schoolCouncils/unsafe'), {
      organizationId: 'org-1',
      published: true,
      audience: { type: 'all', ids: [] },
      internalNotes: 'Ne doit jamais sortir',
    });
  });
}

describe('Firestore rules without parent accounts', () => {
  it('lets an unauthenticated installation read only published public content', async () => {
    await seed();
    const db = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, 'posts/public')));
    await assertSucceeds(getDoc(doc(db, 'canteenMenus/week')));
    await assertSucceeds(getDoc(doc(db, 'documents/public')));
    await assertFails(getDoc(doc(db, 'posts/draft')));
    await assertFails(getDoc(doc(db, 'posts/private')));
    await assertFails(getDoc(doc(db, 'schoolCouncils/unsafe')));
  });
  it('never allows public clients to write editorial content', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(db, 'posts/attack'), {
        status: 'published',
        audience: { type: 'all', ids: [] },
      }),
    );
  });
  it('authorizes the bounded public list queries used by the mobile app', async () => {
    await seed();
    const db = env.unauthenticatedContext().firestore();
    const queries = [
      query(
        collection(db, 'posts'),
        where('organizationId', '==', 'org-1'),
        where('status', '==', 'published'),
        where('audience.type', 'in', publicAudienceTypes),
        orderBy('publishedAt', 'desc'),
        limit(30),
      ),
      query(
        collection(db, 'events'),
        where('organizationId', '==', 'org-1'),
        where('published', '==', true),
        where('audience.type', 'in', publicAudienceTypes),
        orderBy('startsAt', 'asc'),
        limit(40),
      ),
      query(
        collection(db, 'canteenMenus'),
        where('organizationId', '==', 'org-1'),
        where('published', '==', true),
        orderBy('startsOn', 'desc'),
        limit(12),
      ),
      query(
        collection(db, 'documents'),
        where('organizationId', '==', 'org-1'),
        where('published', '==', true),
        where('audience.type', 'in', publicAudienceTypes),
        orderBy('createdAt', 'desc'),
        limit(40),
      ),
      query(
        collection(db, 'schoolCouncils'),
        where('organizationId', '==', 'org-1'),
        where('published', '==', true),
        where('audience.type', 'in', publicAudienceTypes),
        orderBy('scheduledAt', 'desc'),
        limit(20),
      ),
    ];
    for (const publicQuery of queries) {
      await assertSucceeds(getDocs(publicQuery));
    }
  });
  it('keeps every contact record and internal note server-only', async () => {
    await seed();
    for (const db of [
      env.unauthenticatedContext().firestore(),
      env.authenticatedContext('fcpe-1', claims('fcpe')).firestore(),
      env.authenticatedContext('admin-1', claims('admin')).firestore(),
    ]) {
      await assertFails(getDoc(doc(db, 'contactConversations/contact-1')));
      await assertFails(getDoc(doc(db, 'contactMessages/message-1')));
      await assertFails(getDoc(doc(db, 'contactInternalNotes/note-1')));
    }
  });
  it('lets active FCPE members read private content but not elevate their role', async () => {
    await seed();
    const db = env.authenticatedContext('fcpe-1', claims('fcpe')).firestore();
    await assertSucceeds(getDoc(doc(db, 'posts/private')));
    await assertSucceeds(getDoc(doc(db, 'memberProfiles/fcpe-1')));
    await assertFails(
      updateDoc(doc(db, 'memberProfiles/fcpe-1'), { role: 'admin' }),
    );
  });
  it('blocks pending members from FCPE content', async () => {
    await seed();
    const db = env
      .authenticatedContext('pending-1', claims('fcpe', 'pending'))
      .firestore();
    await assertFails(getDoc(doc(db, 'posts/private')));
  });
});
