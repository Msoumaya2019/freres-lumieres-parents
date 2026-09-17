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
import { audienceChanged, rebuildAudienceKeysForUser } from './audience.js';
import {
  syncDeviceTokensForUser,
  tokenSyncFields,
  tokensNeedResync,
} from '../triggers/device-tokens.js';

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

    // 1. Les clés d'audience de l'utilisateur.
    //
    // Elles dépendent du rattachement — écoles, niveaux, classes — mais aussi
    // du rôle et des organisations : c'est le rôle qui ouvre la clé `fcpe:`.
    // Ne comparer que les rattachements laissait un parent promu au rôle
    // `fcpe` sans accès aux contenus de la FCPE, sans que rien n'échoue.
    let profileAfter = after;
    if (audienceChanged(before, after)) {
      const audienceKeys = await rebuildAudienceKeysForUser(uid);
      // `after` est le document tel que le client l'a écrit : ses clés sont
      // encore les anciennes. La suite doit travailler sur la version
      // recalculée, sinon on recopierait l'état d'avant dans les jetons.
      profileAfter = { ...after, audienceKeys };
    }

    // 2. Les jetons d'appareil portent une copie de ces clés et des
    //    préférences de catégorie.
    //
    //    Ils ne sont réécrits que si quelque chose dont ils dépendent a bougé.
    //    C'est indispensable pour les préférences : elles sont posées par
    //    utilisateur et recopiées par appareil, donc une case décochée doit
    //    atteindre **tous** les appareils du parent, pas seulement celui qui
    //    l'a saisie.
    if (tokensNeedResync(before, profileAfter)) {
      const synced = await syncDeviceTokensForUser(uid, tokenSyncFields(profileAfter));
      if (synced > 0) {
        logger.info('[onUserProfileWritten] Jetons resynchronisés', { uid, synced });
      }
    }

    // 3. Seuls ces trois champs justifient une réécriture des claims.
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
