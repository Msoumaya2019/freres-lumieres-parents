/**
 * Sélection des destinataires d'une notification.
 *
 * ## Pourquoi une fonction pure, et pas une lecture directe dans le déclencheur
 *
 * Les documents `deviceTokens` viennent de la base : leur forme n'est garantie
 * par rien. Les règles imposent des invariants à l'écriture — `token` égal à
 * l'identifiant du document, `audienceKeys` et `disabledCategories` figés — mais
 * une règle peut être contournée par une migration, un script d'administration
 * ou une version antérieure du schéma. Un document malformé ne doit donc pas
 * faire échouer **tout** l'envoi : il doit être écarté, et nommé.
 *
 * La fonction rend donc deux listes : les destinataires retenus, et les
 * documents refusés avec leur raison. L'appelant journalise les seconds — une
 * exclusion silencieuse serait indiscernable d'un parent qui n'a jamais
 * enregistré d'appareil.
 *
 * ## Les replis ne vont pas tous dans le même sens, et c'est délibéré
 *
 * - `audienceKeys` illisible → **tableau vide**. Un appareil dont on ne sait
 *   pas ce qu'il doit recevoir ne reçoit rien : une notification révèle son
 *   contenu dans le bandeau de l'écran de verrouillage.
 * - `disabledCategories` illisible → **tableau vide**, donc *rien de
 *   désactivé*. Rendre muet un parent dont le profil est incomplet serait pire
 *   que de lui envoyer une notification qu'il aurait pu vouloir ignorer — une
 *   fermeture d'école manquée ne se rattrape pas.
 * - `enabled` absent ou non booléen → **activé**, pour la même raison : c'est
 *   l'absence d'un champ, pas une décision de l'utilisateur. Seul un `false`
 *   explicite éteint l'appareil, et `filterRecipients` fait de toute façon
 *   passer les alertes obligatoires outre.
 *
 * C'est la même règle que dans `triggers/device-tokens.ts`, appliquée au moment
 * de l'envoi plutôt qu'à celui de la recopie. Les deux doivent rester d'accord.
 */
import type { DevicePlatform, NotificationCategory } from '@fl/types';
import { DEVICE_PLATFORMS, NOTIFICATION_CATEGORIES, type PushRecipient } from '@fl/shared';

/** Un document écarté, et pourquoi. */
export interface RejectedToken {
  /** Le jeton, quand il a pu être lu — `null` sinon. */
  token: string | null;
  reason: string;
}

export interface RecipientSelection {
  recipients: PushRecipient[];
  rejected: RejectedToken[];
}

/** Chaîne non vide, ou `null`. */
function texte(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Catégories connues du domaine, dans l'ordre reçu.
 *
 * Les valeurs inconnues sont écartées plutôt que conservées : elles
 * n'empêcheraient rien — le filtre compare des chaînes exactes — mais elles
 * seraient recopiées d'un bout à l'autre de la chaîne sans jamais servir.
 *
 * `urgent` est **conservée** si elle est présente : c'est le filtre d'envoi qui
 * l'ignore, pas cette fonction. Une préférence qu'on ne peut pas honorer reste
 * une donnée valide à stocker, et c'est au seul endroit qui décide de l'envoi
 * de trancher.
 */
function categoriesConnues(value: unknown): NotificationCategory[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is NotificationCategory =>
      typeof item === 'string' && (NOTIFICATION_CATEGORIES as readonly string[]).includes(item),
  );
}

/** Clés d'audience : des chaînes non vides, et rien d'autre. */
function clesTexte(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

/**
 * Convertit des documents `deviceTokens` en destinataires.
 *
 * Un document refusé n'interrompt pas le parcours : les autres sont traités.
 * L'ordre reçu est conservé, ce qui rend la fonction déterministe et les tests
 * lisibles.
 */
export function selectRecipients(documents: readonly unknown[]): RecipientSelection {
  const recipients: PushRecipient[] = [];
  const rejected: RejectedToken[] = [];

  for (const document of documents) {
    if (typeof document !== 'object' || document === null) {
      rejected.push({ token: null, reason: 'document illisible' });
      continue;
    }

    const champs = document as Record<string, unknown>;

    const token = texte(champs.token);
    if (!token) {
      rejected.push({ token: null, reason: 'jeton absent ou illisible' });
      continue;
    }

    const platform = texte(champs.platform);
    if (!platform || !(DEVICE_PLATFORMS as readonly string[]).includes(platform)) {
      // Sans plateforme, une erreur d'envoi n'est plus attribuable à un
      // appareil : le journal d'un envoi perdrait le seul détail qui aide à
      // comprendre un échec ciblé.
      rejected.push({ token, reason: `plateforme inconnue : ${String(champs.platform)}` });
      continue;
    }

    recipients.push({
      token,
      platform: platform as DevicePlatform,
      // Seul un `false` explicite éteint l'appareil : voir l'en-tête.
      enabled: champs.enabled !== false,
      audienceKeys: clesTexte(champs.audienceKeys),
      disabledCategories: categoriesConnues(champs.disabledCategories),
    });
  }

  return { recipients, rejected };
}
