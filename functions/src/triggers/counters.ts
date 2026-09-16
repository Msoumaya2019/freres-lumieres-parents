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
 * incontrôlée. Les fonctions ci-dessous n'écrivent que dans `counters`, qui
 * n'a aucun déclencheur : la boucle est impossible par construction.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { FieldValue } from 'firebase-admin/firestore';

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
