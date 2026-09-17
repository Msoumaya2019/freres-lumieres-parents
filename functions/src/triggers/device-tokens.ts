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
 * recopié. Il n'a encore aucun consommateur — l'écran de préférences n'existe
 * pas — et surtout sa portée n'est pas tranchée : doit-il couper aussi les
 * alertes `urgent`, alors que la spécification dit qu'elles atteignent tout le
 * monde « quelles que soient les préférences » ? Décider à la place du produit
 * serait poser une règle que personne n'a validée.
 */
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

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

    const profile = await adminDb().doc(paths.user(uid)).get();
    if (!profile.exists) {
      logger.error('[onDeviceTokenCreated] Profil introuvable, jeton laissé sans audience', {
        uid,
      });
      return;
    }

    const fields = tokenSyncFields(profile.data() ?? {});
    await snapshot.ref.update(fields);

    logger.info('[onDeviceTokenCreated] Jeton rattaché à son audience', {
      uid,
      keyCount: fields.audienceKeys.length,
    });
  },
);
