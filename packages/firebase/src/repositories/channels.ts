/**
 * Dépôt des canaux de discussion et de leurs messages.
 *
 * ## Un seul écouteur, et il est ici
 *
 * Le critère de sortie de la phase 6 est explicite : « un seul listener temps
 * réel dans toute l'application, celui du canal ouvert ». La liste des canaux
 * se lit donc en **une passe** (`getDocs`), et seule la conversation ouverte
 * s'abonne. Ce n'est pas une économie de confort : la liste ne peut pas se
 * réordonner sous la pagination — elle compte treize entrées fixes —, donc
 * l'abonnement n'y apporterait rien et coûterait une lecture par visiteur.
 *
 * ## Pas de pagination par curseur pour les messages
 *
 * Le fil charge les trente derniers messages et « charger plus » **élargit la
 * fenêtre** au lieu d'avancer un curseur. C'est ce qui permet de tenir les deux
 * exigences à la fois : un fil paginé à trente, et un seul abonnement.
 *
 * L'ordre est rendu **chronologique** (du plus ancien au plus récent) alors que
 * la requête est descendante : Firestore ne sait pas rendre les *derniers* trente
 * autrement, et l'écran veut lire de haut en bas.
 *
 * ## `createdAt` doit être écrit à la création, et ce n'est pas décoratif
 *
 * La règle de modification par l'auteur compare cinq champs avec `unchanged()`,
 * qui **lève une erreur sur un champ absent** — et une erreur vaut refus. Un
 * message créé sans `attachments`, `reactions`, `authorName`, `authorRole` ou
 * `createdAt` ne pourrait donc plus jamais être corrigé par son auteur.
 *
 * ## Ce que ce dépôt ne fait pas, et pourquoi
 *
 * - **Aucune création de canal.** Les treize canaux viennent du script
 *   d'amorçage, qui écrit avec le SDK Admin. Aucun écran n'en crée en phase 6.
 * - **Aucune réaction sur un message.** Il n'existe ni chemin ni règle pour
 *   `channels/{id}/messages/{mid}/reactions` : l'écriture serait refusée par
 *   défaut. Le modèle `ChannelMessage.reactions` existe et est figé par les
 *   règles, mais rien ne l'alimente encore.
 * - **Aucun signalement de message.** L'infrastructure des signalements est la
 *   phase 7 ; `ModerationTargetType` accepte déjà `'message'`, ce qui n'est pas
 *   la même chose qu'un dépôt capable de l'écrire.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

import { CHANNEL_TYPES, messageInputSchema } from '@fl/shared';
import type { MessageInput } from '@fl/shared';
import type { Channel, ChannelMessage, ChannelType, UserRole } from '@fl/types';

import { invalidArgument, toAppError } from '../errors.js';
import { paths } from '../paths.js';

/** Messages chargés à l'ouverture d'un canal, et à chaque élargissement. */
export const MESSAGE_WINDOW_SIZE = 30;

/** Longueur de l'aperçu conservé d'un message cité. */
const REPLY_PREVIEW_LENGTH = 120;

/** Auteur d'un message : le strict nécessaire pour écrire le document. */
export interface MessageAuthor {
  id: string;
  name: string;
  role: UserRole;
}

export interface SendMessageParams {
  channelId: string;
  /**
   * Auteur du message.
   *
   * Passé explicitement plutôt que lu d'une session, comme `voterId` pour les
   * sondages : le dépôt reste testable, et `authorName` / `authorRole` sont
   * **dénormalisés** dans le message — la règle les fige, donc les recopier est
   * le seul moyen de les avoir.
   */
  author: MessageAuthor;
  input: MessageInput;
  /**
   * Aperçu du message cité, si `input.replyToId` est renseigné.
   *
   * Tronqué ici plutôt que par l'appelant : deux écrans qui tronqueraient
   * différemment produiraient deux aperçus pour un même message.
   */
  replyToPreview?: string;
}

export interface SubscribeToMessagesParams {
  channelId: string;
  /** Taille de la fenêtre. Doit valoir au moins `MESSAGE_WINDOW_SIZE`. */
  windowSize?: number;
  onChange: (messages: ChannelMessage[]) => void;
  onError?: (error: unknown) => void;
}

export interface ChannelRepository {
  /**
   * Les canaux de l'organisation, dans l'ordre d'affichage.
   *
   * `isFcpe` n'est pas un confort : la règle de lecture est une disjonction
   * (`type != 'fcpe' || isFcpe()`), et Firestore refuse une requête **entière**
   * quand elle pourrait rendre un document interdit. Un parent doit donc
   * écarter le type `fcpe` lui-même — voir `channelsQuery`.
   */
  listChannels(params: { orgId: string; isFcpe: boolean }): Promise<Channel[]>;
  /** Un canal par son identifiant, ou `null`. */
  getChannel(channelId: string): Promise<Channel | null>;
  /**
   * S'abonne aux derniers messages d'un canal. Rend la fonction de désabonnement.
   *
   * Un seul abonnement doit vivre à la fois : c'est l'écran qui le garantit, en
   * désabonnant avant d'en ouvrir un autre.
   */
  subscribeToMessages(params: SubscribeToMessagesParams): () => void;
  /** Écrit un message. Rend son identifiant. */
  sendMessage(params: SendMessageParams): Promise<string>;
}

/** Document Firestore → `Channel`. L'identifiant est porté par le chemin. */
function mapChannel(snapshot: QueryDocumentSnapshot): Channel {
  return { ...(snapshot.data() as Omit<Channel, 'id'>), id: snapshot.id };
}

