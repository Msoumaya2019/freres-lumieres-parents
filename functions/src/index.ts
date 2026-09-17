import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2/options';

initializeApp();
setGlobalOptions({ region: 'europe-west1', maxInstances: 5 });

const roles = ['fcpe', 'moderator', 'admin'] as const;
const statuses = ['pending', 'active', 'suspended', 'rejected'] as const;
const publicTopics = [
  'all_public',
  'school_maternelle',
  'school_elementaire',
  'canteen',
  'events',
  'school_councils',
] as const;
type Role = (typeof roles)[number];
type Status = (typeof statuses)[number];

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
function text(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}
function requiredText(
  data: Record<string, unknown>,
  key: string,
  max: number,
): string {
  const value = text(data, key).trim();
  if (!value || value.length > max)
    throw new HttpsError('invalid-argument', `${key} est invalide.`);
  return value;
}
function requiredId(data: Record<string, unknown>, key: string): string {
  const value = requiredText(data, key, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(value))
    throw new HttpsError('invalid-argument', `${key} est invalide.`);
  return value;
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
  )
    throw new HttpsError('permission-denied', 'Permission insuffisante.');
  return auth;
}
function organizationOf(auth: { token: Record<string, unknown> }): string {
  const id = text(auth.token, 'organizationId');
  if (!id) throw new HttpsError('permission-denied', 'Organisation manquante.');
  return id;
}

