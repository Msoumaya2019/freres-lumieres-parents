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
 *
 * ## Ce qui, en revanche, fait bien échouer l'envoi
 *
 * Un jeton d'accès Expo refusé. C'est le seul cas où cette fonction lève, et il
 * le mérite : le défaut est **global** — aucun envoi n'aboutit, pour personne —,
 * **durable** — il ne se répare pas en réessayant —, et **silencieux** si on le
 * laisse passer, puisqu'il se comptait jusqu'ici comme une audience
 * injoignable. Lever a un prix : ni historique, ni `notifiedAt`, donc la
 * publication ne sera pas renotifiée d'elle-même. C'est exact — rien n'est
 * parti — et c'est préférable à un document qui affirme le contraire.
 *
 * ## Le compte rendu se fait en deux temps, et c'est voulu
 *
 * Ce module écrit ce que le service a **accepté** : `acceptedCount`, et
 * `deliveredCount: null`. Le nombre de messages réellement remis à FCM ou APNs
 * n'existe pas encore — Expo recommande d'attendre quinze minutes avant de
 * demander les reçus, et cette fonction-ci vit soixante secondes. C'est
 * `receipts.ts` qui complète le document, plus tard, sur un déclencheur
 * planifié.
 *
 * La conséquence pratique : la table `pushTickets` écrite ici n'est pas un
 * ornement, c'est ce qui rend la relecture possible. Un reçu désigne un ticket,
 * jamais un jeton ; sans cette association, la relecture saurait qu'un appareil
 * est mort sans pouvoir dire lequel.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';

import type { Audience, NotificationType } from '@fl/types';
import {
  ExpoPushDispatcher,
  PushCredentialsError,
  chunkAudienceKeys,
  type PushDispatcher,
  type PushMessage,
  type PushResult,
  type PushTicketRef,
} from '@fl/shared';

import { adminDb } from '../lib/admin.js';
import { COLLECTIONS, paths } from '../lib/paths.js';
import { selectRecipients } from './recipients.js';
import { purgeDeviceTokens } from '../lib/token-purge.js';

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
  /**
   * Messages **acceptés** par le service (ticket `ok`).
   *
   * Ce champ s'appelait `delivered`, et le nom mentait : un ticket `ok` ne dit
   * pas que le message est arrivé, seulement que le service s'en charge. La
   * remise réelle se lit quinze minutes plus tard, dans le document
   * `notifications/{id}`.
   */
  accepted: number;
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
 * ## Pourquoi `enabled` n'est **pas** dans la requête
 *
 * La requête ne contraint pas `enabled`, et c'est délibéré. Une contrainte ici
 * écarte un appareil éteint **avant** `filterRecipients`, qui ne peut alors
 * plus rien pour lui : un parent ayant coupé les notifications de son téléphone
 * ne recevrait plus aucune alerte urgente, alors que c'est précisément le cas
 * que l'exception doit couvrir. Le filtre reste donc le seul endroit qui
 * décide — et lui s'éprouve sans émulateur.
 *
 * Le prix est de lire quelques documents de plus, les appareils éteints de
 * l'audience, pour les écarter juste après. À l'échelle d'un groupe scolaire il
 * est très inférieur au coût d'une fermeture d'école non reçue.
 *
 * ## Pourquoi le dédoublonnage
 *
 * `array-contains-any` n'accepte que trente valeurs, donc les clés visées sont
 * découpées en lots, et un appareil dont les clés tombent dans deux lots serait
 * renvoyé deux fois — il recevrait **deux fois** la même notification. La clé du
 * dédoublonnage est l'identifiant du document, qui est le jeton lui-même et ne
 * dépend pas de la forme du contenu.
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
      .where('audienceKeys', 'array-contains-any', lot)
      .get();

    for (const document of resultat.docs) {
      if (!parJeton.has(document.id)) parJeton.set(document.id, document.data());
    }
  }

  return [...parJeton.values()];
}

/**
 * Écrit l'historique de l'envoi, sans jamais faire échouer l'envoi.
 *
 * Rend `true` quand le document est écrit, `false` quand l'écriture a échoué.
 * L'appelant s'en sert pour ne pas écrire la table des tickets : des tickets
 * sans document d'historique ne seraient jamais relus — le passage des reçus
 * part de l'historique — et resteraient en base jusqu'à la fin des temps.
 *
 * ## Pourquoi `deliveredCount` vaut `null`, et non `0`
 *
 * À cet instant on sait ce que le service a **accepté**, pas ce qu'il a remis.
 * Écrire `0` affirmerait qu'aucun message n'est parti ; écrire `acceptedCount`
 * affirmerait qu'ils sont tous arrivés. `null` dit la seule chose vraie : pas
 * encore relu. Le passage des reçus le remplacera par un nombre — ou laissera
 * le document tel quel si la relecture échoue, ce qui est précisément
 * l'information à ne pas perdre.
 *
 * ## Pourquoi `receiptsChecked` peut être vrai dès l'écriture
 *
 * Quand il n'y a aucun ticket à relire — personne n'était éligible, ou tous les
 * envois ont échoué —, la remise est connue d'avance : zéro. Marquer le
 * document comme « à relire » le ferait interroger le service à chaque passage
 * pendant vingt-quatre heures, pour rien.
 */
