import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';

let env: RulesTestEnvironment;

function endpoint(value: string | undefined, fallbackPort: number) {
  const [host = '127.0.0.1', port = String(fallbackPort)] = (value ?? '').split(
    ':',
  );
  return { host, port: Number(port) };
}

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

afterAll(async () => env.cleanup());
afterEach(async () => {
  await Promise.all([env.clearFirestore(), env.clearStorage()]);
});

const claims = (role: string, status = 'active') => ({
  role,
  status,
  organizationId: 'org-1',
  schoolIds: [],
  levelIds: [],
  classIds: [],
});

async function seedReport(
  visibility: 'owner_moderators' | 'fcpe' = 'owner_moderators',
) {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'reports/report-1'), {
      organizationId: 'org-1',
      authorId: 'parent-1',
      visibility,
      status: 'received',
    });
  });
}

describe('Storage security rules', () => {
  it('allows an active user to upload a small image to their own report', async () => {
    await seedReport();
    const storage = env
      .authenticatedContext('parent-1', claims('parent'))
      .storage();
    await assertSucceeds(
      uploadBytes(
        ref(storage, 'reports/parent-1/report-1/photo.webp'),
        new Uint8Array([1, 2, 3]),
        { contentType: 'image/webp' },
      ),
    );
  });

  it('rejects cross-user, executable and suspended uploads', async () => {
    await seedReport();
    const active = env
      .authenticatedContext('parent-1', claims('parent'))
      .storage();
    const suspended = env
      .authenticatedContext('parent-1', claims('parent', 'suspended'))
      .storage();
    await assertFails(
      uploadBytes(
        ref(active, 'reports/parent-2/report-1/photo.jpg'),
        new Uint8Array([1]),
        { contentType: 'image/jpeg' },
      ),
    );
    await assertFails(
      uploadBytes(
        ref(active, 'reports/parent-1/report-1/payload.exe'),
        new Uint8Array([1]),
        { contentType: 'application/octet-stream' },
      ),
    );
    await assertFails(
      uploadBytes(
        ref(suspended, 'reports/parent-1/report-1/photo.png'),
        new Uint8Array([1]),
        { contentType: 'image/png' },
      ),
    );
  });

  it('applies report visibility to photos', async () => {
    await seedReport();
    const ownerStorage = env
      .authenticatedContext('parent-1', claims('parent'))
      .storage();
    const path = 'reports/parent-1/report-1/photo.webp';
    await assertSucceeds(
      uploadBytes(ref(ownerStorage, path), new Uint8Array([1, 2, 3]), {
        contentType: 'image/webp',
      }),
    );

    const fcpeStorage = env
      .authenticatedContext('fcpe-1', claims('fcpe'))
      .storage();
    const moderatorStorage = env
      .authenticatedContext('moderator-1', claims('moderator'))
      .storage();
    await assertFails(getBytes(ref(fcpeStorage, path)));
    await assertSucceeds(getBytes(ref(moderatorStorage, path)));

    await seedReport('fcpe');
    await assertSucceeds(getBytes(ref(fcpeStorage, path)));
  });
});
