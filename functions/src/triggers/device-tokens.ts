/**
 * Synchronisation des jetons d'appareil avec le profil.
 *
 * ## Pourquoi le serveur, et pas le client
 *
 * Un jeton porte deux champs recopiés du profil : `audienceKeys` et
 * `disabledCategories`. Les règles Firestore les refusent au client — vides à
 * la création, puis figés — pour deux raisons différentes :
 *
 *  - `audienceKeys` est une **autorisation**. Le serveur sélectionne les
 *    destinataires d'une notification en le lisant, donc un client qui le
 *    déclare choisit qui il devient. Les règles ne peuvent pas vérifier une
 *    clé `class:` ou `level:` : elles ne lisent pas les enfants de l'appelant.
 *  - `disabledCategories` est une **préférence**, donc inoffensive en soi, mais
 *    elle est posée par utilisateur et recopiée par appareil. Un client ne
 *    peut atteindre que l'appareil courant : propriétaire du champ, il
 *    laisserait diverger les autres appareils du même parent.
 *
 * ## Les deux replis ne vont pas dans le même sens, et c'est délibéré
 *
 *  - **Ne rien recevoir** (`audienceKeys`) échoue **fermé** : compte non
 *    `active`, profil illisible, champ absent → le tableau est vide. Un
 *    appareil dont on ne sait rien ne doit rien recevoir, car une notification
 *    révèle son contenu dans le bandeau de l'écran de verrouillage.
 *  - **La préférence** (`disabledCategories`) échoue **ouvert** : des
 *    préférences illisibles sont traitées comme « rien de désactivé ». Rendre
 *    muet un parent dont le profil est incomplet serait pire que de lui
 *    envoyer une notification qu'il aurait pu vouloir ignorer — une fermeture
 *    d'école manquée ne se rattrape pas.
 *
 * ## La chaîne d'invocations, et pourquoi elle s'arrête
 *
 * ```
 *  deviceTokens/{token} créé par le client
 *        │
 *        ├─ onDeviceTokenCreated  → écrit sur le même document
 *        │                          (aucun déclencheur sur `update`, pas de boucle)
 *        │
 *  users/{uid} modifié (statut ou rattachement)
 *        │
 *        └─ onUserProfileWritten → syncDeviceTokensForUser
 *                                   → écrit dans deviceTokens (aucun déclencheur)
 * ```
 *
 * Aucun déclencheur n'écoute les mises à jour de `deviceTokens` : la chaîne se
 * termine toujours, et une notification ne peut pas en déclencher une autre.
 *
 * ## Ce que ces fonctions ne font pas
 *
 * L'interrupteur général (`users/{uid}.notificationPrefs.enabled`) n'est **pas**
 * recopié : l'écran de préférences n'existe pas, donc rien ne l'écrit, et un
 * champ que personne ne peut poser est une donnée morte.
 *
 * Sa portée, en revanche, est **tranchée** : il ne coupera pas les alertes
 * `urgent`. Le même choix est déjà appliqué à `deviceTokens.enabled`, dont
 * `filterRecipients` fait passer les catégories de
 * `MANDATORY_NOTIFICATION_CATEGORIES` outre. Le jour où ce champ sera recopié,
 * il devra lire cette liste, et non comparer à la chaîne `'urgent'`.
 */
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import type { DocumentReference } from 'firebase-admin/firestore';

import { notificationPrefsSchema } from '@fl/shared';
import type { NotificationCategory } from '@fl/types';

import { adminDb } from '../lib/admin.js';
import { COLLECTIONS, paths } from '../lib/paths.js';

/** Les deux champs d'un jeton que le serveur possède. */
export interface DeviceTokenSyncFields {
  audienceKeys: string[];
  disabledCategories: NotificationCategory[];
}

