/**
 * Déclencheur d'activité d'un canal : tient l'aperçu du dernier message.
 *
 * ## Pourquoi un second déclencheur sur la même écriture
 *
 * `notifyChannelAudience` écoute déjà `channels/{channelId}/messages/{messageId}`.
 * Il n'a pas été étendu, et c'est délibéré : il **s'arrête** quand le canal n'a
 * pas d'audience — `channelDigestPlan` rend `null`, et rien n'est écrit. Un
 * canal sans audience n'aurait alors jamais d'aperçu, et l'écran afficherait un
 * canal muet alors que des messages y sont. Les deux responsabilités sont
 * distinctes : l'une groupe une annonce, l'autre décrit un affichage.
 *
 * ## Aucune boucle
 *
 * Ce déclencheur écrit dans `channels/{channelId}`, et aucun déclencheur
 * n'écoute `channels`. `notifyChannelAudience` écoute la sous-collection des
 * messages. La chaîne s'arrête donc ici — le même schéma que `counters.ts`, où
 * chaque déclencheur est relié explicitement à ce qu'il écrit.
 *
 * ## Pourquoi une transaction
 *
 * Deux messages écrits au même instant liraient sinon le même aperçu, et le
 * second écraserait le premier — un des deux pourrait reculer. La transaction
 * fait relire l'état du canal à chaque écriture, et la comparaison de dates
 * vit dans `channelActivityUpdate`.
 *
 * ## Un canal absent n'est pas créé
 *
 * `set` avec fusion **crée** le document s'il manque. Écrire l'aperçu d'un
 * message dont le canal n'existe plus fabriquerait donc un canal fantôme,
 * réduit à un `stats`, que l'écran listerait. La garde d'existence est là pour
 * cela, et non par prudence.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

import { channelActivityUpdate } from '../channels/activity.js';
import { adminDb } from '../lib/admin.js';
import { paths } from '../lib/paths.js';

export const onChannelMessageActivity = onDocumentCreated(
  { document: 'channels/{channelId}/messages/{messageId}', region: 'europe-west1' },
  async (event) => {
    const message = event.data?.data();
    if (!message) return;

    const { channelId } = event.params;
    const db = adminDb();
    const channelRef = db.doc(paths.channel(channelId));

    const ecrit = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(channelRef);

      // Voir l'en-tête : sans cette garde, `set` créerait un canal fantôme.
      if (!snapshot.exists) return false;

      const activity = channelActivityUpdate({
        existing: snapshot.data()?.stats,
        message,
      });

      if (!activity) return false;

      transaction.set(
        channelRef,
        {
          stats: {
            lastMessageAt: activity.lastMessageAt,
            lastMessagePreview: activity.lastMessagePreview,
            // `null` veut dire « ce message n'a pas de nom », et la fusion
            // laisserait alors en place celui du message précédent. La
            // suppression est donc explicite : l'aperçu décrit **ce** message,
            // pas un mélange de deux.
            lastMessageAuthorName: activity.lastMessageAuthorName ?? FieldValue.delete(),
          },
        },
        { merge: true },
      );

      return true;
    });

    if (!ecrit) return;

    logger.info('[onChannelMessageActivity] Aperçu mis à jour', { channelId });
  },
);
