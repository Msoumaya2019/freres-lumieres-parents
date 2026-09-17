/**
 * Déclencheur d'un message de canal : alimente le lot à annoncer.
 *
 * ## Ce que cette fonction ne fait pas
 *
 * Elle n'envoie **rien**. Un canal actif ne doit pas produire une notification
 * par message : les messages s'accumulent dans `channelDigests/{channelId}`, et
 * c'est un passage planifié qui annonce le lot cinq minutes plus tard. Séparer
 * les deux est ce qui rend le regroupement possible — un déclencheur ne peut
 * pas attendre, et une fonction qui dort coûte pendant qu'elle dort.
 *
 * ## Pourquoi `onDocumentCreated`
 *
 * Un message naît `visible` : `validMessage()` l'impose dans les règles. Il n'y
 * a donc pas deux chemins à réduire à une règle, contrairement à une
 * publication. Et un message masqué par la modération pendant la fenêtre ne
 * doit pas annuler le lot : il sera écarté à l'annonce, quand les messages
 * seront relus — ce que cette fonction ne fait pas, et n'a pas à faire.
 *
 * ## Pourquoi une transaction
 *
 * Deux messages écrits au même instant dans un canal actif liraient sinon le
 * même lot, et l'un écraserait l'autre : trois messages seraient annoncés comme
 * deux. La transaction fait relire le lot à chaque écriture.
 *
 * ## La chaîne s'arrête ici
 *
 * Cette fonction écrit dans `channelDigests`, qu'aucun déclencheur n'écoute. Le
 * passage planifié, lui, n'est pas déclenché par une écriture : il lit cette
 * collection et la supprime. Il n'existe donc aucune boucle — le même schéma
 * que `counters.ts`, où chaque déclencheur est relié explicitement à ce qu'il
 * écrit.
 */
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

import { adminDb } from '../lib/admin.js';
import { paths } from '../lib/paths.js';
import { channelDigestPlan } from '../notifications/channel-plan.js';

export const notifyChannelAudience = onDocumentCreated(
  { document: 'channels/{channelId}/messages/{messageId}', region: 'europe-west1' },
  async (event) => {
    const message = event.data?.data();
    if (!message) return;

    const { channelId, messageId } = event.params;
    const db = adminDb();

    // Le canal est lu **hors** transaction : il n'est pas en concurrence avec
    // le lot, et le lire dedans ferait payer une relecture à chaque message
    // pour une valeur qui ne change pas dans l'intervalle d'une écriture.
    const channel = (await db.doc(paths.channel(channelId)).get()).data();

    const digestRef = db.doc(paths.channelDigest(channelId));

    const plan = await db.runTransaction(async (transaction) => {
      const existant = (await transaction.get(digestRef)).data();
      const suivant = channelDigestPlan(
        channelId,
        messageId,
        message,
        channel,
        existant,
        new Date(),
      );

      if (!suivant) return null;

      transaction.set(digestRef, {
        orgId: suivant.orgId,
        channelId: suivant.channelId,
        messageIds: suivant.messageIds,
        flushAt: suivant.flushAt,
      });

      return suivant;
    });

    if (!plan) return;

    logger.info('[notifyChannelAudience] Lot mis à jour', {
      channelId,
      messageCount: plan.messageIds.length,
      flushAt: plan.flushAt.toISOString(),
    });
  },
);
