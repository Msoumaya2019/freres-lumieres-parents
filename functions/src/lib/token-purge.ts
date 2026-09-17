/**
 * Suppression des jetons d'appareil.
 *
 * ## Pourquoi ce geste est isolé dans son propre module
 *
 * Il a trois déclencheurs, et ils ne se ressemblent pas : un ticket refusé à
 * l'envoi, un reçu `DeviceNotRegistered` lu quinze minutes plus tard, et la
 * suppression d'un compte. Écrire la suppression trois fois aurait produit trois
 * comportements qui divergent à la première modification — l'un des trois
 * oublierait de compter, ou découperait ses lots autrement. Le troisième
 * existait bel et bien, avec son propre lot : il ne découpait rien, et
 * partageait sa transaction avec les publications à anonymiser.
 *
 * ## Pourquoi il vit dans `lib/`, et non sous `notifications/`
 *
 * Ses appelants sont répartis : `notifications/send.ts`,
 * `notifications/receipts.ts` et `auth/user-triggers.ts`. Le ranger sous l'un
 * des deux dossiers faisait de l'autre un import latéral.
 *
 * ## Pourquoi supprimer, et non désactiver
 *
 * `DeviceNotRegistered` veut dire que l'application n'est plus installée. Le
 * jeton ne reviendra pas : le garder le fait retenter à chaque envoi, pour
 * toujours, et gonfle le nombre d'appareils visés — donc l'écart entre ce que
 * l'administration croit envoyer et ce qui part réellement.
 *
 * Un compte supprimé, lui, n'a plus d'appareil du tout : ses jetons
 * continueraient d'être envoyés à un profil qui n'existe plus.
 */
import type { Firestore } from 'firebase-admin/firestore';

import { adminDb } from './admin.js';
import { paths } from './paths.js';

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
 *
 * La base est injectable pour la même raison qu'`anonymisePublications` : sans
 * elle, aucun test ne peut traverser `cleanupDeletedUser` sans émulateur.
 */
export async function purgeDeviceTokens(
  tokens: readonly string[],
  db: Firestore = adminDb(),
): Promise<number> {
  const uniques = [...new Set(tokens)];
  if (uniques.length === 0) return 0;

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
