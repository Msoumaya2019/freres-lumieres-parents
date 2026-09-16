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
import { displayName } from '@fl/shared';
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

  const cursor = useRef<QueryDocumentSnapshot | null>(null);
  const generation = useRef(0);

  const enabled = repository !== null && postId.length > 0;

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
  }, [repository, postId]);

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
      } catch (error) {
        if (mine !== generation.current) return;
        setLoadMoreError(isAppError(error) ? error : toAppError(error));
      } finally {
        if (mine === generation.current) setLoadingMoreComments(false);
      }
    })();
  }, [repository, postId, loadingMoreComments]);

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
  };
}
