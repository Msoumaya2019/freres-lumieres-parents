/**
 * Clôture des sondages dont l'échéance annoncée est passée.
 *
 * ## Ce module n'est pas ce qui ferme le vote
 *
 * Le vote est fermé depuis la seconde annoncée, et sans lui : les règles
 * Firestore comparent `endsAt` à `request.time`, si bien qu'un sondage échu
 * refuse les votes **et** publie ses résultats. Ce passage ne fait
 * qu'**enregistrer** ce qui est déjà vrai — `status: 'closed'` et `closedAt`.
 *
 * Pourquoi l'enregistrer, alors ? Parce qu'un état déduit d'une horloge n'est
 * pas un état : l'écran d'administration doit pouvoir montrer un sondage clos,
 * et le déclencheur de notification doit raisonner sur une **transition de
 * statut**. Une horloge ne produit pas de transition, donc ne notifie rien.
 *
 * C'est aussi ce qui rend le planificateur non critique. S'il passait en
 * retard, ou pas du tout, aucun vote ne se glisserait après l'heure dite. Le
 * pire défaut possible est un sondage affiché « ouvert » qui refuse les votes :
 * visible, et réparable en le clôturant à la main. Le défaut inverse — un vote
 * accepté après l'heure annoncée — changerait le résultat lui-même, et c'est
 * précisément pour cela que la garantie est dans la règle.
 *
 * ## Un sondage sans échéance n'est jamais ramené
 *
 * Firestore écarte de `endsAt <= maintenant` les documents qui ne portent pas
 * le champ. Un sondage sans date de clôture n'est donc jamais clos
 * automatiquement — ce qui est exactement voulu : seule la FCPE peut le clore.
 * C'est une règle du service, et non une précaution d'écriture : la requête
 * l'applique, et `FauxFirestore` la reproduit plutôt que de l'approximer.
 *
 * ## La borne, et ce qu'elle garantit en plus du coût
 *
 * Un passage traite au plus `MAX_SONDAGES_PAR_PASSAGE` sondages, comme
 * `flushChannelDigests`. La borne n'est pas qu'une question de facture : c'est
 * elle qui rend un chevauchement de deux passages impossible, et donc
 * l'écriture **idempotente sans transaction**. Vingt écritures prennent
 * quelques millisecondes, la fonction est planifiée toutes les cinq minutes et
 * son délai est d'une minute : deux passages ne peuvent pas se croiser. Une
 * transaction coûterait une lecture de plus par sondage pour couvrir un cas que
 * la borne interdit.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';

import { adminDb } from '../lib/admin.js';
import { COLLECTIONS, paths } from '../lib/paths.js';

/** Nombre de sondages traités au plus par passage. */
const MAX_SONDAGES_PAR_PASSAGE = 20;

/** Ce qu'un passage a fait, pour le journal. */
export interface PollClosingReport {
  /** Sondages ramenés par la requête. */
  examined: number;
  /** Sondages clos par ce passage. */
  closed: number;
}

/**
 * Enregistre la clôture des sondages dont l'échéance est passée.
 *
 * `maintenant` est un paramètre plutôt qu'une lecture d'horloge, pour la même
 * raison que `db` : un test qui doit placer une échéance « juste avant » et
 * « juste après » la borne ne peut pas le faire contre l'horloge réelle sans
 * devenir instable.
 */
export async function closeDuePolls(
  db: Firestore = adminDb(),
  maintenant: Date = new Date(),
): Promise<PollClosingReport> {
  // Égalité **puis** inégalité : c'est cet ordre qui exige l'index composite
  // `polls(status, endsAt)`, déclaré dans `firebase/firestore.indexes.json` et
  // tenu par un test qui lit la requête et l'index. Un index simple ne suffit
  // plus dès que deux champs sont contraints.
  const echus = await db
    .collection(COLLECTIONS.polls)
    .where('status', '==', 'open')
    .where('endsAt', '<=', maintenant)
    .limit(MAX_SONDAGES_PAR_PASSAGE)
    .get();

  const rapport: PollClosingReport = { examined: 0, closed: 0 };

  for (const document of echus.docs) {
    rapport.examined += 1;

    // `merge: true` par principe, et non par nécessité : sans lui, l'écriture
    // **remplacerait** le document, et la question du sondage disparaîtrait.
    // C'est le même geste que `PollRepository.close`, pour que les deux chemins
    // — la FCPE et le planificateur — écrivent exactement la même chose.
    await db
      .doc(paths.poll(document.id))
      .set({ status: 'closed', closedAt: maintenant, updatedAt: maintenant }, { merge: true });
    rapport.closed += 1;
  }

  if (rapport.examined > 0) {
    logger.info('[closeDuePolls] Passage terminé', { ...rapport });
  }

  return rapport;
}
