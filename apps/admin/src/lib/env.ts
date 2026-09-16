/**
 * Configuration de l'interface d'administration.
 *
 * Même principe que côté mobile : Expo et Next.js n'inlinent que les accès
 * **littéraux** aux variables publiques. Chaque variable est donc écrite
 * explicitement, plutôt que lue dynamiquement dans une boucle.
 *
 * Rappel : les variables `NEXT_PUBLIC_*` sont visibles par n'importe qui dans
 * le navigateur. Elles ne contiennent que la configuration Firebase client,
 * qui n'est pas un secret. Les décisions d'autorisation sont prises par les
 * Security Rules, jamais par cette application.
 */
import {
  describeMissingConfig,
  readAppEnvironment,
  readEmulatorHost,
  readFirebaseConfig,
  shouldUseEmulators,
  validateFirebaseConfig,
  type EnvSource,
  type FirebaseClientConfig,
} from '@fl/firebase';

const envSource: EnvSource = {
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  NEXT_PUBLIC_USE_FIREBASE_EMULATORS: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS,
  NEXT_PUBLIC_EMULATOR_HOST: process.env.NEXT_PUBLIC_EMULATOR_HOST,
};

const PREFIX = 'NEXT_PUBLIC_' as const;

export const appEnvironment = readAppEnvironment(envSource, PREFIX);
export const useFirebaseEmulators = shouldUseEmulators(envSource, PREFIX);
export const emulatorHost = readEmulatorHost(envSource, PREFIX);
export const firebaseConfig: FirebaseClientConfig = readFirebaseConfig(envSource, PREFIX);
export const firebaseConfigCheck = validateFirebaseConfig(firebaseConfig);
export const missingConfigMessage = describeMissingConfig(firebaseConfigCheck.missing, PREFIX);
export const isFirebaseConfigured = firebaseConfigCheck.valid;

/** L'émulateur Storage n'existe pas côté navigateur sans configuration : on
 * se contente d'avertir plutôt que de faire échouer le démarrage. */
export const emulatorNotice = useFirebaseEmulators
  ? `Émulateurs Firebase activés (${emulatorHost}). Aucune donnée réelle ne sera modifiée.`
  : null;
