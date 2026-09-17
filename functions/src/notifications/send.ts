/**
 * Chemin d'envoi d'une notification.
 *
 * ## Ce que ce module remplace
 *
 * `ExpoPushDispatcher` existait, était testé, et **n'était appelé par
 * personne** : il manquait tout ce qui va d'un contenu à ses destinataires —
 * lire les jetons, les convertir, purger les appareils disparus, journaliser
 * l'envoi. C'est le défaut que ce projet rencontre le plus souvent, et il ne
 * fait jamais échouer un test : le code est simplement inerte.
 *
 * ## Ce qui reste dehors, volontairement
 *
 * Toute la décision est ailleurs — `post-plan.ts` dit **s'il faut** envoyer et
 * avec quoi, `recipients.ts` dit **à qui**. Ici, il ne reste que la plomberie
 * Firestore et réseau, qu'aucun test unitaire ne peut couvrir sans émulateur.
 * La garder mince est ce qui rend le reste éprouvable.
 *
 * ## Le journal d'envoi ne fait pas échouer l'envoi
 *
 * Comme le journal d'audit, l'écriture du document `notifications/{id}` est
 * rattrapée : une notification partie et non journalisée est un défaut
 * d'historique, pas un défaut de service. L'inverse — perdre l'envoi parce que
 * l'historique a échoué — serait absurde.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';

import type { Audience, NotificationType } from '@fl/types';
import {
  ExpoPushDispatcher,
  chunkAudienceKeys,
  type PushDispatcher,
  type PushMessage,
} from '@fl/shared';

import { adminDb } from '../lib/admin.js';
import { COLLECTIONS, paths } from '../lib/paths.js';
import { selectRecipients } from './recipients.js';

/** Nombre maximal d'opérations dans un lot Firestore. */
const TAILLE_LOT = 500;

/** Métadonnées d'historique, propres à l'appelant. */
export interface NotificationJournalEntry {
  type: NotificationType;
  audience: Audience;
  sourceType?: 'post' | 'poll' | 'event' | 'report' | 'message' | 'manual';
  sourceId?: string;
  deeplink?: string;
  /** Auteur de l'action : pour un déclencheur, l'auteur du contenu. */
  sentBy: string;
  sentByName: string;
}

export interface SendToAudienceParams {
  /**
   * Le message. Ses `audienceKeys` désignent les destinataires, et
   * `data.orgId` l'organisation — les deux y sont déjà, et les redemander
   * permettrait de les faire diverger.
   */
  message: PushMessage;
  journal: NotificationJournalEntry;
  /** Injectable : les tests fournissent un dispatcher qui ne sort pas du processus. */
  dispatcher?: PushDispatcher;
}

export interface SendOutcome {
  /** Jetons candidats avant filtrage par préférences. */
  recipientCount: number;
  /** Documents écartés parce que leur forme ne permettait pas de les utiliser. */
  rejectedCount: number;
  delivered: number;
  failed: number;
  /** Jetons supprimés : appareil désinstallé, jeton expiré. */
  purgedTokens: number;
}

/**
 * Dispatcher réel, utilisé par les déclencheurs.
 *
 * `EXPO_ACCESS_TOKEN` est facultatif mais recommandé : sans lui, l'API Expo
 * applique une limite de débit beaucoup plus stricte, et un envoi à quelques
 * centaines d'appareils échouerait par vagues. Il se pose dans
 * l'environnement des fonctions, jamais dans le dépôt.
 */
export function createPushDispatcher(): PushDispatcher {
  return new ExpoPushDispatcher({
    accessToken: process.env.EXPO_ACCESS_TOKEN,
    log: (message, context) => logger.info(message, context),
  });
}

/**
 * Jetons d'une organisation dont l'audience recoupe celle visée.
 *
 * Le dédoublonnage n'est pas une précaution de confort : `array-contains-any`
 * n'accepte que trente valeurs, donc les clés visées sont découpées en lots, et
 * un appareil dont les clés tombent dans deux lots serait renvoyé deux fois —
 * il recevrait **deux fois** la même notification. La clé du dédoublonnage est
 * l'identifiant du document, qui est le jeton lui-même et ne dépend pas de la
 * forme du contenu.
 */
