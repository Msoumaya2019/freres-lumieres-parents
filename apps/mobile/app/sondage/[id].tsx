/**
 * Détail d'un sondage : la question, les réponses, mon vote, et les résultats
 * **quand j'y ai droit**.
 *
 * ## Les résultats ne sont pas demandés « pour voir »
 *
 * C'est `usePoll` qui pose la lecture des résultats, et seulement après avoir
 * interrogé `canReadPollResults`. L'écran, lui, n'a pas à s'en occuper : il
 * affiche ce qu'on lui donne, et l'état `idle` de `results` dit « pas le
 * droit », non « zéro voix ». Voir l'en-tête du crochet.
 *
 * ## La sélection est **dérivée**, jamais recopiée dans un état
 *
 * Le réflexe serait de recopier `myVote.optionIds` dans un état local dès
 * qu'il arrive — donc depuis un effet, ce que la règle
 * `react-hooks/set-state-in-effect` interdit, et à raison : le premier rendu
 * afficherait une sélection vide avant que l'effet ne la remplisse.
 *
 * Ici, la sélection est `brouillon ?? monVote?.optionIds ?? []` : le brouillon
 * n'existe qu'à partir du premier geste. Avant, on lit le vote du serveur ;
 * après, on lit le geste en cours. Il n'y a donc jamais deux vérités à
 * réconcilier, et rien à remettre d'aplomb quand le vote arrive.
 *
 * ## Ce que l'écran dit de l'anonymat
 *
 * `Poll.anonymous` demande d'être présenté pour ce qu'il est : une promesse
 * **d'interface**, pas une promesse cryptographique. L'identifiant du document
 * de vote est l'UID de l'électeur — c'est ce qui rend le double vote impossible
 * — donc quelqu'un qui aurait accès à la base pourrait relier un vote à une
 * personne. La phrase affichée ne promet que ce qui est tenu : les résultats ne
 * sont publiés que sous forme de totaux.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  POLL_RESULTS_VISIBILITY_LABELS,
  POLL_STATUS_BADGES,
  POLL_STATUS_LABELS,
  appErrorMessage,
  formatDateTime,
  pollEffectiveStatus,
} from '@fl/shared';
import type { Poll, PollResultsVisibility } from '@fl/types';

import { PollOptionRow } from '@/components/polls/poll-option-row';
import { PollResultsCard } from '@/components/polls/poll-results-card';
import { AppText, Badge, Button, Card, Divider, Screen } from '@/components/ui';
import { EmptyState, ErrorState, LoadingView } from '@/components/ui/state-views';
import { usePoll, type PollDetailResult } from '@/hooks/use-poll';
import { useTheme } from '@/providers/theme-provider';

export default function PollDetailScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ id?: string }>();
  const pollId = typeof params.id === 'string' ? params.id : '';

  const { theme } = useTheme();
  const detail = usePoll(pollId);
  // `null` tant que le parent n'a rien touché : voir l'en-tête.
  const [brouillon, setBrouillon] = useState<readonly string[] | null>(null);

  if (detail.error) {
    return (
      <Screen edges={[]}>
        <ErrorState
          message={appErrorMessage(detail.error)}
          technicalDetail={detail.error.message}
          onRetry={detail.refresh}
        />
      </Screen>
    );
  }

  if (detail.status === 'loading' || detail.status === 'idle') {
    return (
      <Screen edges={[]}>
        <LoadingView message="Chargement du sondage…" />
      </Screen>
    );
  }

  const poll = detail.poll;

  if (!poll) {
    return (
      <Screen edges={[]}>
        <EmptyState
          icon={<Ionicons name="stats-chart-outline" size={40} color="#9AA3B2" />}
          title="Sondage indisponible"
          description="Ce sondage a été retiré, ou il ne concerne pas vos enfants."
        />
      </Screen>
    );
  }

  const options = [...poll.options].sort((a, b) => a.order - b.order);
  const selection = brouillon ?? detail.myVote?.optionIds ?? [];
  const aVote = detail.myVote !== null;
  // Une seule dérivation, et elle sert **aux deux** endroits qui l'utilisent :
  // le badge et la phrase qui dit si l'on peut encore voter. « Ouvert » n'est
  // pas le statut seul — une échéance dépassée ferme le sondage au même titre
  // qu'un statut `closed`, et c'est la **règle** qui tient l'heure annoncée.
  //
  // Les deux endroits étaient dérivés séparément, et le badge affichait
  // « Ouvert » au-dessus d'un « Ce sondage est clos. » : la règle d'accord
  // entre `isPollOpen` et `pollEffectiveStatus` est vérifiée par un test, sur
  // le produit des statuts et des régimes d'échéance.
  const etat = pollEffectiveStatus({ status: poll.status, endsAt: poll.endsAt });
  const ouvert = etat === 'open';
  const peutVoter = ouvert && (!aVote || poll.allowChangeVote);

  const basculer = (optionId: string): void => {
    if (poll.allowMultiple) {
      setBrouillon(
        selection.includes(optionId)
          ? selection.filter((id) => id !== optionId)
          : [...selection, optionId],
      );
      return;
    }
    // Choix unique : cocher remplace. Décocher la seule réponse possible
    // laisserait un vote vide, que `pollVoteSchema` refuserait.
    setBrouillon([optionId]);
  };

  return (
    <Screen edges={[]} scroll>
      <View style={{ gap: theme.spacing.lg, paddingTop: theme.spacing.lg }}>
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              <Badge label={POLL_STATUS_LABELS[etat]} tone={POLL_STATUS_BADGES[etat]} />
              {poll.anonymous ? <Badge label="Anonyme" /> : null}
              {poll.allowMultiple ? <Badge label="Choix multiple" /> : null}
            </View>

            <AppText variant="title">{poll.question}</AppText>

            {poll.description ? (
              <AppText variant="body" color="secondary">
                {poll.description}
              </AppText>
            ) : null}

            {poll.endsAt ? (
              <AppText variant="caption" color="muted">
                {`Clôture prévue le ${formatDateTime(poll.endsAt)}`}
              </AppText>
            ) : null}
          </View>
        </Card>

        <View style={{ gap: theme.spacing.md }}>
          {options.map((option) => (
            <PollOptionRow
              key={option.id}
              label={option.label}
              multiple={poll.allowMultiple}
              selected={selection.includes(option.id)}
              onPress={peutVoter ? () => basculer(option.id) : undefined}
            />
          ))}
        </View>

        {peutVoter && selection.length > 0 ? (
          <Button
            label={aVote ? 'Modifier mon vote' : 'Voter'}
            loading={detail.submitting}
            onPress={() => {
              void detail.submitVote(selection).then((envoye) => {
                // Le brouillon redevient inutile une fois le vote enregistré :
                // c'est le vote du serveur qui fait foi à partir de là.
                if (envoye) setBrouillon(null);
              });
            }}
          />
        ) : null}

        {detail.voteError ? (
          <AppText variant="body" color="danger" accessibilityRole="alert">
            {appErrorMessage(detail.voteError)}
          </AppText>
        ) : null}

        {aVote && !peutVoter && ouvert ? (
          <AppText variant="body" color="secondary">
            Votre vote est enregistré. Ce sondage n’autorise pas sa modification.
          </AppText>
        ) : null}

        {!ouvert ? (
          <AppText variant="body" color="secondary">
            {etat === 'draft' ? 'Ce sondage n’est pas encore publié.' : 'Ce sondage est clos.'}
          </AppText>
        ) : null}

        {poll.anonymous ? (
          <AppText variant="caption" color="muted">
            Réponse anonyme : les résultats ne sont publiés que sous forme de totaux, sans aucun
            nom.
          </AppText>
        ) : null}

        <Divider />

        <View style={{ gap: theme.spacing.md }}>
          <AppText variant="label" color="muted">
            Résultats
          </AppText>

          <Resultats detail={detail} poll={poll} />
        </View>
      </View>
    </Screen>
  );
}

/**
 * La zone des résultats, selon ce que le crochet a pu obtenir.
 *
 * Quatre situations, et aucune ne se confond avec une autre : je n'y ai pas
 * droit (`idle`), la lecture est en cours (`loading`), elle a réussi (`ready`,
 * y compris sans aucune voix), ou elle a échoué (`error`).
 */
