/**
 * Point d'entrée des Cloud Functions.
 *
 * ## Organisation
 *
 * ```
 *  auth/       cycle de vie des comptes, Custom Claims, clés d'audience
 *  callable/   actions privilégiées appelées depuis l'interface d'administration
 *  triggers/   réactions aux écritures Firestore (compteurs, notifications)
 *  lib/        Admin SDK, chemins, journal d'audit
 * ```
 *
 * ## Options globales
 *
 * - **`europe-west1`** : les utilisateurs sont en France. Une fonction
 *   exécutée aux États-Unis ajouterait 150 ms d'aller-retour à chaque appel.
 * - **`maxInstances`** : plafonne le coût en cas de pic ou d'abus. Sur une
 *   application à quelques centaines d'utilisateurs, dix instances
 *   simultanées suffisent largement.
 * - **`concurrency`** : plusieurs requêtes par instance, ce qui réduit le
 *   nombre d'instances à démarrer (et donc la facture).
 *
 * ## Ajouter une fonction
 *
 * 1. Créer le module dans le dossier correspondant.
 * 2. L'exporter ici.
 * 3. Documenter son déclencheur et ses permissions dans `docs/`.
 * 4. Ajouter un test si elle porte une décision d'autorisation.
 */
import { setGlobalOptions } from 'firebase-functions/v2';

setGlobalOptions({
  region: 'europe-west1',
  maxInstances: 10,
  concurrency: 40,
  memory: '256MiB',
  timeoutSeconds: 60,
});

// --- Comptes et droits -------------------------------------------------------
export { onUserProfileCreated, onUserProfileWritten } from './auth/user-triggers.js';

// --- Actions d'administration ------------------------------------------------
export { adminSetUserStatus, adminSetUserRole, adminDeleteUser } from './callable/admin-users.js';

// --- Compteurs agrégés -------------------------------------------------------
export { onReportWritten } from './triggers/counters.js';
