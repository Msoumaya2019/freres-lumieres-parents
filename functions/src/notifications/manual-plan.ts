/**
 * Décide ce que produit une annonce écrite à la main.
 *
 * ## Pourquoi la décision est séparée de l'envoi
 *
 * Même raison que `post-plan.ts` : tout ce qui décide — l'organisation, les clés
 * d'audience, la priorité, la coupe du corps — vit ici, pur, éprouvable sur des
 * objets littéraux. Le chemin d'envoi ne fait que de la plomberie Firestore et
 * réseau, qu'aucun test unitaire ne couvre sans émulateur.
 *
 * ## D'où vient l'organisation
 *
 * Du **profil de l'appelant**, relu en base par la Cloud Function — jamais de la
 * requête. `notificationSendSchema` ne porte d'ailleurs aucun `orgId` : une
 * frontière d'organisation qui se demande au client n'en est pas une.
 *
 * ## Pourquoi le type ne dit pas l'urgence
 *
 * Une publication urgente produit `urgent_alert` ; une annonce manuelle produit
 * `manual_announcement`, **même urgente**. Le type répond à « qu'est-ce qui a
 * produit cet envoi » — une main, ici —, et la catégorie à « l'utilisateur
 * peut-il la désactiver ». Confondre les deux ferait d'une annonce urgente une
 * alerte de publication, et l'historique ne saurait plus qui a écrit quoi.
 *
 * ## Qui peut envoyer une urgence
 *
 * N'importe quel détenteur de `notification.send`, soit les rôles `fcpe`,
 * `moderator` et `admin`. C'est exactement l'ensemble qui peut déjà publier une
 * information urgente : restreindre ici ne protégerait rien, la porte d'à côté
 * resterait ouverte. La contrepartie est le **journal d'audit** — la fonction
 * appelable y écrit l'auteur, la catégorie et l'audience, et `adminLogs` n'est
 * lisible que par un administrateur. Un envoi urgent de masse est donc
 * attribuable, pas anonyme.
 *
 * ## Le corps est coupé, et l'historique porte la version coupée
 *
 * `extraitNotification` ramène le corps à ce qu'un bandeau affiche. C'est le
 * texte **envoyé** qui est journalisé, pas celui qui a été saisi : un historique
 * montrant le texte complet décrirait un message que personne n'a reçu.
 *
 * ## Pourquoi une audience vide rend `null`
 *
 * `buildAudienceKeys` rend un tableau vide pour une audience `school`, `level`
 * ou `class` privée de son identifiant. Le schéma l'interdit, mais cette
 * fonction ne le suppose pas. Envoyer à zéro appareil écrirait une ligne
 * d'historique « 0 destinataire », qui se lit comme un échec alors qu'il n'y
 * avait personne à viser.
 */
import type { Audience, NotificationCategory, NotificationType } from '@fl/types';
import { buildAudienceKeys, type NotificationSendInput, type PushMessage } from '@fl/shared';

import { extraitNotification } from './post-plan.js';

/**
 * Type d'une annonce écrite à la main.
 *
 * Une constante plutôt qu'une chaîne recopiée : c'est la valeur qui distingue
 * une annonce d'une publication dans l'historique, et deux copies finiraient
 * par diverger sans que rien ne le signale.
 */
export const TYPE_ANNONCE_MANUELLE: NotificationType = 'manual_announcement';

/** Ce qu'il faut pour envoyer une annonce, et pour journaliser l'envoi. */
export interface ManualNotificationPlan {
  orgId: string;
  category: NotificationCategory;
  audience: Audience;
  audienceKeys: string[];
  title: string;
  body: string;
  deeplink?: string;
  priority: 'default' | 'max';
  /** Auteur de l'annonce : c'est lui qui « envoie », au sens du journal. */
  sentBy: string;
  sentByName: string;
}

/** L'appelant, tel que la fonction appelable l'a résolu **en base**. */
export interface ManualCaller {
  uid: string;
  name: string;
  orgId: string;
}

/**
 * Plan d'envoi d'une annonce, ou `null` s'il n'y a personne à viser.
 *
 * L'entrée est le résultat **validé** de `notificationSendSchema` : la forme est
 * déjà garantie, et la revalider ici ferait une seconde vérité à tenir d'accord
 * avec la première.
 */
export function manualNotificationPlan(
  input: NotificationSendInput,
  caller: ManualCaller,
): ManualNotificationPlan | null {
  const audienceKeys = buildAudienceKeys(input.audience, caller.orgId);
  if (audienceKeys.length === 0) return null;

  return {
    orgId: caller.orgId,
    category: input.category,
    audience: input.audience,
    audienceKeys,
    title: input.title,
    body: extraitNotification(input.body),
    ...(input.deeplink ? { deeplink: input.deeplink } : {}),
    // Seule la catégorie obligatoire réveille un téléphone en silencieux. La
    // liste des catégories obligatoires est lue ailleurs — ici, la question est
    // « celle-ci en fait-elle partie », et `urgent` en est le seul membre.
    priority: input.category === 'urgent' ? 'max' : 'default',
    sentBy: caller.uid,
    sentByName: caller.name,
  };
}

/**
 * Le message push correspondant au plan.
 *
 * `data` ne porte que ce dont l'application a besoin pour ouvrir le bon écran.
 * Il n'y a **pas** de `sourceId` : une annonce ne se rattache à aucun contenu,
 * et en inventer un ferait écrire dans le journal une référence qui ne
 * désignerait rien.
 */
export function manualPushMessage(plan: ManualNotificationPlan): PushMessage {
  return {
    title: plan.title,
    body: plan.body,
    category: plan.category,
    audienceKeys: plan.audienceKeys,
    data: {
      type: TYPE_ANNONCE_MANUELLE,
      orgId: plan.orgId,
      ...(plan.deeplink ? { deeplink: plan.deeplink } : {}),
    },
    priority: plan.priority,
  };
}
