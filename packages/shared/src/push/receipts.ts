/**
 * Lecture des reçus Expo Push : la décision, sans le réseau.
 *
 * ## Pourquoi cette fonction est séparée de l'appel HTTP
 *
 * Le compte rendu d'un envoi est ce que l'administration affiche. Il se trompe
 * silencieusement : un nombre faux ne lève rien, ne casse rien, et masque
 * précisément ce qu'on veut voir — combien de parents ont réellement reçu
 * l'information. Séparer le comptage de l'appel réseau le rend éprouvable ligne
 * à ligne, sans simuler `fetch` ni attendre quinze minutes.
 *
 * ## Les trois réponses possibles, et la quatrième
 *
 * Un identifiant demandé tombe dans exactement un cas :
 *
 *  - le reçu dit `ok` → **remis** à FCM ou APNs ;
 *  - le reçu dit `error` → **échoué**, et `DeviceNotRegistered` désigne en plus
 *    un appareil à retirer de l'index ;
 *  - **aucun reçu** → **en attente**. Le service omet simplement les
 *    identifiants dont il n'a pas encore la réponse ; il ne rend jamais un reçu
 *    vide. Compter ces identifiants comme livrés aurait inventé des livraisons,
 *    les compter comme échoués aurait inventé des pannes.
 *
 * La quatrième est un statut que le service n'envoie pas — une évolution de son
 * vocabulaire. Il est compté **échoué**, jamais livré : un reçu qu'on ne sait
 * pas lire n'est pas une confirmation de remise, et se tromper dans ce sens-là
 * fait annoncer des parents informés qui ne le sont pas.
 *
 * ## L'invariant
 *
 * `delivered + failed + pending === ticketIds.length`, toujours. Il n'est pas
 * décoratif : c'est lui qui interdit qu'un identifiant disparaisse du compte
 * rendu sans que personne ne le voie.
 */
import type { PushReceipts } from './dispatcher.js';

/** Un reçu, tel que le service le rend. */
export interface ExpoPushReceipt {
  status: 'ok' | 'error';
  message?: string;
  /** Erreur normalisée du transport, quand il y en a une. */
  details?: { error?: string };
}

/** Erreur qui signifie que l'appareil ne recevra plus rien, définitivement. */
export const ERREUR_JETON_MORT = 'DeviceNotRegistered';

/**
 * Compte les reçus d'un lot d'identifiants.
 *
 * @param ticketIds identifiants demandés — la référence, pas la réponse
 * @param data      table rendue par le service, indexée par identifiant
 */
export function summariseReceipts(
  ticketIds: readonly string[],
  data: Readonly<Record<string, ExpoPushReceipt | undefined>>,
): PushReceipts {
  let delivered = 0;
  let failed = 0;
  let pending = 0;
  const deadTicketIds: string[] = [];

  for (const id of ticketIds) {
    const receipt = data[id];

    if (!receipt) {
      pending += 1;
      continue;
    }

    if (receipt.status === 'ok') {
      delivered += 1;
      continue;
    }

    failed += 1;
    if (receipt.details?.error === ERREUR_JETON_MORT) deadTicketIds.push(id);
  }

  return { delivered, failed, pending, deadTicketIds };
}
