/**
 * Décide s'il faut notifier pour un sondage, et avec quoi.
 *
 * ## La décision se lit en **transition**, pas en état
 *
 * Un sondage peut naître `open` — publié d'un seul geste — ou le devenir : c'est
 * le cas d'un brouillon préparé la veille pour le lendemain, que l'administration
 * ouvre plus tard. Un `onDocumentCreated` raterait le second chemin, un
 * `onDocumentUpdated` le premier. Le déclencheur écoute donc `onDocumentWritten`,
 * et cette fonction ramène les deux cas à une seule règle : le statut **devient**
 * `open`.
 *
 * C'est aussi ce qui la rend insensible aux autres écritures du document, qui
 * sont nombreuses et légitimes : le balayage planifié inscrit la clôture des
 * sondages échus, la FCPE clôt à la main, une question se corrige. Aucune ne fait
 * **devenir** `open`, donc aucune ne notifie.
 *
 * ## La clôture ne notifie pas, et ce n'est pas un oubli
 *
 * `new_poll` est le seul type de notification qu'un sondage produise : le
 * document des notifications n'en prévoit pas d'autre, et `NotificationType` ne
 * connaît pas de `poll_closed`. Annoncer une clôture sous le type `new_poll`
 * ferait mentir l'historique des envois — la collection même que
 * l'administration lit pour savoir ce qui est réellement parti.
 *
 * ## La garde d'idempotence n'est pas une ceinture de confort
 *
 * Les déclencheurs Firestore s'exécutent **au moins une fois** : une reprise
 * après incident rejoue l'événement. Sans `notifiedAt`, un redémarrage enverrait
 * une seconde fois la même notification à toute l'audience. Le champ est posé
 * **après** l'envoi, et non avant : marquer d'abord puis échouer perdrait la
 * notification en silence, ce qui est pire qu'un doublon.
 *
 * ## Le nom de l'auteur n'est pas sur le document
 *
 * `Poll` ne porte que `createdBy`, et c'est une décision assumée de `createPoll` :
 * recopier un nom d'auteur ajouterait au document un champ qu'aucune règle ne
 * vérifie. Le journal d'envoi, lui, **exige** un nom (`sentByName`). Le
 * déclencheur le lit donc sur le profil, et le contexte le porte — la fonction
 * pure n'a pas à savoir d'où il vient.
 *
 * Quand ce profil a disparu, on ne renonce pas à envoyer : le sondage est celui
 * de l'**association**, pas d'une personne, et les règles le disent déjà (« un
 * membre de la FCPE n'a pas à être l'auteur pour ouvrir un sondage au nom de
 * l'association »). Le repli est donc « La FCPE », et non l'absence d'envoi — un
 * compte supprimé ne doit pas rendre muet le sondage qu'il a préparé.
 */
import type { Audience, DateLike, NotificationCategory, NotificationType } from '@fl/types';
import { buildDeeplink, formatDateTime, toDate, type PushMessage } from '@fl/shared';

import { audienceLisible, extraitNotification } from './post-plan.js';

/** Ce qui est écrit dans le journal quand l'auteur du sondage n'a plus de profil. */
export const AUTEUR_PAR_DEFAUT = 'La FCPE';

/**
 * Corps de repli, quand le sondage ne porte aucune précision.
 *
 * Un bandeau a besoin d'un corps, et le sondage n'en fournit pas toujours : la
 * description est facultative, et un sondage sans date de clôture n'annonce
 * rien. Le repli est une invitation, pas une promesse — il ne dit rien que le
 * document ne dise déjà.
 */
export const CORPS_SANS_PRECISION = 'Votre avis est attendu.';

/** Ce qu'il faut pour envoyer, et pour journaliser l'envoi. */
export interface PollNotificationPlan {
  orgId: string;
  sourceId: string;
  audience: Audience;
  audienceKeys: string[];
  category: NotificationCategory;
  type: NotificationType;
  title: string;
  body: string;
  deeplink: string;
  /** Auteur du sondage : c'est lui qui « envoie », au sens du journal. */
  authorId: string;
  authorName: string;
}

/**
 * Ce que le déclencheur a lu, et que le sondage ne porte pas.
 *
 * Le champ est typé `unknown`, et non `string` : il sort de Firestore, dont les
 * valeurs ne sont garanties par rien. L'annoter `string` ferait une promesse que
 * le premier profil malformé démentirait — c'est le choix déjà fait par
 * `recipients.ts` et par `CommentNotificationContext`.
 */
export interface PollNotificationContext {
  /** Nom de l'auteur, lu sur son profil. Absent, le repli est `AUTEUR_PAR_DEFAUT`. */
  authorName: unknown;
}

