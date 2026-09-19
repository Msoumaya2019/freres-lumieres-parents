/**
 * Regroupement des messages d'un canal, et annonce du lot.
 *
 * ## Pourquoi regrouper, et pas notifier à chaque message
 *
 * Un canal de discussion actif produirait sinon quarante notifications pour une
 * conversation de dix minutes. Le document de référence l'énonce comme une
 * règle — « on regroupe » — et c'est le seul déclencheur qui l'exige. Les
 * messages sont donc accumulés sur une fenêtre de cinq minutes, puis annoncés
 * en une fois : « 3 nouveaux messages ».
 *
 * ## Ce que le regroupement casse, et qu'il a fallu réparer
 *
 * « On ne se notifie jamais soi-même » ne peut plus s'écrire comme un abandon
 * d'envoi. Un message seul dans un canal calme forme un lot dont l'auteur est
 * la seule personne concernée : renoncer à envoyer ne protégerait personne,
 * cela **éteindrait la notification pour tout le monde** — le demandeur
 * n'obtiendrait aucune réponse parce qu'il a posé sa question. La règle est
 * donc déplacée : le lot part, et **les auteurs du lot sont exclus des
 * destinataires**. Un message d'Alice prévient tout le canal sauf Alice.
 *
 * ## La conséquence assumée : un compte commun à tous
 *
 * Un seul envoi porte un seul texte, donc un seul compte. Dans un lot où Alice
 * a écrit deux messages et Bob un seul, Alice lit « 3 nouveaux messages » alors
 * que deux étaient les siens. Le lui dire autrement demanderait un envoi par
 * destinataire — c'est-à-dire, exactement, ce que le regroupement supprime.
 *
 * ## Un lot vidé de sa substance n'est pas annoncé
 *
 * Les messages sont **relus** au moment de l'annonce, pas recopiés dans le lot.
 * Un message masqué par un modérateur pendant la fenêtre ne compte donc plus :
 * annoncer « 3 nouveaux messages » sous un canal qui n'en montre que deux
 * enverrait les parents chercher ce qui n'est pas là. Si plus rien n'est
 * visible, le lot disparaît sans un mot.
 *
 * ## Le lien profond, maintenant que l'écran existe
 *
 * Le transport a longtemps n'emporté **aucun lien** : `channel` était un type
 * de cible connu, mais `TYPES_SANS_ROUTE` l'excusait faute d'écran pour
 * l'ouvrir. Un lien reconnu puis refusé à l'ouverture laisse le tap sans
 * effet, ce qui se lit comme une application cassée — pire que pas de lien du
 * tout. L'écran de discussion existe depuis la phase 6 : la ligne d'excuse a
 * disparu, et c'est ici que le lien s'écrit.
 */
import type { Audience } from '@fl/types';
import { buildDeeplink, type PushMessage } from '@fl/shared';

import { clesAudience } from './recipients.js';

/** Durée de la fenêtre de regroupement, en minutes. */
export const DIGEST_WINDOW_MINUTES = 5;

/** Chaîne non vide, ou `null`. */
function texte(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Date lisible, ou `null`.
 *
 * Firestore rend un `Timestamp`, les tests une `Date` : les deux formes
 * arrivent ici, et une troisième — un objet d'une autre nature, ou une chaîne —
 * doit être traitée comme illisible plutôt que de faire lever la fonction.
 */
function dateDe(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const rendu = (value as { toDate: () => unknown }).toDate();
    return rendu instanceof Date && !Number.isNaN(rendu.getTime()) ? rendu : null;
  }

  return null;
}

/** État à écrire dans `channelDigests/{channelId}` après l'arrivée d'un message. */
export interface ChannelDigestPlan {
  orgId: string;
  channelId: string;
  /** Messages du lot, dans leur ordre d'arrivée, sans doublon. */
  messageIds: string[];
  /** Instant à partir duquel le lot peut être annoncé. */
  flushAt: Date;
}

/**
 * Décide de l'état du lot après un message.
 *
 * `null` n'est pas une erreur : c'est le cas d'un message qu'il ne faut pas
 * compter — masqué, illisible, ou déjà compté.
 *
 * ## Pourquoi la fenêtre est portée par le lot, et pas par l'horloge
 *
 * `flushAt` est fixé à l'ouverture du lot et **n'est plus repoussé** tant que
 * la fenêtre court. Le repousser à chaque message ferait qu'un canal bavard ne
 * serait jamais annoncé : la fenêtre glisserait indéfiniment, et le lot
 * grossirait sans fin. Une fenêtre fixe garantit qu'un lot est annoncé au plus
 * tard cinq minutes après son premier message.
 */