/** Document Firestore → `ChannelMessage`, dans le même esprit. */
function mapMessage(snapshot: QueryDocumentSnapshot): ChannelMessage {
  return { ...(snapshot.data() as Omit<ChannelMessage, 'id'>), id: snapshot.id };
}

export function createChannelRepository(db: Firestore): ChannelRepository {
  return { listChannels, getChannel, subscribeToMessages, sendMessage };

  async function listChannels(params: { orgId: string; isFcpe: boolean }): Promise<Channel[]> {
    try {
      const snapshot = await getDocs(channelsQuery(db, params));
      return snapshot.docs.map(mapChannel);
    } catch (error) {
      throw toAppError(error);
    }
  }

  async function getChannel(channelId: string): Promise<Channel | null> {
    try {
      const snapshot = await getDoc(doc(db, paths.channel(channelId)));
      return snapshot.exists() ? mapChannel(snapshot) : null;
    } catch (error) {
      throw toAppError(error);
    }
  }

  function subscribeToMessages(params: SubscribeToMessagesParams): () => void {
    const { channelId, windowSize = MESSAGE_WINDOW_SIZE, onChange, onError } = params;

    return onSnapshot(
      query(
        collection(db, paths.channelMessages(channelId)),
        // `status` est contraint, et ce n'est pas un ornement : la règle de
        // lecture d'un message exige `status == 'visible'`, donc une requête
        // qui ne le contraint pas est refusée en bloc — elle *pourrait* rendre
        // un message masqué.
        where('status', '==', 'visible'),
        orderBy('createdAt', 'desc'),
        limit(windowSize),
      ),
      (snapshot) => {
        // La requête est descendante pour prendre les *derniers* messages ;
        // l'écran, lui, lit du plus ancien au plus récent.
        onChange(snapshot.docs.map(mapMessage).reverse());
      },
      (error) => {
        if (onError) {
          onError(toAppError(error));
          return;
        }
        // Sans gestionnaire, un abonnement refusé est parfaitement silencieux :
        // l'écran resterait vide sans que rien ne dise pourquoi.
        throw toAppError(error);
      },
    );
  }

  async function sendMessage(params: SendMessageParams): Promise<string> {
    const { channelId, author, input, replyToPreview } = params;

    const parsed = messageInputSchema.safeParse(input);
    if (!parsed.success) {
      throw invalidArgument('Message invalide.', {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const data = parsed.data;
    const reference = doc(collection(db, paths.channelMessages(channelId)));
    const now = serverTimestamp();

    try {
      await setDoc(reference, {
        channelId,
        authorId: author.id,
        // Voir l'en-tête : ces trois champs sont figés par la règle de
        // modification, et `unchanged()` lève sur un champ absent. Les omettre
        // rendrait le message définitivement incorrigible.
        authorName: author.name,
        authorRole: author.role,
        body: data.body,
        attachments: data.attachments,
        reactions: {},
        // `replyToPreview` n'est pas un champ du schéma : il se déduit du
        // message cité, que le dépôt ne lit pas. L'appelant le fournit.
        ...(data.replyToId
          ? {
              replyToId: data.replyToId,
              ...(replyToPreview
                ? { replyToPreview: truncate(replyToPreview, REPLY_PREVIEW_LENGTH) }
                : {}),
            }
          : {}),
        status: 'visible',
        reportCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      return reference.id;
    } catch (error) {
      throw toAppError(error);
    }
  }
}

/**
 * Requête de la liste des canaux.
 *
 * ## Pourquoi le type est contraint pour un parent
 *
 * La règle de lecture est `orgId == orgId() && (type != 'fcpe' || isFcpe())`.
 * Pour un membre FCPE, `isFcpe()` est vrai et la requête n'a rien à prouver de
 * plus. Pour un parent, la règle se réduit à `type != 'fcpe'`, que Firestore ne
 * peut satisfaire que si la requête porte la contrainte elle-même : une règle
 * n'est pas un filtre, et une requête qui *pourrait* rendre un canal interdit
 * est refusée entièrement.
 *
 * Les deux branches sont **mesurées** par `firestore.rules.test.ts` : la
 * requête contrainte réussit, l'autre est refusée en `permission-denied`.
 *
 * ## La liste des types est dérivée, jamais recopiée
 *
 * `VISIBLE_CHANNEL_TYPES` se calcule à partir de `CHANNEL_TYPES`. Recopier les
 * quatre valeurs à la main ferait qu'un type ajouté au modèle resterait absent
 * de la requête, et le canal correspondant deviendrait invisible pour les
 * parents sans qu'aucun test ne tombe.
 */
export function channelsQuery(db: Firestore, params: { orgId: string; isFcpe: boolean }): Query {
  const channels = collection(db, paths.channels());
  const { orgId, isFcpe } = params;

  return isFcpe
    ? query(channels, where('orgId', '==', orgId), orderBy('order', 'asc'))
    : query(
        channels,
        where('orgId', '==', orgId),
        where('type', 'in', [...VISIBLE_CHANNEL_TYPES]),
        orderBy('order', 'asc'),
      );
}

/** Types de canal qu'un parent peut lister : `CHANNEL_TYPES` sans `fcpe`. */
export const VISIBLE_CHANNEL_TYPES: readonly ChannelType[] = CHANNEL_TYPES.filter(
  (type) => type !== 'fcpe',
);

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}