function texte(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** Clés non vides d'un tableau, ou tableau vide. */
function cles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

/**
 * Corps de la notification, à partir de ce que le sondage porte.
 *
 * La description d'abord : c'est ce que la FCPE a écrit pour être lu. À défaut,
 * la date de clôture — la seule information qui aide un parent à décider
 * **quand** répondre, et elle vient du document. À défaut encore, une invitation
 * neutre : voir `CORPS_SANS_PRECISION`.
 *
 * Le transtypage ne promet rien. `toDate` est **totale** : elle rend `null` pour
 * toute valeur qu'elle ne reconnaît pas — un type inattendu se replie donc sur
 * l'invitation au lieu de lever au milieu d'un envoi. Le contrôle de type à
 * l'écriture (`validPoll()`) rend ce cas improbable, pas impossible : une
 * migration ou une version antérieure du schéma peut avoir écrit autre chose.
 */
export function corpsDuSondage(after: Record<string, unknown>): string {
  const description = texte(after.description);
  if (description) return extraitNotification(description);

  const echeance = toDate(after.endsAt as DateLike | null | undefined);
  if (echeance) return `Clôture le ${formatDateTime(echeance)}`;

  return CORPS_SANS_PRECISION;
}

/**
 * Plan de notification d'un sondage, ou `null` s'il n'y a rien à envoyer.
 *
 * `null` n'est pas une erreur : c'est le cas le plus fréquent. Le déclencheur
 * l'utilise pour sortir immédiatement, sans lire ni écrire.
 */
export function pollNotificationPlan(
  pollId: string,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  context: PollNotificationContext,
): PollNotificationPlan | null {
  // Suppression : le document n'existe plus.
  if (!after) return null;

  // Le statut doit **devenir** ouvert : c'est la seule transition qui notifie.
  // Une clôture ne notifie pas du tout, voir l'en-tête.
  if (after.status !== 'open') return null;
  if (before?.status === 'open') return null;

  // Et le sondage ne doit **jamais** avoir été notifié. Cette garde couvre deux
  // cas distincts, et le second ne se déduit pas du premier :
  //
  //  - le rejeu du même événement, que Firestore peut produire seul ;
  //  - la **réouverture** d'un sondage déjà parti — `closed` puis `open` — qui
  //    franchit la garde de transition sans y être arrêtée. Sans `notifiedAt`,
  //    un aller-retour de statut renverrait la même notification à toute
  //    l'audience.
  if (after.notifiedAt) return null;

  const orgId = texte(after.orgId);
  const question = texte(after.question);
  const authorId = texte(after.createdBy);
  const audience = audienceLisible(after.audience);
  const audienceKeys = cles(after.audienceKeys);

  // Un sondage sans question ne peut pas être annoncé : le bandeau affiche la
  // question en première ligne, et un titre vide se lirait comme une
  // notification cassée. Une audience vide, elle, ne concerne personne —
  // l'écrire au journal comme un envoi à zéro destinataire ferait croire à un
  // envoi raté, alors qu'il n'y avait rien à envoyer.
  if (!orgId || !question || !authorId || !audience) return null;
  if (audienceKeys.length === 0) return null;

  return {
    orgId,
    sourceId: pollId,
    audience,
    audienceKeys,
    // `sondages` n'est pas une catégorie obligatoire : l'envoi part en priorité
    // normale, et un parent qui l'a coupée ne le reçoit pas. C'est le but d'une
    // préférence, et `filterRecipients` s'en charge.
    category: 'sondages',
    type: 'new_poll',
    // Le titre est la question : c'est ce que le parent doit lire pour décider
    // d'ouvrir ou non, et un libellé générique (« Nouveau sondage ») le forcerait
    // à ouvrir l'application pour savoir de quoi il retourne.
    title: question,
    body: corpsDuSondage(after),
    deeplink: buildDeeplink({ type: 'poll', id: pollId }),
    authorId,
    authorName: texte(context.authorName) ?? AUTEUR_PAR_DEFAUT,
  };
}

/**
 * Le message push correspondant au plan.
 *
 * `data` ne porte que ce dont l'application a besoin pour ouvrir le bon écran et
 * rattacher la notification à son contenu. Chaque champ supplémentaire serait
 * une copie de plus à garder d'accord avec le document d'origine, sans que rien
 * ne le vérifie.
 *
 * `priority` est absent : les catégories obligatoires sont les seules à passer
 * en priorité maximale, et `sondages` n'en fait pas partie.
 */
export function pollPushMessage(plan: PollNotificationPlan): PushMessage {
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
  };
}
