/**
 * Construction et manipulation des clés d'audience.
 *
 * Rappel de l'enjeu : le fil d'actualité d'un parent doit se lire en une
 * seule requête Firestore indexée. Pour cela, chaque contenu porte un
 * tableau `audienceKeys` et chaque utilisateur possède le tableau des clés
 * auxquelles il a droit. La requête est alors :
 *
 *     where('audienceKeys', 'array-contains-any', userKeys)
 *       .orderBy('publishedAt', 'desc')
 *       .limit(10)
 *
 * Limite Firestore à connaître : `array-contains-any` accepte au maximum
 * 30 valeurs. Un utilisateur typique en a 3 à 6 (organisation, école,
 * niveau(x), classe(s), FCPE). La fonction `chunkAudienceKeys` permet de
 * découper proprement si un cas extrême se présente (famille recomposée,
 * plusieurs établissements).
 */
import type {
  Audience,
  AudienceKey,
  AudienceType,
  ClassId,
  ClassLevel,
  OrganizationId,
  SchoolId,
  UserRole,
} from '@fl/types';

/** Maximum de valeurs acceptées par `array-contains-any` côté Firestore. */
export const MAX_ARRAY_CONTAINS_ANY = 30;

export function orgKey(orgId: OrganizationId): AudienceKey {
  return `org:${orgId}`;
}

export function schoolKey(schoolId: SchoolId): AudienceKey {
  return `school:${schoolId}`;
}

export function levelKey(schoolId: SchoolId, level: ClassLevel): AudienceKey {
  return `level:${schoolId}:${level}`;
}

export function classKey(classId: ClassId): AudienceKey {
  return `class:${classId}`;
}

export function fcpeKey(orgId: OrganizationId): AudienceKey {
  return `fcpe:${orgId}`;
}

/** Rôles ayant accès aux contenus réservés à la FCPE. */
export const FCPE_ROLES = ['fcpe', 'moderator', 'admin'] as const satisfies readonly UserRole[];

export function isFcpeRole(role: UserRole): boolean {
  return (FCPE_ROLES as readonly UserRole[]).includes(role);
}

/**
 * Calcule les clés d'audience d'un contenu.
 *
 * Un contenu « tous les parents » porte la clé `org:{orgId}`, que tout
 * utilisateur validé possède. Un contenu ciblé sur un niveau porte
 * `level:{schoolId}:{level}`, ce qui évite qu'un CE1 d'une autre école
 * reçoive une information qui ne le concerne pas.
 */
export function buildAudienceKeys(audience: Audience, orgId: OrganizationId): AudienceKey[] {
  switch (audience.type) {
    case 'all':
      return [orgKey(orgId)];
    case 'school':
      return audience.schoolId ? [schoolKey(audience.schoolId)] : [];
    case 'level':
      return audience.schoolId && audience.level
        ? [levelKey(audience.schoolId, audience.level)]
        : [];
    case 'class':
      return audience.classId ? [classKey(audience.classId)] : [];
    case 'fcpe':
      return [fcpeKey(orgId)];
  }
}

/**
 * Clés d'audience d'un utilisateur, à partir de ses rattachements.
 *
 * Appelée à l'inscription puis à chaque modification du profil ou des
 * enfants ; le résultat est recopié dans `users/{uid}.audienceKeys` et dans
 * `deviceTokens/{token}.audienceKeys` par une Cloud Function.
 */
export function buildUserAudienceKeys(input: {
  orgIds: readonly OrganizationId[];
  schoolIds: readonly SchoolId[];
  levels: readonly ClassLevel[];
  classIds: readonly ClassId[];
  role: UserRole;
  /** Association niveau → école, nécessaire pour construire `level:{school}:{level}`. */
  levelSchoolPairs?: readonly { schoolId: SchoolId; level: ClassLevel }[];
}): AudienceKey[] {
  const keys = new Set<AudienceKey>();

  for (const orgId of input.orgIds) {
    keys.add(orgKey(orgId));
    if (isFcpeRole(input.role)) {
      keys.add(fcpeKey(orgId));
    }
  }

  for (const schoolId of input.schoolIds) {
    keys.add(schoolKey(schoolId));
  }

  for (const classId of input.classIds) {
    keys.add(classKey(classId));
  }

  if (input.levelSchoolPairs) {
    for (const pair of input.levelSchoolPairs) {
      keys.add(levelKey(pair.schoolId, pair.level));
    }
  }

  return [...keys];
}

/**
 * Vérifie qu'une audience est cohérente avec son type.
 * Utilisée par la validation Zod côté client et par les tests de règles.
 */
export function validateAudience(audience: Audience): { valid: boolean; reason?: string } {
  switch (audience.type) {
    case 'all':
    case 'fcpe':
      return { valid: true };
    case 'school':
      return audience.schoolId
        ? { valid: true }
        : { valid: false, reason: 'audience.schoolId est obligatoire pour le type « school »' };
    case 'level':
      if (!audience.schoolId || !audience.level) {
        return {
          valid: false,
          reason: 'audience.schoolId et audience.level sont obligatoires pour le type « level »',
        };
      }
      return { valid: true };
    case 'class':
      return audience.classId
        ? { valid: true }
        : { valid: false, reason: 'audience.classId est obligatoire pour le type « class »' };
  }
}

/**
 * Un utilisateur peut-il voir un contenu ?
 *
 * Utilisée côté client pour filtrer un résultat déjà reçu, et dans les tests
 * pour vérifier que la règle Firestore et le code applicatif concordent.
 * Elle ne remplace JAMAIS les Security Rules.
 */
export function isVisibleForUserKeys(
  contentKeys: readonly AudienceKey[],
  userKeys: readonly AudienceKey[],
): boolean {
  if (contentKeys.length === 0) return false;
  const userKeySet = new Set(userKeys);
  return contentKeys.some((key) => userKeySet.has(key));
}

/**
 * Convertit une clé d'audience en nom de « topic » de notification.
 *
 * Les noms de topic FCM n'acceptent que `[a-zA-Z0-9-_.~%]` : on remplace
 * donc les séparateurs `:` par `_`. La fonction est déterministe, ce qui
 * permet au client et au serveur de calculer le même topic sans se parler.
 */
export function audienceKeyToTopic(key: AudienceKey): string {
  return key.replace(/[^a-zA-Z0-9-_.~%]/g, '_').toLowerCase();
}

/** Découpe une liste de clés en lots compatibles avec `array-contains-any`. */
export function chunkAudienceKeys(
  keys: readonly AudienceKey[],
  size: number = MAX_ARRAY_CONTAINS_ANY,
): AudienceKey[][] {
  const chunks: AudienceKey[][] = [];
  for (let i = 0; i < keys.length; i += size) {
    chunks.push(keys.slice(i, i + size));
  }
  return chunks;
}

/** Types d'audience qu'un rôle donné peut utiliser pour publier. */
export function allowedAudienceTypes(role: UserRole): readonly AudienceType[] {
  switch (role) {
    case 'admin':
    case 'moderator':
    case 'fcpe':
      return ['all', 'school', 'level', 'class', 'fcpe'];
    case 'parent':
      return [];
  }
}
