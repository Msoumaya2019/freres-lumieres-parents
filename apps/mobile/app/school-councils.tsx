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
} from '../components/ui';
import { colors, spacing, typography } from '../constants/theme';
import { usePublicContent } from '../hooks/use-public-content';
import { dateFrom, loadPublicSchoolCouncils } from '../services/public-content';

export default function CouncilsPage() {
  const { items, loading, refreshing, error, refresh } = usePublicContent(
    loadPublicSchoolCouncils,
  );
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
      >
        <View>
          <Text style={styles.eyebrow}>VIE DE L’ÉCOLE</Text>
          <Text style={styles.title}>Conseils d’école</Text>
          <Text style={styles.subtitle}>
            Dates, ordres du jour et décisions publiques.
          </Text>
        </View>
        {loading ? <LoadingState label="Chargement des conseils…" /> : null}
        {!loading && error ? <ErrorState message={error} /> : null}
        {!loading && !error && items.length === 0 ? (
          <EmptyState
            title="Aucun conseil publié"
            message="Les informations publiques apparaîtront ici."
          />
        ) : null}
        {items.map((council) => (
          <Card key={council.id} tone="success">
            <Badge tone="accent">
              {dateFrom(council.scheduledAt)
                .toLocaleDateString('fr-FR', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })
                .toUpperCase()}
            </Badge>
            <Text style={styles.heading}>{council.title}</Text>
            {council.publicAgenda.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Ordre du jour</Text>
                {council.publicAgenda.map((item) => (
                  <Text key={item} style={styles.body}>
                    • {item}
                  </Text>
                ))}
              </View>
            ) : null}
            {council.publicDecisions.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Décisions</Text>
                {council.publicDecisions.map((item) => (
                  <Text key={item} style={styles.body}>
                    • {item}
                  </Text>
                ))}
              </View>
            ) : null}
            {council.publicDocumentIds.length > 0 ? (
              <Text style={styles.meta}>
                {council.publicDocumentIds.length} document(s) disponible(s)
                dans la bibliothèque.
              </Text>
            ) : null}
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  eyebrow: { color: colors.primary, fontWeight: '900' },
  title: { ...typography.title, color: colors.primaryDark },
  subtitle: { ...typography.body, color: colors.muted },
  heading: { ...typography.heading, color: colors.text },
  section: { gap: spacing.xs },
  sectionTitle: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '800',
  },
  body: { ...typography.body, color: colors.text },
  meta: { ...typography.small, color: colors.muted },
});
