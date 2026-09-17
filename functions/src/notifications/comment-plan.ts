/**
 * Décide s'il faut notifier pour un commentaire, à qui, et avec quoi.
 *
 * ## Une personne, pas une audience
 *
 * C'est la différence de fond avec `post-plan.ts`. Une publication s'adresse à
 * une audience — un ensemble de clés que `queryTokensByAudience` sait
 * interroger. Un commentaire s'adresse à **une personne**, désignée par son
 * identifiant : l'auteur de la publication que l'on vient de commenter, ou
 * l'auteur du commentaire auquel on répond. Aucune clé d'audience ne décrit cet
 * ensemble, et c'est pourquoi le plan porte `targetUid` et non `audienceKeys`.
 *
 * ## Deux questions, deux champs
 *
 * Le **type** dit quelle règle a désigné le destinataire : `new_comment` pour
 * l'auteur de la publication, `comment_reply` pour l'auteur du commentaire
 * parent. La **catégorie** dit si le parent peut la couper — `discussions`, qui
 * est désactivable. Les confondre écrirait dans l'historique qu'un commentaire
 * a été publié là où quelqu'un a répondu.
 *
 * ## On ne se notifie jamais soi-même
 *
 * Un parent qui commente sa propre publication, ou qui répond à son propre
 * commentaire, est le destinataire que la règle désigne — et c'est le seul cas
 * où elle est écartée. La comparaison porte sur les identifiants, jamais sur
 * les noms : deux personnes peuvent porter le même.
 *
 * ## Un commentaire parent disparu ne fait pas taire la réponse
 *
 * `parentId` peut désigner un commentaire masqué ou supprimé entre-temps. La
 * cible retombe alors sur l'auteur de la publication, l'autre partie légitime
 * du fil. Rendre `null` serait un silence, et un silence ne se distingue pas
 * d'une panne : le commentaire a bien été écrit, quelqu'un doit pouvoir
 * l'apprendre.
 *
 * ## Le lien profond vise la publication, jamais le commentaire
 *
 * `DEEPLINK_TARGET_TYPES` ne connaît pas de type `comment`, et l'écran de la
 * publication affiche son fil. Un lien vers un type sans écran serait reconnu
 * par l'analyse puis refusé à l'ouverture : le tap laisserait l'application où
 * elle est, sans rien dire. Le lien réutilise donc le seul type ouvrable.
 */
import type { NotificationCategory, NotificationType } from '@fl/types';
import { buildDeeplink, type PushMessage } from '@fl/shared';

import { extraitNotification } from './post-plan.js';

/** Ce qu'il faut pour envoyer, et pour journaliser l'envoi. */
export interface CommentNotificationPlan {
  /** Organisation, lue sur la publication : le commentaire ne la porte pas. */
  orgId: string;
  /** Publication sous laquelle le commentaire a été écrit. */
  postId: string;
  /** Commentaire qui déclenche l'envoi. */
  commentId: string;
  /** Destinataire, désigné par son identifiant — une personne, pas une audience. */
  targetUid: string;
  category: NotificationCategory;
  type: NotificationType;
  title: string;
  body: string;
  deeplink: string;
  /** Auteur du commentaire : c'est lui qui « envoie », au sens du journal. */
  authorId: string;
  authorName: string;
}

/**
 * Ce que le déclencheur a lu, et que le commentaire ne porte pas.
 *
 * Le commentaire est un document de sous-collection : il ne connaît ni
 * l'organisation, ni le titre de la publication, ni l'auteur du commentaire
 * auquel il répond. Ces quatre valeurs viennent de deux lectures faites par le
 * déclencheur, et c'est ici qu'elles sont interprétées.
 *
 * Les champs sont typés `unknown`, et non `string | null` : ils sortent de
 * Firestore, dont les valeurs ne sont garanties par rien. Les annoter
 * `string | null` ferait une promesse que le premier document malformé
 * démentirait — c'est le choix déjà fait par `recipients.ts`, qui reçoit
 * `readonly unknown[]` et normalise lui-même.
 */
