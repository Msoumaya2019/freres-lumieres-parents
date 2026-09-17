/**
 * Point d'entrée de la couche d'accès Firebase.
 *
 * Import conseillé :
 *
 *     import { paths, createUserRepository, createPostRepository } from '@fl/firebase';
 *
 * Ce package ne crée jamais l'application Firebase lui-même : il ne sait pas
 * si l'on est sur React Native (persistance AsyncStorage) ou dans un
 * navigateur (persistance locale). Chaque application initialise le SDK dans
 * `src/lib/firebase.ts`, puis injecte les instances ici.
 *
 * Cette séparation évite d'imposer `react-native` à l'admin et de rendre le
 * package intestable.
 */

export * from './paths.js';
export * from './config.js';
export * from './converters.js';
export * from './errors.js';
export * from './pagination.js';
export * from './storage.js';

export * from './repositories/users.js';
export * from './repositories/posts.js';
export * from './repositories/reference.js';
export * from './repositories/admin-logs.js';

export * from './functions/admin.js';

// Le module d'envoi push vivait ici. Il est parti dans `@fl/shared` : il
// n'importe aucun SDK Firebase, et une Cloud Function — qui doit pouvoir s'en
// servir — ne peut pas dépendre de ce paquet, qui embarque le SDK client.
// Voir `packages/shared/src/push/dispatcher.ts`.
