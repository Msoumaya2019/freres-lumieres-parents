import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2/options';

initializeApp();
setGlobalOptions({ region: 'europe-west1', maxInstances: 5 });

const roles = ['parent', 'fcpe', 'moderator', 'admin'] as const;
const statuses = ['pending', 'active', 'suspended', 'rejected'] as const;
type Role = (typeof roles)[number];
type Status = (typeof statuses)[number];

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

function stringArrayField(
  data: Record<string, unknown>,
  key: string,
): string[] {
  const value = data[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function requireActiveRole(
  auth: { token: Record<string, unknown>; uid: string } | undefined,
  allowed: Role[],
) {
  if (!auth)
    throw new HttpsError('unauthenticated', 'Authentification requise.');
  if (
    auth.token.status !== 'active' ||
    !allowed.includes(auth.token.role as Role)
  ) {
    throw new HttpsError('permission-denied', 'Permission insuffisante.');
  }
  return auth;
}

function actorOrganizationId(auth: { token: Record<string, unknown> }): string {
  const organizationId = stringField(auth.token, 'organizationId');
  if (!organizationId)
    throw new HttpsError(
      'permission-denied',
      'Organisation administrateur manquante.',
    );
  return organizationId;
}

async function requireTargetInOrganization(
  collection: string,
  targetId: string,
  organizationId: string,
) {
  const ref = getFirestore().doc(`${collection}/${targetId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'Cible introuvable.');
  const target = asRecord(snapshot.data());
  if (stringField(target, 'organizationId') !== organizationId)
    throw new HttpsError('permission-denied', 'Organisation différente.');
  return { ref, target };
}

function assertRole(value: unknown): asserts value is Role {
  if (typeof value !== 'string' || !roles.includes(value as Role))
    throw new HttpsError('invalid-argument', 'Rôle invalide.');
}

async function claimsForUser(uid: string, role: Role, status: Status) {
  const snapshot = await getFirestore().doc(`users/${uid}`).get();
  if (!snapshot.exists)
    throw new HttpsError('not-found', 'Profil utilisateur introuvable.');
  const profile = asRecord(snapshot.data());
  return {
    role,
    status,
    organizationId: stringField(profile, 'organizationId'),
    schoolIds: stringArrayField(profile, 'schoolIds'),
    levelIds: stringArrayField(profile, 'levelIds'),
    classIds: stringArrayField(profile, 'classIds'),
  };
}

export const approveUser = onCall<Record<string, unknown>>(async (request) => {
  const actor = requireActiveRole(request.auth, ['admin']);
  const organizationId = actorOrganizationId(actor);
  const data = asRecord(request.data);
  const uid = stringField(data, 'uid');
  if (!uid)
    throw new HttpsError('invalid-argument', 'Identifiant utilisateur requis.');
  const { ref } = await requireTargetInOrganization(
    'users',
    uid,
    organizationId,
  );
  await ref.update({
    status: 'active',
    updatedAt: FieldValue.serverTimestamp(),
  });
  await getAuth().setCustomUserClaims(
    uid,
    await claimsForUser(uid, 'parent', 'active'),
  );
  await logAdminAction(actor.uid, organizationId, 'USER_APPROVED', 'user', uid);
  return { ok: true };
});

export const setUserRole = onCall<Record<string, unknown>>(async (request) => {
  const actor = requireActiveRole(request.auth, ['admin']);
  const organizationId = actorOrganizationId(actor);
  const data = asRecord(request.data);
  const uid = stringField(data, 'uid');
  const role: unknown = data.role;
  if (!uid || uid === actor.uid)
    throw new HttpsError('invalid-argument', 'Cible invalide.');
  assertRole(role);
  const { ref, target: profile } = await requireTargetInOrganization(
    'users',
    uid,
    organizationId,
  );
  const rawStatus = profile.status;
  const status: Status =
    typeof rawStatus === 'string' && statuses.includes(rawStatus as Status)
      ? (rawStatus as Status)
      : 'pending';
  await ref.update({ role, updatedAt: FieldValue.serverTimestamp() });
  await getAuth().setCustomUserClaims(
    uid,
    await claimsForUser(uid, role, status),
  );
  await logAdminAction(actor.uid, organizationId, 'ROLE_CHANGED', 'user', uid, {
    role,
  });
  return { ok: true };
});

export const sendPushNotification = onCall<Record<string, unknown>>(
  async (request) => {
    requireActiveRole(request.auth, ['admin']);
    const data = asRecord(request.data);
    const topic = stringField(data, 'topic');
    const title = stringField(data, 'title').trim();
    const body = stringField(data, 'body').trim();
    if (
      !/^(organization|school|level)_[A-Za-z0-9-]{1,80}$/.test(topic) ||
      !title ||
      !body
    ) {
      throw new HttpsError('invalid-argument', 'Notification invalide.');
    }
    const messageId = await getMessaging().send({
      topic,
      notification: { title: title.slice(0, 120), body: body.slice(0, 500) },
    });
    return { ok: true, messageId };
  },
);

export const createPostNotification = onCall<Record<string, unknown>>(
  (request) => {
    requireActiveRole(request.auth, ['admin']);
    throw new HttpsError(
      'failed-precondition',
      'La diffusion automatique sera activée en Phase 5.',
    );
  },
);

export const moderateContent = onCall<Record<string, unknown>>(
  async (request) => {
    const actor = requireActiveRole(request.auth, ['moderator', 'admin']);
    const organizationId = actorOrganizationId(actor);
    const data = asRecord(request.data);
    const targetType = stringField(data, 'targetType');
    const targetId = stringField(data, 'targetId');
    const collections: Record<string, string> = {
      post: 'posts',
      comment: 'comments',
      message: 'messages',
    };
    const collection = collections[targetType];
    if (!collection || !targetId)
      throw new HttpsError('invalid-argument', 'Cible de modération invalide.');
    const { ref } = await requireTargetInOrganization(
      collection,
      targetId,
      organizationId,
    );
    await ref.update({
      status: 'hidden',
      moderatedAt: FieldValue.serverTimestamp(),
      moderatedBy: actor.uid,
    });
    const action =
      targetType === 'comment'
        ? 'COMMENT_HIDDEN'
        : targetType === 'message'
          ? 'MESSAGE_HIDDEN'
          : 'POST_HIDDEN';
    await logAdminAction(
      actor.uid,
      organizationId,
      action,
      targetType,
      targetId,
    );
    return { ok: true };
  },
);

export const deleteUserData = onCall<Record<string, unknown>>(
  async (request) => {
    if (!request.auth)
      throw new HttpsError('unauthenticated', 'Authentification requise.');
    const data = asRecord(request.data);
    const requestedUid = stringField(data, 'uid') || request.auth.uid;
    if (requestedUid !== request.auth.uid) {
      const actor = requireActiveRole(request.auth, ['admin']);
      await requireTargetInOrganization(
        'users',
        requestedUid,
        actorOrganizationId(actor),
      );
    }

    const db = getFirestore();
    const children = await db
      .collection('childProfiles')
      .where('parentUserId', '==', requestedUid)
      .get();
    const batch = db.batch();
    for (const child of children.docs) batch.delete(child.ref);
    batch.delete(db.doc(`users/${requestedUid}`));
    await batch.commit();
    await getAuth().deleteUser(requestedUid);
    return { ok: true, publicContentAnonymizationPending: true };
  },
);

async function logAdminAction(
  actorUserId: string,
  organizationId: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown> = {},
) {
  await getFirestore().collection('adminLogs').add({
    actorUserId,
    organizationId,
    action,
    targetType,
    targetId,
    metadata,
    createdAt: FieldValue.serverTimestamp(),
  });
}
