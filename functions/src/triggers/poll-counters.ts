/**
 * Décompte des voix d'un sondage.
 *
 * ## Pourquoi ce compteur existe
 *
 * Un parent qui vote n'a **pas** le droit de modifier le sondage : les règles
 * réservent `polls/{pollId}` à `isFcpe()`. Le compteur ne peut donc pas être
 * écrit par le client — c'est la même situation que le compteur de commentaires,
 * et la même solution : le client écrit le fait, le serveur en déduit le total.
 *
 * La sous-collection `votes/{uid}` est la **source de vérité** : elle rend le
 * double vote structurellement impossible. Le document `pollResults/{pollId}`
 * n'est qu'un cache d'affichage, que ce déclencheur tient à jour — et il en est
 * le **seul** écrivain, les règles refusant toute écriture client.
 *
 * ## Pourquoi les résultats sont hors du document de sondage
 *
 * `polls/{pollId}` est lisible par tout parent de l'organisation : c'est ce qui
 * permet de poser la question avant d'y répondre. Y écrire les totaux
 * publierait donc les résultats à tout le monde, quel que soit
 * `resultsVisibility` — une promesse que le modèle déclarait et que rien
 * n'implémentait.
 *
 * Le déplacement n'est pas un rangement : une règle de lecture ne filtre pas
 * des champs, elle ouvre ou ferme un document entier. Tant que les totaux
 * vivaient sur le sondage, « les résultats apparaissent après le vote » était
 * invivable, et la fenêtre entre le vote et la réécriture du décompte suffisait
 * à les laisser filtrer par le cache local.
 *
 * ## Pourquoi une transaction, et non un incrément ciblé
 *
 * Les options sont désignées par leur **identifiant**, pas par leur position.
 * `FieldValue.increment` vise un chemin, donc une position (`options.2.votes`) :
 * réordonner les options — ce que l'administration fera en corrigeant une
 * question — ferait basculer les voix d'une réponse à l'autre, en silence.
 *
 * Une transaction lit les deux documents, retrouve chaque option par son
 * identifiant, et réécrit le tableau. Elle est nécessaire pour une seconde
 * raison : deux votes simultanés liraient tous deux le même total et l'un
 * écraserait l'autre. La transaction les fait rejouer.
 *
 * ## Le sondage cesse d'être un document chaud
 *
 * C'est la conséquence heureuse du déplacement, et elle mérite d'être notée :
 * ce déclencheur n'écrit plus dans `polls/{pollId}`. Le sondage n'est donc
 * réécrit que par la FCPE — à la publication, à la clôture, à la correction
 * d'une question — et `notifyPollAudience`, qui écoutera ce chemin, peut
 * raisonner en **transition de statut** sans craindre d'être réveillé par
 * chaque vote. Le document chaud est désormais `pollResults/{pollId}`, que
 * personne n'écoute.
 *
 * ## Ce que le cache ne garantit pas
 *
 * Un déclencheur Firestore est livré « au moins une fois » : un rejeu applique
 * le même delta deux fois, et le total dérive. Le choix de l'incrément plutôt
 * que du recomptage est délibéré — recompter la sous-collection coûterait une
 * lecture par vote déjà exprimé, à chaque nouveau vote, soit un coût
 * quadratique. La contrepartie est assumée et **réparable** : la vérité est dans
 * `votes`, donc recalculer les compteurs depuis cette sous-collection redonne un
 * décompte exact. Ce recalcul n'est pas écrit ici.
 *
 * ## Ce que le cache garantit, en revanche
 *
 * Le décompte parcourt les options **du sondage**, jamais celles du vote. Un
 * identifiant que le vote nomme mais que le sondage ne connaît pas est ignoré :
 * une réponse inventée ne peut pas apparaître dans les résultats. C'est la
 * propriété qui compte — le pire qu'un client puisse faire est d'ajouter un
 * participant qui n'a choisi aucune réponse réelle.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { FieldValue, type DocumentData } from 'firebase-admin/firestore';

import { adminDb } from '../lib/admin.js';
import { paths } from '../lib/paths.js';

/** Variation à appliquer au décompte. */
export interface VoteDeltas {
  /** Par identifiant d'option. Absent quand l'option n'est pas concernée. */
  readonly parOption: Readonly<Record<string, number>>;
  /** Variation du nombre de participants distincts. */
  readonly votants: number;
}

