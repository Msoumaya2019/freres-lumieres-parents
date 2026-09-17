/**
 * Suppression des jetons d'appareil déclarés morts.
 *
 * ## Pourquoi ce geste est isolé dans son propre module
 *
 * Il a deux déclencheurs, et ils ne se ressemblent pas : un ticket refusé à
 * l'envoi, et un reçu `DeviceNotRegistered` lu quinze minutes plus tard. Écrire
 * la suppression deux fois aurait produit deux comportements qui divergent à la
 * première modification — l'un des deux oublierait de compter, ou découperait
 * ses lots autrement.
 *
 * ## Pourquoi supprimer, et non désactiver
 *
 * `DeviceNotRegistered` veut dire que l'application n'est plus installée. Le
 * jeton ne reviendra pas : le garder le fait retenter à chaque envoi, pour
 * toujours, et gonfle le nombre d'appareils visés — donc l'écart entre ce que
 * l'administration croit envoyer et ce qui part réellement.
 */
import { adminDb } from '../lib/admin.js';
import { paths } from '../lib/paths.js';

/** Nombre maximal d'opérations dans un lot Firestore. */
const TAILLE_LOT = 500;

/**
 * Supprime les jetons indiqués, et rend le nombre de documents supprimés.
 *
 * Les doublons sont écartés : un même jeton peut apparaître deux fois — deux
 * lots d'audience, ou un ticket et un reçu —, et un lot Firestore refuse deux
 * écritures sur le même document. La suppression étant idempotente, le compte
 * rendu, lui, ne l'est pas : sans dédoublonnage il annoncerait plus de jetons
 * supprimés qu'il n'en existait.
 */
export async function purgeDeviceTokens(tokens: readonly string[]): Promise<number> {
  const uniques = [...new Set(tokens)];
  if (uniques.length === 0) return 0;

  const db = adminDb();
  let supprimes = 0;

  for (let debut = 0; debut < uniques.length; debut += TAILLE_LOT) {
    const lot = uniques.slice(debut, debut + TAILLE_LOT);
    const batch = db.batch();
    for (const token of lot) batch.delete(db.doc(paths.deviceToken(token)));
    await batch.commit();
    supprimes += lot.length;
  }

  return supprimes;
}
