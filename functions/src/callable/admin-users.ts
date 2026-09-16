/**
 * Actions d'administration sur les comptes.
 *
 * ## Pourquoi ces actions ne sont pas de simples écritures Firestore
 *
 * Approuver un compte, le suspendre ou changer son rôle modifie les **Custom
 * Claims**, que seul l'Admin SDK peut écrire. Une Cloud Function est donc
 * obligatoire — et c'est une bonne chose : cela place toutes les décisions
 * d'autorisation au même endroit, avec une seule implémentation à auditer.
 *
 * ## Défense en profondeur
 *
 * Chaque fonction :
 *  1. vérifie que l'appelant est authentifié (`request.auth`) ;
 *  2. **relit son rôle et son statut en base** plutôt que de se fier au
 *     jeton, qui peut avoir jusqu'à une heure de retard ;
 *  3. valide les entrées avec le même schéma Zod que le client ;
 *  4. journalise l'action dans `adminLogs`.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { FieldValue } from 'firebase-admin/firestore';

import { hasPermission } from '@fl/shared';
import type { UserRole, UserStatus } from '@fl/types';
import { userRoleUpdateSchema, userStatusUpdateSchema } from '@fl/shared';

import { adminAuth, adminDb } from '../lib/admin.js';
import { diffContext, writeAuditLog } from '../lib/audit.js';
import { ADMIN_ACTIONS, paths } from '../lib/paths.js';
import { syncUserClaims, type ClaimsSource } from '../auth/claims.js';

const REGION = 'europe-west1';

interface CallerContext {
  uid: string;
  name: string;
  role: UserRole;
  orgId: string;
}

/**
 * Identifie l'appelant à partir de la **base de données**, pas du jeton.
 *
 * Un administrateur fraîchement rétrogradé pourrait sinon continuer à agir
 * pendant près d'une heure avec son ancien jeton.
 */
async function resolveCaller(auth: { uid: string } | undefined): Promise<CallerContext> {
  if (!auth?.uid) {
    throw new HttpsError('unauthenticated', 'Vous devez être connecté.');
  }

  const snapshot = await adminDb().doc(paths.user(auth.uid)).get();
  if (!snapshot.exists) {
    throw new HttpsError('permission-denied', 'Profil introuvable.');
  }

  const data = snapshot.data() ?? {};
  const role = data.role as UserRole | undefined;
  const status = data.status as UserStatus | undefined;
  const orgId = data.orgId as string | undefined;

  if (status !== 'active' || !role || !orgId) {
    throw new HttpsError('permission-denied', 'Votre compte doit être actif.');
  }

  return {
    uid: auth.uid,
    name: `${data.firstName ?? ''} ${data.lastName ?? ''}`.trim() || 'Administrateur',
    role,
    orgId,
  };
}

/** Charge le profil cible et vérifie qu'il appartient à la même organisation. */
async function resolveTarget(targetUid: string, caller: CallerContext) {
  const ref = adminDb().doc(paths.user(targetUid));
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    throw new HttpsError('not-found', 'Cet utilisateur n’existe pas.');
  }

  const data = snapshot.data() ?? {};

  if (data.orgId !== caller.orgId) {
    // Un administrateur ne peut agir que sur sa propre organisation. Sans ce
    // contrôle, un administrateur d'une organisation pourrait modifier les
    // comptes d'une autre.
    throw new HttpsError(
      'permission-denied',
      'Cet utilisateur appartient à une autre organisation.',
    );
  }

  if (targetUid === caller.uid) {
    throw new HttpsError('failed-precondition', 'Vous ne pouvez pas modifier votre propre compte.');
  }

  return { ref, data };
}

// ===========================================================================
//  Changement de statut : approuver, refuser, suspendre, réactiver
// ===========================================================================

