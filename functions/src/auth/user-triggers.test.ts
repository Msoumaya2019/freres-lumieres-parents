/**
 * Nettoyage des données d'un compte supprimé.
 *
 * ## Pourquoi ces tests existent
 *
 * `cleanupDeletedUser` portait deux défauts que rien ne signalait :
 *
 *  - son bloc de documentation annonçait l'anonymisation « des messages, des
 *    commentaires », alors qu'elle ne traitait que les publications ;
 *  - l'anonymisation s'arrêtait au premier lot de 500 **sans le dire**, et
 *    partageait sa transaction avec la suppression des jetons — passé la
 *    limite de 500 écritures d'un lot Firestore, plus rien n'était écrit, pas
 *    même la suppression des jetons.
 *
 * Le second est un défaut de **comportement**, donc il se prouve par un
 * comportement : la base est injectée, et le faux Firestore porte une vraie base
 * en mémoire. Un test de source aurait vérifié que la boucle existe, sans
 * vérifier qu'un parent de mille deux cents publications est entièrement
 * anonymisé.
 */
import { describe, expect, it } from 'vitest';

import { COLLECTIONS, paths } from '../lib/paths.js';
import { base, type FauxDocument } from '../test-helpers/faux-firestore.js';
import { anonymisePublications, cleanupDeletedUser } from './user-triggers.js';

/** Publications d'un auteur, numérotées. */
function publicationsDe(nombre: number, authorId = 'uid-partant'): FauxDocument[] {
  return Array.from({ length: nombre }, (_, index) => ({
    id: `p${index}`,
    authorId,
    authorName: 'Marie D.',
  }));
}

describe('anonymisePublications', () => {
  it('traite toutes les publications, et pas seulement le premier lot', async () => {
    // Le défaut d'origine : `limit(500)` sans boucle. Le test échoue à 500.
    const publications = publicationsDe(1200);
    const { db } = base({ [COLLECTIONS.posts]: publications });

    const traitees = await anonymisePublications('uid-partant', db);

    expect(traitees).toBe(1200);
    expect(publications.every((p) => p.authorName === 'Ancien parent')).toBe(true);
    expect(publications.every((p) => p.authorId === 'deleted-user')).toBe(true);
  });

  it('ne dépasse jamais la limite d’écritures d’un lot Firestore', async () => {
    const { faux, db } = base({ [COLLECTIONS.posts]: publicationsDe(1200) });

    await anonymisePublications('uid-partant', db);

    // Trois passages : 500, 500, 200. Aucun lot au-delà de 500.
    expect(faux.lots).toEqual([500, 500, 200]);
  });

  it('ne touche pas aux publications d’un autre auteur', async () => {
    const siennes = publicationsDe(3, 'uid-partant');
    const autres = publicationsDe(2, 'uid-restant');
    const { db } = base({ [COLLECTIONS.posts]: [...siennes, ...autres] });

    await anonymisePublications('uid-partant', db);

    expect(autres.every((p) => p.authorName === 'Marie D.')).toBe(true);
  });

  it('rend zéro sans boucler quand l’identifiant est déjà le marqueur', async () => {
    // Sans la garde, la boucle retrouverait les documents qu'elle vient
    // d'écrire : le test ne tomberait pas, il ne finirait pas.
    const { db } = base({ [COLLECTIONS.posts]: publicationsDe(1, 'deleted-user') });

    await expect(anonymisePublications('deleted-user', db)).resolves.toBe(0);
  });
});

describe('cleanupDeletedUser', () => {
  it('supprime les jetons, anonymise les publications et efface le profil', async () => {
    const publications = publicationsDe(2);
    const jetons: FauxDocument[] = [
      { id: 'ExponentPushToken[a]', uid: 'uid-partant' },
      { id: 'ExponentPushToken[b]', uid: 'uid-partant' },
    ];
    const { faux, db } = base({
      [COLLECTIONS.posts]: publications,
      [COLLECTIONS.deviceTokens]: jetons,
    });

    await cleanupDeletedUser('uid-partant', db);

    expect(faux.restants(COLLECTIONS.deviceTokens)).toHaveLength(0);
    expect(publications.every((p) => p.authorName === 'Ancien parent')).toBe(true);
    expect(faux.supprimes).toContain(paths.user('uid-partant'));
  });

  it('n’écrit jamais plus de 500 opérations dans un même lot', async () => {
    // La version fautive mettait les jetons **et** les publications dans une
    // seule transaction : au-delà de 500, le service la refusait entièrement.
    const jetons: FauxDocument[] = Array.from({ length: 40 }, (_, index) => ({
      id: `ExponentPushToken[${index}]`,
      uid: 'uid-partant',
    }));
    const { faux, db } = base({
      [COLLECTIONS.posts]: publicationsDe(600),
      [COLLECTIONS.deviceTokens]: jetons,
    });

    await cleanupDeletedUser('uid-partant', db);

    expect(faux.lots.every((taille) => taille <= 500)).toBe(true);
    expect(faux.lots).toContain(500);
  });

  it('ne touche pas aux jetons d’un autre porteur', async () => {
    const { faux, db } = base({
      [COLLECTIONS.posts]: [],
      [COLLECTIONS.deviceTokens]: [
        { id: 'ExponentPushToken[a]', uid: 'uid-partant' },
        { id: 'ExponentPushToken[b]', uid: 'uid-restant' },
      ],
    });

    await cleanupDeletedUser('uid-partant', db);

    expect(faux.restants(COLLECTIONS.deviceTokens).map((jeton) => jeton.id)).toEqual([
      'ExponentPushToken[b]',
    ]);
  });
});
