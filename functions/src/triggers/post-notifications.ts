/**
 * Notification à la publication d'une publication.
 *
 * ## Pourquoi `onDocumentWritten` et pas `onDocumentCreated`
 *
 * Une publication peut naître `published` — rédigée puis publiée d'un seul
 * geste — ou le devenir, si elle a d'abord été enregistrée en brouillon. Un
 * déclencheur de création raterait le second cas, un déclencheur de mise à jour
 * le premier. `onDocumentWritten` couvre les deux, et c'est `postNotificationPlan`
 * qui ramène les deux chemins à une seule règle : le statut **devient**
 * `published`.
 *
 * ## Pourquoi la chaîne s'arrête
 *
 * Le déclencheur écrit `notifiedAt` dans le document qu'il écoute, donc il est
 * rappelé. La seconde invocation trouve `before.status == 'published'` et sort
 * sans rien lire ni écrire. Deux gardes indépendantes l'arrêtent — le
 * changement de statut et `notifiedAt` — parce que la première protège du cas
 * normal et la seconde du **rejeu**, que Firestore peut produire seul.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { adminDb } from '../lib/admin.js';
import { paths } from '../lib/paths.js';
import { postNotificationPlan, postPushMessage } from '../notifications/post-plan.js';
import { sendToAudience } from '../notifications/send.js';

/**
 * À la publication : notifier l'audience de la publication.
 *
 * Les déclencheurs Firestore s'exécutent au moins une fois. Le marquage a lieu
 * **après** l'envoi, et non avant : marquer d'abord puis échouer laisserait la
 * publication marquée comme notifiée alors que personne n'a rien reçu — une
 * perte silencieuse, pire qu'un doublon.
 *
 * Aucune reprise automatique n'est demandée : une erreur permanente — index
 * manquant, requête invalide — ferait réessayer pendant des jours, ce que le
 * budget d'invocations ne permet pas. Un échec reste visible dans les journaux
 * Cloud, et le champ `notifiedAt` dit précisément où l'envoi s'est arrêté.
 */
export const onPostPublished = onDocumentWritten(
  { document: 'posts/{postId}', region: 'europe-west1' },
  async (event) => {
    const postId = event.params.postId;
    const plan = postNotificationPlan(postId, event.data?.before.data(), event.data?.after.data());

    if (!plan) return;

    const outcome = await sendToAudience({
      message: postPushMessage(plan),
      journal: {
        type: plan.type,
        audience: plan.audience,
        sourceType: 'post',
        sourceId: plan.sourceId,
        deeplink: plan.deeplink,
        sentBy: plan.authorId,
        sentByName: plan.authorName,
      },
    });

    await adminDb().doc(paths.post(postId)).update({
      notifiedAt: FieldValue.serverTimestamp(),
      'stats.notifiedCount': outcome.delivered,
    });
  },
);
