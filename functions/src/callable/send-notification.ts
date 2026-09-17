/**
 * Envoi d'une annonce écrite à la main.
 *
 * ## Pourquoi une fonction appelable, et pas une écriture Firestore
 *
 * Envoyer une notification demande l'Admin SDK : lire les jetons de tous les
 * appareils d'une audience, appeler le service Expo, purger les appareils
 * disparus, écrire l'historique. Aucun client ne peut faire cela, et c'est
 * heureux — les règles de `notifications` refusent d'ailleurs toute écriture
 * cliente, administrateur compris.
 *
 * ## Ce que cette fonction ne décide pas
 *
 * Ni le contenu du message, ni la priorité, ni les clés d'audience :
 * `manual-plan.ts` les calcule, et il est pur donc éprouvable sans émulateur.
 * Ici il ne reste que l'ordre des vérifications et le journal d'audit.
 *
 * ## L'ordre des vérifications
 *
 * 1. l'appelant est identifié **en base** (`resolveCaller`) ;
 * 2. il détient `notification.send` ;
 * 3. l'entrée passe le schéma partagé, le même que celui du formulaire ;
 * 4. l'audience désigne quelqu'un.
 *
 * La permission est vérifiée **avant** la validation de l'entrée, comme dans
 * les autres fonctions d'administration : un appelant sans droit n'a pas à
 * apprendre, par un message d'erreur détaillé, quelle forme d'entrée est
 * attendue.
 *
 * ## Le journal d'audit est écrit dans tous les cas
 *
 * Y compris quand l'envoi est interrompu. Un jeton d'accès Expo expiré fait
 * lever `sendToAudience` sans rien écrire dans l'historique des envois : sans
 * cette écriture-ci, une tentative d'annonce urgente à huit cents téléphones
 * ne laisserait **aucune trace attribuable**. Or c'est précisément le geste
 * qu'un journal d'audit existe pour rendre visible.
 *
 * Le compte rendu est donc écrit une fois, après la tentative, avec son issue
 * dans les métadonnées — et `targetId` porte l'organisation, qui existe avant
 * comme après. Désigner le document d'historique serait plus précis, mais il
 * n'existe pas encore à l'instant où l'envoi échoue.
 *
 * ## Qui peut envoyer une urgence
 *
 * Tout détenteur de `notification.send` : `fcpe`, `moderator`, `admin`. C'est
 * exactement l'ensemble qui peut déjà publier une information urgente, donc
 * restreindre ici ne fermerait rien. La contrepartie est ce journal — nom de
 * l'auteur, catégorie, audience, et issue.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { hasPermission, notificationSendSchema } from '@fl/shared';

import { resolveCaller } from '../lib/caller.js';
import { writeAuditLog } from '../lib/audit.js';
import { ADMIN_ACTIONS } from '../lib/paths.js';
import {
  TYPE_ANNONCE_MANUELLE,
  manualNotificationPlan,
  manualPushMessage,
} from '../notifications/manual-plan.js';
import { sendToAudience, type SendOutcome } from '../notifications/send.js';

const REGION = 'europe-west1';

export const sendManualNotification = onCall({ region: REGION }, async (request) => {
  const caller = await resolveCaller(request.auth);

  if (!hasPermission(caller.role, 'notification.send')) {
    throw new HttpsError(
      'permission-denied',
      'Vous n’êtes pas autorisé à envoyer une notification.',
    );
  }

  const parsed = notificationSendSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Demande invalide.');
  }

  const plan = manualNotificationPlan(parsed.data, {
    uid: caller.uid,
    name: caller.name,
    orgId: caller.orgId,
  });

  if (!plan) {
    // Une audience que le schéma accepte mais dont aucune clé ne se déduit ne
    // concerne personne. Le dire vaut mieux que d'envoyer à zéro appareil et
    // d'écrire une ligne d'historique qui se lirait comme un échec.
    throw new HttpsError('failed-precondition', 'Cette audience ne désigne personne.');
  }

  /** Contexte commun aux deux issues, pour n'avoir qu'une seule forme à tenir. */
  const contexte = {
    category: plan.category,
    audience: plan.audience.type,
    title: plan.title,
    audienceKeys: plan.audienceKeys,
  };

  let outcome: SendOutcome;
  try {
    outcome = await sendToAudience({
      message: manualPushMessage(plan),
      journal: {
        type: TYPE_ANNONCE_MANUELLE,
        audience: plan.audience,
        sourceType: 'manual',
        ...(plan.deeplink ? { deeplink: plan.deeplink } : {}),
        sentBy: plan.sentBy,
        sentByName: plan.sentByName,
      },
    });
  } catch (error) {
    await writeAuditLog({
      actorId: caller.uid,
      actorName: caller.name,
      actorRole: caller.role,
      action: ADMIN_ACTIONS.notificationSend,
      targetType: 'organization',
      targetId: caller.orgId,
      metadata: {
        ...contexte,
        issue: 'interrompu',
        error: error instanceof Error ? error.message : String(error),
      },
    });

    logger.error('[sendManualNotification] Envoi interrompu', {
      actorId: caller.uid,
      category: plan.category,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }

  await writeAuditLog({
    actorId: caller.uid,
    actorName: caller.name,
    actorRole: caller.role,
    action: ADMIN_ACTIONS.notificationSend,
    targetType: 'organization',
    targetId: caller.orgId,
    metadata: {
      ...contexte,
      issue: 'envoyé',
      notificationId: outcome.notificationId,
      recipientCount: outcome.recipientCount,
      acceptedCount: outcome.accepted,
      failedCount: outcome.failed,
      purgedTokens: outcome.purgedTokens,
    },
  });

  logger.info('[sendManualNotification] Annonce envoyée', {
    actorId: caller.uid,
    category: plan.category,
    recipientCount: outcome.recipientCount,
    accepted: outcome.accepted,
    failed: outcome.failed,
  });

  return {
    ok: true,
    recipientCount: outcome.recipientCount,
    acceptedCount: outcome.accepted,
    failedCount: outcome.failed,
    purgedTokens: outcome.purgedTokens,
    notificationId: outcome.notificationId,
  };
});
