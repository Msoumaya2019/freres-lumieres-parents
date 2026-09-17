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
  /** Catégories désactivées par l'utilisateur. */
  disabledCategories: readonly NotificationCategory[];
  /** Clés d'audience de l'appareil. */
  audienceKeys: readonly string[];
}

/** Résultat d'un envoi. */
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
 * Les alertes `urgent` ne sont **jamais** filtrées : une fermeture d'école
 * doit atteindre tout le monde. C'est la seule exception, et elle est
 * volontaire.
 */
export function filterRecipients(
  recipients: readonly PushRecipient[],
  category: NotificationCategory,
): PushRecipient[] {
  if (category === 'urgent') return [...recipients];
  return recipients.filter((recipient) => !recipient.disabledCategories.includes(category));
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
