/**
 * Décision pure : que faut-il écrire dans l'aperçu d'un canal ?
 *
 * ## Pourquoi c'est ici et pas dans le déclencheur
 *
 * Le déclencheur ne décide rien : il lit un document, appelle cette fonction,
 * et écrit ce qu'elle rend. Toute la logique qui peut être fausse — comparer
 * deux dates, refuser un message mal formé, couper un aperçu — vit donc dans
 * une fonction sans SDK, éprouvable sans émulateur.
 *
 * ## Un déclencheur peut être livré dans le désordre
 *
 * Firestore garantit « au moins une fois », et **pas** l'ordre. Deux messages
 * écrits à quelques millisecondes d'intervalle peuvent donc arriver à l'envers,
 * et une écriture sans garde ferait reculer `lastMessageAt` — la liste des
 * canaux annoncerait alors un dernier message qui n'est pas le dernier. Le
 * garde est la comparaison avec la date déjà enregistrée.
 *
 * ## Ce que cette fonction ne fait pas
 *
 * Elle ne touche pas `stats.messageCount`. Compter les messages **visibles**
 * demande de suivre aussi la modération — masquer un message doit décrémenter —
 * et ce suivi n'existe pas encore. Un compteur qui dérive sans que rien ne le
 * signale est pire qu'un compteur absent, donc le champ reste à zéro jusqu'à ce
 * que la modération des messages soit écrite.
 */
import { messagePreview, toDate } from '@fl/shared';
import type { ChannelStats, DateLike } from '@fl/types';

/** Aperçu à écrire dans `channels/{channelId}.stats`. */
export interface ChannelActivity {
  /** Date du message, telle que le déclencheur l'écrira. */
  readonly lastMessageAt: Date;
  /** Première ligne du message, coupée. */
  readonly lastMessagePreview: string;
  /**
   * Nom de l'auteur, ou `null` si le message n'en porte pas.
   *
   * `null` et non une chaîne vide : l'écriture se fait en fusion, donc omettre
   * le champ **laisserait en place** le nom du message précédent. Le
   * déclencheur traduit `null` en suppression explicite.
   */
  readonly lastMessageAuthorName: string | null;
}

/** Message tel qu'un déclencheur le reçoit : des données Firestore non typées. */
export interface IncomingMessage {
  readonly body?: unknown;
  readonly authorName?: unknown;
  readonly createdAt?: unknown;
}

/**
 * Aperçu à écrire après l'arrivée d'un message, ou `null` s'il n'y a rien à
 * faire.
 *
 * Rend `null` dans trois cas, et chacun a sa raison :
 *
 *  - le corps du message est illisible ou vide — il n'y a rien à montrer ;
 *  - la date est illisible — sans elle, impossible de savoir si ce message est
 *    le dernier, et écrire reviendrait à le décider au hasard ;
 *  - la date n'est pas postérieure à celle déjà enregistrée — c'est le message
 *    d'un lot livré dans le désordre, ou un rejeu du même événement.
 */
export function channelActivityUpdate(params: {
  existing: ChannelStats | undefined;
  message: IncomingMessage;
}): ChannelActivity | null {
  const { existing, message } = params;

  const body = typeof message.body === 'string' ? message.body.trim() : '';
  if (!body) return null;

  const at = toDate(message.createdAt as DateLike | null | undefined);
  if (!at) return null;

  const previous = toDate(existing?.lastMessageAt ?? null);
  // `>=` et non `>` : un rejeu du même message porte la même date, et le
  // réécrire ne changerait rien tout en coûtant une écriture.
  if (previous && previous.getTime() >= at.getTime()) return null;

  const authorName = typeof message.authorName === 'string' ? message.authorName.trim() : '';

  return {
    lastMessageAt: at,
    lastMessagePreview: messagePreview(body),
    lastMessageAuthorName: authorName === '' ? null : authorName,
  };
}
