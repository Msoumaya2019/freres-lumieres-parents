/**
 * Dépôt des sondages.
 *
 * ## `notify` n'est pas un champ, c'est une décision de statut
 *
 * `pollInputSchema` porte un booléen `notify` que le document ne conserve pas :
 * il décide du **statut initial**. `notify: true` publie le sondage d'emblée
 * (`open`) ; `notify: false` l'enregistre en brouillon (`draft`), que
 * l'administration ouvrira plus tard.
 *
 * Ce n'est pas un détail de rangement : la règle de lecture n'ouvre un sondage
 * qu'aux statuts `open` et `closed`, si bien qu'un brouillon n'est lisible par
 * **personne** — pas même par un parent de l'audience visée. Enregistrer sans
 * publier ne laisse donc rien filtrer.
 *
 * C'est aussi cette traduction qui impose, côté notification, un déclencheur
 * d'**écriture** et non de création : un sondage peut naître `open`, ou le
 * devenir quand l'administration ouvre son brouillon. Un déclencheur de
 * création raterait le second cas.
 *
 * ## Les compteurs démarrent à zéro, et c'est le serveur qui les tient
 *
 * `options[].votes` et `totalVoters` sont écrits ici à zéro, et nulle part
 * ailleurs depuis le client : les règles réservent la modification du document
 * de sondage à la FCPE (`isFcpe()`), donc un parent qui vote ne peut pas
 * incrémenter quoi que ce soit. Le décompte appartient à une Cloud Function,
 * qui seule écrit dans un document qu'un parent n'a pas le droit de modifier.
 *
 * ## Le vote lit avant d'écrire, et ce n'est pas une précaution de confort
 *
 * `vote` fait deux lectures avant sa seule écriture. Le sondage, d'abord,
 * parce qu'il faut en connaître l'anonymat : c'est lui qui décide si le
 * document de vote porte un `uid`. Le vote existant, ensuite, parce que deux
 * choses en dépendent — `createdAt` ne doit pas être réécrit quand on change
 * de réponse, et `allowChangeVote` doit produire un refus lisible plutôt qu'un
 * `permission-denied` générique.
 *
 * Ces contrôles **ne sont pas la barrière** : les règles les refont au moment
 * de l'écriture, sur le document parent, et c'est elles qui décident. Un vote
 * peut d'ailleurs être refusé alors que ces lectures avaient dit oui — le
 * sondage a pu être clos dans l'intervalle. C'est le comportement voulu : la
 * lecture sert le message, la règle sert la garantie.
 */

import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  type Firestore,
} from 'firebase/firestore';

import { buildAudienceKeys, pollInputSchema, pollVoteSchema } from '@fl/shared';
import type { PollInput, PollVoteInput } from '@fl/shared';
import type { Poll } from '@fl/types';

import { appError, invalidArgument, toAppError } from '../errors.js';
import { paths } from '../paths.js';

export interface CreatePollParams {
  orgId: string;
  /**
   * Auteur du sondage.
   *
   * Seul son identifiant est écrit (`createdBy`) : `Poll` ne déclare pas de nom
   * d'auteur, et les règles n'en bornent aucun. Recopier un `authorName` ici
   * ajouterait au document un champ que le modèle ne connaît pas et qu'aucune
   * règle ne vérifie — un nom vide s'afficherait tel quel. L'écran
   * d'administration lit le profil, qui est la source du nom.
   */
  authorId: string;
  /**
   * Identifiant à donner au sondage, obtenu par `newPollId()`.
   *
   * Sans lui, Firestore en choisit un. Le pré-générer permet de composer le
   * lien profond **avant** l'écriture, et donc de le joindre à la notification
   * sans relire le document qu'on vient de créer.
   */
  pollId?: string;
  input: PollInput;
}

export interface CastVoteParams {
  pollId: string;
  /**
   * Identifiant de l'électeur.
   *
   * C'est lui qui **est** l'identifiant du document de vote, et c'est ce qui
   * rend le double vote impossible : les règles exigent
   * `voterKey == request.auth.uid`. Le passer explicitement, plutôt que de le
   * lire d'une session, garde le dépôt testable et met le lien en évidence —
   * c'est aussi la raison pour laquelle l'anonymat d'un sondage est une
   * promesse d'interface, et non une promesse de base (voir `Poll.anonymous`).
   */
  voterId: string;
  input: PollVoteInput;
}

