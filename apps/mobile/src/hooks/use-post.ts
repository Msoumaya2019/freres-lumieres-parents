/**
 * Détail d'une publication : la publication elle-même et ses commentaires.
 *
 * ## Les deux chargements sont isolés
 *
 * La publication est chargée d'abord, ses commentaires ensuite. Un échec sur
 * les commentaires ne doit pas effacer la publication : le parent venu lire une
 * information sur une fermeture d'école ne peut pas perdre cette information
 * parce que la conversation n'a pas répondu. Les deux erreurs sont donc
 * distinctes, et affichées à deux endroits différents.
 *
 * ## `commentsLoaded` n'est pas `comments.length > 0`
 *
 * « Pas encore chargé » et « chargé, et il n'y a rien » se ressemblent
 * dangereusement : confondus, l'écran affiche « Aucun commentaire » pendant le
 * chargement, puis se contredit. Un drapeau explicite lève l'ambiguïté, comme
 * `profileResolved` le fait pour le profil.
 *
 * ## Le numéro de génération
 *
 * Un rafraîchissement pendant un chargement de page peut faire arriver les
 * réponses dans le désordre. Chaque chargement note son numéro et ignore sa
 * propre réponse si un chargement plus récent est parti entre-temps.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { QueryDocumentSnapshot } from 'firebase/firestore';

import {
  appendPage,
  createPostRepository,
  isAppError,
  toAppError,
  type PostRepository,
} from '@fl/firebase';
import { displayName, isReactionEmoji, reactionCountsAfter, type ReactionEmoji } from '@fl/shared';
import type { AppError, Comment, Post } from '@fl/types';

import { initializeFirebase } from '@/lib/firebase';
import { useAuth } from '@/providers/auth-provider';

import type { AsyncData } from './use-reference-data';

interface Snapshot {
  readonly key: string;
  readonly post: AsyncData<Post | null>;
  readonly comments: readonly Comment[];
  /** Les commentaires ont-ils été chargés ? Distinct de « la liste est vide ». */
  readonly commentsLoaded: boolean;
  readonly commentsError: AppError | null;
  readonly hasMoreComments: boolean;
}

export interface PostDetailResult {
  readonly status: AsyncData<Post | null>['status'];
  /** `null` tant que le chargement n'a pas abouti, ou si la publication est inaccessible. */
  readonly post: Post | null;
  readonly error: AppError | null;
  readonly comments: readonly Comment[];
  readonly commentsStatus: 'loading' | 'ready' | 'error';
  readonly commentsError: AppError | null;
  readonly hasMoreComments: boolean;
  readonly loadingMoreComments: boolean;
  /** Échec d'une page de commentaires suivante, sans effacer celles déjà lues. */
  readonly loadMoreError: AppError | null;
  readonly refreshing: boolean;
  refresh: () => void;
  loadMoreComments: () => void;
  /** Écrit un commentaire, ou une réponse si `parentId` est fourni. */
  submitComment: (body: string, parentId?: string) => Promise<boolean>;
  readonly submitting: boolean;
  readonly submitError: AppError | null;
  /** Réaction que **j'ai** posée sur chaque commentaire, par identifiant. */
  readonly myReactions: ReadonlyMap<string, ReactionEmoji>;
  /** Pose, remplace ou retire ma réaction sur un commentaire. */
  toggleReaction: (commentId: string, emoji: ReactionEmoji) => void;
  readonly reactionError: AppError | null;
}

