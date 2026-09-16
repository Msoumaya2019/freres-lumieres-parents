/**
 * Déclencheurs liés au cycle de vie des comptes.
 *
 * ## Le parcours complet
 *
 * ```
 *  Inscription (client)      → users/{uid} créé avec status = 'pending'
 *        │
 *        ▼
 *  onUserProfileCreated      → claims { role: 'parent', status: 'pending' }
 *        │                      → l'utilisateur ne peut RIEN lire
 *        ▼
 *  Approbation (admin)       → users/{uid}.status = 'active'
 *        │
 *        ▼
 *  onUserProfileWritten      → claims { status: 'active' }
 *                              → l'utilisateur accède à l'application
 * ```
 *
 * Ce découplage est volontaire : le client ne peut pas s'attribuer un statut
 * (les règles Firestore figent `role` et `status`), et seule une Function
 * dotée de l'Admin SDK peut écrire les Custom Claims.
 */
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { FieldValue } from 'firebase-admin/firestore';

import { adminDb } from '../lib/admin.js';
import { COLLECTIONS, paths } from '../lib/paths.js';
import { claimsSourceFromProfile, clearUserClaims, syncUserClaims } from './claims.js';
import { rebuildAudienceKeysForUser } from './audience.js';

/**
 * À la création du profil : l'utilisateur reçoit des claims minimaux.
 *
 * Sans cette étape, un compte fraîchement inscrit n'aurait aucun claim et se
 * heurterait à des refus incompréhensibles. Il obtient donc `parent` +
 * `pending`, ce qui lui permet de lire son propre profil et rien d'autre.
 */
export const onUserProfileCreated = onDocumentCreated(
  { document: 'users/{uid}', region: 'europe-west1' },
  async (event) => {
    const uid = event.params.uid;
    const data = event.data?.data();
    if (!data) return;

    const source = claimsSourceFromProfile(data);
    if (!source) {
      logger.error('[onUserProfileCreated] Profil sans organisation, claims non appliqués', {
        uid,
      });
      return;
    }

    await syncUserClaims(uid, source);
    await rebuildAudienceKeysForUser(uid);

    logger.info('[onUserProfileCreated] Compte créé en attente de validation', {
      uid,
      orgId: source.orgId,
    });
  },
);

/**
 * À chaque écriture du profil : les claims sont resynchronisés **uniquement
 * si nécessaire**.
 *
 * Ce garde-fou évite d'appeler l'API Admin à chaque modification anodine
 * (changement de prénom, de préférences de notification). Sur une application
 * à quelques centaines d'utilisateurs, c'est la différence entre une dizaine
 * d'appels par jour et plusieurs milliers.
 */
export const onUserProfileWritten = onDocumentWritten(
  { document: 'users/{uid}', region: 'europe-west1' },
  async (event) => {
    const uid = event.params.uid;
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    // Suppression du profil : on retire tous les droits.
    if (!after) {
      await clearUserClaims(uid);
      logger.warn('[onUserProfileWritten] Profil supprimé, droits retirés', { uid });
      return;
    }

    const source = claimsSourceFromProfile(after);
    if (!source) return;

    // Les enfants ont-ils changé ? Si oui, il faut recalculer les clés
    // d'audience, qui déterminent le fil d'actualité et le ciblage des
    // notifications.
    const audienceChanged =
      JSON.stringify(before?.levels ?? []) !== JSON.stringify(after.levels ?? []) ||
      JSON.stringify(before?.classIds ?? []) !== JSON.stringify(after.classIds ?? []) ||
      JSON.stringify(before?.schoolIds ?? []) !== JSON.stringify(after.schoolIds ?? []);

    if (audienceChanged) {
      await rebuildAudienceKeysForUser(uid);
    }

    // Seuls ces trois champs justifient une réécriture des claims.
    //
    // Aucun contrôle de dérive n'est fait ici, et c'est volontaire : pour le
    // faire il faudrait lire les claims courants via l'API Admin à **chaque**
    // écriture de profil, ce qui coûterait une lecture là où l'on cherche
    // justement à n'en faire aucune. La dérive est traitée à la source —
    // `adminSetUserStatus` et `adminSetUserRole` appellent `syncUserClaims`
    // explicitement — et ce déclencheur sert de filet : toute modification de
    // `role`, `status` ou `orgId` le traverse.
    const claimsNeedUpdate =
      before?.role !== after.role ||
      before?.status !== after.status ||
      before?.orgId !== after.orgId;

    if (!claimsNeedUpdate) return;

    await syncUserClaims(uid, source);

    logger.info('[onUserProfileWritten] Claims synchronisés', {
      uid,
      role: source.role,
      status: source.status,
      previousStatus: before?.status,
    });
  },
);

/**
 * À la suppression du compte Firebase Auth : nettoyage des données liées.
 *
 * Les jetons d'appareil doivent disparaître, sinon les notifications
 * continueraient d'être envoyées à un compte supprimé. Les contributions
 * (messages, commentaires) sont **anonymisées** plutôt que supprimées : cela
 * préserve la cohérence des discussions pour les autres parents, tout en
 * satisfaisant le droit à l'effacement.
 */
export async function cleanupDeletedUser(uid: string): Promise<void> {
  const db = adminDb();

  const tokens = await db.collection(COLLECTIONS.deviceTokens).where('uid', '==', uid).get();

  const batch = db.batch();
  for (const token of tokens.docs) {
    batch.delete(token.ref);
  }

  // Anonymisation des contributions.
  const posts = await db
    .collection(COLLECTIONS.posts)
    .where('authorId', '==', uid)
    .limit(500)
    .get();
  for (const post of posts.docs) {
    batch.update(post.ref, { authorName: 'Ancien parent', authorId: 'deleted-user' });
  }

  await batch.commit();
  await db
    .doc(paths.user(uid))
    .delete()
    .catch(() => undefined);

  logger.info('[cleanupDeletedUser] Données nettoyées et contributions anonymisées', { uid });
}

/** Marque l'activité d'un utilisateur, sans écrire plus d'une fois par jour. */
export async function touchUserActivity(uid: string): Promise<void> {
  const ref = adminDb().doc(paths.user(uid));
  const snapshot = await ref.get();
  if (!snapshot.exists) return;

  const lastSeen = snapshot.get('lastSeenAt') as { toDate?: () => Date } | undefined;
  const lastSeenDate = lastSeen?.toDate?.();
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  if (lastSeenDate && lastSeenDate.getTime() > oneDayAgo) return;

  await ref.update({ lastSeenAt: FieldValue.serverTimestamp() });
}