export interface PollRepository {
  /** Identifiant d'un sondage qui n'existe pas encore — rien n'est écrit. */
  newPollId(): string;
  /** Un sondage par son identifiant, ou `null`. */
  get(pollId: string): Promise<Poll | null>;
  /**
   * Crée un sondage. Valide les données, calcule les clés d'audience, et
   * traduit `notify` en statut initial.
   */
  create(params: CreatePollParams): Promise<string>;
  /**
   * Enregistre le vote de l'appelant, ou remplace son vote précédent.
   *
   * Le décompte des voix n'est pas écrit ici : il appartient à la Cloud
   * Function `onPollVoteWritten`, parce que le document de sondage est
   * réservé à la FCPE.
   */
  vote(params: CastVoteParams): Promise<void>;
}

export function createPollRepository(db: Firestore): PollRepository {
  return {
    newPollId: () => doc(collection(db, paths.polls())).id,
    get,
    create,
    vote,
  };

  async function get(pollId: string): Promise<Poll | null> {
    try {
      const snapshot = await getDoc(doc(db, paths.poll(pollId)));
      if (!snapshot.exists()) return null;
      return { ...(snapshot.data() as Omit<Poll, 'id'>), id: snapshot.id };
    } catch (error) {
      throw toAppError(error);
    }
  }

  async function create(params: CreatePollParams): Promise<string> {
    const { orgId, authorId, pollId, input } = params;

    const parsed = pollInputSchema.safeParse(input);
    if (!parsed.success) {
      throw invalidArgument('Sondage invalide.', {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const data = parsed.data;
    const audienceKeys = buildAudienceKeys(data.audience, orgId);

    if (audienceKeys.length === 0) {
      throw invalidArgument("L'audience du sondage est incomplète.");
    }

    try {
      const now = serverTimestamp();
      const payload = {
        orgId,
        question: data.question,
        ...(data.description ? { description: data.description } : {}),
        // Les compteurs partent de zéro, et les règles refusent toute création
        // qui tenterait de les fixer autrement : un sondage neuf ne peut pas
        // naître avec des voix.
        options: data.options.map((option) => ({
          id: option.id,
          label: option.label,
          order: option.order,
          votes: 0,
        })),
        allowMultiple: data.allowMultiple,
        anonymous: data.anonymous,
        allowChangeVote: data.allowChangeVote,
        audience: data.audience,
        audienceKeys,
        resultsVisibility: data.resultsVisibility,
        // Voir l'en-tête : `notify` ne se stocke pas, il choisit le statut.
        status: data.notify ? 'open' : 'draft',
        startsAt: now,
        ...(data.endsAt ? { endsAt: data.endsAt } : {}),
        totalVoters: 0,
        createdBy: authorId,
        createdAt: now,
        updatedAt: now,
      };

      const reference = pollId ? doc(db, paths.poll(pollId)) : doc(collection(db, paths.polls()));

      await setDoc(reference, payload);
      return reference.id;
    } catch (error) {
      throw toAppError(error);
    }
  }

  async function vote(params: CastVoteParams): Promise<void> {
    const { pollId, voterId, input } = params;

    const parsed = pollVoteSchema.safeParse(input);
    if (!parsed.success) {
      throw invalidArgument('Vote invalide.', {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const optionIds = parsed.data.optionIds;

    const sondage = await get(pollId);
    if (!sondage) {
      throw appError('not-found', 'Ce sondage n’existe plus.');
    }
    if (sondage.status !== 'open') {
      throw appError('failed-precondition', 'Ce sondage n’est pas ouvert.');
    }
    if (!sondage.allowMultiple && optionIds.length > 1) {
      throw invalidArgument('Ce sondage n’accepte qu’une seule réponse.');
    }

    const reference = doc(db, paths.pollVote(pollId, voterId));

    let dejaVote: boolean;
    try {
      dejaVote = (await getDoc(reference)).exists();
    } catch (error) {
      throw toAppError(error);
    }

    if (dejaVote && !sondage.allowChangeVote) {
      throw appError('failed-precondition', 'Ce sondage n’autorise pas la modification du vote.');
    }

    const now = serverTimestamp();

    try {
      await setDoc(
        reference,
        {
          pollId,
          // Voir `Poll.anonymous` : un sondage anonyme ne porte **aucun** `uid`.
          // Ce n'est pas une politesse du client — les règles refusent un `uid`
          // sur un sondage anonyme, et l'exigent sur les autres.
          ...(sondage.anonymous ? {} : { uid: voterId }),
          optionIds,
          // `createdAt` est l'instant du vote enregistré : il ne bouge pas
          // quand on change de réponse, et c'est `updatedAt` qui l'indique.
          ...(dejaVote ? { updatedAt: now } : { createdAt: now }),
        },
        { merge: true },
      );
    } catch (error) {
      throw toAppError(error);
    }
  }
}
