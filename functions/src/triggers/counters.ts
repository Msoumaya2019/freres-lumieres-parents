/**
 * Maintenance des compteurs agrégés.
 *
 * ## Le problème que ces fonctions résolvent
 *
 * Afficher « 4 signalements ouverts » sur le tableau de bord nécessiterait
 * normalement une requête d'agrégation — facturée, et lente si la collection
 * est volumineuse. Le tableau de bord serait alors l'écran le plus coûteux de
 * l'application, alors qu'il est ouvert à chaque connexion de la FCPE.
 *
 * ## La solution
 *
 * Un document unique `counters/{orgId}`, mis à jour par incréments à chaque
 * changement. Le tableau de bord coûte **une seule lecture**, quel que soit
 * le nombre de signalements.
 *
 * ## Le piège à éviter
 *
 * Une Cloud Function qui écrirait dans une collection elle-même écoutée par
 * une autre Cloud Function peut provoquer une cascade d'invocations
 * incontrôlée. Chaque déclencheur ci-dessous est donc relié explicitement à ce
 * qu'il écrit, et la chaîne se termine toujours :
 *
 * ```
 * reports/{id}                → counters/{orgId}        (aucun déclencheur)
 * posts/{id}/comments/{cid}   → posts/{id}              (aucun déclencheur)
 * .../comments/{cid}/reactions/{uid}
 *                             → posts/{id}/comments/{cid}
 *                             → onCommentWritten, delta nul, s'arrête
 * ```
 *
 * La dernière ligne est la seule qui réveille une autre fonction : le
 * décompte de réactions écrit dans le commentaire, ce qui déclenche
 * `onCommentWritten`. Comme le statut du commentaire n'a pas changé, le delta
 * vaut zéro et la fonction sort immédiatement — une invocation, aucune
 * lecture, aucune écriture. Il n'existe donc aucune boucle.
 *
 * ## Ce qui n'est pas encore tenu
 *
 * `initializeCounters` déclare des champs que rien ne met à jour
 * (`postsLast7Days`, `users.activeLast7Days`, `openPolls`, `upcomingEvents`,
 * `moderationQueueOpen`, …). Ce n'est pas un oubli : ces compteurs dépendent
 * de fonctionnalités qui n'existent pas encore (sondages, événements, conseils
 * d'école). Les seuls tenus aujourd'hui sont les signalements, le nombre de
 * commentaires d'une publication et le décompte des réactions — c'est-à-dire
 * ceux dont l'absence se voit à l'écran.
 *
 * Un compteur glissant (`…Last7Days`) ne peut pas se déduire d'un incrément :
 * rien ne le décrémente quand la fenêtre avance. Il demandera un recalcul
 * planifié, pas un déclencheur d'écriture.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { FieldValue, type DocumentData } from 'firebase-admin/firestore';

import { isReactionEmoji } from '@fl/shared';
import type { ReportStatus } from '@fl/types';

import { adminDb } from '../lib/admin.js';
import { paths } from '../lib/paths.js';

/** Statuts considérés comme « en cours de traitement » dans les compteurs. */
const OPEN_STATUSES: readonly ReportStatus[] = ['received', 'in_progress'];
const IN_PROGRESS_STATUSES: readonly ReportStatus[] = ['forwarded_school', 'forwarded_city'];

function isOpen(status: unknown): boolean {
  return typeof status === 'string' && OPEN_STATUSES.includes(status as ReportStatus);
}

function isInProgress(status: unknown): boolean {
  return typeof status === 'string' && IN_PROGRESS_STATUSES.includes(status as ReportStatus);
}

/**
 * Met à jour les compteurs de signalements.
 *
 * On calcule le **delta** plutôt que de recompter : la fonction reste
 * exacte quel que soit l'ordre d'arrivée des événements, et son coût ne
 * dépend pas du volume de la collection.
 */