export interface CommentNotificationContext {
  /** Organisation, lue sur la publication. */
  orgId: unknown;
  /** Titre de la publication : ce que le bandeau affiche en première ligne. */
  postTitle: unknown;
  /** Auteur de la publication : le destinataire d'un nouveau commentaire. */
  postAuthorId: unknown;
  /** Auteur du commentaire parent, ou rien quand il n'y en a pas, ou qu'il a disparu. */
  parentAuthorId: unknown;
}

function texte(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Identifiant du commentaire parent, ou `null`.
 *
 * Exporté parce que le déclencheur s'en sert pour décider **ce qu'il lit** —
 * aller chercher le parent, ou non — tandis que le plan s'en sert pour décider
 * **ce qu'il écrit** — `comment_reply` ou `new_comment`. Deux lectures d'un
 * même champ : les faire diverger notifierait la mauvaise personne sous le bon
 * libellé, et rien ne le signalerait.
 */
export function parentIdOf(comment: Record<string, unknown> | undefined): string | null {
  return comment ? texte(comment.parentId) : null;
}

/**
 * Plan de notification d'un commentaire, ou `null` s'il n'y a rien à envoyer.
 *
 * `null` n'est pas une erreur : c'est le cas le plus fréquent. Le déclencheur
 * l'utilise pour sortir immédiatement, sans envoyer.
 */
export function commentNotificationPlan(
  postId: string,
  commentId: string,
  comment: Record<string, unknown> | undefined,
  context: CommentNotificationContext,
): CommentNotificationPlan | null {
  // Suppression, ou document illisible.
  if (!comment) return null;

  // Un commentaire naît `visible` — les règles l'imposent à la création. La
  // garde couvre ce qu'une migration ou une version antérieure du schéma
  // aurait pu écrire : notifier pour un commentaire que personne ne peut lire
  // enverrait le parent sur un fil où il ne trouverait rien.
  if (comment.status !== 'visible') return null;

  const authorId = texte(comment.authorId);
  const authorName = texte(comment.authorName);
  const body = texte(comment.body);
  const parentId = parentIdOf(comment);

  // Le titre est requis, comme celui d'une publication l'est par ses règles :
  // un fil qu'on ne peut pas nommer ne peut pas être annoncé.
  const orgId = texte(context.orgId);
  const postTitle = texte(context.postTitle);

  if (!orgId || !postTitle || !authorId || !authorName || !body) return null;

  // L'auteur du commentaire parent quand il y en a un, l'auteur de la
  // publication sinon. Une seule expression pour les deux cas : la réponse à
  // un commentaire disparu retombe d'elle-même sur l'auteur de la publication.
  const targetUid = texte(context.parentAuthorId) ?? texte(context.postAuthorId);
  if (!targetUid) return null;

  // On ne se notifie jamais soi-même.
  if (targetUid === authorId) return null;

  return {
    orgId,
    postId,
    commentId,
    targetUid,
    category: 'discussions',
    type: parentId ? 'comment_reply' : 'new_comment',
    title: postTitle,
    // L'auteur est nommé dans le corps : le titre porte le fil, et le bandeau
    // dit qui parle sans qu'il faille ouvrir l'application.
    body: extraitNotification(`${authorName} : ${body}`),
    deeplink: buildDeeplink({ type: 'post', id: postId }),
    authorId,
    authorName,
  };
}

/**
 * Le message push correspondant au plan.
 *
 * `audienceKeys` est **vide**, et ce n'est pas un oubli : le message ne vise
 * aucune audience, mais les appareils d'une personne, retrouvés par son
 * identifiant. Remplir ce champ ferait croire à un envoi de masse, et le
 * journal d'historique — qui recopie ces clés — décrirait une audience qui n'a
 * jamais été adressée.
 *
 * `priority` est absent : les catégories obligatoires sont les seules à
 * passer en priorité maximale, et `discussions` n'en fait pas partie.
 */
export function commentPushMessage(plan: CommentNotificationPlan): PushMessage {
  return {
    title: plan.title,
    body: plan.body,
    category: plan.category,
    audienceKeys: [],
    data: {
      type: plan.type,
      orgId: plan.orgId,
      sourceId: plan.postId,
      deeplink: plan.deeplink,
    },
  };
}
