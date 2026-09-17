/**
 * Relecture des reçus Expo : le second temps du compte rendu.
 *
 * ## Pourquoi une fonction planifiée, et pas la fin de l'envoi
 *
 * Expo recommande d'attendre **quinze minutes** avant de demander un reçu, et
 * les efface au bout de **vingt-quatre heures**. Or `sendToAudience` vit dans
 * une fonction plafonnée à soixante secondes : elle ne peut pas attendre. La
 * relecture est donc un second passage, sur un déclencheur horaire.
 *
 * Une heure, et non cinq minutes : les reçus restent lisibles une journée
 * entière, donc un délai d'une heure n'en perd aucun, et il divise par douze le
 * nombre d'invocations — sur une association qui paie ses factures, la
 * différence compte.
 *
 * ## Ce que ce passage doit à la table `pushTickets`
 *
 * Un reçu désigne un **ticket**, jamais un jeton. C'est la limite du service, et
 * elle est incontournable : `readReceipts` rend donc des identifiants morts, et
 * c'est ici qu'ils redeviennent des jetons, par la table écrite au moment de
 * l'envoi. Sans elle, ce module saurait qu'un appareil est mort sans pouvoir
 * dire lequel — il compterait une panne et laisserait le jeton en place.
 *
 * ## L'ordre des écritures est choisi pour être rejouable
 *
 * Reçus, purge, suppression des tickets, puis mise à jour de l'historique —
 * dans cet ordre. Le déclencheur s'exécute **au moins une fois** : si
 * l'historique était mis à jour en premier, une reprise après incident ne
 * relirait rien, et les reçus seraient perdus. En le mettant en dernier, la
 * seule conséquence d'une reprise est une seconde lecture — les reçus sont
 * idempotents —, et le pire cas est un reçu devenu indisponible, compté
 * `pending` au lieu de `delivered`. C'est une imprécision, pas un mensonge.
 *
 * ## Ce qui interrompt le passage
 *
 * Un jeton d'accès Expo refusé, et lui seul. Le défaut est global et durable :
 * réessayer sur les dix-neuf autres envois ne donnerait rien, et le passage de
 * l'heure suivante recommencerait. Un échec **ordinaire**, au contraire, laisse
 * le document en attente et sera repris — c'est le comportement voulu, pas une
 * négligence.
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';

import { PushCredentialsError, type PushDispatcher } from '@fl/shared';

import { adminDb } from '../lib/admin.js';
import { COLLECTIONS } from '../lib/paths.js';
import { createPushDispatcher } from './send.js';
import { purgeDeviceTokens } from './token-purge.js';

/**
 * Délai avant de demander un reçu, en millisecondes.
 *
 * Quinze minutes : la valeur que la documentation du service recommande. Plus
 * tôt, une partie des reçus n'existe pas encore et serait comptée `pending`.
 */
export const DELAI_RECUS_MS = 15 * 60 * 1000;

/**
 * Nombre d'envois examinés par passage.
 *
 * Le plafond protège l'invocation : chaque envoi relu coûte un appel réseau et
 * autant de lectures que d'appareils. Vingt suffisent très largement — il
 * faudrait vingt notifications en une heure pour que la file s'allonge, et le
 * reliquat est simplement traité au passage suivant.
 */
const ENVOIS_PAR_PASSAGE = 20;

/** Nombre maximal d'opérations dans un lot Firestore. */
const TAILLE_LOT = 500;

export interface ReceiptsOutcome {
  /** Envois dont les reçus ont été relus. */
  checked: number;
  /** Envois dont la relecture a échoué : repris au passage suivant. */
  unread: number;
  delivered: number;
  /** Reçus en erreur, tous motifs confondus. */
  failed: number;
  pending: number;
  /** Jetons supprimés parce que le transport les a déclarés morts. */
  purgedTokens: number;
}

export interface ReadPendingReceiptsOptions {
  /** Injectable : les tests fournissent un dispatcher qui ne sort pas du processus. */
  dispatcher?: PushDispatcher;
  /** Injectable : sans horloge explicite, un test ne peut pas se placer dans le temps. */
  now?: Date;
}

/**
 * Relit les reçus des envois qui attendent leur compte rendu.
 *
 * Un envoi dont la relecture échoue est **laissé tel quel** : `receiptsChecked`
 * reste faux, donc le passage suivant le reprendra. C'est la raison pour
 * laquelle l'échec est compté dans le compte rendu au lieu d'être avalé — un
 * envoi repris trois fois de suite est le signe d'un problème durable, et il
 * doit être visible dans les journaux.
 */
