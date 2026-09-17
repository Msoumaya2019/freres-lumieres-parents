import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
} from '../../components/ui';
import { colors, spacing, typography } from '../../constants/theme';
import { usePublicContent } from '../../hooks/use-public-content';
import {
  audienceLabel,
  dateFrom,
  loadPublicEvents,
} from '../../services/public-content';

const typeLabels = {
  meeting: 'Réunion',
  school_council: 'Conseil d’école',
  trip: 'Sortie',
  fair: 'Kermesse',
  holiday: 'Vacances',
  election: 'Élections',
  school_event: 'Événement scolaire',
  other: 'Événement',
} as const;

export default function AgendaPage() {
  const { items, loading, refreshing, error, refresh } =
    usePublicContent(loadPublicEvents);
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
      >
        <View>
          <Text style={styles.eyebrow}>DATES IMPORTANTES</Text>
          <Text style={styles.title}>Agenda</Text>
        </View>
        {loading ? <LoadingState label="Chargement de l’agenda…" /> : null}
        {!loading && error ? <ErrorState message={error} /> : null}
        {!loading && !error && items.length === 0 ? (
          <EmptyState
            title="Agenda vide"
            message="Les prochains événements apparaîtront ici."
          />
        ) : null}
        {items.map((event) => {
          const start = dateFrom(event.startsAt);
          return (
            <Card
              key={event.id}
              tone={event.type === 'fair' ? 'warning' : 'default'}
            >
              <Badge
                tone={event.type === 'school_council' ? 'accent' : 'default'}
              >
                {start
                  .toLocaleDateString('fr-FR', {
                    day: 'numeric',
                    month: 'short',
                  })
                  .toUpperCase()}
              </Badge>
              <Text style={styles.event}>{event.title}</Text>
              <Text style={styles.body}>{event.description}</Text>
              <Text style={styles.meta}>
                {start.toLocaleTimeString('fr-FR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {event.location ? ` · ${event.location}` : ''}
              </Text>
              <Text style={styles.meta}>
                {typeLabels[event.type]} · {audienceLabel(event.audience)}
              </Text>
            </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  eyebrow: { color: colors.primary, fontWeight: '900' },
  title: { ...typography.title, color: colors.primaryDark },
  event: { ...typography.heading, color: colors.text },
  body: { ...typography.body, color: colors.text },
  meta: { ...typography.small, color: colors.muted },
});
