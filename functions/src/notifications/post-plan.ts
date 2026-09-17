/**
 * Décide s'il faut notifier pour une publication, et avec quoi.
 *
 * ## Pourquoi la décision est séparée de l'envoi
 *
 * Le déclencheur Firestore ne se contente pas de « réagir à une écriture » : il
 * doit décider **si** cette écriture est une publication, et si elle ne l'a pas
 * déjà été notifiée. Cette décision est celle qui se trompe le plus facilement —
 * un `onDocumentUpdated` se déclenche à chaque modification, y compris celles
 * que le déclencheur vient d'écrire lui-même. La garder dans une fonction pure
 * permet de l'éprouver sans émulateur, sur des objets littéraux.
 *
 * ## Le déclencheur doit couvrir deux chemins, pas un
 *
 * Une publication peut naître `published` (rédigée puis publiée d'un geste) ou
 * le devenir (brouillon publié plus tard). Un `onDocumentCreated` raterait la
 * seconde, un `onDocumentUpdated` la première. Le déclencheur écoute donc
 * `onDocumentWritten`, et cette fonction ramène les deux cas à la même règle :
 * le statut **devient** `published`.
 *
 * ## La garde d'idempotence n'est pas une ceinture de confort
 *
 * Les déclencheurs Firestore s'exécutent **au moins une fois** : une reprise
 * après incident rejoue l'événement. Sans `notifiedAt`, un redémarrage enverrait
 * une seconde fois la même notification à tous les parents. Le champ est posé
 * après l'envoi, et non avant : marquer d'abord puis échouer perdrait la
 * notification en silence, ce qui est pire qu'un doublon.
 */
import type { Audience, NotificationCategory, NotificationType } from '@fl/types';
import { AUDIENCE_TYPES, buildDeeplink, type PushMessage } from '@fl/shared';

/**
 * Longueur maximale du corps d'une notification.
 *
 * Les bandeaux tronquent d'eux-mêmes, et de façon différente selon la
 * plateforme et la taille d'écran. Tronquer ici, à une longueur qui tient sur
 * deux lignes, évite qu'un paragraphe de publication soit coupé au milieu d'un
 * mot par le système — et le remplace par une coupe que nous choisissons.
 */
export const LONGUEUR_CORPS_NOTIFICATION = 180;

/** Ce qu'il faut pour envoyer, et pour journaliser l'envoi. */
export interface PostNotificationPlan {
  orgId: string;
  sourceId: string;
  audience: Audience;
  audienceKeys: string[];
  category: NotificationCategory;
  type: NotificationType;
  title: string;
  body: string;
  deeplink: string;
  priority: 'default' | 'max';
  /** Auteur de la publication : c'est lui qui « envoie », au sens du journal. */
  authorId: string;
  authorName: string;
}

function texte(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** Chaînes non vides d'un tableau, ou tableau vide. */
function cles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

/**
 * Audience lisible, ou `null`.
 *
 * Seul `type` est vérifié : l'objet part tel quel dans le journal
 * d'administration, qui est un document d'historique et non une autorisation.
 * Le vérifier entièrement n'apporterait rien à l'envoi, qui ne lit que les clés
 * d'audience — déjà calculées et stockées à part.
 */
function audienceLisible(value: unknown): Audience | null {
  if (typeof value !== 'object' || value === null) return null;
  const type = (value as Record<string, unknown>).type;
  if (typeof type !== 'string' || !(AUDIENCE_TYPES as readonly string[]).includes(type)) {
    return null;
  }
  return value as Audience;
}

/**
 * Extrait le corps de la notification.
 *
 * Les espaces sont normalisés avant la coupe : un paragraphe qui commence par
 * trois retours à la ligne afficherait sinon un bandeau vide sur deux lignes.
 */
export function extraitNotification(corps: string, max = LONGUEUR_CORPS_NOTIFICATION): string {
  const propre = corps.trim().replace(/\s+/g, ' ');
  if (propre.length <= max) return propre;
  return `${propre.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Plan de notification d'une publication, ou `null` s'il n'y a rien à envoyer.
 *
 * `null` n'est pas une erreur : c'est le cas le plus fréquent. Le déclencheur
 * l'utilise pour sortir immédiatement, sans lire ni écrire.
 */
export function postNotificationPlan(
  postId: string,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): PostNotificationPlan | null {
  // Suppression : le document n'existe plus.
  if (!after) return null;

  // Le statut doit **devenir** publié. Une republication ne notifie donc pas :
  // le parent a déjà été prévenu, et la republication est une correction.
  if (after.status !== 'published') return null;
  if (before?.status === 'published') return null;

  // Rejeu du même événement (au moins une fois), ou envoi déjà effectué.
  if (after.notifiedAt) return null;

  const orgId = texte(after.orgId);
  const title = texte(after.title);
  const body = texte(after.body);
  const authorId = texte(after.authorId);
  const authorName = texte(after.authorName);
  const audience = audienceLisible(after.audience);
  const audienceKeys = cles(after.audienceKeys);

  // Une publication sans audience ne concerne personne : l'écrire au journal
  // comme un envoi à zéro destinataire ferait croire à un envoi raté, alors
  // qu'il n'y avait rien à envoyer.
  if (!orgId || !title || !body || !authorId || !authorName || !audience) return null;
  if (audienceKeys.length === 0) return null;

  const urgent = after.category === 'urgent';

  return {
    orgId,
    sourceId: postId,
    audience,
    audienceKeys,
    category: urgent ? 'urgent' : 'publications',
    type: urgent ? 'urgent_alert' : 'post_published',
    title,
    body: extraitNotification(body),
    deeplink: buildDeeplink({ type: 'post', id: postId }),
    priority: urgent ? 'max' : 'default',
    authorId,
    authorName,
  };
}

/**
 * Le message push correspondant au plan.
 *
 * `data` ne porte que ce dont l'application a besoin pour ouvrir le bon écran et
 * rattacher la notification à son contenu. Chaque champ supplémentaire serait
 * une copie de plus à garder d'accord avec le document d'origine, sans que rien
 * ne le vérifie.
 */
export function postPushMessage(plan: PostNotificationPlan): PushMessage {
  return {
    title: plan.title,
    body: plan.body,
    category: plan.category,
    audienceKeys: plan.audienceKeys,
    data: {
      type: plan.type,
      orgId: plan.orgId,
      sourceId: plan.sourceId,
      deeplink: plan.deeplink,
    },
    priority: plan.priority,
  };
}
