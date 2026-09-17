/**
 * Envoi de notifications push.
 *
 * ## Pourquoi une interface plutôt qu'un appel direct
 *
 * Le SDK JavaScript Firebase ne prend pas en charge la messagerie dans React
 * Native : `firebase/messaging` cible les navigateurs. Deux chemins existent
 * réellement (voir `docs/05-notifications.md`) :
 *
 *  - **Expo Notifications** → Expo Push Service → FCM (Android) et APNs (iOS).
 *    Retenu en V1 : aucun identifiant natif à gérer, builds sans Mac.
 *  - **`@react-native-firebase/messaging`** → FCM direct, avec les topics
 *    natifs, mais exige un `prebuild` et des credentials dans le dépôt.
 *
 * Tout le code d'envoi passe donc par cette interface. Basculer d'une
 * implémentation à l'autre ne touche qu'un fichier.
 *
 * ## Pourquoi ce module vit dans `@fl/shared`, et pas dans `@fl/firebase`
 *
 * Il n'importe **aucun** SDK Firebase : ni `firebase/firestore`, ni
 * `firebase-admin`. Le transport Expo Push est un simple appel HTTP. Or une
 * Cloud Function ne peut pas dépendre de `@fl/firebase`, qui embarque le SDK
 * client — c'est une règle du projet, et `paths.ts` va jusqu'à recopier les
 * noms de collections pour ne pas créer cette arête. Le module a donc été
 * déplacé ici : `@fl/shared` est le paquet sans SDK, et `functions` en dépend
 * déjà.
 *
 * Conséquence à ne pas défaire : ce fichier doit rester sans dépendance au
 * SDK Firebase. S'il en gagnait une, le paquet deviendrait inutilisable côté
 * serveur, et le retour du problème serait silencieux.
 */
import type { NotificationCategory } from '@fl/types';

import { audienceKeyToTopic } from '../audience.js';
import { isMandatoryNotificationCategory } from '../constants.js';

/** Un envoi de notification, décrit indépendamment du fournisseur. */
export interface PushMessage {
  title: string;
  body: string;
  /** Catégorie métier, utilisée pour le filtrage par préférences. */
  category: NotificationCategory;
  /** Clés d'audience ciblées. */
  audienceKeys: readonly string[];
  /** Données transportées jusqu'à l'application. */
  data: {
    type: string;
    orgId: string;
    sourceId?: string;
    deeplink?: string;
  };
  /** Priorité maximale pour les alertes urgentes. */
  priority?: 'default' | 'max';
}

/** Un destinataire : un jeton et ses préférences recopiées. */
export interface PushRecipient {
  token: string;
  platform: 'ios' | 'android' | 'web';
  /**
   * Interrupteur général de **cet appareil** (`deviceTokens.enabled`).
   *
   * Il ne coupe pas tout : les catégories obligatoires passent outre. La
   * décision est prise dans `filterRecipients`, à un seul endroit.
   */
  enabled: boolean;
  /** Catégories désactivées par l'utilisateur. */
  disabledCategories: readonly NotificationCategory[];
  /** Clés d'audience de l'appareil. */
  audienceKeys: readonly string[];
}

/**
 * Résultat d'un envoi.
 *
 * ## Ce que `delivered` compte exactement
 *
 * **Des messages acceptés par le service, pas des messages reçus.** Un ticket
 * `ok` signifie qu'Expo Push a pris le message en charge et le remettra à FCM
 * ou APNs ; il ne dit rien de ce qui se passe ensuite — appareil éteint,
 * application désinstallée entre-temps, jeton révoqué. Le seul moyen de le
 * savoir est de relire les **reçus** (`/push/getReceipts`), et ce code ne le
 * fait pas encore.
 *
 * Conséquence à ne pas oublier : le compteur affiché à l'administration est un
 * **compteur d'acceptation**. Il est honnête tant qu'on l'appelle ainsi ; il
 * devient faux le jour où un écran l'intitule « reçues ». Le lire
 * `/docs/05-notifications.md` avant de s'en servir dans une interface.
 */
export interface PushResult {
  delivered: number;
  failed: number;
  /** Jetons à supprimer (appareil désinstallé, jeton expiré). */
  invalidTokens: string[];
}

export interface PushDispatcher {
  /** Envoie un message à une liste de destinataires. */
  send(message: PushMessage, recipients: readonly PushRecipient[]): Promise<PushResult>;
}

/** Nom de canal Android, dérivé de la catégorie. */
export function androidChannelId(category: NotificationCategory): string {
  return `fl-${category}`;
}

/** Topics équivalents, pour une future implémentation FCM directe. */
export function messageTopics(message: PushMessage): string[] {
  return message.audienceKeys.map(audienceKeyToTopic);
}

/**
 * Filtre les destinataires selon leurs préférences.
 *
 * ## L'interrupteur général n'atteint pas les alertes obligatoires
 *
 * Un appareil dont `enabled` est faux ne reçoit plus rien — **sauf** les
 * catégories de `MANDATORY_NOTIFICATION_CATEGORIES`. Couper le bruit n'est pas
 * couper les alertes, et une fermeture d'école annoncée trop tard ne se
 * rattrape pas.
 *
 * Cette exception était auparavant appliquée **à moitié, en deux endroits** :
 * ici pour `disabledCategories`, et nulle part pour l'interrupteur général, que
 * la requête Firestore contraignait sans exception. Un parent ayant éteint les
 * notifications de son téléphone ne recevait donc **aucune** alerte urgente.
 * La requête ne contraint plus `enabled` (voir `queryTokensByAudience`), et la
 * décision se prend ici, à un seul endroit.
 *
 * ## Pourquoi `isMandatoryNotificationCategory` plutôt que `'urgent'`
 *
 * L'exception a une source unique, `MANDATORY_NOTIFICATION_CATEGORIES`.
 * Comparer à la chaîne `'urgent'` recopierait cette liste ici, et les deux
 * divergeraient le jour où une seconde catégorie deviendrait obligatoire.
 */
export function filterRecipients(
  recipients: readonly PushRecipient[],
  category: NotificationCategory,
): PushRecipient[] {
  if (isMandatoryNotificationCategory(category)) return [...recipients];
  return recipients.filter(
    (recipient) => recipient.enabled && !recipient.disabledCategories.includes(category),
  );
}

/**
 * Regroupe les destinataires par lots.
 * L'API Expo Push accepte au maximum 100 jetons par requête.
 */
export function chunkRecipients(
  recipients: readonly PushRecipient[],
  batchSize = 100,
): PushRecipient[][] {
  const batches: PushRecipient[][] = [];
  for (let index = 0; index < recipients.length; index += batchSize) {
    batches.push(recipients.slice(index, index + batchSize));
  }
  return batches;
}