export const onReportWritten = onDocumentWritten(
  { document: 'reports/{reportId}', region: 'europe-west1' },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    const orgId = (after?.orgId ?? before?.orgId) as string | undefined;
    if (!orgId) return;

    const openDelta = (isOpen(after?.status) ? 1 : 0) - (isOpen(before?.status) ? 1 : 0);
    const inProgressDelta =
      (isInProgress(after?.status) ? 1 : 0) - (isInProgress(before?.status) ? 1 : 0);

    if (openDelta === 0 && inProgressDelta === 0) return;

    await adminDb()
      .doc(paths.counter(orgId))
      .set(
        {
          moderation: {
            reportsOpen: FieldValue.increment(openDelta),
            reportsInProgress: FieldValue.increment(inProgressDelta),
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

    logger.info('[onReportWritten] Compteurs de signalements mis à jour', {
      orgId,
      openDelta,
      inProgressDelta,
    });
  },
);

/**
 * Compteur de commentaires d'une publication.
 *
 * ## Pourquoi il n'est pas écrit par le client
 *
 * `posts/{postId}` n'est modifiable que par la FCPE (`isFcpe()` dans les
 * règles). Un parent qui commentait voyait donc son second écrit — le
 * compteur — refusé : le commentaire était bien créé, l'interface signalait un
 * échec pour une action réussie, et le compteur restait à zéro. La règle est
 * la bonne (un parent ne doit pas modifier la publication d'autrui) ; c'est
 * l'écriture côté client qui était fautive.
 *
 * ## Ce qui est compté
 *
 * Un commentaire supprimé est un **masquage** (`status: 'deleted'`), pas un
 * `delete` : sans le test sur `status`, masquer un commentaire ne décrémenterait
 * rien et le fil annoncerait un décompte trop élevé. La fonction compare l'état
 * avant et après plutôt que de recompter, comme `onReportWritten`.
 *
 * ## Cascade
 *
 * Cette fonction écrit dans `posts/{postId}`, qui n'a aucun déclencheur. Une
 * réaction écrit dans le commentaire, ce qui réveille cette fonction — mais le
 * delta vaut alors zéro, donc elle s'arrête sans lire ni écrire.
 */
export const onCommentWritten = onDocumentWritten(
  { document: 'posts/{postId}/comments/{commentId}', region: 'europe-west1' },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    const delta = (isCountedComment(after) ? 1 : 0) - (isCountedComment(before) ? 1 : 0);
    if (delta === 0) return;

    const postId = event.params.postId;
    const post = adminDb().doc(paths.post(postId));

    // Le commentaire ne peut naître que sous une publication existante (les
    // règles l'imposent), mais la publication a pu être supprimée entre-temps.
    // Sans cette vérification, `set(..., { merge: true })` créerait un document
    // fantôme ne contenant qu'un compteur.
    if (!(await post.get()).exists) {
      logger.warn('[onCommentWritten] Publication absente, compteur ignoré', { postId });
      return;
    }

    await post.set({ stats: { commentCount: FieldValue.increment(delta) } }, { merge: true });

    logger.info('[onCommentWritten] Compteur de commentaires mis à jour', { postId, delta });
  },
);

/**
 * Décompte des réactions d'un commentaire.
 *
 * La sous-collection `reactions/{uid}` est la **source de vérité** : elle rend
 * le doublon structurellement impossible et un client ne peut pas la falsifier.
 * Le champ `reactions` du commentaire n'est qu'un cache d'affichage, que ce
 * déclencheur tient à jour.
 *
 * Un écart est possible si un événement est livré deux fois — les
 * déclencheurs Firestore sont « au moins une fois ». Le choix de l'incrément
 * plutôt que du recomptage est délibéré : il coûte zéro lecture, alors que
 * recompter la sous-collection coûterait une lecture par réaction affichée, à
 * chaque réaction posée. La contrepartie est assumée et réparable : effacer
 * les champs `reactions` puis rejouer les sous-collections redonne un décompte
 * exact, puisque la vérité est ailleurs.
 *
 * L'emoji hors liste est ignoré plutôt que compté : `@fl/shared` et les règles
 * de sécurité partagent la même liste, et une clé inventée ne doit pas
 * apparaître dans le cache.
 */
export const onCommentReactionWritten = onDocumentWritten(
  { document: 'posts/{postId}/comments/{commentId}/reactions/{uid}', region: 'europe-west1' },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    const beforeEmoji = reactionEmoji(before);
    const afterEmoji = reactionEmoji(after);

    // `unchanged` couvre le cas le plus fréquent : une réécriture identique
    // (retry du client, fusion de deux écritures) ne doit rien modifier.
    if (beforeEmoji === afterEmoji) return;

    const { postId, commentId } = event.params;
    const comment = adminDb().doc(paths.comment(postId, commentId));

    if (!(await comment.get()).exists) {
      logger.warn('[onCommentReactionWritten] Commentaire absent, décompte ignoré', {
        postId,
        commentId,
      });
      return;
    }

    const updates: Record<string, FieldValue> = {};
    if (beforeEmoji) updates[`reactions.${beforeEmoji}`] = FieldValue.increment(-1);
    if (afterEmoji) updates[`reactions.${afterEmoji}`] = FieldValue.increment(1);

    if (Object.keys(updates).length === 0) return;

    await comment.set(updates, { merge: true });

    logger.info('[onCommentReactionWritten] Décompte mis à jour', {
      postId,
      commentId,
      beforeEmoji,
      afterEmoji,
    });
  },
);

/** Un commentaire compte tant qu'il n'est pas masqué. Un document absent ne compte pas. */
function isCountedComment(data: DocumentData | undefined): boolean {
  return data?.status !== undefined && data.status !== 'deleted';
}

/** Emoji d'une réaction, ou `null` si absent ou hors liste. */
function reactionEmoji(data: DocumentData | undefined): string | null {
  const emoji = data?.emoji;
  return typeof emoji === 'string' && isReactionEmoji(emoji) ? emoji : null;
}

/**
 * Initialise le document de compteurs d'une organisation.
 *
 * Utile lors de la création d'une nouvelle organisation : sans ce document,
 * le tableau de bord afficherait « statistiques non disponibles » jusqu'à la
 * première écriture métier.
 */
export async function initializeCounters(orgId: string): Promise<void> {
  await adminDb()
    .doc(paths.counter(orgId))
    .set(
      {
        users: {
          total: 0,
          pending: 0,
          active: 0,
          suspended: 0,
          rejected: 0,
          activeLast7Days: 0,
        },
        content: {
          postsPublished: 0,
          postsLast7Days: 0,
          commentsTotal: 0,
          messagesTotal: 0,
        },
        moderation: {
          reportsOpen: 0,
          reportsInProgress: 0,
          moderationQueueOpen: 0,
        },
        engagement: {
          openPolls: 0,
          openCollectiveIssues: 0,
          upcomingEvents: 0,
          pendingCouncilQuestions: 0,
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}