/** Option du document de résultats — l'identifiant et son compte, rien d'autre. */
export interface OptionDecomptee {
  readonly id: string;
  readonly votes: number;
}

/** Décompte recalculé après application des variations. */
export interface DecompteApplique {
  readonly options: readonly OptionDecomptee[];
  readonly totalVoters: number;
  /**
   * Vrai quand un décompte est descendu sous zéro et a été ramené à zéro.
   * Signale un rejeu de déclencheur : le déclencheur le journalise.
   */
  readonly deriveDetectee: boolean;
}

export const onPollVoteWritten = onDocumentWritten(
  { document: 'polls/{pollId}/votes/{voterKey}', region: 'europe-west1' },
  async (event) => {
    const deltas = voteDeltas(event.data?.before.data(), event.data?.after.data());

    // Couvre le cas le plus fréquent : une réécriture identique — rejeu du
    // client, ou livraison en double — ne doit rien modifier.
    if (Object.keys(deltas.parOption).length === 0 && deltas.votants === 0) return;

    const { pollId } = event.params;
    const sondage = adminDb().doc(paths.poll(pollId));
    const resultats = adminDb().doc(paths.pollResult(pollId));
    let deriveDetectee = false;

    await adminDb().runTransaction(async (transaction) => {
      // Les deux documents sont lus **dans** la transaction, et pour deux
      // raisons différentes : le sondage porte la liste des options — c'est
      // l'autorité sur ce qui peut exister — et le document de résultats porte
      // les compteurs à reprendre. Le lire hors transaction laisserait une
      // correction de question se glisser entre la lecture et l'écriture.
      const instantanes = await transaction.getAll(sondage, resultats);
      const instantaneSondage = instantanes[0];
      const instantaneResultats = instantanes[1];

      // `getAll` rend un **tableau**, et le typage ne garantit pas sa longueur —
      // alors que deux références sont passées, donc que les deux instantanés
      // existent. Un `!` dirait « je sais mieux que le compilateur » et
      // masquerait un vrai changement d'API ; ce refus explicite le rendrait
      // visible, et il est fermé : mieux vaut ne pas décompter que décompter
      // sur un document qu'on n'a pas lu.
      if (!instantaneSondage || !instantaneResultats) {
        logger.error('[onPollVoteWritten] Lecture incomplète, décompte ignoré', { pollId });
        return;
      }

      // Le vote ne peut naître que sous un sondage existant (les règles
      // l'exigent), mais le sondage a pu être supprimé entre-temps — et
      // supprimer un document n'efface pas ses sous-collections.
      if (!instantaneSondage.exists) {
        logger.warn('[onPollVoteWritten] Sondage absent, décompte ignoré', { pollId });
        return;
      }

      const donneesSondage = instantaneSondage.data() ?? {};
      const decompte = appliquerVote(donneesSondage, instantaneResultats.data() ?? {}, deltas);
      deriveDetectee = decompte.deriveDetectee;

      transaction.set(
        resultats,
        {
          // La règle de lecture compare l'organisation du document à celle du
          // lecteur. Le champ est donc indispensable — et son absence, plutôt
          // qu'un `undefined` refusé par le SDK Admin, rendrait le document
          // illisible par tout le monde : un repli fermé, ce qui est le bon
          // sens de l'erreur.
          ...(typeof donneesSondage.orgId === 'string' ? { orgId: donneesSondage.orgId } : {}),
          options: decompte.options,
          totalVoters: decompte.totalVoters,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    // Un décompte négatif signalerait un rejeu de déclencheur. On le ramène à
    // zéro plutôt que de l'afficher — un « −1 participant » n'a aucun sens à
    // l'écran — mais on le dit, sans quoi la dérive resterait invisible. C'est
    // la seule différence assumée avec le décompte des réactions : un compteur
    // de réactions est décoratif, un résultat de sondage **est** le produit.
    if (deriveDetectee) {
      logger.warn('[onPollVoteWritten] Décompte négatif ramené à zéro — rejeu probable', {
        pollId,
        deltas,
      });
    }

    logger.info('[onPollVoteWritten] Décompte des voix mis à jour', { pollId, ...deltas });
  },
);

/**
 * Variation du décompte pour une écriture de vote.
 *
 * Extraite du déclencheur pour être testable sans émulateur : c'est ici que vit
 * la règle métier — « un changement de vote déplace une voix, il n'en ajoute
 * pas » — et non dans la plomberie Firestore.
 *
 * Les listes sont ramenées à des ensembles : un identifiant répété dans le vote
 * ne doit compter qu'une fois. Les règles refusent déjà les doublons ; ce repli
 * évite qu'une donnée écrite par un autre chemin fasse dériver le total.
 */
export function voteDeltas(
  before: DocumentData | undefined,
  after: DocumentData | undefined,
): VoteDeltas {
  const avant = new Set(choix(before));
  const apres = new Set(choix(after));

  const parOption: Record<string, number> = {};
  for (const identifiant of avant) {
    if (!apres.has(identifiant)) parOption[identifiant] = (parOption[identifiant] ?? 0) - 1;
  }
  for (const identifiant of apres) {
    if (!avant.has(identifiant)) parOption[identifiant] = (parOption[identifiant] ?? 0) + 1;
  }

  // Un votant de plus à la création, un de moins à la suppression, et rien qui
  // change quand un vote est modifié : c'est la même personne.
  return { parOption, votants: (after ? 1 : 0) - (before ? 1 : 0) };
}

/**
 * Applique les variations au document de résultats.
 *
 * Le parcours porte sur les options **du sondage**, et c'est délibéré : une
 * option que le vote nomme mais que le sondage ne connaît pas n'est jamais
 * créée, et une option absente du vote garde son compte. Un identifiant inventé
 * par un client ne peut donc pas se retrouver dans les résultats.
 *
 * Les comptes existants sont lus **par identifiant**, jamais par position : le
 * document de résultats peut avoir été écrit dans un autre ordre, et une
 * correction de question peut avoir réordonné les options.
 */
export function appliquerVote(
  sondage: DocumentData,
  resultats: DocumentData,
  deltas: VoteDeltas,
): DecompteApplique {
  let deriveDetectee = false;

  const comptes = new Map<string, number>();
  const optionsResultats = Array.isArray(resultats.options)
    ? (resultats.options as DocumentData[])
    : [];
  for (const option of optionsResultats) {
    const identifiant = typeof option?.id === 'string' ? option.id : null;
    if (identifiant) {
      comptes.set(identifiant, typeof option?.votes === 'number' ? option.votes : 0);
    }
  }

  const optionsSondage = Array.isArray(sondage.options) ? (sondage.options as DocumentData[]) : [];
  const options: OptionDecomptee[] = optionsSondage.map((option) => {
    const identifiant = typeof option?.id === 'string' ? option.id : '';
    const total = (comptes.get(identifiant) ?? 0) + (deltas.parOption[identifiant] ?? 0);
    if (total < 0) deriveDetectee = true;

    return { id: identifiant, votes: total < 0 ? 0 : total };
  });

  const votants =
    (typeof resultats.totalVoters === 'number' ? resultats.totalVoters : 0) + deltas.votants;
  if (votants < 0) deriveDetectee = true;

  return { options, totalVoters: votants < 0 ? 0 : votants, deriveDetectee };
}

/** Identifiants d'options d'un vote, réduits à ce que le calcul peut lire. */
function choix(data: DocumentData | undefined): readonly string[] {
  const identifiants = data?.optionIds;
  if (!Array.isArray(identifiants)) return [];
  return identifiants.filter(
    (identifiant): identifiant is string => typeof identifiant === 'string',
  );
}
