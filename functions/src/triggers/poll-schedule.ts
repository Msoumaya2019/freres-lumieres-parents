/**
 * Déclencheur horaire de la clôture des sondages échus.
 *
 * ## Pourquoi cinq minutes, et pas une
 *
 * Le retard n'a aucune conséquence sur la garantie : le vote est fermé par les
 * règles, à la seconde annoncée, que ce passage ait eu lieu ou non. Ce que le
 * retard déplace est l'**enregistrement** de la clôture — donc l'affichage, et
 * la transition de statut sur laquelle la notification se décidera plus tard.
 *
 * Un passage chaque minute gagnerait au plus quatre minutes sur cet
 * enregistrement, et multiplierait par cinq le nombre d'invocations. C'est le
 * même arbitrage que `digest-schedule.ts` et `receipts-schedule.ts`, et pour la
 * même raison : sur une association qui paie ses factures, la différence
 * compte, et quatre minutes ne changent rien à un sondage.
 *
 * ## Pourquoi `timeZone` est fixée
 *
 * Elle n'a aucun effet sur un rythme de cinq minutes, mais l'omettre laisse le
 * champ dans un état implicite que le prochain lecteur devra deviner. Les
 * utilisateurs sont en France ; autant que la question du fuseau soit déjà
 * tranchée le jour où le rythme changera.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { closeDuePolls } from '../polls/close-due.js';

export const onPollsDue = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'Europe/Paris',
    region: 'europe-west1',
  },
  async () => {
    await closeDuePolls();
  },
);
