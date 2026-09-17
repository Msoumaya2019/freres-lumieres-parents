/**
 * Envoi de notifications push.
 *
 * ## Pourquoi une interface plutôt qu'un appel direct
 *
 * Le SDK JavaScript Firebase ne prend pas en charge la messagerie dans React
 * Native : `firebase/messaging` cible les navigateurs. Deux chemins existent
 * réellement (voir `docs/05-notifications.md`) :
 *
 *  - **Expo Notifications** → Expo Push Service → FCM (Android) et APNs (iOS).
 *    Retenu en V1 : aucun identifiant natif à gérer, builds sans Mac.
 *  - **`@react-native-firebase/messaging`** → FCM direct, avec les topics
 *    natifs, mais exige un `prebuild` et des credentials dans le dépôt.
 *
 * Tout le code d'envoi passe donc par cette interface. Basculer d'une
 * implémentation à l'autre ne touche qu'un fichier.
 *
 * ## Pourquoi ce module vit dans `@fl/shared`, et pas dans `@fl/firebase`
 *
 * Il n'importe **aucun** SDK Firebase : ni `firebase/firestore`, ni
 * `firebase-admin`. Le transport Expo Push est un simple appel HTTP. Or une
 * Cloud Function ne peut pas dépendre de `@fl/firebase`, qui embarque le SDK
 * client — c'est une règle du projet, et `paths.ts` va jusqu'à recopier les
 * noms de collections pour ne pas créer cette arête. Le module a donc été
 * déplacé ici : `@fl/shared` est le paquet sans SDK, et `functions` en dépend
 * déjà.
 *
 * Conséquence à ne pas défaire : ce fichier doit rester sans dépendance au
 * SDK Firebase. S'il en gagnait une, le paquet deviendrait inutilisable côté
 * serveur, et le retour du problème serait silencieux.
 */
import type { NotificationCategory } from '@fl/types';

import { audienceKeyToTopic } from '../audience.js';
import { isMandatoryNotificationCategory } from '../constants.js';

/** Un envoi de notification, décrit indépendamment du fournisseur. */
export interface PushMessage {
  title: string;
  body: string;
  /** Catégorie métier, utilisée pour le filtrage par préférences. */
  category: NotificationCategory;
  /** Clés d'audience ciblées. */
  audienceKeys: readonly string[];
  /** Données transportées jusqu'à l'application. */
  data: {
    type: string;
    orgId: string;
    sourceId?: string;
    deeplink?: string;
  };
  /** Priorité maximale pour les alertes urgentes. */
  priority?: 'default' | 'max';
}

/** Un destinataire : un jeton et ses préférences recopiées. */
export interface PushRecipient {
  token: string;
  platform: 'ios' | 'android' | 'web';
  /**
   * Interrupteur général de **cet appareil** (`deviceTokens.enabled`).
   *
   * Il ne coupe pas tout : les catégories obligatoires passent outre. La
   * décision est prise dans `filterRecipients`, à un seul endroit.
   */
  enabled: boolean;
  /** Catégories désactivées par l'utilisateur. */
  disabledCategories: readonly NotificationCategory[];
  /** Clés d'audience de l'appareil. */
  audienceKeys: readonly string[];
}

/**
 * Un ticket rendu par le service, associé au jeton qu'il concerne.
 *
 * ## Pourquoi le jeton voyage avec l'identifiant
 *
 * Un reçu ne le porte pas. `/push/getReceipts` répond par identifiant de
 * ticket, sans jamais dire à quel appareil il correspondait — vérifié dans la
 * documentation du service, et contre-intuitif : on lit un reçu
 * `DeviceNotRegistered` en sachant qu'un appareil est mort sans pouvoir dire
 * lequel. Le ticket est le seul endroit où l'identifiant et le jeton se
 * rencontrent ; il doit donc les garder ensemble, sinon la relecture ne peut
 * rien purger.
 */
export interface PushTicketRef {
  /** Identifiant à relire plus tard, tel que rendu par le service. */
  id: string;
  /** Jeton auquel ce ticket correspond. */
  token: string;
}

/**
 * Résultat d'un envoi, du point de vue du **ticket**.
 *
 * ## Ce que `accepted` compte exactement
 *
 * **Des messages pris en charge par le service, pas des messages reçus.** Un
 * ticket `ok` signifie qu'Expo Push a accepté le message et le remettra à FCM ou
 * APNs ; il ne dit rien de ce qui se passe ensuite — appareil éteint,
 * application désinstallée entre-temps, jeton révoqué.
 *
 * Ce champ s'appelait `delivered`, et c'était un mensonge par avance. Le seul
 * moyen de savoir ce qui a été **remis** au transport est de relire les reçus
 * (`readReceipts`) ; savoir ce que le **téléphone** a reçu n'existe pas.
 *
 * `tickets` est la clé de cette relecture. Les perdre rend l'envoi définitif :
 * on ne saura jamais ce qu'il est advenu.
 */
export interface PushResult {
  accepted: number;
  failed: number;
  /** Jetons à supprimer (appareil désinstallé, jeton expiré). */
  invalidTokens: string[];
  /** Tickets à relire, dans l'ordre des lots envoyés. */
  tickets: PushTicketRef[];
}

