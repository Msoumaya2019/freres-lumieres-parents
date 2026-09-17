/**
 * Annonce des lots de discussion dont la fenêtre est écoulée.
 *
 * ## Le partage des rôles avec le déclencheur
 *
 * `triggers/channel-notifications.ts` accumule ; ce module annonce. La
 * séparation n'est pas cosmétique : c'est elle qui permet de **relire** les
 * messages au moment de l'annonce. Un message retiré par son auteur, ou masqué
 * par la modération, pendant les cinq minutes de la fenêtre ne compte alors
 * plus — annoncer « 3 nouveaux messages » sous un canal qui n'en montre que
 * deux enverrait les parents chercher ce qui n'est pas là.
 *
 * ## Pourquoi l'envoi précède la suppression
 *
 * Dans cet ordre, un passage interrompu entre les deux réannonce le lot au
 * passage suivant : un doublon, visible dans l'historique. Dans l'ordre
 * inverse, la notification serait **perdue** — et une notification perdue ne
 * se distingue pas d'un canal calme. Le défaut visible est préféré au défaut
 * silencieux, comme partout ailleurs dans ce module.
 *
 * Un envoi qui **lève** — jeton d'accès Expo refusé — laisse donc le lot en
 * place : le passage suivant le reprendra quand le secret aura été remplacé.
 *
 * ## Pourquoi le lot est supprimé même sans envoi
 *
 * Un lot vide — tous ses messages masqués, ou son canal supprimé — est
 * supprimé sans un mot. Le garder ferait interroger la base à chaque passage
 * pour un lot qui ne pourra plus jamais rien annoncer.
 *
 * ## La borne
 *
 * Un passage traite au plus `MAX_LOTS_PAR_PASSAGE` lots. Sans borne, une
 * reprise après une panne longue ferait un seul passage très long, et la
 * fonction planifiée serait interrompue au milieu — sans que rien ne dise où.
 */
import type { Audience } from '@fl/types';
import { logger } from 'firebase-functions/v2';

import { adminDb } from '../lib/admin.js';
import { COLLECTIONS, paths } from '../lib/paths.js';
import { digestNotification } from './channel-plan.js';
import { sendToAudience } from './send.js';

/** Nombre de lots traités au plus par passage. */
const MAX_LOTS_PAR_PASSAGE = 20;

/** Ce qu'un passage a fait, pour le journal. */
export interface DigestFlushReport {
  /** Lots examinés. */
  examined: number;
  /** Lots annoncés. */
  sent: number;
  /** Lots disparus sans un mot : vides, ou canal retiré. */
  skipped: number;
}

/** Identifiants de messages lisibles dans un document de lot. */
function messageIdsOf(data: Record<string, unknown> | undefined): string[] {
  if (!data || !Array.isArray(data.messageIds)) return [];
  return data.messageIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/** Annonce les lots dont la fenêtre est écoulée, et les retire. */
export async function flushChannelDigests(): Promise<DigestFlushReport> {
  const maintenant = new Date();
  const db = adminDb();

  // Une égalité de plage sur un seul champ : l'index simple est créé par
  // Firestore, aucun index composite n'est à déclarer. Ajouter `orgId` ici en
  // demanderait un, non déclaré, et la requête serait refusée à l'exécution
  // avec un message qui ne dit pas lequel manque.
  const dus = await db
    .collection(COLLECTIONS.channelDigests)
    .where('flushAt', '<=', maintenant)
    .limit(MAX_LOTS_PAR_PASSAGE)
    .get();

  const rapport: DigestFlushReport = { examined: 0, sent: 0, skipped: 0 };

  for (const document of dus.docs) {
    rapport.examined += 1;

    const channelId = document.id;
    const messageIds = messageIdsOf(document.data());

    const references = messageIds.map((messageId) =>
      db.doc(paths.channelMessage(channelId, messageId)),
    );
    const instantanes = references.length > 0 ? await db.getAll(...references) : [];
    const messages = instantanes.map((instantane) => instantane.data());

    const channel = (await db.doc(paths.channel(channelId)).get()).data();
    const plan = digestNotification(channelId, channel, messages);

    if (!plan) {
      await document.ref.delete();
      rapport.skipped += 1;
      continue;
    }

    const audience = plan.audience;

    await sendToAudience({
      message: plan.message,
      excludeUids: plan.excludeUids,
      journal: {
        type: 'new_message',
        // Le champ est omis plutôt qu'écrit à `undefined` : l'Admin SDK refuse
        // une valeur indéfinie, et l'échec ferait perdre la trace d'un envoi
        // qui, lui, a bien eu lieu.
        ...(audience ? { audience: audience as Audience } : {}),
        sourceType: 'message',
        sourceId: channelId,
        sentBy: plan.authorId,
        sentByName: plan.authorName,
      },
    });

    await document.ref.delete();
    rapport.sent += 1;
  }

  if (rapport.examined > 0) {
    logger.info('[flushChannelDigests] Passage terminé', { ...rapport });
  }

  return rapport;
}