/** Profil réduit à ce dont dépendent ces deux champs. */
export interface TokenSyncSource {
  status?: unknown;
  audienceKeys?: unknown;
  notificationPrefs?: unknown;
  /** Lu par la seule garde de changement de porteur, jamais par la signature. */
  uid?: unknown;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/**
 * Catégories désactivées, lues dans les préférences du profil.
 *
 * Le schéma est celui de `@fl/shared`, donc le même que celui qui valide la
 * saisie côté client : les Cloud Functions revalident, elles ne font pas
 * confiance à ce qui est en base.
 */
function readDisabledCategories(prefs: unknown): NotificationCategory[] {
  const parsed = notificationPrefsSchema.safeParse(prefs);
  if (!parsed.success) return [];
  return [...parsed.data.disabledCategories];
}

/**
 * Champs d'un jeton, déduits du profil.
 *
 * Le seul repli fermé est celui du statut. Un compte qui n'est pas `active` ne
 * reçoit rien — et comme pour les Custom Claims, l'absence de statut vaut
 * `pending`, jamais `active`.
 */
export function tokenSyncFields(profile: TokenSyncSource): DeviceTokenSyncFields {
  if (profile.status !== 'active') {
    return { audienceKeys: [], disabledCategories: [] };
  }

  return {
    audienceKeys: strings(profile.audienceKeys),
    disabledCategories: readDisabledCategories(profile.notificationPrefs),
  };
}

/**
 * Signature de tout ce dont un jeton dépend.
 *
 * Comparer une signature plutôt que trois champs un par un évite le défaut
 * classique : ajouter demain un champ dérivé et oublier de l'ajouter à la
 * condition de resynchronisation. Les tableaux sont triés — leur ordre n'a pas
 * de sens ici, et un réordonnancement ne doit pas coûter une écriture par
 * appareil.
 */
export function tokenSyncSignature(profile: TokenSyncSource | undefined): string {
  if (!profile) return 'absent';
  return JSON.stringify([
    profile.status ?? null,
    strings(profile.audienceKeys).sort(),
    readDisabledCategories(profile.notificationPrefs).sort(),
  ]);
}

/** Les jetons d'un utilisateur doivent-ils être resynchronisés ? */
export function tokensNeedResync(
  before: TokenSyncSource | undefined,
  after: TokenSyncSource,
): boolean {
  return tokenSyncSignature(before) !== tokenSyncSignature(after);
}

/**
 * Le porteur du jeton a-t-il changé ?
 *
 * C'est la seule mise à jour d'un jeton qui oblige à recalculer ses champs
 * dérivés : l'appareil a un nouveau propriétaire, et les règles ont exigé
 * qu'il reparte de zéro. Les autres écritures du client — `enabled`,
 * `lastUsedAt` — ne changent rien à l'audience, et les recalculer coûterait
 * une lecture de profil à chaque ouverture de l'application.
 *
 * Cette garde est aussi ce qui **termine la chaîne**. Le déclencheur écrit
 * dans le document qu'il écoute, donc il est rappelé : mais `uid` est alors
 * inchangé, et il sort immédiatement — une invocation, aucune lecture, aucune
 * écriture. Sans cette garde, la boucle serait infinie.
 *
 * Une création (`before` absent) ou une suppression (`after` absent) ne
 * compte pas comme un changement de porteur : la création est traitée par
 * `onDeviceTokenCreated`, et un jeton supprimé n'a plus rien à recaler.
 */
export function tokenOwnerChanged(
  before: TokenSyncSource | undefined,
  after: TokenSyncSource | undefined,
): boolean {
  if (!before || !after) return false;
  return before.uid !== after.uid;
}

/**
 * Recopie les champs dérivés sur tous les jetons d'un utilisateur.
 *
 * Une requête, puis une écriture par appareil. Le nombre d'appareils d'un
 * parent se compte sur les doigts d'une main, donc aucun découpage en lots
 * n'est nécessaire — mais la requête, elle, est filtrée par `uid`, ce qui
 * évite de parcourir l'index entier.
 */
export async function syncDeviceTokensForUser(
  uid: string,
  fields: DeviceTokenSyncFields,
): Promise<number> {
  const db = adminDb();
  const tokens = await db.collection(COLLECTIONS.deviceTokens).where('uid', '==', uid).get();

  if (tokens.empty) return 0;

  const batch = db.batch();
  for (const token of tokens.docs) {
    batch.update(token.ref, {
      audienceKeys: fields.audienceKeys,
      disabledCategories: fields.disabledCategories,
    });
  }
  await batch.commit();

  return tokens.size;
}

/**
 * Lit le profil d'un porteur et recopie ses champs dérivés sur le jeton.
 *
 * Les deux déclencheurs ci-dessous ne diffèrent que par leur condition
 * d'entrée ; le travail, lui, est identique.
 */
async function applyTokenSync(uid: string, ref: DocumentReference, source: string): Promise<void> {
  const profile = await adminDb().doc(paths.user(uid)).get();
  if (!profile.exists) {
    // Profil introuvable : le jeton garde des clés vides, et l'appareil ne
    // reçoit rien. C'est le seul comportement sûr.
    logger.error(`[${source}] Profil introuvable, jeton laissé sans audience`, { uid });
    return;
  }

  const fields = tokenSyncFields(profile.data() ?? {});
  await ref.update(fields);

  logger.info(`[${source}] Jeton rattaché à son audience`, {
    uid,
    keyCount: fields.audienceKeys.length,
  });
}

/**
 * À la création d'un jeton : le serveur le rattache à l'audience de son
 * porteur.
 *
 * Sans cette étape, le jeton resterait éternellement avec `audienceKeys: []` —
 * l'état que les règles imposent au client — et **aucun parent ne recevrait
 * jamais la moindre notification**. C'était le cas : la fonction de recopie
 * existait, mais rien ne l'appelait.
 */
export const onDeviceTokenCreated = onDocumentCreated(
  { document: 'deviceTokens/{token}', region: 'europe-west1' },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const uid = snapshot.get('uid');
    if (typeof uid !== 'string' || uid.length === 0) {
      // Le jeton existe sans porteur : il ne recevra rien, et le taire est le
      // seul comportement sûr.
      logger.error('[onDeviceTokenCreated] Jeton sans uid : audience non appliquée', {
        token: event.params.token,
      });
      return;
    }

    await applyTokenSync(uid, snapshot.ref, 'onDeviceTokenCreated');
  },
);

