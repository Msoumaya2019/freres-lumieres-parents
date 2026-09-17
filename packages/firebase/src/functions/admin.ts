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

import type { NotificationSendInput } from '@fl/shared';
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
  sendNotification: 'sendManualNotification',
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

/**
 * Compte rendu d'un envoi, tel que la fonction le retourne.
 *
 * ## Ce que ces nombres comptent, et ce qu'ils ne comptent pas
 *
 * **Aucun ne compte de parents.** Le service de notification dit qu'il a reçu
 * le message, pas que le téléphone l'a affiché : « 120 messages pris en charge »
 * est vrai, « 120 familles prévenues » ne le serait pas.
 *
 * ## Pourquoi `deliveredCount` n'est pas ici
 *
 * Parce qu'il n'existe pas encore. À l'envoi, on sait ce que le service a
 * **accepté** ; le nombre de remises n'apparaît qu'après la relecture des reçus,
 * une quinzaine de minutes plus tard, sur un déclencheur planifié. Le lire ici
 * supposerait d'attendre, et cette attente serait plus longue que la durée de
 * vie de la fonction.
 *
 * ## `notificationId` à `null` ne veut pas dire « rien n'a été envoyé »
 *
 * Les messages sont partis ; c'est le **document d'historique** qui manque, son
 * écriture étant rattrapée pour qu'un défaut de journal ne fasse pas perdre un
 * envoi. L'écran doit donc le dire ainsi, et non comme un échec.
 */
export interface SendNotificationResult {
  /** Appareils visés, après filtrage des préférences. */
  readonly recipientCount: number;
  /** Messages pris en charge par le service (ticket `ok`). */
  readonly acceptedCount: number;
  /** Refusés dès l'envoi. La relecture des reçus peut en ajouter. */
  readonly failedCount: number;
  /** Appareils disparus dont le jeton a été retiré pendant l'envoi. */
  readonly purgedTokens: number;
  /** Document d'historique écrit, ou `null` s'il n'a pas pu l'être. */
  readonly notificationId: string | null;
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

  /**
   * Envoie une annonce écrite à la main à une audience.
   *
   * L'entrée est celle du schéma partagé, **organisation exclue** : elle est
   * lue dans le profil de l'appelant, côté serveur. Le schéma est strict, donc
   * l'ajouter ici ferait refuser l'appel — et c'est le comportement voulu,
   * puisqu'une organisation fournie par le client est une organisation qu'on
   * peut choisir.
   *
   * Rejette si l'audience ne désigne personne, si l'appelant n'a pas la
   * permission, ou si un jeton d'accès du service est refusé — ce dernier cas
   * interrompant l'envoi plutôt que d'être compté comme une audience
   * injoignable.
   */
  sendNotification(input: NotificationSendInput): Promise<SendNotificationResult>;
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

/**
 * Réponse de `sendManualNotification`.
 *
 * Dérivée de `SendNotificationResult` plutôt que recopiée : la fonction
 * retourne exactement ces compteurs, et deux listes de champs écrites à la main
 * de part et d'autre divergent au premier ajout.
 */
type SendNotificationResponse = SendNotificationResult & { ok: boolean };

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
  const callSendNotification = httpsCallable<NotificationSendInput, SendNotificationResponse>(
    functions,
    FUNCTION_NAMES.sendNotification,
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

    async sendNotification(input) {
      try {
        const result = await callSendNotification(input);
        return {
          recipientCount: result.data.recipientCount,
          acceptedCount: result.data.acceptedCount,
          failedCount: result.data.failedCount,
          purgedTokens: result.data.purgedTokens,
          // `?? null` couvre le cas d'un déploiement plus ancien que ce client,
          // qui ne renverrait pas le champ. L'absence se lit alors comme « pas
          // de compte rendu », ce qui est exactement ce qu'elle est.
          notificationId: result.data.notificationId ?? null,
        };
      } catch (error) {
        throw toAppError(error);
      }
    },
  };
}
