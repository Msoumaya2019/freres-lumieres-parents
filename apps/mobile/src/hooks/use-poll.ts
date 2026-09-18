/**
 * Un sondage : sa question, mon vote, et ses résultats **quand j'y ai droit**.
 *
 * ## Les résultats ne se demandent pas « pour voir »
 *
 * `getResults` lève quand les règles refusent, et une règle de lecture ne
 * filtre pas des champs : elle ouvre ou ferme un document entier. Un écran qui
 * demanderait les résultats avant d'y avoir droit afficherait donc une erreur,
 * et un abonnement refusé ne se rouvre pas tout seul.
 *
 * La décision est prise **avant** l'appel, par `canReadPollResults`, qui
 * reproduit l'échelle des règles et porte la même vérité qu'elles. Elle est
 * prise **une seule fois**, dans `load`, et n'est pas rangée dans un état : c'est
 * `results.status` qui la porte — `'idle'` veut dire « la lecture n'a pas été
 * tentée », et non « la lecture a échoué ». Un champ qui redirait la même chose
 * à côté de `results` serait une seconde vérité ; celui qui existait a été
 * retiré, aucun écran ne le lisait.
 *
 * ## Une lecture ponctuelle, et non un abonnement
 *
 * Le décompte ne bouge que lorsqu'un autre parent vote, et il est déjà
 * rafraîchissable à la main. Un abonnement vivant coûterait une lecture à
 * chaque changement et rouvrirait un document chaud que le déplacement des
 * totaux hors du sondage avait justement fait disparaître. Aucun écran de
 * l'application n'utilise `onSnapshot` aujourd'hui : en introduire un ici
 * ajouterait une seconde façon de lire les données pour un gain qui n'existe
 * pas — la FCPE suit un décompte vivant depuis l'écran d'administration, pas
 * le parent qui vient répondre.
 *
 * ## Un refus malgré le droit est une divergence, et elle se voit
 *
 * Si le prédicat dit oui et que la lecture est refusée, les deux sources ont
 * divergé. L'écran ne s'effondre pas pour autant — le parent doit pouvoir lire
 * la question et voter — mais l'erreur est conservée et affichée dans la zone
 * des résultats, sous une forme neutre. L'avaler ferait passer une divergence
 * pour une absence de voix.
 *
 * ## « Pas encore lu » n'est pas « zéro voix »
 *
 * Un sondage que personne n'a voté n'a **pas** de document de résultats :
 * l'absence vaut zéro. Mais l'absence vaut aussi « pas encore répondu » pendant
 * la lecture, et l'écran afficherait des zéros qui se contrediraient une seconde
 * plus tard. D'où un `AsyncData` à quatre états, dont `idle` qui dit « je n'ai
 * pas le droit de demander », et non « j'ai demandé et il n'y a rien ».
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createPollRepository, isAppError, toAppError, type PollRepository } from '@fl/firebase';
import { canReadPollResults } from '@fl/shared';
import type { AppError, Poll, PollResults, PollVote } from '@fl/types';

import { initializeFirebase } from '@/lib/firebase';
import { useAuth } from '@/providers/auth-provider';

import type { AsyncData } from './use-reference-data';

interface Snapshot {
  readonly key: string;
  readonly poll: AsyncData<Poll | null>;
  readonly myVote: PollVote | null;
  readonly results: AsyncData<PollResults | null>;
}

export interface PollDetailResult {
  readonly status: AsyncData<Poll | null>['status'];
  /** `null` tant que le chargement n'a pas abouti, ou si le sondage est inaccessible. */
  readonly poll: Poll | null;
  readonly error: AppError | null;
  /** Mon vote, ou `null` si je n'ai pas encore voté. */
  readonly myVote: PollVote | null;
  readonly results: AsyncData<PollResults | null>;
  readonly refreshing: boolean;
  refresh: () => void;
  readonly submitting: boolean;
  readonly voteError: AppError | null;
  /** Enregistre mon vote, ou remplace le précédent. */
  submitVote: (optionIds: readonly string[]) => Promise<boolean>;
}

