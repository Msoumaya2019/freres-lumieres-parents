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
const claims = (role: 'fcpe' | 'admin') => ({
  role,
  status: 'active',
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
afterEach(async () => {
  await Promise.all([env.clearFirestore(), env.clearStorage()]);
});
afterAll(async () => env.cleanup());

describe('Storage rules', () => {
  it('exposes assets only for published public records', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'posts/public'), {
        organizationId: 'org-1',
        status: 'published',
        audience: { type: 'all', ids: [] },
      });
      await setDoc(doc(context.firestore(), 'posts/private'), {
        organizationId: 'org-1',
        status: 'published',
        audience: { type: 'fcpe', ids: [] },
      });
      await uploadBytes(
        ref(context.storage(), 'posts/public/flyer.webp'),
        new Uint8Array([1]),
        { contentType: 'image/webp' },
      );
      await uploadBytes(
        ref(context.storage(), 'posts/private/internal.webp'),
        new Uint8Array([1]),
        { contentType: 'image/webp' },
      );
    });
    const storage = env.unauthenticatedContext().storage();
    await assertSucceeds(getBytes(ref(storage, 'posts/public/flyer.webp')));
    await assertFails(getBytes(ref(storage, 'posts/private/internal.webp')));
  });
  it('denies every direct contact upload and read, including to admins', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await uploadBytes(
        ref(context.storage(), 'contact/conversation/file.webp'),
        new Uint8Array([1]),
        { contentType: 'image/webp' },
      );
    });
    for (const storage of [
      env.unauthenticatedContext().storage(),
      env.authenticatedContext('admin-1', claims('admin')).storage(),
    ]) {
      await assertFails(
        uploadBytes(
          ref(storage, 'contact/conversation/file.webp'),
          new Uint8Array([1]),
          { contentType: 'image/webp' },
        ),
      );
      await assertFails(
        getBytes(ref(storage, 'contact/conversation/file.webp')),
      );
    }
  });
  it('rejects editorial uploads by ordinary FCPE members', async () => {
    await env.withSecurityRulesDisabled(async (context) =>
      setDoc(doc(context.firestore(), 'posts/public'), {
        organizationId: 'org-1',
        status: 'published',
        audience: { type: 'all', ids: [] },
      }),
    );
    const storage = env
      .authenticatedContext('fcpe-1', claims('fcpe'))
      .storage();
    await assertFails(
      uploadBytes(ref(storage, 'posts/public/file.pdf'), new Uint8Array([1]), {
        contentType: 'application/pdf',
      }),
    );
  });
});
