import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const projectId = 'demo-freres-lumieres';
let env: RulesTestEnvironment;

function endpoint(value: string | undefined, fallbackPort: number) {
  const [host = '127.0.0.1', port = String(fallbackPort)] = (value ?? '').split(
    ':',
  );
  return { host, port: Number(port) };
}

const claims = (role: string, status = 'active') => ({
  role,
  status,
  organizationId: 'org-1',
  schoolIds: ['school-1'],
  levelIds: ['ce1'],
  classIds: ['ce1-a'],
});

beforeAll(async () => {
  const firestore = endpoint(process.env.FIRESTORE_EMULATOR_HOST, 8080);
  const storage = endpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 9199);
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      ...firestore,
      rules: readFileSync(resolve('firebase/firestore.rules'), 'utf8'),
    },
    storage: {
      ...storage,
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
      authorId: 'admin',
      status: 'published',
      audience: { type: 'all', ids: [] },
    });
    await setDoc(doc(db, 'posts/fcpe'), {
      organizationId: 'org-1',
      authorId: 'admin',
      status: 'published',
      audience: { type: 'fcpe', ids: [] },
    });
    await setDoc(doc(db, 'polls/poll-1'), {
      organizationId: 'org-1',
      audience: { type: 'all', ids: [] },
    });
    await setDoc(doc(db, 'users/parent-1'), {
      id: 'parent-1',
      organizationId: 'org-1',
      role: 'parent',
      status: 'active',
    });
  });
}

describe('Firestore security rules', () => {
  it('allows an active parent to read public content but not FCPE content', async () => {
    await seed();
    const db = env
      .authenticatedContext('parent-1', claims('parent'))
      .firestore();
    await assertSucceeds(getDoc(doc(db, 'posts/public')));
    await assertFails(getDoc(doc(db, 'posts/fcpe')));
  });

  it('allows an FCPE member to read FCPE content', async () => {
    await seed();
    const db = env.authenticatedContext('fcpe-1', claims('fcpe')).firestore();
    await assertSucceeds(getDoc(doc(db, 'posts/fcpe')));
  });

  it('never lets a client change its role', async () => {
    await seed();
    const db = env
      .authenticatedContext('parent-1', claims('parent'))
      .firestore();
    await assertFails(updateDoc(doc(db, 'users/parent-1'), { role: 'admin' }));
  });

  it('blocks pending and suspended users from participation', async () => {
    await seed();
    for (const status of ['pending', 'suspended']) {
      const db = env
        .authenticatedContext(`${status}-user`, claims('parent', status))
        .firestore();
      await assertFails(
        setDoc(doc(db, `comments/${status}`), {
          organizationId: 'org-1',
          postId: 'public',
          authorId: `${status}-user`,
          body: 'Test',
          status: 'visible',
        }),
      );
    }
  });

  it('uses deterministic immutable poll votes', async () => {
    await seed();
    const db = env
      .authenticatedContext('parent-1', claims('parent'))
      .firestore();
    const vote = doc(db, 'pollVotes/poll-1_parent-1');
    await assertSucceeds(
      setDoc(vote, {
        organizationId: 'org-1',
        pollId: 'poll-1',
        userId: 'parent-1',
        optionIds: ['yes'],
      }),
    );
    await assertFails(updateDoc(vote, { optionIds: ['no'] }));
  });

  it('keeps private reports visible only to their owner and moderators', async () => {
    await seed();
    await env.withSecurityRulesDisabled(async (context) =>
      setDoc(doc(context.firestore(), 'reports/private'), {
        organizationId: 'org-1',
        authorId: 'parent-1',
        visibility: 'owner_moderators',
        status: 'received',
      }),
    );
    await assertSucceeds(
      getDoc(
        doc(
          env.authenticatedContext('parent-1', claims('parent')).firestore(),
          'reports/private',
        ),
      ),
    );
    await assertFails(
      getDoc(
        doc(
          env.authenticatedContext('parent-2', claims('parent')).firestore(),
          'reports/private',
        ),
      ),
    );
    await assertSucceeds(
      getDoc(
        doc(
          env
            .authenticatedContext('moderator-1', claims('moderator'))
            .firestore(),
          'reports/private',
        ),
      ),
    );
  });

  it('lets admins inspect users while role mutations remain server-only', async () => {
    await seed();
    const db = env.authenticatedContext('admin-1', claims('admin')).firestore();
    await assertSucceeds(getDoc(doc(db, 'users/parent-1')));
    await assertFails(updateDoc(doc(db, 'users/parent-1'), { role: 'fcpe' }));
  });
});