export function channelDigestPlan(
  channelId: string,
  messageId: string,
  message: Record<string, unknown> | undefined,
  channel: Record<string, unknown> | undefined,
  existing: Record<string, unknown> | undefined,
  now: Date,
): ChannelDigestPlan | null {
  if (!message) return null;

  // Un message naît `visible` — les règles l'imposent. La garde couvre ce
  // qu'une migration ou une version antérieure aurait pu écrire.
  if (message.status !== 'visible') return null;

  if (!channel) return null;

  // Un canal masqué ne s'annonce pas : la notification enverrait les parents
  // vers un contenu que la modération vient de retirer.
  if (channel.status !== 'visible') return null;

  const orgId = texte(channel.orgId);
  if (!orgId) return null;

  const precedents = Array.isArray(existing?.messageIds)
    ? existing.messageIds.filter((id): id is string => typeof id === 'string')
    : [];

  // Les déclencheurs Firestore s'exécutent « au moins une fois » : le même
  // message peut être présenté deux fois. La liste dédoublonnée est ce qui
  // empêche un lot de trois messages d'en annoncer quatre.
  if (precedents.includes(messageId)) return null;

  const ouverture = dateDe(existing?.flushAt);
  const flushAt =
    ouverture && ouverture.getTime() > now.getTime()
      ? ouverture
      : new Date(now.getTime() + DIGEST_WINDOW_MINUTES * 60_000);

  return { orgId, channelId, messageIds: [...precedents, messageId], flushAt };
}

/** Ce qu'il faut pour annoncer un lot, une fois la fenêtre écoulée. */
export interface ChannelDigestNotification {
  orgId: string;
  channelId: string;
  message: PushMessage;
  /**
   * Auteurs du lot, retirés des destinataires.
   *
   * C'est ici que vit « on ne se notifie jamais soi-même », déplacé de
   * l'abandon d'envoi vers le choix des destinataires.
   */
  excludeUids: string[];
  /** Nombre de messages annoncés, tous auteurs confondus. */
  count: number;
  /** Audience du canal, recopiée dans l'historique de l'envoi. */
  audience: Audience | undefined;
  /** Dernier auteur lisible du lot : le journal d'envoi doit nommer quelqu'un. */
  authorId: string;
  authorName: string;
}

/**
 * Construit l'annonce d'un lot, ou `null` s'il n'y a rien à annoncer.
 *
 * Le canal et les messages sont ceux **relus** au moment de l'annonce, jamais
 * ceux recopiés à l'ouverture du lot : un canal renommé, une audience élargie
 * ou un message masqué dans l'intervalle doivent être annoncés sous leur état
 * réel.
 */
export function digestNotification(
  channelId: string,
  channel: Record<string, unknown> | undefined,
  messages: readonly (Record<string, unknown> | undefined)[],
): ChannelDigestNotification | null {
  if (!channel) return null;
  if (channel.status !== 'visible') return null;

  const orgId = texte(channel.orgId);
  const channelName = texte(channel.name);
  if (!orgId || !channelName) return null;

  const visibles = messages.filter(
    (candidat): candidat is Record<string, unknown> =>
      typeof candidat === 'object' && candidat !== null && candidat.status === 'visible',
  );

  // Plus rien de lisible : le lot disparaît sans un mot. C'est le cas d'un
  // message retiré par son auteur, ou masqué, pendant la fenêtre.
  if (visibles.length === 0) return null;

  const auteurs = new Set<string>();
  for (const visible of visibles) {
    const id = texte(visible.authorId);
    if (id) auteurs.add(id);
  }

  // Un envoi groupé n'a pas d'auteur unique. Le journal en désigne donc un, le
  // dernier du lot — celui qui a fermé la fenêtre —, et il doit être **lisible** :
  // l'historique doit porter un identifiant réel plutôt qu'un « système » qui
  // ne désigne personne. On remonte donc le lot jusqu'au dernier auteur
  // utilisable, au lieu d'abandonner le lot au premier nom manquant.
  let dernier: { authorId: string; authorName: string } | null = null;
  for (let index = visibles.length - 1; index >= 0; index -= 1) {
    const id = texte(visibles[index]?.authorId);
    const nom = texte(visibles[index]?.authorName);
    if (id && nom) {
      dernier = { authorId: id, authorName: nom };
      break;
    }
  }
  if (!dernier) return null;

  const count = visibles.length;
  const audience = channel.audience;
  const deeplink = buildDeeplink({ type: 'channel', id: channelId });

  return {
    orgId,
    channelId,
    count,
    excludeUids: [...auteurs],
    audience:
      typeof audience === 'object' && audience !== null ? (audience as Audience) : undefined,
    authorId: dernier.authorId,
    authorName: dernier.authorName,
    message: {
      // Le canal nomme la notification, le compte la résume : le bandeau se lit
      // d'un coup d'œil, sans ouvrir l'application.
      title: channelName,
      body: count === 1 ? 'Nouveau message' : `${count} nouveaux messages`,
      category: 'discussions',
      audienceKeys: clesAudience(channel.audienceKeys),
      // Le tap ouvre le canal, et non l'onglet Discussions : le parent qui
      // reçoit « 3 nouveaux messages » doit arriver sur ces messages.
      data: { type: 'new_message', orgId, sourceId: channelId, deeplink },
    },
  };
}
