import type { Post, PostCategory } from '@flp/types';
import { useMemo, useState } from 'react';
import {
  Pressable,
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
import {
  audienceLabel,
  dateFrom,
  loadPublicPosts,
} from '../../services/public-content';

const categories: Array<{ label: string; value?: PostCategory }> = [
  { label: 'Tout' },
  { label: 'Urgent', value: 'urgent' },
  { label: 'École', value: 'information' },
  { label: 'Cantine', value: 'canteen' },
  { label: 'FCPE', value: 'fcpe' },
  { label: 'Événements', value: 'event' },
];
const categoryLabels: Record<PostCategory, string> = {
  information: 'Information',
  urgent: 'Urgent',
  canteen: 'Cantine',
  after_school: 'Périscolaire',
  works: 'Travaux',
  school_trip: 'Sortie scolaire',
  fcpe: 'FCPE',
  city: 'Mairie',
  event: 'Événement',
  school_council: 'Conseil d’école',
  other: 'Autre',
};
function badgeTone(post: Post) {
  if (post.importance === 'urgent' || post.category === 'urgent')
    return 'urgent' as const;
  if (post.category === 'event') return 'accent' as const;
  return 'default' as const;
}

export default function HomePage() {
  const [filter, setFilter] = useState<PostCategory | undefined>();
  const { items, loading, refreshing, error, refresh } =
    usePublicContent(loadPublicPosts);
  const posts = useMemo(
    () => (filter ? items.filter((post) => post.category === filter) : items),
    [filter, items],
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
          <Text style={styles.greeting}>Bonjour 👋</Text>
          <Text style={styles.title}>Actualités</Text>
          <Text style={styles.subtitle}>
            Toute la vie de l’école, en un coup d’œil.
          </Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {categories.map((category) => {
            const active = category.value === filter;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                key={category.label}
                onPress={() => setFilter(category.value)}
              >
                <Text style={[styles.filter, active && styles.filterActive]}>
                  {category.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {loading ? <LoadingState label="Chargement des actualités…" /> : null}
        {!loading && error ? <ErrorState message={error} /> : null}
        {!loading && !error && posts.length === 0 ? (
          <EmptyState
            title="Aucune actualité"
            message="Les nouvelles publications apparaîtront ici."
          />
        ) : null}
        <View style={styles.list}>
          {posts.map((post) => (
            <Card
              key={post.id}
              tone={
                post.importance === 'urgent'
                  ? 'danger'
                  : post.category === 'event'
                    ? 'warning'
                    : 'default'
              }
            >
              <View style={styles.cardHeader}>
                <Badge tone={badgeTone(post)}>
                  {categoryLabels[post.category].toUpperCase()}
                </Badge>
                {post.pinned ? (
                  <Text style={styles.pinned}>ÉPINGLÉE</Text>
                ) : null}
              </View>
              <Text style={styles.postTitle}>{post.title}</Text>
              <Text style={styles.body}>{post.body}</Text>
              <Text style={styles.meta}>
                {audienceLabel(post.audience)} ·{' '}
                {post.publishedAt
                  ? dateFrom(post.publishedAt).toLocaleDateString('fr-FR', {
                      day: 'numeric',
                      month: 'long',
                    })
                  : 'Publication récente'}
              </Text>
              <PublicAssetButton path={post.flyerPath} label="Voir le flyer" />
              <PublicAssetButton path={post.pdfPath} label="Ouvrir le PDF" />
              <PublicAssetButton
                path={post.imagePaths[0]}
                label="Voir l’image"
              />
            </Card>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  greeting: { ...typography.body, color: colors.muted },
  title: { ...typography.display, color: colors.primaryDark },
  subtitle: { ...typography.body, color: colors.muted, marginTop: spacing.xs },
  filters: { gap: 9 },
  filter: {
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    overflow: 'hidden',
  },
  filterActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    color: colors.white,
  },
  list: { gap: 14 },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pinned: { ...typography.small, color: colors.primary, fontWeight: '800' },
  postTitle: { ...typography.heading, color: colors.text },
  body: { ...typography.body, color: colors.text },
  meta: { ...typography.small, color: colors.muted },
});
