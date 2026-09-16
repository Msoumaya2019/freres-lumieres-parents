/**
 * Détail d'une publication : son contenu, ses pièces jointes, ses commentaires.
 *
 * ## Les commentaires sont dans la liste, pas dans une zone défilante imbriquée
 *
 * La publication occupe l'en-tête de la `FlatList` et les commentaires en sont
 * les éléments. Empiler une `ScrollView` de commentaires dans celle de la
 * publication ferait entrer deux gestes de défilement en concurrence et
 * chargerait tous les commentaires d'un coup. Ici une seule liste défile, et la
 * pagination des commentaires s'y branche sans cas particulier.
 *
 * ## Les réponses sont signalées, pas rattachées à leur parent
 *
 * Le modèle prévoit un niveau de réponse (`parentId`). La page de commentaires
 * arrive dans l'ordre chronologique, où une réponse et son parent peuvent être
 * séparés par vingt messages. Les regrouper demanderait de charger le parent, et
 * l'afficher sans lui serait pire que de ne rien afficher. Les réponses sont
 * donc indentées — assez pour qu'on voie que c'en est une — et la constitution
 * de fils viendra avec le chargement des réponses.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  View,
} from 'react-native';

import { appErrorMessage, pluralize } from '@fl/shared';
import type { AppError, Comment } from '@fl/types';

import { CommentCard } from '@/components/post/comment-card';
import { CommentComposer } from '@/components/post/comment-composer';
import { PostDetailCard } from '@/components/post/post-detail-card';
import { AppText, Button, Screen } from '@/components/ui';
import { EmptyState, ErrorState, LoadingView } from '@/components/ui/state-views';
import { usePost } from '@/hooks/use-post';
import { useTheme } from '@/providers/theme-provider';

/** Commentaire auquel la prochaine saisie répondra. */
interface ReplyTarget {
  readonly id: string;
  readonly authorName: string;
}

