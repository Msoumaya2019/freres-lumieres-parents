/**
 * Liste du fil d'actualité.
 *
 * ## Le bandeau des publications épinglées défile avec le contenu
 *
 * Il vit dans l'en-tête de la liste, pas au-dessus d'elle. Un bandeau fixe
 * occuperait en permanence une part notable d'un téléphone compact, au profit
 * d'informations qui changent rarement. Les épinglés sont visibles à
 * l'ouverture ; ils s'effacent quand le parent commence à lire.
 *
 * ## L'en-tête et l'état vide viennent de l'écran
 *
 * « Aucune publication » ne veut pas dire la même chose selon le filtre : sur
 * « Tout », l'école n'a rien publié ; sur « Cantine », c'est la catégorie qui
 * est vide. La liste ne peut pas le deviner — elle reçoit donc le texte tout
 * fait plutôt que de composer une phrase qui serait fausse une fois sur deux.
 *
 * ## Une erreur de page suivante n'efface pas la page courante
 *
 * Le pied de liste signale l'échec et propose de réessayer. Remplacer tout le
 * fil par un écran d'erreur parce que la onzième publication n'est pas arrivée
 * serait disproportionné : le parent perdrait ce qu'il était en train de lire.
 */
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';

import { appErrorMessage } from '@fl/shared';
import type { AppError, Post } from '@fl/types';

import { AppText, Button } from '@/components/ui';
import { useTheme } from '@/providers/theme-provider';

import { PostCard } from './post-card';

export interface FeedListProps {
  /** Fil chronologique, publications épinglées **exclues**. */
  posts: readonly Post[];
  /** Publications épinglées, affichées en tête de liste. */
  pinned: readonly Post[];
  hasMore: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  /** Échec d'une page suivante : signalé en pied de liste, sans effacer le reste. */
  loadMoreError: AppError | null;
  onRefresh: () => void;
  onLoadMore: () => void;
  onPressPost: (post: Post) => void;
  header: React.ReactNode;
  emptyState: React.ReactNode;
}

export function FeedList({
  posts,
  pinned,
  hasMore,
  loadingMore,
  refreshing,
  loadMoreError,
  onRefresh,
  onLoadMore,
  onPressPost,
  header,
  emptyState,
}: FeedListProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <FlatList
      style={{ flex: 1 }}
      data={posts}
      keyExtractor={(post) => post.id}
      renderItem={({ item }) => <PostCard post={item} onPress={() => onPressPost(item)} />}
      ItemSeparatorComponent={() => <View style={{ height: theme.spacing.md }} />}
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: theme.spacing.xxxl,
      }}
      ListHeaderComponent={
        <>
          {header}
          {pinned.length > 0 ? <PinnedStrip posts={pinned} onPressPost={onPressPost} /> : null}
        </>
      }
      ListEmptyComponent={<>{emptyState}</>}
      ListFooterComponent={
        <FeedFooter
          hasMore={hasMore}
          loadingMore={loadingMore}
          loadMoreError={loadMoreError}
          itemCount={posts.length}
          onRetry={onLoadMore}
        />
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
        />
      }
      // Le rappel est retiré quand il n'y a plus rien à charger : c'est la
      // façon la plus sûre d'empêcher un appel inutile, plutôt que de compter
      // sur le garde interne du hook.
      onEndReached={hasMore ? onLoadMore : undefined}
      onEndReachedThreshold={0.6}
      keyboardShouldPersistTaps="handled"
    />
  );
}

/**
 * Publications épinglées, sous un intitulé explicite.
 *
 * L'intitulé compte : sans lui, une publication ancienne apparaissant en tête
 * d'un fil chronologique passerait pour un défaut de tri. La carte porte déjà
 * l'étiquette « Épinglé », mais l'intitulé l'annonce avant qu'on ait à lire.
 */
function PinnedStrip({
  posts,
  onPressPost,
}: {
  posts: readonly Post[];
  onPressPost: (post: Post) => void;
}): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.md }}>
      <AppText variant="label" color="muted">
        À la une
      </AppText>

      {posts.map((post) => (
        <PostCard key={post.id} post={post} onPress={() => onPressPost(post)} />
      ))}

      <View style={{ height: theme.spacing.sm }} />
    </View>
  );
}

function FeedFooter({
  hasMore,
  loadingMore,
  loadMoreError,
  itemCount,
  onRetry,
}: {
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: AppError | null;
  itemCount: number;
  onRetry: () => void;
}): React.JSX.Element | null {
  const { theme } = useTheme();

  if (loadMoreError) {
    return (
      <View
        style={{
          marginTop: theme.spacing.lg,
          gap: theme.spacing.sm,
          alignItems: 'center',
        }}
        accessibilityRole="alert"
      >
        <AppText variant="caption" color="danger" align="center">
          {appErrorMessage(loadMoreError)}
        </AppText>
        <Button label="Réessayer" variant="secondary" fullWidth={false} onPress={onRetry} />
      </View>
    );
  }

  if (loadingMore) {
    return (
      <View
        style={{ marginTop: theme.spacing.lg, alignItems: 'center' }}
        accessibilityRole="progressbar"
        accessibilityLabel="Chargement des publications suivantes"
      >
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  // Rien à annoncer sur un fil vide : l'état vide s'en charge juste au-dessus.
  if (!hasMore && itemCount > 0) {
    return (
      <AppText
        variant="caption"
        color="muted"
        align="center"
        style={{ marginTop: theme.spacing.lg }}
      >
        Vous avez tout lu.
      </AppText>
    );
  }

  return null;
}