/**
 * Au changement de porteur : le jeton est recalculé pour le nouveau.
 *
 * Les règles ont exigé que `audienceKeys` et `disabledCategories` soient
 * remis à vide lors d'un transfert — sans quoi le nouveau porteur hériterait
 * des notifications de l'ancien. Il faut donc les remplir, sinon l'appareil
 * resterait muet pour toujours : le déclencheur de création ne se déclenche
 * plus, et rien d'autre ne recalcule un jeton existant.
 *
 * La chaîne s'arrête d'elle-même : l'écriture ci-dessous rappelle ce
 * déclencheur, mais `uid` est alors inchangé et `tokenOwnerChanged` le fait
 * sortir sans rien lire ni écrire.
 */
export const onDeviceTokenOwnerChanged = onDocumentUpdated(
  { document: 'deviceTokens/{token}', region: 'europe-west1' },
  async (event) => {
    const change = event.data;
    if (!change) return;

    if (!tokenOwnerChanged(change.before.data(), change.after.data())) return;

    const uid = change.after.get('uid');
    if (typeof uid !== 'string' || uid.length === 0) {
      logger.error('[onDeviceTokenOwnerChanged] Nouveau porteur illisible', {
        token: event.params.token,
      });
      return;
    }

    await applyTokenSync(uid, change.after.ref, 'onDeviceTokenOwnerChanged');
  },
);
