/**
 * Le décompte d'un sondage, en totaux.
 *
 * ## Les lignes viennent du **sondage**, les chiffres des résultats
 *
 * `pollResults.options` porte « toutes les options du sondage, dans son ordre,
 * y compris à zéro voix » — mais ce document peut **ne pas exister** : un
 * sondage que personne n'a voté n'en a pas, et l'absence vaut zéro. Les lignes
 * sont donc construites à partir de `poll.options`, qui est toujours complet et
 * ordonné, et les voix sont lues dans une table par identifiant. Afficher
 * `results.options` directement ferait disparaître toutes les réponses d'un
 * sondage sans voix, ou dépendrait de l'ordre décidé par la Cloud Function.
 *
 * ## Aucun nom, jamais
 *
 * Les règles ne laissent personne écrire ce document — la Cloud Function
 * `onPollVoteWritten` en est le seul écrivain — et il ne contient que des
 * totaux. C'est ce qui rend le décompte infalsifiable, et ce qui permet
 * d'afficher un résultat sans jamais nommer qui que ce soit.
 *
 * ## La barre n'est pas la seule information
 *
 * Elle donne la lecture rapide, mais elle seule serait inaccessible : un
 * pourcentage et un nombre sont écrits à côté, et le rapport est aussi porté
 * par un libellé d'accessibilité. Une barre sans chiffre obligerait à estimer
 * une longueur, ce que tout le monde ne peut pas faire.
 */
import { View } from 'react-native';

import { formatPercent, pluralize } from '@fl/shared';
import type { PollOption, PollResults } from '@fl/types';

import { AppText } from '@/components/ui';
import { useTheme } from '@/providers/theme-provider';

export interface PollResultsCardProps {
  options: readonly PollOption[];
  /** `null` quand le sondage n'a encore reçu aucune voix : l'absence vaut zéro. */
  results: PollResults | null;
}

export function PollResultsCard({ options, results }: PollResultsCardProps): React.JSX.Element {
  const { theme } = useTheme();

  const voixParOption = new Map(
    (results?.options ?? []).map((option) => [option.id, option.votes]),
  );
  const total = results?.totalVoters ?? 0;

  const lignes = [...options].sort((a, b) => a.order - b.order);

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <AppText variant="body" color="secondary">
        {total === 0 ? 'Aucune voix pour le moment.' : pluralize(total, 'participant')}
      </AppText>

      {lignes.map((option) => {
        const nombre = voixParOption.get(option.id) ?? 0;
        const part = total > 0 ? (nombre / total) * 100 : 0;

        return (
          <View
            key={option.id}
            style={{ gap: theme.spacing.xs }}
            accessibilityLabel={`${option.label} : ${enVoix(nombre)}, ${formatPercent(nombre, total)}`}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: theme.spacing.sm,
              }}
            >
              <AppText variant="body" style={{ flex: 1 }}>
                {option.label}
              </AppText>
              <AppText variant="bodyStrong" color="secondary">
                {formatPercent(nombre, total)}
              </AppText>
            </View>

            <View
              style={{
                height: 8,
                borderRadius: theme.radii.pill,
                backgroundColor: theme.colors.surfaceMuted,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${part}%`,
                  height: '100%',
                  borderRadius: theme.radii.pill,
                  backgroundColor: theme.colors.primary,
                }}
              />
            </View>

            <AppText variant="caption" color="muted">
              {enVoix(nombre)}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

/**
 * « 3 voix » — et non « 3 voixs ».
 *
 * `pluralize` ajoute un « s » par défaut, et « voix » est **invariable**. Sans
 * le troisième argument, chaque décompte de plus d'une voix afficherait une
 * faute, sur l'écran même qui compte les réponses.
 */
function enVoix(nombre: number): string {
  return pluralize(nombre, 'voix', 'voix');
}
