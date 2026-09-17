import type { Document } from '@flp/types';
import { useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { PublicAssetButton } from '../components/public-asset-button';
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
import { audienceLabel, loadPublicDocuments } from '../services/public-content';

const categoryLabels: Record<Document['category'], string> = {
  flyer: 'Flyer',
  canteen: 'Cantine',
  minutes: 'Compte rendu',
  city: 'Mairie',
  fcpe: 'FCPE',
  other: 'Autre',
};

export default function DocumentsPage() {
  const [category, setCategory] = useState<Document['category'] | undefined>();
  const { items, loading, refreshing, error, refresh } =
    usePublicContent(loadPublicDocuments);
  const documents = useMemo(
    () =>
      category ? items.filter((item) => item.category === category) : items,
    [category, items],
  );
  const filters: Array<{ label: string; value?: Document['category'] }> = [
    { label: 'Tous' },
    { label: 'Flyers', value: 'flyer' },
    { label: 'Cantine', value: 'canteen' },
    { label: 'Comptes rendus', value: 'minutes' },
    { label: 'Mairie', value: 'city' },
  ];
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
      >
        <View>
          <Text style={styles.eyebrow}>BIBLIOTHÈQUE PUBLIQUE</Text>
          <Text style={styles.title}>Documents</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {filters.map((filter) => {
            const active = filter.value === category;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                key={filter.label}
                onPress={() => setCategory(filter.value)}
              >
                <Text style={[styles.filter, active && styles.filterActive]}>
                  {filter.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {loading ? <LoadingState label="Chargement des documents…" /> : null}
        {!loading && error ? <ErrorState message={error} /> : null}
        {!loading && !error && documents.length === 0 ? (
          <EmptyState
            title="Aucun document"
            message="Les documents publiés apparaîtront ici."
          />
        ) : null}
        {documents.map((document) => (
          <Card key={document.id}>
            <Badge
              tone={document.category === 'canteen' ? 'accent' : 'default'}
            >
              {categoryLabels[document.category].toUpperCase()}
            </Badge>
            <Text style={styles.heading}>{document.title}</Text>
            <Text style={styles.meta}>
              {document.year} · {audienceLabel(document.audience)}
            </Text>
            <PublicAssetButton
              path={document.storagePath}
              label="Ouvrir le document"
            />
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  eyebrow: { color: colors.primary, fontWeight: '900' },
  title: { ...typography.title, color: colors.primaryDark },
  filters: { gap: spacing.sm },
  filter: {
    color: colors.text,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    overflow: 'hidden',
  },
  filterActive: {
    color: colors.white,
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  heading: { ...typography.heading, color: colors.text },
  meta: { ...typography.small, color: colors.muted },
});
