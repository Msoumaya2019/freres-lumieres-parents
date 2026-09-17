/**
 * Suppression des jetons d'appareil.
 *
 * ## Ce que ces tests ajoutent
 *
 * Le bloc de documentation de `purgeDeviceTokens` affirme que « les doublons
 * sont écartés », et donne la raison : « un lot Firestore refuse deux écritures
 * sur le même document ». Rien ne l'éprouvait — le seul test qui nommait la
 * fonction lisait sa **position** dans un autre fichier, pas son comportement.
 *
 * C'est une promesse qui compte : les jetons arrivent par lots d'audience, et
 * un même appareil appartient souvent à deux lots. Sans dédoublonnage, le lot
 * entier est refusé par le service — la suppression ne fait rien du tout, et le
 * compte rendu annoncerait pourtant des suppressions.
 *
 * Le faux Firestore refuse donc deux écritures sur le même document, comme le
 * service. Sans cette contrainte, le test passerait avec ou sans le
 * dédoublonnage : un faux plus permissif que le service ne prouve rien.
 */
import { describe, expect, it } from 'vitest';

import { COLLECTIONS } from './paths.js';
import { base, type FauxDocument } from '../test-helpers/faux-firestore.js';
import { purgeDeviceTokens } from './token-purge.js';

/** Jetons d'appareil présents en base, numérotés. */
function jetonsDe(nombre: number): FauxDocument[] {
  return Array.from({ length: nombre }, (_, index) => ({
    id: `ExponentPushToken[${index}]`,
    uid: 'uid-partant',
  }));
}

describe('purgeDeviceTokens', () => {
  it('supprime chaque jeton une seule fois, même donné deux fois', async () => {
    // Le cas réel : deux lots d'audience portent le même appareil.
    const { faux, db } = base({ [COLLECTIONS.deviceTokens]: jetonsDe(2) });

    const supprimes = await purgeDeviceTokens(
      ['ExponentPushToken[0]', 'ExponentPushToken[0]', 'ExponentPushToken[1]'],
      db,
    );

    // Deux jetons distincts, donc deux suppressions — et non trois : le compte
    // rendu décrit la base, pas la liste reçue.
    expect(supprimes).toBe(2);
    expect(faux.lots).toEqual([2]);
    expect(faux.restants(COLLECTIONS.deviceTokens)).toHaveLength(0);
  });

  it('n’écrit aucun lot quand la liste est vide', async () => {
    const { faux, db } = base({ [COLLECTIONS.deviceTokens]: jetonsDe(1) });

    await expect(purgeDeviceTokens([], db)).resolves.toBe(0);

    expect(faux.lots).toEqual([]);
    expect(faux.restants(COLLECTIONS.deviceTokens)).toHaveLength(1);
  });

  it('découpe au-delà de la limite d’écritures d’un lot Firestore', async () => {
    // Un compte supprimé peut porter plus de 500 jetons : le partage d'un
    // appareil entre plusieurs lots d'audience en crée un par combinaison.
    const { faux, db } = base({ [COLLECTIONS.deviceTokens]: jetonsDe(1200) });
    const jetons = jetonsDe(1200).map((jeton) => jeton.id);

    await expect(purgeDeviceTokens(jetons, db)).resolves.toBe(1200);

    expect(faux.lots).toEqual([500, 500, 200]);
  });
});
