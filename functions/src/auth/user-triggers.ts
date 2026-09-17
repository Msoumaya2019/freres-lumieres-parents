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
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

import { adminDb } from '../lib/admin.js';
import { COLLECTIONS, paths } from '../lib/paths.js';
import { purgeDeviceTokens } from '../lib/token-purge.js';
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

/** Nom affiché à la place de celui d'un compte supprimé. */
const ANCIEN_PARENT = 'Ancien parent';

/**
 * Identifiant posé à la place de l'auteur d'un compte supprimé.
 *
 * Il sert aussi d'invariant à la boucle d'anonymisation : un document déjà
 * traité ne porte plus l'identifiant recherché, donc l'ensemble rétrécit à
 * chaque passage. C'est ce qui garantit la terminaison — voir
 * `anonymisePublications`.
 */
const AUTEUR_SUPPRIME = 'deleted-user';

/**
 * Publications anonymisées par lot.
 *
 * Un lot Firestore accepte 500 écritures, et l'anonymisation en fait
 * exactement une par publication : la borne du lot est donc la borne du
 * format, sans marge inventée.
 */
const TAILLE_LOT_ANONYMISATION = 500;

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
 * ## Ce qu'elle traite, et ce qu'elle ne traite pas
 *
 * Les jetons d'appareil disparaissent — par `purgeDeviceTokens`, comme partout
 * ailleurs dans le projet. Ils étaient auparavant supprimés par un lot écrit
 * sur place, qui ne découpait rien et partageait sa transaction avec
 * l'anonymisation : passé quelques centaines de publications, le lot dépassait
 * la limite de 500 écritures et **rien** n'était écrit, pas même la suppression
 * des jetons.
 *
 * Les **publications** de l'intéressé sont anonymisées plutôt que supprimées :
 * cela préserve la cohérence des discussions pour les autres parents, tout en
 * satisfaisant le droit à l'effacement.
 *
 * Les **commentaires** (`posts/{id}/comments`) et les **messages**
 * (`channels/{id}/messages`) ne sont **pas** traités. Ce bloc a annoncé le
 * contraire — « les contributions (messages, commentaires) » — pendant que le
 * code ne touchait qu'aux publications. Les atteindre demande une requête de
 * groupe de collections, donc un index de groupe à déclarer : le manque est
 * écrit dans `docs/04-security.md` § 8 et porté par `docs/08-roadmap.md`,
 * plutôt que promis ici.
 */
export async function cleanupDeletedUser(uid: string, db: Firestore = adminDb()): Promise<void> {
  const jetons = await db.collection(COLLECTIONS.deviceTokens).where('uid', '==', uid).get();
  const purgedTokens = await purgeDeviceTokens(
    jetons.docs.map((jeton) => jeton.id),
    db,
  );

  const anonymisedPosts = await anonymisePublications(uid, db);

  await db
    .doc(paths.user(uid))
    .delete()
    .catch(() => undefined);

  logger.info('[cleanupDeletedUser] Données nettoyées et publications anonymisées', {
    uid,
    purgedTokens,
    anonymisedPosts,
  });
}

/**
 * Remplace l'identité de l'auteur sur **toutes** ses publications, et rend le
 * nombre de documents traités.
 *
 * ## Pourquoi la requête est relancée au lieu d'être paginée
 *
 * La version précédente s'arrêtait au premier lot de 500, sans le dire : un
 * parent qui avait publié davantage gardait son nom sur le reste, et rien ne le
 * signalait. Un `offset` aurait rejoué ou sauté des lignes, puisque les
 * documents changent en cours de route ; un curseur aurait demandé un
 * `orderBy`, donc un index composite à déclarer et à ne pas oublier.
 *
 * La requête est donc relancée **telle quelle** jusqu'à ce qu'elle ne rende
 * plus rien. Comme chaque passage remplace `authorId`, l'ensemble rétrécit à
 * chaque tour : la terminaison ne dépend d'aucune borne arbitraire.
 *
 * ## Pourquoi la base est injectable
 *
 * C'est la seule façon d'éprouver le défaut qu'elle corrige. Un test de source
 * vérifierait que la boucle existe ; il ne vérifierait pas qu'un parent de
 * mille deux cents publications est **entièrement** anonymisé, ni qu'aucun lot
 * ne dépasse la limite du service. Le paramètre a une valeur par défaut, donc
 * les appelants ne le voient pas.
 */
export async function anonymisePublications(
  uid: string,
  db: Firestore = adminDb(),
): Promise<number> {
  // Un profil dont l'identifiant serait déjà le marqueur ferait tourner la
  // boucle sans fin — chaque passage retrouverait les documents qu'il vient
  // d'écrire. Le cas est hors d'atteinte, les identifiants Firebase Auth étant
  // des chaînes aléatoires de 28 caractères, mais la boucle ne peut pas se
  // terminer sans cette ligne, et une boucle sans fin dans une Function coûte.
  if (uid === AUTEUR_SUPPRIME) return 0;

  let anonymises = 0;

  for (;;) {
    const lot = await db
      .collection(COLLECTIONS.posts)
      .where('authorId', '==', uid)
      .limit(TAILLE_LOT_ANONYMISATION)
      .get();

    if (lot.empty) return anonymises;

    const batch = db.batch();
    for (const publication of lot.docs) {
      batch.update(publication.ref, { authorName: ANCIEN_PARENT, authorId: AUTEUR_SUPPRIME });
    }
    await batch.commit();

    anonymises += lot.size;
  }
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
