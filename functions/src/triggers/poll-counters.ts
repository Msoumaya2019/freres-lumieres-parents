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
 * double vote structurellement impossible. `options[].votes` et `totalVoters`
 * ne sont qu'un cache d'affichage, que ce déclencheur tient à jour.
 *
 * ## Pourquoi une transaction, et non un incrément ciblé
 *
 * Les voix vivent dans le **tableau** `options` du sondage, et une option est
 * désignée par son identifiant, pas par sa position. `FieldValue.increment`
 * vise un chemin, donc une position (`options.2.votes`) : réordonner les
 * options — ce que l'administration fera en corrigeant une question — ferait
 * basculer les voix d'une réponse à l'autre, en silence.
 *
 * Une transaction lit le document, retrouve chaque option par son identifiant,
 * et réécrit le tableau. Elle coûte une lecture par vote, et elle est
 * nécessaire pour une seconde raison : deux votes simultanés liraient tous deux
 * le même total et l'un écraserait l'autre. La transaction les fait rejouer.
 *
 * ## Le document de sondage devient un document **chaud**
 *
 * C'est la conséquence à ne pas manquer : chaque vote écrit dans
 * `polls/{pollId}`. Tout déclencheur futur posé sur ce chemin sera donc réveillé
 * **à chaque vote**, et pas seulement à la publication. `notifyPollAudience`,
 * notamment, devra raisonner en **transition de statut** — n'agir que si le
 * statut *devient* `open` — et non sur la seule existence d'une écriture. Sans
 * cette précaution, chaque vote annoncerait le sondage à tout le monde.
 *
 * La chaîne s'arrête ici : rien n'écoute `polls/{pollId}` aujourd'hui.
 *
 * ## Ce que le cache ne garantit pas
 *
 * Un déclencheur Firestore est livré « au moins une fois » : un rejeu applique
 * le même delta deux fois, et le total dérive. Le choix de l'incrément plutôt
 * que du recomptage est délibéré — recompter la sous-collection coûterait une
 * lecture par vote déjà exprimé, à chaque nouveau vote, soit un coût
 * quadratique. La contrepartie est assumée et **réparable** : la vérité est dans
 * `votes`, donc recalculer `options[].votes` et `totalVoters` depuis cette
 * sous-collection redonne un décompte exact. Ce recalcul n'est pas écrit ici.
 *
 * ## Ce que le cache garantit, en revanche
 *
 * Le décompte parcourt les options **du sondage**, jamais celles du vote. Un
 * identifiant qui n'existe pas dans le sondage est donc ignoré, et une réponse
 * inventée ne peut pas apparaître dans les résultats. C'est la propriété qui
 * compte : le pire qu'un client puisse faire est d'ajouter un participant qui
 * n'a choisi aucune réponse réelle.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { FieldValue, type DocumentData } from 'firebase-admin/firestore';

import { adminDb } from '../lib/admin.js';
import { paths } from '../lib/paths.js';

/** Variation à appliquer au document de sondage. */
export interface VoteDeltas {
  /** Par identifiant d'option. Absent quand l'option n'est pas concernée. */
  readonly parOption: Readonly<Record<string, number>>;
  /** Variation du nombre de participants distincts. */
  readonly votants: number;
}

/** Sondage recalculé après application des variations. */
export interface DecompteApplique {
  readonly options: DocumentData[];
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
    let deriveDetectee = false;

    await adminDb().runTransaction(async (transaction) => {
      const instantane = await transaction.get(sondage);

      // Le vote ne peut naître que sous un sondage existant (les règles
      // l'exigent), mais le sondage a pu être supprimé entre-temps — et
      // supprimer un document n'efface pas ses sous-collections.
      if (!instantane.exists) {
        logger.warn('[onPollVoteWritten] Sondage absent, décompte ignoré', { pollId });
        return;
      }

      const decompte = appliquerVote(instantane.data() ?? {}, deltas);
      deriveDetectee = decompte.deriveDetectee;

      transaction.update(sondage, {
        options: decompte.options,
        totalVoters: decompte.totalVoters,
        updatedAt: FieldValue.serverTimestamp(),
      });
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
 * Applique les variations au document de sondage.
 *
 * Le parcours porte sur les options **du sondage**, et c'est délibéré : une
 * option que le vote nomme mais que le sondage ne connaît pas n'est jamais
 * créée, et une option absente du vote n'est jamais touchée. Un identifiant
 * inventé par un client ne peut donc pas se retrouver dans les résultats.
 */
export function appliquerVote(donnees: DocumentData, deltas: VoteDeltas): DecompteApplique {
  let deriveDetectee = false;

  const options = (Array.isArray(donnees.options) ? (donnees.options as DocumentData[]) : []).map(
    (option) => {
      const identifiant = typeof option?.id === 'string' ? option.id : null;
      const delta = identifiant ? (deltas.parOption[identifiant] ?? 0) : 0;
      if (delta === 0) return option;

      const voix = typeof option?.votes === 'number' ? option.votes : 0;
      const total = voix + delta;
      if (total < 0) deriveDetectee = true;

      return { ...option, votes: total < 0 ? 0 : total };
    },
  );

  const votants =
    (typeof donnees.totalVoters === 'number' ? donnees.totalVoters : 0) + deltas.votants;
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
