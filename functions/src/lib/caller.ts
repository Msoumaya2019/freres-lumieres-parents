/**
 * Identification de l'appelant d'une action privilégiée.
 *
 * ## Pourquoi cette fonction vit dans `lib/`
 *
 * Elle servait une seule famille d'actions — les trois qui portent sur un
 * compte. L'envoi d'une annonce en est un quatrième appelant, et il n'a rien à
 * voir avec la gestion des utilisateurs : la recopier aurait produit deux
 * lectures de profil qui divergent à la première modification, et c'est
 * exactement le genre d'écart qui ne se voit qu'à l'exécution.
 *
 * ## Pourquoi la base, et non le jeton
 *
 * Un administrateur fraîchement rétrogradé pourrait sinon continuer à agir
 * pendant près d'une heure avec son ancien jeton. Le rôle lu ici est celui du
 * document, pas celui du Custom Claim.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne décide **pas** si l'appelant a le droit d'agir. Il dit qui il est et à
 * quelle organisation il appartient ; chaque fonction appelable applique
 * ensuite sa propre permission, parce que la permission dépend de l'action et
 * non de l'identité.
 */
import { HttpsError } from 'firebase-functions/v2/https';

import type { UserRole, UserStatus } from '@fl/types';

import { adminDb } from './admin.js';
import { paths } from './paths.js';

export interface CallerContext {
  uid: string;
  name: string;
  role: UserRole;
  orgId: string;
}

/** Chaîne nettoyée, ou chaîne vide. */
function texte(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Nom d'affichage d'un profil, ou `null` s'il n'y en a pas.
 *
 * ## Pourquoi elle ne lève pas, là où `resolveCaller` lève
 *
 * Une fonction appelable **doit** identifier son acteur : sans profil, il n'y a
 * pas d'action. Un déclencheur, lui, agit **au nom** d'un auteur dont le profil
 * peut avoir disparu — la suppression d'un compte est une opération normale, et
 * elle ne doit pas rendre muet le contenu qu'il a préparé. L'appelant décide
 * alors du repli, et chacun a le sien : « Administrateur » ici, « La FCPE »
 * pour un sondage.
 *
 * ## Pourquoi elle existe
 *
 * Le format du nom complet s'écrivait en ligne dans `resolveCaller`, et il
 * allait s'écrire une seconde fois dans le déclencheur des sondages. Deux
 * copies divergeraient sur la première retouche — une espace de trop, un
 * deuxième prénom ajouté — et l'écart ne se verrait que dans un journal
 * d'envoi, c'est-à-dire trop tard.
 */
export function nomDuProfil(data: Record<string, unknown> | undefined): string | null {
  const nom = `${texte(data?.firstName)} ${texte(data?.lastName)}`.trim();
  return nom.length > 0 ? nom : null;
}

/**
 * Résout l'appelant à partir de son profil en base.
 *
 * Lève `unauthenticated` si personne n'est connecté, et `permission-denied` si
 * le profil est absent ou le compte inactif. Le message reste volontairement
 * générique : dire « votre compte est en attente » à un appelant non
 * authentifié renseignerait sur l'état d'un compte qui n'est pas le sien.
 */
export async function resolveCaller(auth: { uid: string } | undefined): Promise<CallerContext> {
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
    name: nomDuProfil(data) ?? 'Administrateur',
    role,
    orgId,
  };
}