export function usePost(postId: string): PostDetailResult {
  const { profile, firebaseUser } = useAuth();
  const [firebase] = useState(() => initializeFirebase());
  const repository = useMemo<PostRepository | null>(
    () => (firebase ? createPostRepository(firebase.db) : null),
    [firebase],
  );

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadingMoreComments, setLoadingMoreComments] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<AppError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<AppError | null>(null);
  const [myReactions, setMyReactions] = useState<ReadonlyMap<string, ReactionEmoji>>(
    () => new Map(),
  );
  const [reactionError, setReactionError] = useState<AppError | null>(null);

  const cursor = useRef<QueryDocumentSnapshot | null>(null);
  const generation = useRef(0);

  const enabled = repository !== null && postId.length > 0;

  /**
   * Charge ma réaction sur les commentaires affichés.
   *
   * Une lecture par commentaire, et non une requête de groupe : le décompte
   * affiché vient du commentaire lui-même (`reactions`), il ne reste donc qu'à
   * savoir ce que **moi** j'ai choisi. Une requête de groupe demanderait un
   * index supplémentaire et une règle `match /{path=**}/…` pour un gain
   * marginal sur vingt commentaires.
   *
   * L'émoticône relue est validée contre `REACTION_EMOJIS` : la règle
   * d'écriture la borne déjà, mais une donnée antérieure ou importée ne
   * repasserait pas par elle, et afficher une chaîne arbitraire comme une
   * réaction serait une erreur silencieuse.
   *
   * Un échec est ignoré volontairement : ne pas savoir ce que j'ai réagi ne
   * doit pas empêcher de lire la conversation. Les décomptes restent affichés,
   * seule la mise en évidence manque.
   */
  const loadMyReactions = useCallback(
    async (commentIds: readonly string[]): Promise<void> => {
      const uid = firebaseUser?.uid ?? null;
      if (!repository || !postId || !uid || commentIds.length === 0) return;

      try {
        const mine = await repository.fetchMyReactions(postId, commentIds, uid);
        setMyReactions((current) => {
          const updated = new Map(current);
          for (const [commentId, emoji] of mine) {
            if (isReactionEmoji(emoji)) updated.set(commentId, emoji);
          }
          return updated;
        });
      } catch {
        // Voir l'en-tête : sans conséquence sur la lecture.
      }
    },
    [repository, postId, firebaseUser],
  );

  const load = useCallback(async (): Promise<void> => {
    if (!repository || !postId) return;

    const mine = (generation.current += 1);
    cursor.current = null;
    setLoadMoreError(null);

    let post: Post | null;
    try {
      post = await repository.get(postId);
    } catch (error) {
      if (mine !== generation.current) return;
      setSnapshot({
        key: postId,
        post: { status: 'error', error: isAppError(error) ? error : toAppError(error) },
        comments: [],
        commentsLoaded: false,
        commentsError: null,
        hasMoreComments: false,
      });
      return;
    }

    if (mine !== generation.current) return;

    // Une publication dont les commentaires sont fermés n'a pas de
    // conversation à charger : la requête serait payée pour rien, et la page
    // de commentaires ne serait pas affichée de toute façon.
    const commentsDisabled = post !== null && post.commentsEnabled === false;

    setSnapshot({
      key: postId,
      post: { status: 'ready', data: post },
      comments: [],
      commentsLoaded: commentsDisabled,
      commentsError: null,
      hasMoreComments: false,
    });

    if (commentsDisabled) return;

    try {
      const page = await repository.fetchComments(postId);
      if (mine !== generation.current) return;
      cursor.current = page.nextCursor;
      setSnapshot((current) =>
        current && current.key === postId
          ? {
              ...current,
              comments: page.items,
              commentsLoaded: true,
              hasMoreComments: page.hasMore,
            }
          : current,
      );
      void loadMyReactions(page.items.map((comment) => comment.id));
    } catch (error) {
      if (mine !== generation.current) return;
      setSnapshot((current) =>
        current && current.key === postId
          ? {
              ...current,
              commentsLoaded: true,
              commentsError: isAppError(error) ? error : toAppError(error),
            }
          : current,
      );
    }
  }, [repository, postId, loadMyReactions]);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  const loadMoreComments = useCallback(() => {
    const cursorSnapshot = cursor.current;
    if (!repository || !postId || !cursorSnapshot || loadingMoreComments) return;

    const mine = generation.current;
    setLoadingMoreComments(true);

    void (async () => {
      try {
        const page = await repository.fetchComments(postId, cursorSnapshot);
        if (mine !== generation.current) return;

        cursor.current = page.nextCursor;
        setLoadMoreError(null);
        setSnapshot((current) =>
          current && current.key === postId
            ? {
                ...current,
                comments: appendPage(current.comments, page),
                hasMoreComments: page.hasMore,
              }
            : current,
        );
        void loadMyReactions(page.items.map((comment) => comment.id));
      } catch (error) {
        if (mine !== generation.current) return;
        setLoadMoreError(isAppError(error) ? error : toAppError(error));
      } finally {
        if (mine === generation.current) setLoadingMoreComments(false);
      }
    })();
  }, [repository, postId, loadingMoreComments, loadMyReactions]);

  /**
   * Écrit un commentaire, puis recharge la publication et sa première page de
   * commentaires.
   *
   * ## Pourquoi un rechargement, et non une insertion locale
   *
   * Insérer le commentaire dans l'état local afficherait un compteur faux : le
   * décompte en tête d'écran vient de `stats.commentCount`, écrit par une Cloud
   * Function **après** la création. Le compteur ne peut donc pas être incrémenté
   * par le client sans mentir. Recharger coûte une vingtaine de lectures, ce qui
   * est négligeable pour une action volontaire et rare — et c'est la seule façon
   * d'afficher le décompte réel.
   *
   * Le rechargement ramène aussi la première page : le commentaire qu'on vient
   * d'écrire étant le plus récent, il apparaît en tête. Perdre les pages
   * suivantes est sans conséquence, l'auteur venant nécessairement de remonter
   * en haut de la conversation pour saisir son texte.
   *
   * `authorId` vient de `firebaseUser.uid` et non de `profile.id` : c'est la
   * valeur que les règles comparent, et la seule qui ne puisse pas être périmée.
   */
  const submitComment = useCallback(
    async (body: string, parentId?: string): Promise<boolean> => {
      const trimmed = body.trim();
      const uid = firebaseUser?.uid ?? null;

      if (!repository || !postId || !uid || !profile || trimmed.length === 0) return false;

      setSubmitting(true);
      setSubmitError(null);

      try {
        await repository.addComment({
          postId,
          authorId: uid,
          authorName: displayName(profile.firstName, profile.lastName),
          authorRole: profile.role,
          body: trimmed,
          ...(parentId ? { parentId } : {}),
        });

        await load();
        return true;
      } catch (error) {
        setSubmitError(isAppError(error) ? error : toAppError(error));
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [repository, postId, firebaseUser, profile, load],
  );

  /**
   * Pose, remplace ou retire ma réaction sur un commentaire.
   *
   * ## Mise à jour optimiste, puis retour en arrière si le serveur refuse
   *
   * Le décompte affiché est tenu par une Cloud Function qui s'exécute **après**
   * l'écriture : sans mise à jour locale, le bouton semblerait ne rien faire
   * pendant une seconde. Le décompte est donc estimé par
   * `reactionCountsAfter`, puis remplacé par la valeur réelle au prochain
   * chargement.
   *
   * L'échec est traité symétriquement : laisser la réaction affichée alors que
   * le serveur l'a refusée ferait croire à une réussite, et le parent ne
   * comprendrait pas pourquoi elle disparaît au rechargement suivant.
   *
   * Retoucher la même émoticône la retire — c'est le geste attendu, et cela
   * évite d'ajouter un bouton « retirer ».
   */
  /**
   * Écrit une réaction dans l'état local, en avançant ou en revenant en arrière.
   *
   * Les deux sens passent par la même fonction : l'annulation est le même
   * calcul avec `from` et `to` échangés. Deux chemins distincts finiraient par
   * diverger, et c'est l'annulation — le chemin rare, donc le moins testé — qui
   * resterait fausse.
   */
  const applyReaction = useCallback(
    (commentId: string, from: ReactionEmoji | undefined, to: ReactionEmoji | undefined): void => {
      setMyReactions((current) => {
        const updated = new Map(current);
        if (to) updated.set(commentId, to);
        else updated.delete(commentId);
        return updated;
      });

      setSnapshot((current) =>
        current && current.key === postId
          ? {
              ...current,
              comments: current.comments.map((comment) =>
                comment.id === commentId
                  ? { ...comment, reactions: reactionCountsAfter(comment.reactions, from, to) }
                  : comment,
              ),
            }
          : current,
      );
    },
    [postId],
  );

  const toggleReaction = useCallback(
    (commentId: string, emoji: ReactionEmoji): void => {
      const uid = firebaseUser?.uid ?? null;
      if (!repository || !postId || !uid) return;

      const previous = myReactions.get(commentId);
      const next = previous === emoji ? undefined : emoji;

      setReactionError(null);
      applyReaction(commentId, previous, next);

      void repository
        .setReaction({ postId, commentId, uid, emoji, active: next !== undefined })
        .catch((error: unknown) => {
          applyReaction(commentId, next, previous);
          setReactionError(isAppError(error) ? error : toAppError(error));
        });
    },
    [repository, postId, firebaseUser, myReactions, applyReaction],
  );

  const current = snapshot && snapshot.key === postId ? snapshot : null;
  const status: AsyncData<Post | null>['status'] = !enabled
    ? 'idle'
    : current === null
      ? 'loading'
      : current.post.status;

  const commentsStatus: 'loading' | 'ready' | 'error' =
    !current || !current.commentsLoaded ? 'loading' : current.commentsError ? 'error' : 'ready';

  return {
    status,
    post: current?.post.status === 'ready' ? current.post.data : null,
    error: current?.post.status === 'error' ? current.post.error : null,
    comments: current?.comments ?? [],
    commentsStatus,
    commentsError: current?.commentsError ?? null,
    hasMoreComments: current?.hasMoreComments ?? false,
    loadingMoreComments,
    loadMoreError,
    refreshing,
    refresh,
    loadMoreComments,
    submitComment,
    submitting,
    submitError,
    myReactions,
    toggleReaction,
    reactionError,
  };
}
