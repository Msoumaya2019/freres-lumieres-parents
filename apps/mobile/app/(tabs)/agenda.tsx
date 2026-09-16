/**
 * Agenda.
 *
 * ⚠️ ÉTAT : Phase 1 (fondations).
 *
 * La structure de l'écran et les types d'événements sont en place. La vue
 * calendrier, les rappels et les inscriptions sont développés en Phase 9.
 */
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';

import { EVENT_TYPE_LABELS } from '@fl/shared';
import type { EventType } from '@fl/types';

import { AppText, Card, Screen } from '@/components/ui';
import { useTheme } from '@/providers/theme-provider';

const EVENT_KINDS: EventType[] = [
  'conseil_ecole',
  'reunion',
  'sortie',
  'vacances',
  'kermesse',
  'election',
  'evenement_fcpe',
  'evenement_scolaire',
];

export default function AgendaScreen(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <Screen scroll>
      <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.xs }}>
        <AppText variant="display">Agenda</AppText>
        <AppText variant="body" color="secondary">
          Conseils d’école, réunions, sorties et événements de l’année.
        </AppText>
      </View>

      <Card style={{ marginTop: theme.spacing.lg }}>
        <AppText variant="bodyStrong">Vue calendrier à venir</AppText>
        <AppText variant="body" color="secondary" style={{ marginTop: theme.spacing.xs }}>
          Le calendrier, les rappels et l’ajout au calendrier du téléphone sont développés à la
          Phase 9. Les types d’événements ci-dessous sont déjà définis et partagés avec l’interface
          d’administration.
        </AppText>
      </Card>

      <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.sm }}>
        {EVENT_KINDS.map((kind) => (
          <Card key={kind}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <Ionicons name="calendar-clear-outline" size={20} color={theme.colors.accent} />
              <AppText variant="body">{EVENT_TYPE_LABELS[kind]}</AppText>
            </View>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
