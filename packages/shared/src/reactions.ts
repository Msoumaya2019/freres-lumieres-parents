/**
 * Décompte des réactions d'un commentaire.
 *
 * ## Pourquoi le client calcule un décompte qu'il n'a pas le droit d'écrire
 *
 * `Comment.reactions` est maintenu par une Cloud Function, à partir de la
 * sous-collection `reactions/{uid}` — c'est la seule façon d'empêcher un client
 * de mentir sur un décompte. Mais la fonction s'exécute **après** l'écriture,
 * et le commentaire n'est pas relu : afficher le décompte du document donnerait
 * donc, juste après un toucher, le chiffre d'avant. Le bouton semblerait ne
 * rien faire.
 *
 * Le calcul ci-dessous est une **estimation locale**, remplacée par la valeur
 * réelle au prochain chargement. Il est isolé ici pour être testable : c'est
 * de l'arithmétique de comptage, exactement le genre de code qui se trompe
 * silencieusement d'une unité.
 */
import type { ReactionEmoji } from './constants.js';

/**
 * Décompte après un changement de réaction.
 *
 * @param counts   Décompte actuel, tel qu'il figure sur le commentaire.
 * @param previous L'émoticône que j'avais posée, ou `undefined` si aucune.
 * @param next     Celle que je pose, ou `undefined` si je retire la mienne.
 */
export function reactionCountsAfter(
  counts: Readonly<Record<string, number>>,
  previous: ReactionEmoji | undefined,
  next: ReactionEmoji | undefined,
): Record<string, number> {
  const result: Record<string, number> = { ...counts };

  // Retoucher la même émoticône ne compte pas deux fois. Sans ce garde, un
  // double toucher rapide incrémenterait le décompte local, et le chiffre ne
  // redescendrait qu'au rechargement suivant.
  if (previous === next) return result;

  if (previous !== undefined) {
    const left = (result[previous] ?? 0) - 1;
    // Une entrée qui tombe à zéro est retirée plutôt que laissée à « 0 » : le
    // décompte affiché filtre déjà les zéros, mais une carte qui traîne des
    // entrées vides rend la comparaison avec la valeur du serveur illisible.
    if (left > 0) result[previous] = left;
    else delete result[previous];
  }

  if (next !== undefined) {
    result[next] = (result[next] ?? 0) + 1;
  }

  return result;
}
