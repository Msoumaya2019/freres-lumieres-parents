/**
 * Initialisation du SDK Firebase pour React Native.
 *
 * ## Ce que ce fichier fait, et ne fait pas
 *
 * Il crée l'application Firebase, l'authentification persistante, Firestore
 * et Storage — puis les expose sous forme d'instances prêtes à injecter dans
 * les repositories de `@fl/firebase`.
 *
 * Il ne contient **aucune logique métier** : le package partagé ne sait pas
 * s'il tourne sur React Native ou dans un navigateur, c'est pourquoi
 * l'initialisation reste ici, propre à la plateforme.
 *
 * ## Aucune clé privée
 *
 * Seule la configuration client est utilisée. Elle est publique par nature.
 * La clé Firebase Admin n'a rien à faire dans une application mobile : elle
 * donnerait un accès total à la base à quiconque l'extrairait du bundle.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, initializeAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';

import { EMULATOR_PORTS } from '@fl/firebase';

import { emulatorHost, firebaseConfig, useFirebaseEmulators } from './env';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;

/** L'application a-t-elle été initialisée correctement ? */
export function isFirebaseReady(): boolean {
  return app !== null && auth !== null && db !== null;
}

/**
 * Initialise Firebase une seule fois.
 *
 * Appelée au démarrage de l'application, avant le premier rendu des écrans.
 * Renvoie `null` si la configuration est incomplète, ce qui permet à
 * l'interface d'afficher un écran explicatif au lieu de planter.
 */
export function initializeFirebase(): {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
} | null {
  if (app && auth && db && storage) {
    return { app, auth, db, storage };
  }

  try {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

    // La persistance de session est indispensable sur mobile : sans elle,
    // l'utilisateur devrait se reconnecter à chaque ouverture de l'app.
    auth = createAuth(app);

    db = getFirestore(app);
    storage = getStorage(app);

    if (useFirebaseEmulators) {
      connectToEmulators(auth, db, storage);
    }

    return { app, auth, db, storage };
  } catch (error) {
    console.error("[Firebase] Échec de l'initialisation :", error);
    app = null;
    auth = null;
    db = null;
    storage = null;
    return null;
  }
}

/**
 * Crée l'instance d'authentification avec persistance.
 *
 * `getReactNativePersistence` est exporté par la variante React Native de
 * `firebase/auth`. Selon la version du SDK, il peut ne pas être présent dans
 * les types : on tente donc l'appel, et on retombe sur l'authentification
 * standard en mémoire si la fonction n'existe pas. L'utilisateur devra alors
 * se reconnecter à chaque lancement — dégradé, mais fonctionnel.
 */
function createAuth(firebaseApp: FirebaseApp): Auth {
  try {
    const authModule = require('firebase/auth') as {
      getReactNativePersistence?: (storage: unknown) => unknown;
    };
    const persistence = authModule.getReactNativePersistence?.(AsyncStorage);

    if (persistence) {
      return initializeAuth(firebaseApp, { persistence: persistence as never });
    }
  } catch (error) {
    console.warn(
      '[Firebase] Persistance native indisponible, session non conservée entre deux lancements.',
      error,
    );
  }
  return getAuth(firebaseApp);
}

/**
 * Raccorde les SDK aux émulateurs locaux.
 *
 * Permet de développer sans consommer le moindre quota Firebase. Un
 * avertissement est journalisé : il est utile de savoir immédiatement que
 * l'on n'écrit pas dans la vraie base.
 */
function connectToEmulators(
  authInstance: Auth,
  dbInstance: Firestore,
  storageInstance: FirebaseStorage,
): void {
  connectAuthEmulator(authInstance, `http://${emulatorHost}:${EMULATOR_PORTS.auth}`, {
    disableWarnings: true,
  });
  connectFirestoreEmulator(dbInstance, emulatorHost, EMULATOR_PORTS.firestore);
  connectStorageEmulator(storageInstance, emulatorHost, EMULATOR_PORTS.storage);

  console.info(
    `[Firebase] Émulateurs locaux activés (${emulatorHost}). ` +
      'Aucune donnée ne sera écrite dans le projet réel.',
  );
}

/**
 * Accès aux instances après initialisation.
 * Lève une erreur explicite plutôt que de renvoyer `undefined`, ce qui
 * produirait une erreur obscure plusieurs couches plus loin.
 */
export function getFirebaseAuth(): Auth {
  if (!auth)
    throw new Error('Firebase n’est pas initialisé. Appelez initializeFirebase() au démarrage.');
  return auth;
}

export function getFirebaseDb(): Firestore {
  if (!db)
    throw new Error('Firebase n’est pas initialisé. Appelez initializeFirebase() au démarrage.');
  return db;
}

export function getFirebaseStorage(): FirebaseStorage {
  if (!storage)
    throw new Error('Firebase n’est pas initialisé. Appelez initializeFirebase() au démarrage.');
  return storage;
}
