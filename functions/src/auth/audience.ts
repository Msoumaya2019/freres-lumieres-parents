/**
 * Recalcul des clés d'audience d'un utilisateur.
 *
 * Les clés d'audience (`org:…`, `school:…`, `level:…`, `class:…`, `fcpe:…`)
 * sont la pièce maîtresse du fil d'actualité et du ciblage des notifications.
 * Elles sont recalculées côté serveur à chaque modification des enfants ou
 * du rattachement, jamais par le client : sinon un utilisateur pourrait
 * s'attribuer l'accès à un niveau qui n'est pas le sien.
 *
 * La logique de construction est **partagée** avec le client (`@fl/shared`) :
 * une seule définition, utilisée des deux côtés.
 */
import { logger } from 'firebase-functions/v2';

import { buildUserAudienceKeys } from '@fl/shared';
import type { ClassId, ClassLevel, OrganizationId, SchoolId, UserRole } from '@fl/types';

import { adminDb } from '../lib/admin.js';
import { COLLECTIONS, SUBCOLLECTIONS, paths } from '../lib/paths.js';

/** Recalcule et enregistre les clés d'audience d'un utilisateur. */
export async function rebuildAudienceKeysForUser(uid: string): Promise<string[]> {
  const db = adminDb();
  const userRef = db.doc(paths.user(uid));
  const snapshot = await userRef.get();

  if (!snapshot.exists) return [];

  const data = snapshot.data() ?? {};
  const orgIds = Array.isArray(data.orgIds) ? (data.orgIds as OrganizationId[]) : [];
  const schoolIds = Array.isArray(data.schoolIds) ? (data.schoolIds as SchoolId[]) : [];
  const classIds = Array.isArray(data.classIds) ? (data.classIds as ClassId[]) : [];
  const role = (typeof data.role === 'string' ? data.role : 'parent') as UserRole;

  // Les couples (école, niveau) sont lus depuis la sous-collection des
  // enfants : c'est ce qui permet de construire `level:{school}:{level}`
  // correctement lorsqu'une famille a des enfants dans deux écoles.
  const children = await userRef.collection(SUBCOLLECTIONS.children).get();

  const levelSchoolPairs: { schoolId: SchoolId; level: ClassLevel }[] = [];
  const childLevels = new Set<ClassLevel>();
  const childClassIds = new Set<ClassId>();
  const childSchoolIds = new Set<SchoolId>();

  for (const child of children.docs) {
    const schoolId = child.get('schoolId') as SchoolId | undefined;
    const level = child.get('level') as ClassLevel | undefined;
    const classId = child.get('classId') as ClassId | undefined;

    if (schoolId) childSchoolIds.add(schoolId);
    if (level) childLevels.add(level);
    if (classId) childClassIds.add(classId);
    if (schoolId && level) levelSchoolPairs.push({ schoolId, level });
  }

  const audienceKeys = buildUserAudienceKeys({
    orgIds,
    // On combine le rattachement déclaré sur le profil et celui des enfants :
    // les deux sources doivent rester cohérentes, mais un profil incomplet ne
    // doit pas priver l'utilisateur de son fil.
    schoolIds: [...new Set([...schoolIds, ...childSchoolIds])],
    levels: [...childLevels],
    classIds: [...new Set([...classIds, ...childClassIds])],
    role,
    levelSchoolPairs,
  });

  await userRef.update({
    audienceKeys,
    levels: [...childLevels],
    classIds: [...new Set([...classIds, ...childClassIds])],
    schoolIds: [...new Set([...schoolIds, ...childSchoolIds])],
  });

  logger.info('[rebuildAudienceKeysForUser] Clés recalculées', {
    uid,
    keyCount: audienceKeys.length,
  });

  return audienceKeys;
}

/**
 * Recalcule les clés d'audience de tous les jetons d'un utilisateur.
 *
 * Les jetons d'appareil portent une copie des clés, précisément pour pouvoir
 * cibler un envoi sans lire les profils. Cette copie doit donc être
 * maintenue à jour en même temps que le profil.
 */
export async function rebuildAudienceKeysForTokens(
  uid: string,
  audienceKeys: string[],
): Promise<number> {
  const db = adminDb();
  const tokens = await db.collection(COLLECTIONS.deviceTokens).where('uid', '==', uid).get();

  if (tokens.empty) return 0;

  const batch = db.batch();
  for (const token of tokens.docs) {
    batch.update(token.ref, { audienceKeys });
  }
  await batch.commit();

  return tokens.size;
}
