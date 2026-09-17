/**
 * Décider quoi faire d'un appui sur une notification.
 *
 * ## Pourquoi cette décision est séparée du branchement
 *
 * Le branchement lui-même — s'abonner, naviguer — ne se teste que sur un
 * appareil. La **décision**, elle, se teste partout, et c'est elle qui porte
 * les deux pièges :
 *
 *  - `useLastNotificationResponse` rend aussi les appuis sur un bouton
 *    d'action et les réponses écrites. Seul l'appui sur le corps doit ouvrir le
 *    contenu ;
 *  - il rend le **même objet à chaque rendu**. Sans mémoire de ce qui a déjà
 *    été traité, un changement de thème rejouerait la navigation et empilerait
 *    les écrans.
 *
 * Aucune de ces deux règles ne se voit à l'œil sur un émulateur : elles
 * produisent respectivement un écran ouvert pour rien et une pile de trois
 * écrans identiques. Elles sont donc écrites ici, pures, et couvertes.
 *
 * Le module ne connaît ni Expo ni le routeur : il reçoit une forme
 * structurelle, ce qui le rend testable sans appareil et sans simulation.
 */
import { routeForDeeplink } from '@fl/shared';

/** Ce qu'un appui sur une notification apporte, réduit à ce qui décide. */
export interface ReponseNotification {
  /** Identifiant de la notification appuyée. Stable pour un même envoi. */
  readonly identifiant: string;
  /** Action appuyée, telle que fournie par le système. */
  readonly action: string;
  /** Charge utile portée par la notification, non fiable par construction. */
  readonly donnees: unknown;
}

/** Ce qu'il faut faire d'un appui : ouvrir `route`, et ne plus le rouvrir. */
export interface CibleNotification {
  readonly identifiant: string;
  readonly route: string;
}

export interface OptionsCible {
  /** Identifiant de la dernière notification déjà traitée, ou `null`. */
  readonly dejaTraitee: string | null;
  /** Valeur de l'action par défaut du système (appui sur le corps). */
  readonly actionParDefaut: string;
}

/**
 * Rend la route à ouvrir, ou `null` s'il n'y a rien à faire.
 *
 * Les quatre raisons de ne rien faire, dans l'ordre où elles se présentent :
 * pas de réponse (l'application n'a jamais reçu d'appui) ; appui sur autre
 * chose que le corps ; notification déjà traitée ; lien absent ou illisible.
 * La dernière est déléguée à `routeForDeeplink`, qui échoue fermée.
 */
export function cibleDeLaNotification(
  reponse: ReponseNotification | null | undefined,
  options: OptionsCible,
): CibleNotification | null {
  if (!reponse) return null;
  if (reponse.action !== options.actionParDefaut) return null;
  if (reponse.identifiant === options.dejaTraitee) return null;

  const route = routeForDeeplink(donneesDeLaReponse(reponse.donnees));
  if (!route) return null;

  return { identifiant: reponse.identifiant, route };
}

/**
 * Extrait le lien profond d'une charge utile non fiable.
 *
 * La valeur vient d'un service tiers puis du système d'exploitation : elle
 * peut être absente, nulle, ou d'un tout autre type. `routeForDeeplink`
 * accepte `unknown` et refuse tout ce qu'il ne reconnaît pas, donc la seule
 * chose à faire ici est de ne pas lever en la lisant.
 */
function donneesDeLaReponse(donnees: unknown): unknown {
  if (typeof donnees !== 'object' || donnees === null) return undefined;
  return (donnees as { deeplink?: unknown }).deeplink;
}
