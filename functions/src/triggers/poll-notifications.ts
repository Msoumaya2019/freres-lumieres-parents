/**
 * Notification à l'ouverture d'un sondage.
 *
 * ## Pourquoi `onDocumentWritten` et pas `onDocumentCreated`
 *
 * Un sondage peut naître `open` — publié d'un seul geste — ou le devenir : c'est
 * le cas d'un brouillon préparé la veille pour le lendemain, que la FCPE ouvre
 * plus tard. Un déclencheur de création raterait le second chemin, un
 * déclencheur de mise à jour le premier. `onDocumentWritten` couvre les deux, et
 * c'est `pollNotificationPlan` qui ramène les deux cas à une seule règle : le
 * statut **devient** `open`.
 *
 * ## Ce déclencheur est le seul écrivain de `notifiedAt`
 *
 * Les règles ferment le champ côté client, et il faut **les deux clauses** :
 * `absent('notifiedAt')` à la création, `unchangedOptional('notifiedAt')`
 * ensuite. La seconde seule ne dit rien d'une création — il n'y a pas de
 * `resource` à comparer — et un membre de la FCPE pouvait donc le poser sur le
 * document qu'il venait d'écrire et faire taire la notification de son propre
 * sondage : le plan le lit pour décider. Voir `Poll.notifiedAt`.
 *
 * ## Pourquoi la chaîne s'arrête
 *
 * Le déclencheur écrit `notifiedAt` dans le document qu'il écoute, donc il est
 * rappelé. La seconde invocation trouve `before.status == 'open'` et sort sans
 * rien lire ni écrire. Deux gardes indépendantes l'arrêtent — le changement de
 * statut et `notifiedAt` — parce que la première protège du cas normal et la
 * seconde du **rejeu**, que Firestore peut produire seul.
 *
 * ## Pourquoi le profil est lu avant de décider
 *
 * Le nom de l'auteur n'est pas sur le document, et le journal d'envoi l'exige.
 * La lecture est conditionnée au seul statut `open` : ce n'est pas une seconde
 * règle, c'est la **première clause** du plan lue seule — elle suffit à éviter
 * une lecture de profil sur les écritures qui ne peuvent pas notifier, et elles
 * sont les plus nombreuses. Le balayage planifié inscrit la clôture des sondages
 * échus toutes les cinq minutes, la FCPE clôt à la main, une question se
 * corrige : aucune ne fait devenir `open`.
 *
 * Une lecture de profil par ouverture de sondage — quelques dizaines par an —
 * est sans commune mesure avec un envoi, et l'alternative serait de recopier la
 * règle de transition dans le déclencheur, c'est-à-dire d'en faire une seconde
 * source.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { adminDb } from '../lib/admin.js';
import { nomDuProfil } from '../lib/caller.js';
import { paths } from '../lib/paths.js';
import { pollNotificationPlan, pollPushMessage } from '../notifications/poll-plan.js';
import { sendToAudience } from '../notifications/send.js';

/**
 * Nom de l'auteur du sondage, lu sur son profil.
 *
 * Le document ne le porte pas — `createPoll` a délibérément refusé d'y recopier
 * un nom qu'aucune règle ne vérifie. Un profil supprimé rend `null` plutôt que
 * de lever : le plan se replie alors sur « La FCPE », et le sondage qu'il avait
 * préparé part quand même.
 */
async function nomDeLAuteur(poll: Record<string, unknown>): Promise<string | null> {
  const uid = poll.createdBy;
  if (typeof uid !== 'string' || uid.length === 0) return null;

  const snapshot = await adminDb().doc(paths.user(uid)).get();
  return nomDuProfil(snapshot.data());
}

/**
 * À l'ouverture : notifier l'audience du sondage.
 *
 * Les déclencheurs Firestore s'exécutent au moins une fois. Le marquage a lieu
 * **après** l'envoi, et non avant : marquer d'abord puis échouer laisserait le
 * sondage marqué comme notifié alors que personne n'a rien reçu — une perte
 * silencieuse, pire qu'un doublon.
 *
 * Aucune reprise automatique n'est demandée, comme pour les publications : une
 * erreur permanente — index manquant, requête invalide — ferait réessayer
 * pendant des jours, ce que le budget d'invocations ne permet pas. Un échec
 * reste visible dans les journaux Cloud, et `notifiedAt` dit précisément où
 * l'envoi s'est arrêté.
 */
export const notifyPollAudience = onDocumentWritten(
  { document: 'polls/{pollId}', region: 'europe-west1' },
  async (event) => {
    const pollId = event.params.pollId;
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    const authorName = after?.status === 'open' ? await nomDeLAuteur(after) : null;
    const plan = pollNotificationPlan(pollId, before, after, { authorName });

    if (!plan) return;

    await sendToAudience({
      message: pollPushMessage(plan),
      journal: {
        type: plan.type,
        audience: plan.audience,
        sourceType: 'poll',
        sourceId: plan.sourceId,
        deeplink: plan.deeplink,
        sentBy: plan.authorId,
        sentByName: plan.authorName,
      },
    });

    await adminDb().doc(paths.poll(pollId)).update({
      notifiedAt: FieldValue.serverTimestamp(),
    });
  },
);
