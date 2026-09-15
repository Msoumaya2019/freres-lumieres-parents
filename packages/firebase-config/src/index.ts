import {
  getApp,
  getApps,
  initializeApp,
  type FirebaseOptions,
} from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

export interface EmulatorOptions {
  enabled: boolean;
  host?: string;
}

let emulatorsConnected = false;

export function createFirebaseClient(
  options: FirebaseOptions,
  emulator: EmulatorOptions = { enabled: false },
) {
  const app = getApps().length > 0 ? getApp() : initializeApp(options);
  const auth = getAuth(app);
  const firestore = getFirestore(app);
  const functions = getFunctions(app, 'europe-west1');
  const storage = getStorage(app);

  if (emulator.enabled && !emulatorsConnected) {
    const host = emulator.host ?? '127.0.0.1';
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(firestore, host, 8080);
    connectFunctionsEmulator(functions, host, 5001);
    connectStorageEmulator(storage, host, 9199);
    emulatorsConnected = true;
  }

  return { app, auth, firestore, functions, storage };
}