export default function PostDetailScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ id?: string }>();
  const postId = typeof params.id === 'string' ? params.id : '';

  const { theme } = useTheme();
  const detail = usePost(postId);
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);

  const handleReply = useCallback((comment: Comment) => {
    setReplyTo({ id: comment.id, authorName: comment.authorName });
  }, []);

  const cancelReply = useCallback(() => setReplyTo(null), []);

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
        <LoadingView message="Chargement de la publication…" />
      </Screen>
    );
  }

  const post = detail.post;

  if (!post) {
    return (
      <Screen edges={[]}>
        <EmptyState
          icon={<Ionicons name="document-outline" size={40} color="#9AA3B2" />}
          title="Publication indisponible"
          description="Cette publication a été retirée, ou elle ne concerne pas vos enfants."
        />
      </Screen>
    );
  }

  const commentsOpen = post.commentsEnabled;

  return (
    <Screen edges={[]} padded={false}>
      <KeyboardAvoidingView
        // Sans cela, le clavier recouvre la zone de saisie sur iOS : le parent
        // écrirait sans voir ce qu'il écrit. Sur Android, le système remonte
        // déjà la vue (`adjustResize`), et ajouter `padding` la remonterait
        // deux fois.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <FlatList
          data={commentsOpen ? detail.comments : []}
          keyExtractor={(comment) => comment.id}
          renderItem={({ item }) => (
            <CommentCard
              comment={item}
              depth={item.parentId ? 1 : 0}
              onReply={item.parentId ? undefined : handleReply}
              myReaction={detail.myReactions.get(item.id)}
              onReact={(emoji) => detail.toggleReaction(item.id, emoji)}
            />
          )}
          ItemSeparatorComponent={() => <View style={{ height: theme.spacing.lg }} />}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.xxxl,
          }}
          ListHeaderComponent={
            <>
              <View style={{ paddingTop: theme.spacing.lg }}>
                <PostDetailCard post={post} />
              </View>

              <AppText variant="label" color="muted" style={{ marginBottom: theme.spacing.md }}>
                {post.stats.commentCount > 0
                  ? pluralize(post.stats.commentCount, 'commentaire')
                  : 'Commentaires'}
              </AppText>

              {detail.reactionError ? (
                <AppText
                  variant="caption"
                  color="danger"
                  style={{ marginBottom: theme.spacing.md }}
                  accessibilityRole="alert"
                >
                  {appErrorMessage(detail.reactionError)}
                </AppText>
              ) : null}
            </>
          }
          ListEmptyComponent={
            commentsOpen ? (
              <CommentsPlaceholder
                status={detail.commentsStatus}
                error={detail.commentsError}
                onRetry={detail.refresh}
              />
            ) : (
              <AppText variant="body" color="muted">
                Les commentaires sont fermés pour cette publication.
              </AppText>
            )
          }
          ListFooterComponent={
            <CommentsFooter
              visible={commentsOpen && detail.comments.length > 0}
              hasMore={detail.hasMoreComments}
              loading={detail.loadingMoreComments}
              error={detail.loadMoreError}
              onLoadMore={detail.loadMoreComments}
            />
          }
          refreshControl={
            <RefreshControl
              refreshing={detail.refreshing}
              onRefresh={detail.refresh}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }
          onEndReached={
            commentsOpen && detail.hasMoreComments ? detail.loadMoreComments : undefined
          }
          onEndReachedThreshold={0.6}
        />

        {commentsOpen ? (
          <View style={{ paddingHorizontal: theme.spacing.lg }}>
            <CommentComposer
              replyTo={replyTo}
              onCancelReply={cancelReply}
              onSubmit={(body) => detail.submitComment(body, replyTo?.id)}
              submitting={detail.submitting}
              error={detail.submitError}
            />
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

/**
 * Ce qui s'affiche à la place des commentaires.
 *
 * « Pas encore chargé », « le chargement a échoué » et « il n'y en a aucun »
 * sont trois situations différentes. Les confondre ferait apparaître « Aucun
 * commentaire » pendant le chargement, puis se contredire une seconde plus tard.
 */
function CommentsPlaceholder({
  status,
  error,
  onRetry,
}: {
  status: 'loading' | 'ready' | 'error';
  error: AppError | null;
  onRetry: () => void;
}): React.JSX.Element {
  const { theme } = useTheme();

  if (status === 'loading') {
    return (
      <View
        style={{ paddingVertical: theme.spacing.lg, alignItems: 'center' }}
        accessibilityRole="progressbar"
        accessibilityLabel="Chargement des commentaires"
      >
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={{ gap: theme.spacing.sm, alignItems: 'flex-start' }} accessibilityRole="alert">
        <AppText variant="body" color="danger">
          {error ? appErrorMessage(error) : 'Les commentaires n’ont pas pu être chargés.'}
        </AppText>
        <Button label="Réessayer" variant="secondary" fullWidth={false} onPress={onRetry} />
      </View>
    );
  }

  return (
    <AppText variant="body" color="muted">
      Aucun commentaire pour le moment.
    </AppText>
  );
}

/** Pied de liste des commentaires : suite de la conversation, ou fin atteinte. */
function CommentsFooter({
  visible,
  hasMore,
  loading,
  error,
  onLoadMore,
}: {
  visible: boolean;
  hasMore: boolean;
  loading: boolean;
  error: AppError | null;
  onLoadMore: () => void;
}): React.JSX.Element | null {
  const { theme } = useTheme();

  if (!visible) return null;

  if (error) {
    return (
      <View
        style={{ marginTop: theme.spacing.lg, gap: theme.spacing.sm }}
        accessibilityRole="alert"
      >
        <AppText variant="caption" color="danger">
          {appErrorMessage(error)}
        </AppText>
        <Button label="Réessayer" variant="secondary" fullWidth={false} onPress={onLoadMore} />
      </View>
    );
  }

  if (loading) {
    return (
      <View
        style={{ marginTop: theme.spacing.lg, alignItems: 'center' }}
        accessibilityRole="progressbar"
        accessibilityLabel="Chargement des commentaires suivants"
      >
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (!hasMore) {
    return (
      <AppText
        variant="caption"
        color="muted"
        align="center"
        style={{ marginTop: theme.spacing.lg }}
      >
        Fin des commentaires.
      </AppText>
    );
  }

  return (
    <View style={{ marginTop: theme.spacing.lg, alignItems: 'center' }}>
      <Button
        label="Afficher plus de commentaires"
        variant="secondary"
        fullWidth={false}
        onPress={onLoadMore}
      />
    </View>
  );
}
