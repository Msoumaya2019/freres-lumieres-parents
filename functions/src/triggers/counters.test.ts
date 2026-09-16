/**
 * Règles de calcul des compteurs dénormalisés.
 *
 * ## Pourquoi ces tests existent
 *
 * La première version de `onCommentWritten` n'excluait que le statut `deleted` :
 * elle **comptait donc les commentaires masqués**. La publication aurait annoncé
 * « 5 commentaires » en n'en affichant que 3, puisque `fetchComments` filtre sur
 * `status == 'visible'`. Rien ne l'aurait signalé : ni le compilateur, ni les
 * tests de règles — ceux-ci vérifient qui a le droit d'écrire, pas ce que la
 * fonction en déduit.
 *
 * Le calcul a donc été extrait du déclencheur en fonctions pures, testables sans
 * émulateur ni Java. C'est ici que vit la règle métier ; le déclencheur ne fait
 * plus que la plomberie Firestore.
 *
 * ## Ce que ces tests ne couvrent pas
 *
 * L'écriture elle-même (l'incrément Firestore, la lecture de contrôle du parent).
 * Elle demande l'émulateur et un harnais de déclencheurs, qui n'existe pas encore
 * dans ce dépôt. Le risque résiduel est une erreur de plomberie, pas une erreur
 * de comptage.
 */
import { describe, expect, it } from 'vitest';

import { commentCountDelta, reactionDeltas } from './counters.js';

/** Commentaire réduit à ce que le calcul regarde. */
function comment(status?: string) {
  return status === undefined ? undefined : { status };
}

/** Réaction réduite à ce que le calcul regarde. */
function reaction(emoji?: string) {
  return emoji === undefined ? undefined : { emoji };
}

describe('commentCountDelta', () => {
  it('compte la création d’un commentaire', () => {
    expect(commentCountDelta(undefined, comment('visible'))).toBe(1);
  });

  it('décompte la suppression définitive', () => {
    expect(commentCountDelta(comment('visible'), undefined)).toBe(-1);
  });

  it('décompte le masquage par un modérateur', () => {
    // Le point du bug corrigé : `hidden` n'est pas affiché par le fil, donc il
    // ne doit pas être compté.
    expect(commentCountDelta(comment('visible'), comment('hidden'))).toBe(-1);
  });

  it('décompte le retrait par l’auteur', () => {
    expect(commentCountDelta(comment('visible'), comment('deleted'))).toBe(-1);
  });

  it('recompte un commentaire démasqué', () => {
    expect(commentCountDelta(comment('hidden'), comment('visible'))).toBe(1);
  });

  it('ne bouge pas quand seul le corps change', () => {
    expect(commentCountDelta(comment('visible'), comment('visible'))).toBe(0);
  });

  it('ne bouge pas pour un commentaire toujours masqué', () => {
    expect(commentCountDelta(comment('hidden'), comment('hidden'))).toBe(0);
  });

  it('ne bouge pas quand le document est absent des deux côtés', () => {
    expect(commentCountDelta(undefined, undefined)).toBe(0);
  });

  it('ne compte pas un statut inconnu', () => {
    // Échec fermé : seul `visible` compte. Un statut ajouté plus tard sans
    // toucher à cette fonction ne gonflera pas le décompte.
    expect(commentCountDelta(undefined, comment('archived'))).toBe(0);
    expect(commentCountDelta(comment('visible'), comment('archived'))).toBe(-1);
  });
});

describe('reactionDeltas', () => {
  it('incrémente l’emoji posé', () => {
    expect(reactionDeltas(undefined, reaction('👍'))).toEqual({ '👍': 1 });
  });

  it('décrémente l’emoji retiré', () => {
    expect(reactionDeltas(reaction('👍'), undefined)).toEqual({ '👍': -1 });
  });

  it('transfère d’un emoji à l’autre', () => {
    expect(reactionDeltas(reaction('👍'), reaction('🎉'))).toEqual({ '👍': -1, '🎉': 1 });
  });

  it('ne bouge pas pour une réécriture identique', () => {
    // Cas le plus fréquent : un retry du client ne doit pas fausser le décompte.
    expect(reactionDeltas(reaction('👍'), reaction('👍'))).toEqual({});
  });

  it('ne bouge pas quand la réaction n’existe pas', () => {
    expect(reactionDeltas(undefined, undefined)).toEqual({});
  });

  it('ignore un emoji hors liste', () => {
    // Les règles refusent déjà cet emoji ; le cache d'affichage ne doit pas
    // pour autant gagner une clé inventée si le document existait.
    expect(reactionDeltas(undefined, reaction('💩'))).toEqual({});
    expect(reactionDeltas(reaction('💩'), reaction('💩'))).toEqual({});
  });

  it('ignore la part hors liste d’un changement', () => {
    expect(reactionDeltas(reaction('💩'), reaction('🎉'))).toEqual({ '🎉': 1 });
    expect(reactionDeltas(reaction('🎉'), reaction('💩'))).toEqual({ '🎉': -1 });
  });

  it('ne bouge pas si le champ emoji manque', () => {
    expect(reactionDeltas({}, {})).toEqual({});
    expect(reactionDeltas({ uid: 'parent-1' }, { uid: 'parent-1' })).toEqual({});
  });
});