export async function readPendingReceipts(
  options: ReadPendingReceiptsOptions = {},
): Promise<ReceiptsOutcome> {
  const db = adminDb();
  const dispatcher = options.dispatcher ?? createPushDispatcher();
  const maintenant = options.now ?? new Date();
  const echeance = Timestamp.fromMillis(maintenant.getTime() - DELAI_RECUS_MS);

  const envois = await db
    .collection(COLLECTIONS.notifications)
    .where('receiptsChecked', '==', false)
    .where('sentAt', '<=', echeance)
    .orderBy('sentAt', 'asc')
    .limit(ENVOIS_PAR_PASSAGE)
    .get();

  const total: ReceiptsOutcome = {
    checked: 0,
    unread: 0,
    delivered: 0,
    failed: 0,
    pending: 0,
    purgedTokens: 0,
  };

  for (const envoi of envois.docs) {
    const ticketIds = (envoi.get('ticketIds') ?? []) as string[];

    try {
      const compte = await relireUnEnvoi(envoi.ref, ticketIds, dispatcher, db);

      total.checked += 1;
      total.delivered += compte.delivered;
      total.failed += compte.failed;
      total.pending += compte.pending;
      total.purgedTokens += compte.purgedTokens;
    } catch (error) {
      total.unread += 1;

      // Un jeton d'accès refusé vaut pour **tous** les envois. Insister sur les
      // suivants produirait vingt fois la même erreur, et le passage de l'heure
      // suivante la reproduirait indéfiniment. On s'arrête là, avec un message
      // qui dit quoi faire : c'est la seule différence entre une panne qu'on
      // répare et une panne qu'on subit.
      if (error instanceof PushCredentialsError) {
        logger.error(
          '[notifications] Jeton d’accès Expo refusé : les reçus ne peuvent pas être relus.',
          { statut: error.statut },
        );
        break;
      }

      logger.error('[notifications] Reçus non relus', {
        notificationId: envoi.id,
        ticketCount: ticketIds.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (envois.size > 0) {
    logger.info('[notifications] Reçus relus', { ...total });
  }

  return total;
}

/**
 * Relit un envoi, purge ce qu'il faut, puis marque le document comme lu.
 *
 * Rend le compte de cet envoi ; lève si la relecture réseau échoue, pour que
 * l'appelant laisse le document en attente.
 */
async function relireUnEnvoi(
  ref: DocumentReference,
  ticketIds: readonly string[],
  dispatcher: PushDispatcher,
  db: Firestore,
): Promise<Omit<ReceiptsOutcome, 'checked' | 'unread'>> {
  const recus = await dispatcher.readReceipts(ticketIds);

  // La table des tickets rend les deux services à la fois : elle traduit les
  // identifiants morts en jetons, et elle dit quels documents supprimer.
  const tickets = await db
    .collection(COLLECTIONS.pushTickets)
    .where('notificationId', '==', ref.id)
    .get();

  const jetonParTicket = new Map<string, string>();
  for (const document of tickets.docs) {
    const token = document.get('token');
    if (typeof token === 'string') jetonParTicket.set(document.id, token);
  }

  // Un identifiant mort dont le jeton est introuvable est journalisé, jamais
  // ignoré en silence : c'est le symptôme d'une table de tickets incomplète, et
  // sans cette trace la seule conséquence visible serait un jeton qui revient à
  // chaque envoi.
  const jetonsMorts: string[] = [];
  for (const ticketId of recus.deadTicketIds) {
    const token = jetonParTicket.get(ticketId);
    if (token) jetonsMorts.push(token);
    else logger.warn('[notifications] Ticket mort sans jeton connu', { ticketId });
  }

  const purgedTokens = await purgeDeviceTokens(jetonsMorts);

  for (let debut = 0; debut < tickets.docs.length; debut += TAILLE_LOT) {
    const batch = db.batch();
    for (const document of tickets.docs.slice(debut, debut + TAILLE_LOT)) {
      batch.delete(document.ref);
    }
    await batch.commit();
  }

  await ref.update({
    deliveredCount: recus.delivered,
    pendingCount: recus.pending,
    // Les reçus en erreur s'ajoutent aux refus de l'envoi : le document finit
    // par compter tout ce qui n'est pas arrivé, quelle qu'en soit l'étape.
    failedCount: FieldValue.increment(recus.failed),
    receiptsChecked: true,
  });

  return {
    delivered: recus.delivered,
    failed: recus.failed,
    pending: recus.pending,
    purgedTokens,
  };
}
