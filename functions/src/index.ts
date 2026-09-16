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

function requiredText(
  data: Record<string, unknown>,
  key: string,
  maxLength: number,
): string {
  const value = stringField(data, key).trim();
  if (!value || value.length > maxLength)
    throw new HttpsError('invalid-argument', `${key} est invalide.`);
  return value;
}

function requiredId(data: Record<string, unknown>, key: string): string {
  const value = requiredText(data, key, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(value))
    throw new HttpsError('invalid-argument', `${key} est invalide.`);
  return value;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
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

export const registerParentProfile = onCall<Record<string, unknown>>(
  async (request) => {
    if (!request.auth)
      throw new HttpsError('unauthenticated', 'Authentification requise.');

    const uid = request.auth.uid;
    const authUser = await getAuth().getUser(uid);
    const email = authUser.email;
    if (!email)
      throw new HttpsError('failed-precondition', 'Adresse email manquante.');

    const data = asRecord(request.data);
    const firstName = requiredText(data, 'firstName', 80);
    const lastName = requiredText(data, 'lastName', 80);
    const organizationId = requiredId(data, 'organizationId');
    const rawChildren = data.children;
    if (
      !Array.isArray(rawChildren) ||
      rawChildren.length < 1 ||
      rawChildren.length > 5
    )
      throw new HttpsError(
        'invalid-argument',
        'Entre un et cinq enfants sont requis.',
      );

    const children = rawChildren.map((rawChild) => {
      const child = asRecord(rawChild);
      const rawClassId = stringField(child, 'classId').trim();
      return {
        schoolId: requiredId(child, 'schoolId'),
        levelId: requiredId(child, 'levelId'),
        classId: rawClassId ? requiredId(child, 'classId') : undefined,
      };
    });

    const db = getFirestore();
    const userRef = db.doc(`users/${uid}`);
    const claims = await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(userRef);
      if (existing.exists) {
        const profile = asRecord(existing.data());
        const rawRole = stringField(profile, 'role');
        const rawStatus = stringField(profile, 'status');
        return {
          role: roles.includes(rawRole as Role) ? (rawRole as Role) : 'parent',
          status: statuses.includes(rawStatus as Status)
            ? (rawStatus as Status)
            : 'pending',
          organizationId: stringField(profile, 'organizationId'),
          schoolIds: stringArrayField(profile, 'schoolIds'),
          levelIds: stringArrayField(profile, 'levelIds'),
          classIds: stringArrayField(profile, 'classIds'),
        };
      }

      const optionsRef = db.doc(`registrationOptions/${organizationId}`);
      const optionsSnapshot = await transaction.get(optionsRef);
      const options = asRecord(optionsSnapshot.data());
      if (!optionsSnapshot.exists || options.active !== true)
        throw new HttpsError(
          'failed-precondition',
          'Inscriptions indisponibles.',
        );

      const schools = Array.isArray(options.schools) ? options.schools : [];
      for (const child of children) {
        const school = schools
          .map(asRecord)
          .find((entry) => stringField(entry, 'id') === child.schoolId);
        const levels =
          school && Array.isArray(school.levels) ? school.levels : [];
        if (
          !school ||
          !levels
            .map(asRecord)
            .some((entry) => stringField(entry, 'id') === child.levelId)
        ) {
          throw new HttpsError(
            'invalid-argument',
            'Établissement ou niveau invalide.',
          );
        }
      }

      for (const child of children) {
        if (!child.classId) continue;
        const classSnapshot = await transaction.get(
          db.doc(`classes/${child.classId}`),
        );
        const classData = asRecord(classSnapshot.data());
        if (
          !classSnapshot.exists ||
          classData.active !== true ||
          stringField(classData, 'organizationId') !== organizationId ||
          stringField(classData, 'schoolId') !== child.schoolId ||
          stringField(classData, 'levelId') !== child.levelId
        ) {
          throw new HttpsError('invalid-argument', 'Classe invalide.');
        }
      }

      const now = FieldValue.serverTimestamp();
      const schoolIds = unique(children.map((child) => child.schoolId));
      const levelIds = unique(children.map((child) => child.levelId));
      const classIds = unique(
        children.flatMap((child) => (child.classId ? [child.classId] : [])),
      );
      transaction.create(userRef, {
        id: uid,
        firstName,
        lastName,
        email: email.toLowerCase(),
        role: 'parent',
        status: 'pending',
        organizationId,
        schoolIds,
        levelIds,
        classIds,
        notificationPreferences: {},
        createdAt: now,
        updatedAt: now,
      });
      for (const child of children) {
        const childRef = db.collection('childProfiles').doc();
        transaction.create(childRef, {
          id: childRef.id,
          parentUserId: uid,
          organizationId,
          schoolId: child.schoolId,
          levelId: child.levelId,
          ...(child.classId ? { classId: child.classId } : {}),
          createdAt: now,
        });
      }
      return {
        role: 'parent' as const,
        status: 'pending' as const,
        organizationId,
        schoolIds,
        levelIds,
        classIds,
      };
    });

    await getAuth().setCustomUserClaims(uid, claims);
    return { ok: true, status: claims.status };
  },
);

async function changeUserStatus(
  actor: { token: Record<string, unknown>; uid: string },
  uid: string,
  status: Status,
) {
  if (uid === actor.uid)
    throw new HttpsError(
      'invalid-argument',
      'Vous ne pouvez pas modifier votre propre statut.',
    );
  const organizationId = actorOrganizationId(actor);
  const { ref, target } = await requireTargetInOrganization(
    'users',
    uid,
    organizationId,
  );
  const rawRole = target.role;
  const role: Role =
    typeof rawRole === 'string' && roles.includes(rawRole as Role)
      ? (rawRole as Role)
      : 'parent';
  await ref.update({ status, updatedAt: FieldValue.serverTimestamp() });
  await getAuth().setCustomUserClaims(
    uid,
    await claimsForUser(uid, role, status),
  );
  const actions: Record<Status, string> = {
    pending: 'USER_SET_PENDING',
    active:
      target.status === 'suspended' ? 'USER_REACTIVATED' : 'USER_APPROVED',
    suspended: 'USER_SUSPENDED',
    rejected: 'USER_REJECTED',
  };
  await logAdminAction(
    actor.uid,
    organizationId,
    actions[status],
    'user',
    uid,
    {
      previousStatus: target.status,
      status,
    },
  );
}

export const approveUser = onCall<Record<string, unknown>>(async (request) => {
  const actor = requireActiveRole(request.auth, ['admin']);
  const data = asRecord(request.data);
  const uid = stringField(data, 'uid');
  if (!uid)
    throw new HttpsError('invalid-argument', 'Identifiant utilisateur requis.');
  await changeUserStatus(actor, uid, 'active');
  return { ok: true };
});

export const setUserStatus = onCall<Record<string, unknown>>(
  async (request) => {
    const actor = requireActiveRole(request.auth, ['admin']);
    const data = asRecord(request.data);
    const uid = stringField(data, 'uid');
    const status = data.status;
    if (
      !uid ||
      typeof status !== 'string' ||
      !statuses.includes(status as Status)
    ) {
      throw new HttpsError('invalid-argument', 'Statut utilisateur invalide.');
    }
    await changeUserStatus(actor, uid, status as Status);
    return { ok: true };
  },
);

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
