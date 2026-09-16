/**
 * Synchronisation des Custom Claims.
 *
 * ## Pourquoi les claims plutôt qu'une lecture de document
 *
 * Les Security Rules peuvent lire `users/{uid}` avec `get()`, mais cette
 * lecture est **facturée** à chaque évaluation de règle et ajoute de la
 * latence. Les Custom Claims sont embarqués dans le jeton : lecture gratuite,
 * instantanée, et impossible à falsifier depuis le client.
 *
 * ## Contenu des claims
 *
 * ```json
 * { "role": "fcpe", "status": "active",
 *   "orgId": "fcpe-montmagny", "orgIds": ["fcpe-montmagny"] }
 * ```
 *
 * Volontairement minimal (moins de 200 octets sur les 1000 disponibles) :
 *  - **aucune donnée personnelle** — les claims sont lisibles par leur
 *    porteur et peuvent apparaître dans des journaux ;
 *  - **pas de `schoolIds` ni de `levels`** — inutiles aux règles, et ils
 *    grossiraient le jeton à chaque ajout d'enfant.
 *
 * ## Le délai de propagation, et comment il est traité
 *
 * Un claim s'applique au prochain rafraîchissement du jeton, qui peut prendre
 * jusqu'à une heure. En cas de **suspension**, ce délai est inacceptable :
 * on appelle donc `revokeRefreshTokens()`, ce qui invalide immédiatement la
 * session côté client.
 *
 * Et de toute façon, toute action sensible passe par une Cloud Function qui
 * relit `users/{uid}.status` en base avant d'agir : elle ne se fie jamais au
 * seul contenu du jeton. C'est la défense en profondeur.
 */
import type { UserRole, UserStatus } from '@fl/types';

import { adminAuth } from '../lib/admin.js';

export interface UserClaims {
  role: UserRole;
  status: UserStatus;
  orgId: string;
  orgIds: string[];
}

/** Profil minimal nécessaire au calcul des claims. */
export interface ClaimsSource {
  role: UserRole;
  status: UserStatus;
  orgId: string;
  orgIds: readonly string[];
}

/**
 * Lit un document `users/{uid}` et en extrait de quoi calculer les claims.
 *
 * ## Les valeurs de repli sont le cœur de l'échec fermé
 *
 * Un profil incomplet — champ absent, type inattendu, écriture partielle — ne
 * doit jamais produire des droits. D'où les deux replis, choisis pour être les
 * moins permissifs possibles :
 *
 *  - `role` absent → `parent`, le rôle qui a le moins de permissions ;
 *  - `status` absent → `pending`, qui ne donne accès à rien.
 *
 * Le repli n'est pas `active` : un profil sans statut est un profil dont on ne
 * sait rien, pas un profil approuvé.
 *
 * ## Pourquoi `null` plutôt qu'un objet par défaut
 *
 * Sans `orgId`, il n'y a pas d'organisation à laquelle rattacher le compte. Le
 * repli serait arbitraire — et un `orgId` inventé pourrait donner accès aux
 * données d'une autre FCPE. L'appelant journalise et n'applique aucun claim.
 *
 * ## Retour sur `status`
 *
 * La valeur n'est pas validée contre la liste des statuts connus : les règles
 * comparent `status == 'active'` en égalité stricte, donc une valeur
 * inattendue est refusée comme les autres. Valider ici n'ajouterait pas de
 * sécurité, seulement un cas d'erreur à gérer.
 */
export function claimsSourceFromProfile(data: Record<string, unknown>): ClaimsSource | null {
  const { role, status, orgId, orgIds } = data;

  if (typeof orgId !== 'string' || orgId.length === 0) return null;

  return {
    role: (typeof role === 'string' ? role : 'parent') as UserRole,
    status: (typeof status === 'string' ? status : 'pending') as UserStatus,
    orgId,
    orgIds: Array.isArray(orgIds) ? (orgIds as string[]) : [orgId],
  };
}

export function buildClaims(profile: ClaimsSource): UserClaims {
  return {
    role: profile.role,
    status: profile.status,
    orgId: profile.orgId,
    orgIds: [...profile.orgIds],
  };
}

/**
 * Applique les claims d'un utilisateur.
 *
 * Lorsque le compte est suspendu ou refusé, les jetons de rafraîchissement
 * sont révoqués dans la foulée : l'utilisateur est déconnecté à la prochaine
 * opération, sans attendre l'expiration naturelle du jeton.
 */
export async function syncUserClaims(uid: string, profile: ClaimsSource): Promise<void> {
  const claims = buildClaims(profile);

  await adminAuth().setCustomUserClaims(uid, claims);

  if (profile.status === 'suspended' || profile.status === 'rejected') {
    await adminAuth().revokeRefreshTokens(uid);
  }
}

/**
 * Retire tous les droits d'un utilisateur.
 *
 * Appelée à la suppression d'un compte : sans cela, un jeton encore valide
 * continuerait de donner accès aux données pendant jusqu'à une heure.
 */
export async function clearUserClaims(uid: string): Promise<void> {
  await adminAuth().setCustomUserClaims(uid, {
    role: null,
    status: null,
    orgId: null,
    orgIds: null,
  });
  await adminAuth().revokeRefreshTokens(uid);
}

/**
 * Lit les claims actuellement portés par un compte.
 *
 * Utilitaire de diagnostic : il sert à vérifier l'état réel d'un compte depuis
 * un script d'exploitation, pas au fonctionnement courant. Les triggers et les
 * fonctions d'administration écrivent les claims sans les relire — relire
 * coûterait un appel à l'API Admin là où l'on cherche précisément à ne pas en
 * faire.
 */
export async function readUserClaims(uid: string): Promise<UserClaims | null> {
  const user = await adminAuth().getUser(uid);
  const claims = user.customClaims;
  if (!claims || typeof claims.role !== 'string' || typeof claims.status !== 'string') {
    return null;
  }
  return claims as unknown as UserClaims;
}
