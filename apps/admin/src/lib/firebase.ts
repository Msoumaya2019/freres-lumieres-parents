/**
 * Initialisation Firebase côté navigateur.
 *
 * Différence essentielle avec le mobile : la persistance est fournie
 * nativement par le SDK web (`browserLocalPersistence`), et le rendu serveur
 * de Next.js ne doit **jamais** tenter d'initialiser Firebase — `window`
 * n'existe pas encore. Toutes les fonctions de ce fichier sont donc appelées
 * depuis des composants clients, après montage.
 */
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';

import { EMULATOR_PORTS, FUNCTIONS_REGION } from '@fl/firebase';

import { emulatorHost, firebaseConfig, isFirebaseConfigured, useFirebaseEmulators } from './env';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let functions: Functions | null = null;

/** Firebase est-il initialisé et utilisable ? */
export function isFirebaseReady(): boolean {
  return app !== null && auth !== null && db !== null;
}

/** Indique si la configuration a été fournie (indépendamment de l'init). */
export function canInitialize(): boolean {
  return isFirebaseConfigured;
}

export function initializeFirebase(): {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  functions: Functions;
} | null {
  if (app && auth && db && functions) return { app, auth, db, functions };
  if (!isFirebaseConfigured) return null;
  if (typeof window === 'undefined') return null;

  try {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    // La région doit être celle du déploiement : la valeur par défaut du SDK
    // est `us-central1`, où aucune fonction n'est déployée.
    functions = getFunctions(app, FUNCTIONS_REGION);

    if (useFirebaseEmulators) {
      connectAuthEmulator(auth, `http://${emulatorHost}:${EMULATOR_PORTS.auth}`, {
        disableWarnings: true,
      });
      connectFirestoreEmulator(db, emulatorHost, EMULATOR_PORTS.firestore);
      connectFunctionsEmulator(functions, emulatorHost, EMULATOR_PORTS.functions);
    }

    return { app, auth, db, functions };
  } catch (error) {
    console.error('[Firebase] Échec de l’initialisation :', error);
    app = null;
    auth = null;
    db = null;
    functions = null;
    return null;
  }
}

export function getFirebaseAuth(): Auth {
  if (!auth) throw new Error('Firebase n’est pas initialisé.');
  return auth;
}

export function getFirebaseDb(): Firestore {
  if (!db) throw new Error('Firebase n’est pas initialisé.');
  return db;
}

export function getFirebaseFunctions(): Functions {
  if (!functions) throw new Error('Firebase n’est pas initialisé.');
  return functions;
}