async function writeNotificationLog(
  entry: NotificationJournalEntry,
  message: PushMessage,
  notificationId: string,
  comptes: {
    recipientCount: number;
    accepted: number;
    failed: number;
    tickets: readonly PushTicketRef[];
  },
): Promise<boolean> {
  const rienARelire = comptes.tickets.length === 0;

  try {
    await adminDb()
      .doc(paths.notification(notificationId))
      .set({
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
        delivery: 'immediate',
        recipientCount: comptes.recipientCount,
        acceptedCount: comptes.accepted,
        deliveredCount: rienARelire ? 0 : null,
        failedCount: comptes.failed,
        pendingCount: 0,
        ticketIds: comptes.tickets.map((ticket) => ticket.id),
        receiptsChecked: rienARelire,
      });
    return true;
  } catch (error) {
    logger.error('[notifications] Historique non écrit', {
      sourceId: entry.sourceId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Associe chaque ticket à son jeton, le temps que les reçus soient lisibles.
 *
 * ## Pourquoi cette table existe
 *
 * Un reçu Expo désigne un **ticket**, jamais un jeton : la réponse de
 * `/push/getReceipts` ne dit pas à quel appareil elle correspond. Sans cette
 * association, apprendre qu'un appareil est mort ne dirait pas lequel, et la
 * purge serait impossible — le reçu serait lu, compté, et sans effet.
 *
 * ## Pourquoi elle vit dans sa propre collection
 *
 * Elle contient des jetons d'appareil, donc des identifiants. Les ranger dans
 * `notifications` — que la FCPE lit — aurait exposé l'index des appareils que
 * la règle de `deviceTokens` protège déjà. Le document est donc inaccessible au
 * client, et il est supprimé dès que les reçus ont été lus.
 */
async function writePushTickets(
  notificationId: string,
  orgId: string,
  tickets: readonly PushTicketRef[],
): Promise<number> {
  if (tickets.length === 0) return 0;

  const db = adminDb();
  let ecrits = 0;

  for (let debut = 0; debut < tickets.length; debut += TAILLE_LOT) {
    const lot = tickets.slice(debut, debut + TAILLE_LOT);
    const batch = db.batch();

    for (const ticket of lot) {
      batch.set(db.doc(paths.pushTicket(ticket.id)), {
        orgId,
        notificationId,
        token: ticket.token,
        sentAt: FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    ecrits += lot.length;
  }

  return ecrits;
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

  let resultat: PushResult;
  try {
    resultat = await dispatcher.send(message, recipients);
  } catch (error) {
    // Un jeton d'accès refusé n'est pas un envoi qui a échoué : c'est un envoi
    // qui n'a pas eu lieu, et qui n'aura pas lieu tant que le secret n'est pas
    // remplacé. Deux conséquences, et la seconde est la plus grave :
    //
    //  - l'erreur est journalisée à un niveau `error`, avec une phrase qui dit
    //    quoi faire. Une alerte de journal peut s'y accrocher ; sans ce message
    //    distinct, elle se confondait avec une panne réseau passagère ;
    //  - elle est **relancée**, donc l'appelant n'écrit ni historique ni
    //    `notifiedAt`. Rien n'affirme qu'un message est parti, et l'incident
    //    remonte dans les journaux Cloud au lieu d'être absorbé.
    if (error instanceof PushCredentialsError) {
      logger.error(
        '[notifications] Jeton d’accès Expo refusé : aucun envoi ne peut aboutir ' +
          'tant qu’il n’a pas été remplacé.',
        { category: message.category, statut: error.statut },
      );
    }

    throw error;
  }

  const purgedTokens = await purgeDeviceTokens(resultat.invalidTokens);

  // L'identifiant est tiré **avant** l'écriture : la table des tickets doit le
  // porter, et un identifiant créé après coup aurait demandé une seconde
  // écriture du document d'historique — donc une fenêtre où les deux ne se
  // connaissent pas.
  const notificationId = adminDb().collection(COLLECTIONS.notifications).doc().id;

  const historiqueEcrit = await writeNotificationLog(journal, message, notificationId, {
    recipientCount: recipients.length,
    accepted: resultat.accepted,
    failed: resultat.failed,
    tickets: resultat.tickets,
  });

  if (historiqueEcrit) {
    await writePushTickets(notificationId, message.data.orgId, resultat.tickets);
  }

  logger.info('[notifications] Envoi terminé', {
    category: message.category,
    recipientCount: recipients.length,
    accepted: resultat.accepted,
    failed: resultat.failed,
    purgedTokens,
    tickets: resultat.tickets.length,
  });

  return {
    recipientCount: recipients.length,
    rejectedCount: rejected.length,
    accepted: resultat.accepted,
    failed: resultat.failed,
    purgedTokens,
  };
}