export async function queryTokensByAudience(
  orgId: string,
  audienceKeys: readonly string[],
): Promise<unknown[]> {
  const db = adminDb();
  const parJeton = new Map<string, unknown>();

  for (const lot of chunkAudienceKeys(audienceKeys)) {
    const resultat = await db
      .collection(COLLECTIONS.deviceTokens)
      .where('orgId', '==', orgId)
      .where('enabled', '==', true)
      .where('audienceKeys', 'array-contains-any', lot)
      .get();

    for (const document of resultat.docs) {
      if (!parJeton.has(document.id)) parJeton.set(document.id, document.data());
    }
  }

  return [...parJeton.values()];
}

/**
 * Supprime les jetons que le fournisseur a déclarés morts.
 *
 * `DeviceNotRegistered` veut dire que l'application a été désinstallée. Ne pas
 * supprimer le jeton le fait retenter à chaque envoi, indéfiniment, pour un
 * appareil qui n'existe plus.
 */
async function purgeTokens(tokens: readonly string[]): Promise<number> {
  if (tokens.length === 0) return 0;

  const db = adminDb();
  let supprimes = 0;

  for (let debut = 0; debut < tokens.length; debut += TAILLE_LOT) {
    const lot = tokens.slice(debut, debut + TAILLE_LOT);
    const batch = db.batch();
    for (const token of lot) batch.delete(db.doc(paths.deviceToken(token)));
    await batch.commit();
    supprimes += lot.length;
  }

  return supprimes;
}

/** Écrit l'historique de l'envoi, sans jamais faire échouer l'envoi. */
async function writeNotificationLog(
  entry: NotificationJournalEntry,
  message: PushMessage,
  delivered: number,
  failed: number,
): Promise<void> {
  try {
    await adminDb()
      .collection(COLLECTIONS.notifications)
      .add({
        orgId: message.data.orgId,
        type: entry.type,
        category: message.category,
        title: message.title,
        body: message.body,
        audience: entry.audience,
        audienceKeys: [...message.audienceKeys],
        ...(entry.sourceType ? { sourceType: entry.sourceType } : {}),
        ...(entry.sourceId ? { sourceId: entry.sourceId } : {}),
        ...(entry.deeplink ? { deeplink: entry.deeplink } : {}),
        sentBy: entry.sentBy,
        sentByName: entry.sentByName,
        sentAt: FieldValue.serverTimestamp(),
        deliveredCount: delivered,
        failedCount: failed,
        delivery: 'immediate',
      });
  } catch (error) {
    logger.error('[notifications] Historique non écrit', {
      sourceId: entry.sourceId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Envoie un message à tous les appareils dont l'audience recoupe la sienne. */
export async function sendToAudience(params: SendToAudienceParams): Promise<SendOutcome> {
  const { message, journal } = params;
  const dispatcher = params.dispatcher ?? createPushDispatcher();

  const documents = await queryTokensByAudience(message.data.orgId, message.audienceKeys);
  const { recipients, rejected } = selectRecipients(documents);

  if (rejected.length > 0) {
    // Journalisé plutôt que tu : une exclusion muette est indiscernable d'un
    // parent qui n'a jamais enregistré d'appareil.
    logger.warn('[notifications] Jetons écartés', {
      count: rejected.length,
      reasons: rejected.slice(0, 5),
    });
  }

  const resultat = await dispatcher.send(message, recipients);
  const purgedTokens = await purgeTokens(resultat.invalidTokens);

  await writeNotificationLog(journal, message, resultat.delivered, resultat.failed);

  logger.info('[notifications] Envoi terminé', {
    category: message.category,
    recipientCount: recipients.length,
    delivered: resultat.delivered,
    failed: resultat.failed,
    purgedTokens,
  });

  return {
    recipientCount: recipients.length,
    rejectedCount: rejected.length,
    delivered: resultat.delivered,
    failed: resultat.failed,
    purgedTokens,
  };
}