/**
 * Résultat de la relecture des reçus.
 *
 * `delivered` compte les messages **remis à FCM ou APNs** — pas reçus par le
 * téléphone, ce que personne ne peut savoir. `pending` compte les identifiants
 * dont le reçu n'était pas encore disponible : ni livrés, ni échoués.
 *
 * Une relecture qui échoue **lève** au lieu de rendre des zéros. « On ne sait
 * pas » n'est pas « rien n'est passé », et un zéro serait recopié tel quel dans
 * l'historique, où il deviendrait un fait.
 *
 * `deadTicketIds` porte des **identifiants**, pas des jetons, et ce n'est pas un
 * détail de forme : le reçu ne dit pas à quel appareil il correspond. Retrouver
 * le jeton est le travail de l'appelant, et il ne le peut que s'il l'a conservé
 * au moment de l'envoi — d'où `PushTicketRef`.
 */
export interface PushReceipts {
  delivered: number;
  failed: number;
  pending: number;
  /** Identifiants de ticket que le transport a déclarés morts. */
  deadTicketIds: string[];
}

/**
 * Envoi et relecture, sur le même objet.
 *
 * `readReceipts` ne relève pas du transport à proprement parler, mais elle
 * partage tout le reste avec l'envoi : le point d'entrée, l'authentification, le
 * délai d'attente, la journalisation. Deux objets à injecter là où un seul
 * suffit serait une complication sans contrepartie — et un test devrait simuler
 * les deux de la même façon.
 */
export interface PushDispatcher {
  /** Envoie un message à une liste de destinataires. */
  send(message: PushMessage, recipients: readonly PushRecipient[]): Promise<PushResult>;
  /**
   * Relit les reçus d'un envoi précédent.
   *
   * Expo recommande d'attendre **quinze minutes** avant de les demander, et les
   * efface au bout de **vingt-quatre heures**. Un identifiant sans reçu est
   * compté `pending` : ni livré, ni échoué.
   *
   * La relecture ne prend que des identifiants — c'est tout ce qu'un reçu
   * désigne. Le passage de l'identifiant au jeton se fait chez l'appelant.
   */
  readReceipts(ticketIds: readonly string[]): Promise<PushReceipts>;
}

/** Nom de canal Android, dérivé de la catégorie. */
export function androidChannelId(category: NotificationCategory): string {
  return `fl-${category}`;
}

/** Topics équivalents, pour une future implémentation FCM directe. */
export function messageTopics(message: PushMessage): string[] {
  return message.audienceKeys.map(audienceKeyToTopic);
}

/**
 * Filtre les destinataires selon leurs préférences.
 *
 * ## L'interrupteur général n'atteint pas les alertes obligatoires
 *
 * Un appareil dont `enabled` est faux ne reçoit plus rien — **sauf** les
 * catégories de `MANDATORY_NOTIFICATION_CATEGORIES`. Couper le bruit n'est pas
 * couper les alertes, et une fermeture d'école annoncée trop tard ne se
 * rattrape pas.
 *
 * Cette exception était auparavant appliquée **à moitié, en deux endroits** :
 * ici pour `disabledCategories`, et nulle part pour l'interrupteur général, que
 * la requête Firestore contraignait sans exception. Un parent ayant éteint les
 * notifications de son téléphone ne recevait donc **aucune** alerte urgente.
 * La requête ne contraint plus `enabled` (voir `queryTokensByAudience`), et la
 * décision se prend ici, à un seul endroit.
 *
 * ## Pourquoi `isMandatoryNotificationCategory` plutôt que `'urgent'`
 *
 * L'exception a une source unique, `MANDATORY_NOTIFICATION_CATEGORIES`.
 * Comparer à la chaîne `'urgent'` recopierait cette liste ici, et les deux
 * divergeraient le jour où une seconde catégorie deviendrait obligatoire.
 */
export function filterRecipients(
  recipients: readonly PushRecipient[],
  category: NotificationCategory,
): PushRecipient[] {
  if (isMandatoryNotificationCategory(category)) return [...recipients];
  return recipients.filter(
    (recipient) => recipient.enabled && !recipient.disabledCategories.includes(category),
  );
}

/** Découpe une liste en lots d'au plus `taille` éléments. */
function chunk<T>(items: readonly T[], taille: number): T[][] {
  const lots: T[][] = [];
  for (let index = 0; index < items.length; index += taille) {
    lots.push(items.slice(index, index + taille));
  }
  return lots;
}

/**
 * Regroupe les destinataires par lots.
 * L'API Expo Push accepte au maximum 100 jetons par requête.
 */
export function chunkRecipients(
  recipients: readonly PushRecipient[],
  batchSize = 100,
): PushRecipient[][] {
  return chunk(recipients, batchSize);
}

/**
 * Regroupe les identifiants de ticket par lots.
 *
 * `/push/getReceipts` accepte jusqu'à **1000** identifiants par requête, soit
 * dix fois plus que l'envoi. La valeur est mesurée dans la documentation du
 * service, pas devinée : un lot trop gros fait échouer la relecture **entière**,
 * et l'erreur serait interprétée comme « aucun reçu disponible » — donc comme
 * des messages en attente qui ne se résoudront jamais.
 */
export function chunkTicketIds(ticketIds: readonly string[], batchSize = 1000): string[][] {
  return chunk(ticketIds, batchSize);
}
