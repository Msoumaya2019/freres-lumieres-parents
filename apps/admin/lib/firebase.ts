import { createFirebaseClient } from '@flp/firebase-config';

const projectId =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'demo-freres-lumieres';

export const firebase = createFirebaseClient(
  {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? 'demo-api-key',
    authDomain:
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??
      `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket:
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
      `${projectId}.appspot.com`,
    messagingSenderId:
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '000000000000',
    appId:
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID ??
      '1:000000000000:web:0000000000000000000000',
  },
  {
    enabled:
      process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true' ||
      (process.env.NODE_ENV === 'development' && projectId.startsWith('demo-')),
  },
);
