/**
 * Clés d'audience d'un utilisateur : recalcul, et détection du besoin.
 *
 * Les clés d'audience (`org:…`, `school:…`, `level:…`, `class:…`, `fcpe:…`)
 * sont la pièce maîtresse du fil d'actualité et du ciblage des notifications.
 * Elles sont recalculées côté serveur à chaque modification des enfants ou
 * du rattachement, jamais par le client : sinon un utilisateur pourrait
 * s'attribuer l'accès à un niveau qui n'est pas le sien.
 *
 * La logique de construction est **partagée** avec le client (`@fl/shared`) :
 * une seule définition, utilisée des deux côtés.
 *
 * `audienceChanged` et `childAudienceChanged` vivent ici parce qu'elles
 * répondent à la même question — « les clés ont-elles bougé ? » — et que deux
 * modules en dépendent : le recalcul du profil et la recopie vers les jetons
 * d'appareil.
 */
import { logger } from 'firebase-functions/v2';

import { buildUserAudienceKeys } from '@fl/shared';
import type { ClassId, ClassLevel, OrganizationId, SchoolId, UserRole } from '@fl/types';

import { adminDb } from '../lib/admin.js';
import { SUBCOLLECTIONS, paths } from '../lib/paths.js';

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
 * Profil réduit à ce dont dépendent les clés d'audience.
 *
 * Les cinq champs sont nécessaires : `role` et `orgIds` décident de la clé
 * `fcpe:`, `schoolIds` de `school:`, `levels` et `classIds` du reste.
 */
export interface AudienceBearingProfile {
  role?: unknown;
  orgIds?: unknown;
  schoolIds?: unknown;
  levels?: unknown;
  classIds?: unknown;
}

function sortedStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').sort();
}

/**
 * Signature des rattachements dont dépendent les clés d'audience.
 *
 * Les tableaux sont triés : leur ordre n'a aucun sens ici, et un simple
 * réordonnancement ne doit pas déclencher un recalcul — une lecture de profil,
 * une requête sur les enfants et une écriture.
 */
function audienceSignature(profile: AudienceBearingProfile | undefined): string {
  if (!profile) return 'absent';
  return JSON.stringify([
    profile.role ?? null,
    sortedStrings(profile.orgIds),
    sortedStrings(profile.schoolIds),
    sortedStrings(profile.levels),
    sortedStrings(profile.classIds),
  ]);
}

/**
 * Les clés d'audience d'un utilisateur doivent-elles être recalculées ?
 *
 * ## Le défaut que cette fonction corrige
 *
 * La version d'origine ne comparait que `levels`, `classIds` et `schoolIds`.
 * Un parent promu au rôle `fcpe` — ou rattaché à une organisation
 * supplémentaire — ne voyait donc **jamais** sa clé `fcpe:` apparaître : il
 * restait inscrit au fil d'actualité des parents et n'accédait à aucun contenu
 * réservé à la FCPE. Le rôle et les organisations font pourtant partie de ce
 * dont la clé dépend, au même titre que les niveaux.
 *
 * Ce défaut était invisible : rien n'échoue, l'utilisateur voit simplement
 * moins de choses que prévu.
 */
export function audienceChanged(
  before: AudienceBearingProfile | undefined,
  after: AudienceBearingProfile,
): boolean {
  return audienceSignature(before) !== audienceSignature(after);
}

/**
 * Ce dont dépend l'audience d'un enfant.
 *
 * Un enfant porte son école, son niveau et sa classe : ce sont ces trois champs
 * qui décident des clés `school:`, `level:` et `class:`. Le prénom, la date de
 * naissance ou le rang dans la fratrie n'y changent rien — les faire entrer
 * dans la signature ferait payer une lecture de profil, une requête sur les
 * enfants et une écriture à chaque correction d'orthographe.
 */
export interface ChildAudienceSource {
  schoolId?: unknown;
  level?: unknown;
  classId?: unknown;
}

function childAudienceSignature(child: ChildAudienceSource): string {
  return JSON.stringify([
    typeof child.schoolId === 'string' ? child.schoolId : null,
    typeof child.level === 'string' ? child.level : null,
    typeof child.classId === 'string' ? child.classId : null,
  ]);
}

/**
 * Les clés d'audience du parent doivent-elles être recalculées ?
 *
 * ## Le défaut que cette fonction corrige
 *
 * `rebuildAudienceKeysForUser` lit la sous-collection `children` — c'est même
 * la seule façon de construire `level:{école}:{niveau}` quand une famille a des
 * enfants dans deux écoles. Mais **rien ne surveillait cette sous-collection** :
 * ajouter un enfant ne recalculait donc rien tant que le profil n'était pas
 * réécrit. Le parent ne voyait pas le fil de la classe de son enfant, et rien
 * n'échouait — le contenu existait simplement pas pour lui.
 *
 * La création et la suppression comptent toutes les deux : ajouter un enfant
 * ouvre sa classe, en retirer la referme.
 */
export function childAudienceChanged(
  before: ChildAudienceSource | undefined,
  after: ChildAudienceSource | undefined,
): boolean {
  // Création : il n'y avait pas d'enfant, il y en a un.
  if (!before) return after !== undefined;
  // Suppression : il y en avait un, il n'y en a plus.
  if (!after) return true;
  return childAudienceSignature(before) !== childAudienceSignature(after);
}
