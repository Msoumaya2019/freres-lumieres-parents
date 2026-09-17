import AsyncStorage from '@react-native-async-storage/async-storage';
// Firebase's runtime exposes this through its React Native export condition,
// while its generic declaration file omits it.
// @ts-expect-error React Native conditional export selected by Metro.
import { getReactNativePersistence } from '@firebase/auth';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  type Auth,
  connectAuthEmulator,
  getAuth,
  initializeAuth,
} from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

const projectId =
  process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'demo-freres-lumieres';

const app =
  getApps().length > 0
    ? getApp()
    : initializeApp({
        apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? 'demo-api-key',
        authDomain:
          process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ??
          `${projectId}.firebaseapp.com`,
        projectId,
        storageBucket:
          process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ??
          `${projectId}.appspot.com`,
        messagingSenderId:
          process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '000000000000',
        appId:
          process.env.EXPO_PUBLIC_FIREBASE_APP_ID ??
          '1:000000000000:web:0000000000000000000000',
      });

let auth: Auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  auth = getAuth(app);
}

const firestore = getFirestore(app);
const functions = getFunctions(app, 'europe-west1');
const storage = getStorage(app);
const useEmulators =
  process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATORS === 'true' ||
  (__DEV__ && projectId.startsWith('demo-'));

if (useEmulators) {
  const host = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST ?? '127.0.0.1';
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(firestore, host, 8080);
  connectFunctionsEmulator(functions, host, 5001);
  connectStorageEmulator(storage, host, 9199);
}

export { app, auth, firestore, functions, projectId, storage, useEmulators };
