/**
 * Déclencheur horaire de relecture des reçus Expo.
 *
 * ## Pourquoi une heure, et pas cinq minutes
 *
 * Un reçu reste lisible vingt-quatre heures. Un passage par heure n'en perd donc
 * aucun, alors qu'un passage toutes les cinq minutes multiplierait par douze le
 * nombre d'invocations — pour un résultat identique à quelques minutes près.
 * Sur une association qui paie ses factures, la différence compte.
 *
 * ## Pourquoi le passage ne fait rien la plupart du temps
 *
 * La requête ne ramène que les envois dont les reçus sont mûrs
 * (`receiptsChecked == false` et `sentAt` vieux de plus de quinze minutes). Une
 * association qui publie trois informations par semaine laisse donc cette
 * fonction tourner à vide la quasi-totalité du temps : une lecture d'index, et
 * rien de plus.
 *
 * ## Pourquoi `timeZone` est fixée
 *
 * Elle n'a aucun effet sur un rythme horaire, mais l'omettre laisse le champ
 * dans un état implicite que le prochain lecteur devra deviner. Les utilisateurs
 * sont en France ; le jour où le rythme deviendra quotidien, la question du
 * fuseau se posera — autant qu'elle soit déjà tranchée.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { readPendingReceipts } from '../notifications/receipts.js';

export const onReceiptsDue = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: 'Europe/Paris',
    region: 'europe-west1',
  },
  async () => {
    await readPendingReceipts();
  },
);
