/**
 * Appels aux Cloud Functions d'administration.
 *
 * ## Pourquoi une couche dédiée plutôt que `httpsCallable` dans les écrans
 *
 * Trois raisons, toutes tirées de la même expérience : ce qui n'est pas
 * centralisé finit par diverger.
 *
 *  1. **Les noms de fonctions sont des chaînes de caractères.** Les écrire
 *     dans chaque écran, c'est accepter qu'une faute de frappe ne devienne une
 *     erreur d'exécution — et qu'un renommage côté serveur passe inaperçu côté
 *     client.
 *  2. **La région doit correspondre à celle du déploiement.** L'oublier donne
 *     une erreur « not found » que rien dans le code n'explique.
 *  3. **Les erreurs doivent être normalisées.** Sans cette couche, un
 *     `HttpsError` remonterait brut jusqu'à l'interface, avec un code technique
 *     et un message en anglais.
 *
 * ## Ce que cette couche ne fait pas
 *
 * Elle ne décide de rien. Les fonctions revalident chaque entrée, relisent le
 * rôle de l'appelant **en base** plutôt que dans son jeton, et journalisent
 * l'action. Les contrôles côté client servent uniquement à ne pas proposer une
 * action qui sera refusée.
 */
import { httpsCallable, type Functions } from 'firebase/functions';

import type { UserRole, UserStatus } from '@fl/types';

import { toAppError } from '../errors.js';

/**
 * Région de déploiement des fonctions.
 *
 * Doit correspondre au `setGlobalOptions({ region })` de
 * `functions/src/index.ts`. Une divergence ne produit aucune erreur de
 * compilation — seulement un échec à l'exécution.
 */
export const FUNCTIONS_REGION = 'europe-west1';

/** Noms des fonctions appelables. Regroupés ici pour être renommables d'un coup. */
const FUNCTION_NAMES = {
  setUserStatus: 'adminSetUserStatus',
  setUserRole: 'adminSetUserRole',
  deleteUser: 'adminDeleteUser',
} as const;

export interface SetUserStatusInput {
  uid: string;
  status: UserStatus;
  /** Motif conservé dans le journal d'audit et affiché à l'intéressé. */
  reason?: string;
}

export interface SetUserRoleInput {
  uid: string;
  role: UserRole;
  reason?: string;
}

export interface AdminFunctionsClient {
  /**
   * Approuve, refuse, suspend ou réactive un compte.
   * Renvoie le statut effectivement appliqué par le serveur.
   */
  setUserStatus(input: SetUserStatusInput): Promise<UserStatus>;

  /**
   * Change le rôle d'un compte. Réservé aux administrateurs.
   * `unchanged` vaut `true` lorsque le rôle demandé était déjà en place.
   */
  setUserRole(input: SetUserRoleInput): Promise<{ role: UserRole; unchanged: boolean }>;

  /** Supprime un compte et ses données (droit à l'effacement). */
  deleteUser(uid: string): Promise<void>;
}

/** Réponse de `adminSetUserStatus`. */
interface SetStatusResponse {
  ok: boolean;
  status: UserStatus;
}

/** Réponse de `adminSetUserRole`. */
interface SetRoleResponse {
  ok: boolean;
  role: UserRole;
  unchanged?: boolean;
}

export function createAdminFunctionsClient(functions: Functions): AdminFunctionsClient {
  const callSetStatus = httpsCallable<SetUserStatusInput, SetStatusResponse>(
    functions,
    FUNCTION_NAMES.setUserStatus,
  );
  const callSetRole = httpsCallable<SetUserRoleInput, SetRoleResponse>(
    functions,
    FUNCTION_NAMES.setUserRole,
  );
  const callDeleteUser = httpsCallable<{ uid: string }, { ok: boolean }>(
    functions,
    FUNCTION_NAMES.deleteUser,
  );

  return {
    async setUserStatus(input) {
      try {
        const result = await callSetStatus(input);
        // Le statut renvoyé est celui que le serveur a réellement écrit. S'en
        // servir plutôt que de supposer que la demande a été appliquée telle
        // quelle évite d'afficher un état que la base ne connaît pas.
        return result.data.status;
      } catch (error) {
        throw toAppError(error);
      }
    },

    async setUserRole(input) {
      try {
        const result = await callSetRole(input);
        return { role: result.data.role, unchanged: result.data.unchanged ?? false };
      } catch (error) {
        throw toAppError(error);
      }
    },

    async deleteUser(uid) {
      try {
        await callDeleteUser({ uid });
      } catch (error) {
        throw toAppError(error);
      }
    },
  };
}
