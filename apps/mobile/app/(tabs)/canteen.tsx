import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { PublicAssetButton } from '../../components/public-asset-button';
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
import { loadPublicCanteenMenus } from '../../services/public-content';

function dateLabel(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
  });
}

export default function CanteenPage() {
  const { items, loading, refreshing, error, refresh } = usePublicContent(
    loadPublicCanteenMenus,
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
          <Text style={styles.eyebrow}>CANTINE</Text>
          <Text style={styles.title}>Menus</Text>
          <Text style={styles.subtitle}>
            Menus actuels, semaines à venir et informations exceptionnelles.
          </Text>
        </View>
        {loading ? <LoadingState label="Chargement des menus…" /> : null}
        {!loading && error ? <ErrorState message={error} /> : null}
        {!loading && !error && items.length === 0 ? (
          <EmptyState
            title="Aucun menu publié"
            message="Les menus seront affichés ici dès leur publication."
          />
        ) : null}
        {items.map((menu, index) => (
          <Card key={menu.id} tone={index === 0 ? 'warning' : 'default'}>
            <Badge tone="accent">
              {index === 0 ? 'MENU LE PLUS RÉCENT' : 'MENU'}
            </Badge>
            <Text style={styles.heading}>{menu.title}</Text>
            <Text style={styles.period}>
              Du {dateLabel(menu.startsOn)} au {dateLabel(menu.endsOn)}
            </Text>
            {menu.description ? (
              <Text style={styles.body}>{menu.description}</Text>
            ) : null}
            <PublicAssetButton path={menu.imagePath} label="Voir le menu" />
            <PublicAssetButton path={menu.pdfPath} label="Ouvrir le PDF" />
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
  period: { ...typography.small, color: colors.primary, fontWeight: '700' },
  body: { ...typography.body, color: colors.text },
});