async function targetMember(uid: string, organizationId: string) {
  const ref = getFirestore().doc(`memberProfiles/${uid}`);
  const snapshot = await ref.get();
  if (!snapshot.exists)
    throw new HttpsError('not-found', 'Membre introuvable.');
  const data = record(snapshot.data());
  if (text(data, 'organizationId') !== organizationId)
    throw new HttpsError('permission-denied', 'Organisation différente.');
  return { ref, data };
}
async function memberClaims(uid: string, role: Role, status: Status) {
  const snapshot = await getFirestore().doc(`memberProfiles/${uid}`).get();
  if (!snapshot.exists)
    throw new HttpsError('not-found', 'Profil membre introuvable.');
  return {
    role,
    status,
    organizationId: text(record(snapshot.data()), 'organizationId'),
  };
}
async function log(
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

// Ce callable ne concerne que les membres FCPE. Aucun compte public n'est créé.
export const registerMemberProfile = onCall<Record<string, unknown>>(
  async (request) => {
    if (!request.auth)
      throw new HttpsError('unauthenticated', 'Authentification requise.');
    const authUser = await getAuth().getUser(request.auth.uid);
    if (!authUser.email)
      throw new HttpsError('failed-precondition', 'Adresse email manquante.');
    const data = record(request.data);
    const organizationId = requiredId(data, 'organizationId');
    const db = getFirestore();
    const organization = await db.doc(`organizations/${organizationId}`).get();
    if (!organization.exists || organization.data()?.active !== true)
      throw new HttpsError(
        'failed-precondition',
        'Les demandes d’accès sont indisponibles pour cette organisation.',
      );
    const ref = db.doc(`memberProfiles/${request.auth.uid}`);
    const existing = await ref.get();
    if (existing.exists) {
      const existingProfile = record(existing.data());
      const existingRole = text(existingProfile, 'role') as Role;
      const existingStatus = text(existingProfile, 'status') as Status;
      if (
        text(existingProfile, 'email') !== authUser.email.toLowerCase() ||
        !roles.includes(existingRole) ||
        !statuses.includes(existingStatus)
      )
        throw new HttpsError(
          'failed-precondition',
          'Profil membre incohérent.',
        );
      await getAuth().setCustomUserClaims(request.auth.uid, {
        role: existingRole,
        status: existingStatus,
        organizationId: text(existingProfile, 'organizationId'),
      });
      return { ok: true, status: existingStatus };
    }
    const profile = {
      id: request.auth.uid,
      firstName: requiredText(data, 'firstName', 80),
      lastName: requiredText(data, 'lastName', 80),
      email: authUser.email.toLowerCase(),
      role: 'fcpe' as const,
      status: 'pending' as const,
      organizationId,
      ...(text(data, 'declaredFunction').trim()
        ? {
            declaredFunction: text(data, 'declaredFunction')
              .trim()
              .slice(0, 120),
          }
        : {}),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await ref.create(profile);
    await getAuth().setCustomUserClaims(request.auth.uid, {
      role: 'fcpe',
      status: 'pending',
      organizationId,
    });
    return { ok: true, status: 'pending' };
  },
);

async function changeMemberStatus(
  actor: { token: Record<string, unknown>; uid: string },
  uid: string,
  status: Status,
) {
  if (uid === actor.uid)
    throw new HttpsError(
      'invalid-argument',
      'Vous ne pouvez pas modifier votre propre statut.',
    );
  const organizationId = organizationOf(actor);
  const { ref, data } = await targetMember(uid, organizationId);
  const role = roles.includes(data.role as Role) ? (data.role as Role) : 'fcpe';
  await ref.update({ status, updatedAt: FieldValue.serverTimestamp() });
  await getAuth().setCustomUserClaims(
    uid,
    await memberClaims(uid, role, status),
  );
  const action =
    status === 'active'
      ? data.status === 'suspended'
        ? 'MEMBER_REACTIVATED'
        : 'MEMBER_APPROVED'
      : status === 'suspended'
        ? 'MEMBER_SUSPENDED'
        : status === 'rejected'
          ? 'MEMBER_REJECTED'
          : 'MEMBER_SET_PENDING';
  await log(actor.uid, organizationId, action, 'member', uid, {
    previousStatus: data.status,
    status,
  });
}
export const approveMember = onCall<Record<string, unknown>>(
  async (request) => {
    const actor = requireActiveRole(request.auth, ['admin']);
    const uid = requiredId(record(request.data), 'uid');
    await changeMemberStatus(actor, uid, 'active');
    return { ok: true };
  },
);
export const setMemberStatus = onCall<Record<string, unknown>>(
  async (request) => {
    const actor = requireActiveRole(request.auth, ['admin']);
    const data = record(request.data);
    const uid = requiredId(data, 'uid');
    const status = text(data, 'status') as Status;
    if (!statuses.includes(status))
      throw new HttpsError('invalid-argument', 'Statut invalide.');
    await changeMemberStatus(actor, uid, status);
    return { ok: true };
  },
);
export const setMemberRole = onCall<Record<string, unknown>>(
  async (request) => {
    const actor = requireActiveRole(request.auth, ['admin']);
    const organizationId = organizationOf(actor);
    const data = record(request.data);
    const uid = requiredId(data, 'uid');
    const role = text(data, 'role') as Role;
    if (uid === actor.uid || !roles.includes(role))
      throw new HttpsError('invalid-argument', 'Rôle invalide.');
    const { ref, data: profile } = await targetMember(uid, organizationId);
    const status = statuses.includes(profile.status as Status)
      ? (profile.status as Status)
      : 'pending';
    await ref.update({ role, updatedAt: FieldValue.serverTimestamp() });
    await getAuth().setCustomUserClaims(
      uid,
      await memberClaims(uid, role, status),
    );
    await log(actor.uid, organizationId, 'ROLE_CHANGED', 'member', uid, {
      role,
    });
    return { ok: true };
  },
);

export const sendPushNotification = onCall<Record<string, unknown>>(
  async (request) => {
    const actor = requireActiveRole(request.auth, ['admin']);
    const data = record(request.data);
    const topic = text(data, 'topic') as (typeof publicTopics)[number];
    const title = requiredText(data, 'title', 120);
    const body = requiredText(data, 'body', 500);
    if (!publicTopics.includes(topic))
      throw new HttpsError('invalid-argument', 'Audience invalide.');
    const messageId = await getMessaging().send({
      topic,
      notification: { title, body },
    });
    await log(
      actor.uid,
      organizationOf(actor),
      'NOTIFICATION_SENT',
      'topic',
      topic,
      { messageId },
    );
    return { ok: true, messageId };
  },
);

// Les endpoints du chat public seront implémentés en Phase 6. Ils devront imposer
// App Check, secret fort haché, rate limiting et ne retourner aucune note interne.
export const contactApiNotEnabled = onCall(() => {
  throw new HttpsError(
    'failed-precondition',
    'Le contact privé sera activé en Phase 6.',
  );
});
