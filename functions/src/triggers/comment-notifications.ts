/**
 * Notification à l'écriture d'un commentaire.
 *
 * ## Pourquoi `onDocumentCreated`, et pas `onDocumentWritten`
 *
 * Un commentaire naît `visible` : les règles l'imposent à la création
 * (`validComment()`), et rien ne le fait naître en attente de modération. Il n'y
 * a donc pas deux chemins à ramener à une seule règle, comme pour une
 * publication — le déclencheur de création suffit.
 *
 * Ce choix est aussi **moins cher**, et c'est ce qui le rend préférable plutôt
 * que seulement plus simple. Une réaction écrit dans le commentaire
 * (`onCommentReactionWritten` y tient son décompte) : un déclencheur d'écriture
 * serait réveillé à chaque réaction posée, pour constater que le statut n'a pas
 * changé. Celui-ci ne les voit même pas passer.
 *
 * ## Ce que le déclencheur lit, et pourquoi
 *
 * Le commentaire ne porte ni l'organisation, ni le titre de la publication, ni
 * l'auteur du commentaire auquel il répond : c'est un document de
 * sous-collection, dont les champs sont ceux de son auteur. Deux lectures les
 * apportent — la publication, toujours ; le commentaire parent, seulement quand
 * il y en a un.
 *
 * La publication est lue même lorsque rien ne sera envoyé, et c'est assumé :
 * l'alternative serait de reprendre ici une partie de la décision — « ce
 * commentaire est-il visible ? a-t-il un auteur ? » — pour économiser une
 * lecture ponctuelle. Deux endroits décideraient alors de la même chose, et
 * c'est précisément ce qui diverge.
 *
 * Une publication supprimée entre la création du commentaire et l'exécution du
 * déclencheur ne fait pas échouer la fonction : la lecture ne rend rien, le plan
 * manque de quoi nommer le fil, et il sort sans envoyer. Le commentaire, lui, a
 * bien été écrit — mais il ne reste personne à prévenir.
 *
 * ## Pourquoi rien n'est marqué sur le commentaire
 *
 * Le déclencheur de publication écrit `notifiedAt` dans le document qu'il
 * écoute, et c'est cette écriture qu'une seconde garde arrête. Ici, rien n'est
 * écrit dans le commentaire : la fonction ne se réveille pas elle-même, et il
 * n'y a aucune boucle à interrompre.
 *
 * Reste le **rejeu** d'un même événement. Les reprises ne sont pas activées sur
 * ce projet — `retry` vaut `false` par défaut pour les déclencheurs
 * d'événement, et aucune fonction ne l'active —, donc une invocation qui échoue
 * n'est pas rejouée. Et une garde lue dans la charge de l'événement ne verrait
 * de toute façon pas le marquage, puisqu'un rejeu rejoue la charge d'origine ;
 * seule une relecture en base le verrait, au prix d'une lecture sur le
 * déclencheur le plus fréquent du projet. Ce coût est refusé sciemment.
 */
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

import { adminDb } from '../lib/admin.js';
import { paths } from '../lib/paths.js';
import {
  commentNotificationPlan,
  commentPushMessage,
  parentIdOf,
} from '../notifications/comment-plan.js';
import { sendToUser } from '../notifications/send.js';

/**
 * À l'écriture d'un commentaire : prévenir la personne concernée.
 *
 * Une seule personne, jamais une audience : l'auteur de la publication qu'on
 * vient de commenter, ou l'auteur du commentaire auquel on répond. La règle
 * complète — « on ne se notifie jamais soi-même », le repli quand le parent a
 * disparu, le choix du type — vit dans `commentNotificationPlan`, qui s'éprouve
 * sans émulateur.
 *
 * Un `parentId` peut désigner un commentaire d'une autre publication : rien ne
 * l'interdit à l'écriture, et les règles ne le vérifient pas. La lecture ne
 * trouverait alors rien, et le plan retomberait sur l'auteur de la publication —
 * le seul comportement sûr, et le même que pour un parent supprimé.
 *
 * Aucune reprise automatique n'est demandée, pour la même raison que sur la
 * publication : une erreur permanente ferait réessayer pendant des jours, ce que
 * le budget d'invocations ne permet pas.
 */
export const notifyCommentAuthor = onDocumentCreated(
  { document: 'posts/{postId}/comments/{commentId}', region: 'europe-west1' },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const { postId, commentId } = event.params;
    const comment = snapshot.data();
    const parentId = parentIdOf(comment);

    const post = await adminDb().doc(paths.post(postId)).get();

    const parent = parentId ? await adminDb().doc(paths.comment(postId, parentId)).get() : null;

    const plan = commentNotificationPlan(postId, commentId, comment, {
      orgId: post.get('orgId'),
      postTitle: post.get('title'),
      postAuthorId: post.get('authorId'),
      parentAuthorId: parent?.get('authorId'),
    });

    if (!plan) return;

    await sendToUser({
      uid: plan.targetUid,
      message: commentPushMessage(plan),
      journal: {
        type: plan.type,
        // Aucune audience : l'envoi vise une personne. Recopier celle de la
        // publication ferait décrire au journal un envoi de masse qui n'a pas eu
        // lieu — dans la collection même où l'administration lit ce qui est
        // réellement parti.
        sourceType: 'post',
        sourceId: plan.postId,
        deeplink: plan.deeplink,
        sentBy: plan.authorId,
        sentByName: plan.authorName,
      },
    });
  },
);
