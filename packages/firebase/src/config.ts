/**
 * Configuration Firebase côté client.
 *
 * Rappel essentiel : ces valeurs sont **publiques**. Elles finissent dans le
 * bundle distribué sur l'App Store, et c'est normal — elles identifient un
 * projet, elles n'autorisent rien. La sécurité réelle vit dans les Security
 * Rules et les Cloud Functions.
 *
 * Ne jamais placer ici de clé privée, de compte de service ou de secret.
 */

/** Configuration du SDK Firebase côté client. */
export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

/** Source de variables d'environnement (process.env, expo-constants, etc.). */
export type EnvSource = Record<string, string | undefined>;

/** Préfixes reconnus, selon la plateforme. */
export type EnvPrefix = 'EXPO_PUBLIC_' | 'NEXT_PUBLIC_';

/** Noms des variables attendues, construits à partir du préfixe. */
export const FIREBASE_ENV_KEYS = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
  'FIREBASE_MEASUREMENT_ID',
] as const;

/**
 * Lit la configuration Firebase depuis les variables d'environnement.
 *
 * `measurementId` est optionnel : il n'est nécessaire que si Analytics est
 * activé, ce qui n'est pas le cas par défaut.
 */
export function readFirebaseConfig(env: EnvSource, prefix: EnvPrefix): FirebaseClientConfig {
  const read = (key: string): string => env[`${prefix}${key}`]?.trim() ?? '';

  const config: FirebaseClientConfig = {
    apiKey: read('FIREBASE_API_KEY'),
    authDomain: read('FIREBASE_AUTH_DOMAIN'),
    projectId: read('FIREBASE_PROJECT_ID'),
    storageBucket: read('FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: read('FIREBASE_MESSAGING_SENDER_ID'),
    appId: read('FIREBASE_APP_ID'),
  };

  const measurementId = read('FIREBASE_MEASUREMENT_ID');
  if (measurementId) {
    config.measurementId = measurementId;
  }

  return config;
}

/**
 * Vérifie que la configuration est complète.
 *
 * Appelée au démarrage de l'application, avant toute initialisation. Un
 * message clair à ce moment-là évite des heures de débogage sur un écran
 * blanc inexplicable.
 */
export function validateFirebaseConfig(config: FirebaseClientConfig): {
  valid: boolean;
  missing: string[];
} {
  const required: (keyof FirebaseClientConfig)[] = [
    'apiKey',
    'authDomain',
    'projectId',
    'storageBucket',
    'messagingSenderId',
    'appId',
  ];

  const missing = required.filter((key) => {
    const value = config[key];
    return typeof value !== 'string' || value.length === 0;
  });

  return { valid: missing.length === 0, missing };
}

/**
 * Construit le message d'erreur affiché lorsqu'une variable manque.
 * Volontairement très explicite : c'est la première erreur que rencontrera
 * toute personne qui clone le dépôt.
 */
export function describeMissingConfig(missing: readonly string[], prefix: EnvPrefix): string {
  const variables = missing
    .map((key) => {
      const envKey = key
        .replace(/[A-Z]/g, (char) => `_${char}`)
        .toUpperCase()
        .replace(/^_/, '');
      return `  ${prefix}FIREBASE_${envKey}=`;
    })
    .join('\n');

  return [
    'Configuration Firebase incomplète.',
    '',
    'Variables manquantes à ajouter dans votre fichier .env.local :',
    variables,
    '',
    'Ces valeurs se trouvent dans la console Firebase :',
    '  Paramètres du projet → Vos applications → Configuration du SDK.',
    '',
    'Elles ne sont pas des secrets et peuvent être partagées sans risque.',
  ].join('\n');
}

/** Environnement logique de l'application. */
export type AppEnvironment = 'development' | 'production';

export function readAppEnvironment(env: EnvSource, prefix: EnvPrefix): AppEnvironment {
  return env[`${prefix}APP_ENV`]?.trim() === 'production' ? 'production' : 'development';
}

/** Les émulateurs Firebase doivent-ils être utilisés ? */
export function shouldUseEmulators(env: EnvSource, prefix: EnvPrefix): boolean {
  return env[`${prefix}USE_FIREBASE_EMULATORS`]?.trim().toLowerCase() === 'true';
}

/** Hôte des émulateurs. */
export function readEmulatorHost(env: EnvSource, prefix: EnvPrefix): string {
  return env[`${prefix}EMULATOR_HOST`]?.trim() || '127.0.0.1';
}

/**
 * Ports des émulateurs — doivent correspondre à `firebase.json`.
 * Centralisés ici pour qu'une modification ne soit jamais oubliée à un endroit.
 */
export const EMULATOR_PORTS = {
  auth: 9099,
  firestore: 8080,
  storage: 9199,
  functions: 5001,
} as const;

/**
 * Garde-fou de sécurité : refuse d'utiliser les émulateurs en production.
 *
 * Sans cette vérification, une variable d'environnement copiée par erreur
 * ferait pointer l'application publiée vers un émulateur local, avec des
 * données de test. Le contrôle coûte une ligne et évite un incident gênant.
 */
export function assertEmulatorsAllowed(useEmulators: boolean, environment: AppEnvironment): void {
  if (useEmulators && environment === 'production') {
    throw new Error(
      'Configuration refusée : les émulateurs Firebase ne peuvent pas être activés ' +
        "avec EXPO_PUBLIC_APP_ENV=production. Corrigez votre fichier d'environnement.",
    );
  }
}

/** Identifiant de l'organisation par défaut, utilisé à l'amorçage uniquement. */
export function readDefaultOrgSlug(env: EnvSource, prefix: EnvPrefix): string | undefined {
  return env[`${prefix}DEFAULT_ORG_SLUG`]?.trim() || undefined;
}
