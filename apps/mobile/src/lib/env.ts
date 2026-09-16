/**
 * Lecture de la configuration côté application mobile.
 *
 * ## Pourquoi chaque variable est écrite explicitement
 *
 * Expo remplace `process.env.EXPO_PUBLIC_*` **à la compilation**, en
 * n'inlinant que les accès littéraux. Un accès dynamique du type
 * `process.env[cle]` n'est pas remplacé et vaut `undefined` au runtime.
 *
 * C'est la raison pour laquelle ce fichier énumère chaque variable une par
 * une plutôt que de boucler sur une liste. Toute variable ajoutée au
 * `.env.example` doit être reportée ici.
 */
import {
  assertEmulatorsAllowed,
  describeMissingConfig,
  readAppEnvironment,
  readDefaultOrgSlug,
  readEmulatorHost,
  readFirebaseConfig,
  shouldUseEmulators,
  validateFirebaseConfig,
  type EnvSource,
  type FirebaseClientConfig,
} from '@fl/firebase';

/** Variables publiques, inlinées à la compilation par Expo. */
const envSource: EnvSource = {
  EXPO_PUBLIC_FIREBASE_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  EXPO_PUBLIC_FIREBASE_APP_ID: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
  EXPO_PUBLIC_USE_FIREBASE_EMULATORS: process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATORS,
  EXPO_PUBLIC_EMULATOR_HOST: process.env.EXPO_PUBLIC_EMULATOR_HOST,
  EXPO_PUBLIC_DEFAULT_ORG_SLUG: process.env.EXPO_PUBLIC_DEFAULT_ORG_SLUG,
};

const PREFIX = 'EXPO_PUBLIC_' as const;

export const appEnvironment = readAppEnvironment(envSource, PREFIX);
export const useFirebaseEmulators = shouldUseEmulators(envSource, PREFIX);
export const emulatorHost = readEmulatorHost(envSource, PREFIX);
export const defaultOrgSlug = readDefaultOrgSlug(envSource, PREFIX);

/** Configuration Firebase client — publique par nature, ce n'est pas un secret. */
export const firebaseConfig: FirebaseClientConfig = readFirebaseConfig(envSource, PREFIX);

/** Résultat de la vérification de configuration, évalué une seule fois. */
export const firebaseConfigCheck = validateFirebaseConfig(firebaseConfig);

/**
 * Message à afficher lorsqu'une variable manque.
 * C'est la première erreur que rencontrera toute personne qui clone le dépôt :
 * autant qu'elle soit explicite.
 */
export const missingConfigMessage = describeMissingConfig(firebaseConfigCheck.missing, PREFIX);

// Garde-fou : les émulateurs ne doivent jamais être utilisés en production.
assertEmulatorsAllowed(useFirebaseEmulators, appEnvironment);

export const isDevelopment = appEnvironment === 'development';
