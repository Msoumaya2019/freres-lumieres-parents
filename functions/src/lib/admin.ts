/**
 * Initialisation de l'Admin SDK.
 *
 * ## Règle absolue
 *
 * La clé privée de l'Admin SDK ne doit **jamais** être commitée ni incluse
 * dans un bundle client. Ce fichier n'est exécuté que dans l'environnement
 * Cloud Functions, où les identifiants sont fournis automatiquement par
 * l'infrastructure Firebase (compte de service du projet).
 *
 * En développement local, `GOOGLE_APPLICATION_CREDENTIALS` doit pointer vers
 * un fichier ignoré par Git. Les émulateurs, eux, n'ont besoin d'aucun
 * identifiant.
 */
import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';

import { COLLECTIONS, paths } from './paths.js';

let app: App | null = null;

/** Initialise l'Admin SDK une seule fois, quel que soit le point d'entrée. */
export function getAdminApp(): App {
  if (app) return app;
  app = getApps()[0] ?? initializeApp();
  return app;
}

export function adminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function adminDb(): Firestore {
  return getFirestore(getAdminApp());
}

export function adminStorage(): Storage {
  return getStorage(getAdminApp());
}

// Réexport de commodité : les modules de fonctions n'ont ainsi qu'un seul
// import à connaître.
export { COLLECTIONS, paths };
