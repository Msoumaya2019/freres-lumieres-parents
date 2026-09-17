/**
 * Déclencheur horaire de l'annonce des lots de discussion.
 *
 * ## Pourquoi cinq minutes, et pas une
 *
 * La fenêtre de regroupement est de cinq minutes : un lot ne peut donc pas être
 * annoncé avant. Un passage chaque minute gagnerait au plus quatre minutes sur
 * le délai, et multiplierait par cinq le nombre d'invocations. C'est le même
 * arbitrage que `receipts-schedule.ts`, où l'heure l'a emporté sur les cinq
 * minutes pour la même raison — sur une association qui paie ses factures, la
 * différence compte, et quatre minutes ne changent rien à une discussion.
 *
 * ## Pourquoi le passage ne fait rien la plupart du temps
 *
 * La requête ne ramène que les lots échus. Un groupe scolaire dont les canaux
 * sont calmes laisse donc cette fonction tourner à vide la quasi-totalité du
 * temps : une lecture d'index, et rien de plus.
 *
 * ## Pourquoi `timeZone` est fixée
 *
 * Elle n'a aucun effet sur un rythme de cinq minutes, mais l'omettre laisse le
 * champ dans un état implicite que le prochain lecteur devra deviner. Les
 * utilisateurs sont en France ; autant que la question du fuseau soit déjà
 * tranchée le jour où le rythme changera.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { flushChannelDigests } from '../notifications/digest-flush.js';

export const onChannelDigestsDue = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'Europe/Paris',
    region: 'europe-west1',
  },
  async () => {
    await flushChannelDigests();
  },
);
