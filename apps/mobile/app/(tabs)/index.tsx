/**
 * Accueil — fil d'actualité.
 *
 * ## Ce qui défile, et ce qui ne défile pas
 *
 * Le titre et le bandeau de catégories restent fixes ; les publications
 * défilent dessous. Un filtre qu'il faut faire défiler pour atteindre n'est
 * jamais utilisé : un parent qui ne voit pas le filtre conclut que l'application
 * n'en a pas.
 *
 * ## Les épinglés ne sont pas filtrés
 *
 * « À la une » vient d'une requête séparée, sans filtre de catégorie. Une
 * information épinglée par la FCPE — une fermeture d'école, par exemple — doit
 * rester visible même si le parent consulte la rubrique « Cantine ». Le filtre
 * ne s'applique qu'au fil chronologique.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';

import { POST_CATEGORY_LABELS, appErrorMessage } from '@fl/shared';
import type { Post } from '@fl/types';

import { CategoryFilter } from '@/components/feed/category-filter';
import { FeedList } from '@/components/feed/feed-list';
import { AppText, Screen } from '@/components/ui';
import { EmptyState, ErrorState, LoadingView } from '@/components/ui/state-views';
import { useFeed } from '@/hooks/use-feed';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';

export default function HomeScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { profile } = useAuth();
  const router = useRouter();
  const feed = useFeed();

  const handlePressPost = useCallback(
    (post: Post) => {
      router.push(`/post/${post.id}`);
    },
    [router],
  );

  return (
    <Screen>
      <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.xs }}>
        <AppText variant="display">
          {profile?.firstName ? `Bonjour ${profile.firstName}` : 'Bonjour'}
        </AppText>
        <AppText variant="body" color="secondary">
          Voici les informations de l’école Frères Lumières.
        </AppText>
      </View>

      <View style={{ marginTop: theme.spacing.md }}>
        <CategoryFilter value={feed.category} onChange={feed.setCategory} />
      </View>

      {feed.error ? (
        <ErrorState
          message={appErrorMessage(feed.error)}
          technicalDetail={feed.error.message}
          onRetry={feed.retry}
        />
      ) : feed.status === 'ready' ? (
        <FeedList
          posts={feed.posts}
          pinned={feed.pinned}
          hasMore={feed.hasMore}
          loadingMore={feed.loadingMore}
          refreshing={feed.refreshing}
          loadMoreError={feed.loadMoreError}
          onRefresh={feed.refresh}
          onLoadMore={feed.loadMore}
          onPressPost={handlePressPost}
          header={null}
          emptyState={
            <FeedEmptyState category={feed.category} hasPinned={feed.pinned.length > 0} />
          }
        />
      ) : (
        <LoadingView message="Chargement des publications…" />
      )}
    </Screen>
  );
}

/**
 * Message affiché quand le fil est vide.
 *
 * Trois cas distincts, parce qu'ils appellent trois réactions différentes : une
 * catégorie vide se règle en changeant de filtre, un fil vide alors que des
 * publications sont épinglées veut dire qu'on a tout vu, et un fil entièrement
 * vide est simplement une école qui n'a rien publié.
 */
function FeedEmptyState({
  category,
  hasPinned,
}: {
  category: Post['category'] | null;
  hasPinned: boolean;
}): React.JSX.Element {
  const icon = <Ionicons name="newspaper-outline" size={40} color="#9AA3B2" />;

  if (category) {
    return (
      <EmptyState
        icon={icon}
        title={`Aucune publication en ${POST_CATEGORY_LABELS[category].toLowerCase()}`}
        description="Essayez une autre catégorie, ou revenez à « Tout » pour voir l’ensemble du fil."
      />
    );
  }

  if (hasPinned) {
    return (
      <EmptyState
        icon={icon}
        title="C’est tout pour l’instant"
        description="Les prochaines publications apparaîtront ici."
      />
    );
  }

  return (
    <EmptyState
      icon={icon}
      title="Aucune publication pour le moment"
      description="Les informations publiées par l’école et la FCPE apparaîtront ici."
    />
  );
}