function Resultats({ detail, poll }: { detail: PollDetailResult; poll: Poll }): React.JSX.Element {
  const { theme } = useTheme();
  const { results } = detail;

  if (results.status === 'loading') {
    return (
      <AppText variant="body" color="muted">
        Chargement des résultats…
      </AppText>
    );
  }

  if (results.status === 'error') {
    // Le prédicat avait dit oui et la lecture a échoué : soit le réseau, soit
    // une divergence entre le prédicat et les règles. On le dit sans nommer
    // l'un plutôt que l'autre, et surtout sans laisser croire à zéro voix.
    return (
      <View style={{ gap: theme.spacing.sm }} accessibilityRole="alert">
        <AppText variant="body" color="secondary">
          {appErrorMessage(results.error)}
        </AppText>
        <Button label="Réessayer" variant="secondary" fullWidth={false} onPress={detail.refresh} />
      </View>
    );
  }

  if (results.status === 'idle') {
    return (
      <AppText variant="body" color="secondary">
        {quandLesResultats(poll.resultsVisibility)}
      </AppText>
    );
  }

  return (
    <View style={{ gap: theme.spacing.md }}>
      <PollResultsCard options={poll.options} results={results.data} />
      <AppText variant="caption" color="muted">
        {`Publiés : ${POLL_RESULTS_VISIBILITY_LABELS[poll.resultsVisibility]}`}
      </AppText>
    </View>
  );
}

/**
 * Ce qu'on annonce à qui ne voit pas encore les résultats.
 *
 * Le repli — un champ absent — suit celui des règles : **fermé**, et sur la
 * plus restrictive des trois valeurs. La phrase ne doit donc pas promettre
 * davantage que ce que la base autorise, sans quoi elle serait fausse le jour
 * où un document ancien passe.
 */
function quandLesResultats(visibilite: PollResultsVisibility | undefined): string {
  if (visibilite === 'after_vote') {
    return 'Les résultats s’afficheront dès que vous aurez voté.';
  }
  if (visibilite === 'always') {
    return 'Les résultats seront publiés en même temps que le sondage.';
  }
  return 'Les résultats seront publiés à la clôture du sondage.';
}
