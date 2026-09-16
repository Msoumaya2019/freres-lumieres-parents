import type { ClassId, OrganizationId, SchoolId } from './common.js';
import type { AudienceType, ClassLevel } from './enums.js';

/**
 * Ciblage d'un contenu.
 *
 * Représenté comme une carte (map) imbriquée et non comme des champs plats :
 *  - Firestore sait indexer et interroger les champs imbriqués
 *    (`where('audience.type', '==', 'level')`) ;
 *  - l'ajout d'un futur type d'audience (groupe de classes, bus, section…)
 *    se fait sans migration ni collision de noms ;
 *  - la lecture dans le code est explicite (`post.audience.level`).
 *
 * Invariants (vérifiés côté client par Zod ET côté serveur par les Rules) :
 *  - `all`   : orgId seul
 *  - `school`: schoolId obligatoire
 *  - `level` : schoolId + level obligatoires
 *  - `class` : classId obligatoire
 *  - `fcpe`  : orgId seul (réservé aux rôles fcpe/moderator/admin)
 */
export interface Audience {
  readonly type: AudienceType;
  readonly schoolId?: SchoolId;
  readonly level?: ClassLevel;
  readonly classId?: ClassId;
}

/**
 * Clés d'audience dénormalisées, stockées sur chaque contenu sous
 * `audienceKeys: string[]`.
 *
 * C'est la pièce maîtresse de l'optimisation des coûts Firestore : le fil
 * d'actualité d'un parent se lit en **une seule requête** indexée
 * (`array-contains-any` sur ses propres clés + `orderBy publishedAt desc`
 * + `limit`), au lieu d'un fan-out multi-requêtes ou d'une jointure côté
 * client.
 *
 * Elles servent aussi de « topics » pour l'envoi de notifications.
 */
export type AudienceKey = string;

/** Clés possibles, documentées pour éviter les fautes de frappe. */
export type AudienceKeyPrefix = 'org' | 'school' | 'level' | 'class' | 'fcpe';

/** Préfixe d'une clé d'audience, utile au débogage et aux tests. */
export interface ParsedAudienceKey {
  readonly prefix: AudienceKeyPrefix;
  readonly orgId?: OrganizationId;
  readonly schoolId?: SchoolId;
  readonly level?: ClassLevel;
  readonly classId?: ClassId;
}

/** Clés d'audience calculées pour un utilisateur donné (voir `@fl/shared`). */
export interface AudienceSubscription {
  readonly keys: readonly AudienceKey[];
  readonly isFcpe: boolean;
}