export const adminSetUserStatus = onCall({ region: REGION }, async (request) => {
  const caller = await resolveCaller(request.auth);

  const parsed = userStatusUpdateSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Demande invalide.');
  }

  const { status, reason } = parsed.data;
  const { uid: targetUid } = request.data as { uid?: string };
  if (!targetUid) {
    throw new HttpsError('invalid-argument', 'Identifiant utilisateur manquant.');
  }

  const permission =
    status === 'active' ? 'user.approve' : status === 'suspended' ? 'user.suspend' : 'user.approve';

  if (!hasPermission(caller.role, permission)) {
    throw new HttpsError('permission-denied', 'Action non autorisée.');
  }

  const { ref, data } = await resolveTarget(targetUid, caller);

  await ref.update({
    status,
    statusReason: reason ?? FieldValue.delete(),
    ...(status === 'active'
      ? { approvedAt: FieldValue.serverTimestamp(), approvedBy: caller.uid }
      : {}),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Application immédiate aux droits réels. En cas de suspension, la
  // révocation des jetons déconnecte l'utilisateur sans attendre l'expiration.
  const claimsSource: ClaimsSource = {
    role: (data.role as UserRole) ?? 'parent',
    status,
    orgId: (data.orgId as string) ?? caller.orgId,
    orgIds: Array.isArray(data.orgIds) ? (data.orgIds as string[]) : [caller.orgId],
  };
  await syncUserClaims(targetUid, claimsSource);

  const action =
    status === 'active'
      ? data.status === 'suspended'
        ? ADMIN_ACTIONS.userReactivate
        : ADMIN_ACTIONS.userApprove
      : status === 'suspended'
        ? ADMIN_ACTIONS.userSuspend
        : ADMIN_ACTIONS.userReject;

  await writeAuditLog({
    actorId: caller.uid,
    actorName: caller.name,
    actorRole: caller.role,
    action,
    targetType: 'user',
    targetId: targetUid,
    metadata: { ...diffContext(data, { status }, ['status']), reason: reason ?? null },
  });

  logger.info('[adminSetUserStatus] Statut modifié', { targetUid, from: data.status, to: status });

  return { ok: true, status };
});

// ===========================================================================
//  Changement de rôle
// ===========================================================================

export const adminSetUserRole = onCall({ region: REGION }, async (request) => {
  const caller = await resolveCaller(request.auth);

  // Seul un administrateur peut distribuer des rôles : c'est la permission
  // la plus sensible du système.
  if (!hasPermission(caller.role, 'user.role.change')) {
    throw new HttpsError('permission-denied', 'Seul un administrateur peut modifier un rôle.');
  }

  const parsed = userRoleUpdateSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Demande invalide.');
  }

  const { uid: targetUid } = request.data as { uid?: string };
  if (!targetUid) {
    throw new HttpsError('invalid-argument', 'Identifiant utilisateur manquant.');
  }

  const { ref, data } = await resolveTarget(targetUid, caller);
  const nextRole = parsed.data.role as UserRole;

  if (data.role === nextRole) {
    return { ok: true, role: nextRole, unchanged: true };
  }

  await ref.update({ role: nextRole, updatedAt: FieldValue.serverTimestamp() });

  await syncUserClaims(targetUid, {
    role: nextRole,
    status: (data.status as UserStatus) ?? 'active',
    orgId: (data.orgId as string) ?? caller.orgId,
    orgIds: Array.isArray(data.orgIds) ? (data.orgIds as string[]) : [caller.orgId],
  });

  await writeAuditLog({
    actorId: caller.uid,
    actorName: caller.name,
    actorRole: caller.role,
    action: ADMIN_ACTIONS.userRoleChange,
    targetType: 'user',
    targetId: targetUid,
    // Le contexte « avant / après » est indispensable pour reconstituer
    // l'historique des droits en cas de litige.
    metadata: {
      ...diffContext(data, { role: nextRole }, ['role']),
      reason: parsed.data.reason ?? null,
    },
  });

  logger.info('[adminSetUserRole] Rôle modifié', { targetUid, from: data.role, to: nextRole });

  return { ok: true, role: nextRole };
});

// ===========================================================================
//  Suppression conforme au RGPD
// ===========================================================================

export const adminDeleteUser = onCall({ region: REGION }, async (request) => {
  const caller = await resolveCaller(request.auth);

  if (!hasPermission(caller.role, 'user.delete')) {
    throw new HttpsError('permission-denied', 'Seul un administrateur peut supprimer un compte.');
  }

  const { uid: targetUid } = request.data as { uid?: string };
  if (!targetUid) {
    throw new HttpsError('invalid-argument', 'Identifiant utilisateur manquant.');
  }

  const { data } = await resolveTarget(targetUid, caller);

  // Journalisation AVANT la suppression : après, l'acteur et la cible
  // pourraient ne plus être résolvables.
  await writeAuditLog({
    actorId: caller.uid,
    actorName: caller.name,
    actorRole: caller.role,
    action: ADMIN_ACTIONS.userDelete,
    targetType: 'user',
    targetId: targetUid,
    metadata: { email: data.email ?? null, role: data.role ?? null },
  });

  await adminAuth()
    .deleteUser(targetUid)
    .catch((error: unknown) => {
      // Un compte Auth déjà absent ne doit pas empêcher le nettoyage des
      // données Firestore associées.
      logger.warn('[adminDeleteUser] Compte Auth introuvable, poursuite du nettoyage', {
        targetUid,
        error: error instanceof Error ? error.message : String(error),
      });
    });

  const { cleanupDeletedUser } = await import('../auth/user-triggers.js');
  await cleanupDeletedUser(targetUid);

  return { ok: true };
});
