/**
 * Déclencheurs liés au cycle de vie des comptes et au rattachement des familles.
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
 * À côté de ce parcours, `onUserChildrenWritten` surveille la sous-collection
 * des enfants : c'est elle qui porte l'école, le niveau et la classe dont les
 * clés d'audience se déduisent.
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
import { audienceChanged, childAudienceChanged, rebuildAudienceKeysForUser } from './audience.js';
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

    // Suppression du profil : droits retirés, et données nettoyées.
    //
    // Retirer les droits ne suffit **pas** à faire taire un appareil. Le chemin
    // d'envoi d'une notification ne consulte jamais les Custom Claims : il
    // interroge `deviceTokens` par organisation et par clés d'audience. Un
    // compte supprimé continuerait donc de recevoir les notifications de sa
    // classe, indéfiniment.
    //
    // Ce cas se produit dès qu'un profil est supprimé autrement que par
    // `adminDeleteUser` — un effacement depuis la console Firebase, par
    // exemple —, puisque c'est le seul appelant de `cleanupDeletedUser`.
    // Celui-ci est idempotent : sur un profil déjà absent, il ne fait
    // qu'effacer les jetons et anonymiser les contributions.
    if (!after) {
      await clearUserClaims(uid);
      await cleanupDeletedUser(uid);
      logger.warn('[onUserProfileWritten] Profil supprimé, droits retirés et données nettoyées', {
        uid,
      });
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
 * À chaque modification des enfants : les clés du parent sont recalculées.
 *
 * ## Le trou que ce déclencheur ferme
 *
 * `rebuildAudienceKeysForUser` lit la sous-collection `children` — c'est la
 * seule façon de construire `level:{école}:{niveau}` quand une famille a des
 * enfants dans deux écoles. Mais **rien ne surveillait cette sous-collection**.
 * Le profil ne portait donc pas trace du nouvel enfant avant sa prochaine
 * réécriture : le parent ne voyait pas le fil de la classe, et rien n'échouait.
 * Le formulaire d'inscription écrit l'enfant et le profil d'un seul geste, ce
 * qui masquait le défaut ; ajouter un enfant plus tard ne faisait rien.
 *
 * Le filtre est volontairement étroit : seuls l'école, le niveau et la classe
 * comptent. Corriger l'orthographe d'un prénom ne doit pas coûter une lecture
 * de profil, une requête sur les enfants et une écriture.
 *
 * ## Le recalcul se fait en deux passes, et c'est normal
 *
 * `rebuildAudienceKeysForUser` écrit `levels`, `classIds`, `schoolIds` et
 * `audienceKeys` sur le profil, ce qui traverse `onUserProfileWritten` : la
 * recopie vers les jetons d'appareil y est faite, et n'est donc pas répétée
 * ici. La seconde passe recalcule les mêmes valeurs, la comparaison devient
 * fausse et la chaîne s'arrête. Deux lectures de profil et deux écritures pour
 * un enfant ajouté — le prix de ne pas dupliquer la logique de recalcul.
 */
export const onUserChildrenWritten = onDocumentWritten(
  { document: 'users/{uid}/children/{childId}', region: 'europe-west1' },
  async (event) => {
    const uid = event.params.uid;
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    if (!childAudienceChanged(before, after)) return;

    const audienceKeys = await rebuildAudienceKeysForUser(uid);

    logger.info('[onUserChildrenWritten] Clés d’audience recalculées', {
      uid,
      keyCount: audienceKeys.length,
      created: !before,
      deleted: !after,
    });
  },
);

/**
 * Nettoyage des données d'un compte supprimé.
 *
 * Appelée de deux endroits, et c'est volontaire :
 *
 *  - `adminDeleteUser`, après suppression du compte Firebase Auth ;
 *  - `onUserProfileWritten`, quand le profil disparaît sans passer par là —
 *    un effacement depuis la console Firebase, par exemple.
 *
 * Elle est donc **idempotente** : rien n'est supposé sur l'état antérieur, et
 * supprimer un document déjà absent est sans effet.
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