export function usePoll(pollId: string): PollDetailResult {
  const { profile, firebaseUser } = useAuth();
  const [firebase] = useState(() => initializeFirebase());
  const repository = useMemo<PollRepository | null>(
    () => (firebase ? createPollRepository(firebase.db) : null),
    [firebase],
  );

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [voteError, setVoteError] = useState<AppError | null>(null);

  const generation = useRef(0);

  const uid = firebaseUser?.uid ?? null;
  const role = profile?.role ?? null;
  // Sans identifiant, `getMyVote` n'a pas de document à viser : on ne charge
  // pas plutôt que de charger un vote qui ne serait pas le mien. L'écran reste
  // alors en attente, ce qui est exact — la session n'est pas encore connue.
  const enabled = repository !== null && pollId.length > 0 && uid !== null;

  /**
   * Charge le sondage, mon vote, puis les résultats si j'y ai droit.
   *
   * Les deux premières lectures partent **ensemble** : elles ne dépendent pas
   * l'une de l'autre, et les enchaîner doublerait l'attente pour rien.
   *
   * Un échec de `getMyVote` fait échouer le chargement, et c'est délibéré : un
   * refus y est **inatteignable** tant que le sondage est lisible, puisque les
   * deux branches de sa lecture exigent `isActive()`, qui est la condition de
   * la lecture du vote — voir le commentaire de `getMyVote`. Rabattre l'erreur
   * sur `null` ferait passer un vrai défaut pour « je n'ai pas voté », ce qui
   * refermerait les résultats en silence.
   */
  const load = useCallback(async (): Promise<void> => {
    if (!repository || !pollId || !uid) return;

    const mine = (generation.current += 1);
    setVoteError(null);

    let poll: Poll | null;
    let myVote: PollVote | null;

    try {
      [poll, myVote] = await Promise.all([
        repository.get(pollId),
        repository.getMyVote(pollId, uid),
      ]);
    } catch (error) {
      if (mine !== generation.current) return;
      setSnapshot({
        key: pollId,
        poll: { status: 'error', error: isAppError(error) ? error : toAppError(error) },
        myVote: null,
        results: { status: 'idle' },
      });
      return;
    }

    if (mine !== generation.current) return;

    const droit =
      poll !== null &&
      canReadPollResults({
        role,
        status: poll.status,
        resultsVisibility: poll.resultsVisibility,
        hasVoted: myVote !== null,
        endsAt: poll.endsAt,
      });

    setSnapshot({
      key: pollId,
      poll: { status: 'ready', data: poll },
      myVote,
      results: droit ? { status: 'loading' } : { status: 'idle' },
    });

    if (!droit) return;

    try {
      const results = await repository.getResults(pollId);
      if (mine !== generation.current) return;
      setSnapshot((current) =>
        current && current.key === pollId
          ? { ...current, results: { status: 'ready', data: results } }
          : current,
      );
    } catch (error) {
      if (mine !== generation.current) return;
      setSnapshot((current) =>
        current && current.key === pollId
          ? {
              ...current,
              results: {
                status: 'error',
                error: isAppError(error) ? error : toAppError(error),
              },
            }
          : current,
      );
    }
  }, [repository, pollId, uid, role]);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  /**
   * Enregistre mon vote, puis recharge.
   *
   * Un rechargement plutôt qu'une mise à jour locale, pour deux raisons. Le
   * décompte est écrit par la Cloud Function `onPollVoteWritten` **après**
   * l'écriture : l'estimer ici afficherait un total faux. Et voter change mon
   * **droit** de lire les résultats — `after_vote` s'ouvre à l'instant du
   * vote — donc la lecture doit être refaite avec la nouvelle réponse.
   *
   * `voterId` vient de `firebaseUser.uid` : c'est la valeur que les règles
   * comparent à `voterKey`, et la seule qui ne puisse pas être périmée.
   */
  const submitVote = useCallback(
    async (optionIds: readonly string[]): Promise<boolean> => {
      if (!repository || !pollId || !uid || optionIds.length === 0) return false;

      setSubmitting(true);
      setVoteError(null);

      try {
        await repository.vote({ pollId, voterId: uid, input: { optionIds: [...optionIds] } });
        await load();
        return true;
      } catch (error) {
        setVoteError(isAppError(error) ? error : toAppError(error));
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [repository, pollId, uid, load],
  );

  const current = snapshot && snapshot.key === pollId ? snapshot : null;
  const status: AsyncData<Poll | null>['status'] = !enabled
    ? 'idle'
    : current === null
      ? 'loading'
      : current.poll.status;

  const poll = current?.poll.status === 'ready' ? current.poll.data : null;
  const myVote = current?.myVote ?? null;

  return {
    status,
    poll,
    error: current?.poll.status === 'error' ? current.poll.error : null,
    myVote,
    results: current?.results ?? { status: 'idle' },
    refreshing,
    refresh,
    submitting,
    voteError,
    submitVote,
  };
}
