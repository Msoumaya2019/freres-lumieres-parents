/**
 * Fil d'actualité : première page, pagination, rafraîchissement, filtre.
 *
 * ## Le chargement est dérivé, jamais poussé
 *
 * Aucun `setLoading(true)` : ce serait un `setState` synchrone dans un effet,
 * interdit par `react-hooks/set-state-in-effect`, et faux pendant le rendu
 * initial. Le résultat mémorisé porte à la place l'**empreinte de la demande**
 * à laquelle il répond (`key`). Tant qu'elle diffère de la demande courante, le
 * résultat n'est pas encore arrivé — donc l'écran est en chargement. Changer de
 * filtre ne demande donc aucun nettoyage d'état : l'empreinte ne correspond
 * simplement plus.
 *
 * ## Pourquoi un numéro de génération
 *
 * Un utilisateur qui change deux fois de catégorie en une seconde lance trois
 * requêtes. Rien ne garantit que les réponses arrivent dans l'ordre : sans
 * garde, la réponse de la première catégorie pourrait écraser celle de la
 * troisième, et l'écran afficherait un fil qui ne correspond à aucun filtre
 * sélectionné. Chaque chargement note son numéro et ignore sa propre réponse si
 * une demande plus récente est partie entre-temps.
 *
 * ## Pourquoi le curseur vit dans une `ref`
 *
 * Voir `packages/firebase/src/pagination.ts` : un curseur est un instantané de
 * document Firestore, pas une donnée d'affichage. Le mettre dans l'état
 * déclencherait un rendu inutile à chaque page, sans rien apporter.
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
import type { AppError, Post, PostCategory } from '@fl/types';

import { initializeFirebase } from '@/lib/firebase';
import { useAuth } from '@/providers/auth-provider';

import type { AsyncData } from './use-reference-data';

interface FeedData {
  /** Toutes les publications chargées, épinglées comprises. */
  readonly items: readonly Post[];
  readonly hasMore: boolean;
}

/** Résultat mémorisé, avec l'empreinte de la demande à laquelle il répond. */
interface Loaded {
  readonly key: string;
  readonly data: AsyncData<FeedData>;
}

export interface FeedResult {
  readonly status: AsyncData<FeedData>['status'];
  /**
   * Publications à afficher dans le fil chronologique.
   *
   * Les publications épinglées en sont retirées : elles figurent déjà dans le
   * bandeau « À la une ». Les afficher deux fois sur le même écran passerait
   * pour un défaut d'affichage auprès d'un parent.
   */
  readonly posts: readonly Post[];
  /** Publications épinglées, affichées en tête. */
  readonly pinned: readonly Post[];
  readonly hasMore: boolean;
  /** Erreur du premier chargement : remplace tout l'écran. */
  readonly error: AppError | null;
  /**
   * Erreur d'une page suivante, **ou d'un rafraîchissement** : signalée en pied
   * de liste, sans effacer ce qui est déjà affiché.
   */
  readonly loadMoreError: AppError | null;
  readonly loadingMore: boolean;
  readonly refreshing: boolean;
  readonly category: PostCategory | null;
  setCategory: (category: PostCategory | null) => void;
  /** Recharge tout depuis la première page, en vidant la liste. */
  retry: () => void;
  /** Recharge en conservant l'affichage courant. */
  refresh: () => void;
  loadMore: () => void;
}

export function useFeed(): FeedResult {
  const { profile } = useAuth();
  const [firebase] = useState(() => initializeFirebase());

  const repository = useMemo<PostRepository | null>(
    () => (firebase ? createPostRepository(firebase.db) : null),
    [firebase],
  );

  const orgId = profile?.orgId ?? null;

  /**
   * Mémoïsé sur `profile`, dont l'identité ne change qu'à l'arrivée d'un
   * nouveau profil. Sans ce `useMemo`, le tableau serait recréé à chaque rendu
   * et l'effet de chargement se relancerait en boucle.
   */
  const audienceKeys = useMemo<readonly string[]>(() => profile?.audienceKeys ?? [], [profile]);

  const [category, setCategory] = useState<PostCategory | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pinned, setPinned] = useState<readonly Post[]>([]);
  const [loadMoreError, setLoadMoreError] = useState<AppError | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const cursor = useRef<QueryDocumentSnapshot | null>(null);
  const generation = useRef(0);

  const enabled = repository !== null && orgId !== null && audienceKeys.length > 0;
  const key = `${orgId ?? ''}|${category ?? '*'}|${audienceKeys.join(',')}`;

  /** Paramètres communs aux deux chargements, pour qu'ils ne divergent pas. */
  const queryParams = useMemo(
    () => ({ orgId: orgId ?? '', audienceKeys, ...(category ? { category } : {}) }),
    [orgId, audienceKeys, category],
  );

  const fetchFirstPage = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial'): Promise<void> => {
      if (!repository || !orgId || audienceKeys.length === 0) return;

      const mine = (generation.current += 1);
      cursor.current = null;
      setLoadMoreError(null);

      try {
        const page = await repository.fetchFeed(queryParams);
        if (mine !== generation.current) return;
        cursor.current = page.nextCursor;
        setLoaded({
          key,
          data: { status: 'ready', data: { items: page.items, hasMore: page.hasMore } },
        });
      } catch (error) {
        if (mine !== generation.current) return;
        const failure = isAppError(error) ? error : toAppError(error);

        // Un rafraîchissement raté n'efface pas le fil : le parent perdrait ce
        // qu'il était en train de lire à cause d'une coupure d'une seconde.
        // L'échec est signalé en pied de liste, là où le geste a été fait.
        // Le premier chargement, lui, n'a rien à conserver : il affiche l'écran
        // d'erreur, seule réponse possible quand il n'y a rien à montrer.
        if (mode === 'refresh') {
          setLoadMoreError(failure);
          return;
        }

        setLoaded({ key, data: { status: 'error', error: failure } });
      }
    },
    [repository, orgId, audienceKeys, key, queryParams],
  );

  useEffect(() => {
    if (!enabled) return;
    void fetchFirstPage();
  }, [enabled, fetchFirstPage]);

  // --- Épinglage ------------------------------------------------------------
  //
  // Chargé une fois par organisation, indépendamment du filtre : le bandeau
  // « À la une » ne doit pas disparaître parce qu'un filtre est actif.
  useEffect(() => {
    if (!repository || !orgId) return;

    let cancelled = false;

    void repository
      .fetchPinned(orgId)
      .then((posts) => {
        if (!cancelled) setPinned(posts);
      })
      // Une erreur ici n'est pas bloquante : l'épinglage est un confort, et
      // remplacer tout le fil par un écran d'erreur pour trois publications
      // mises en avant serait disproportionné.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [repository, orgId]);

  // --- Actions --------------------------------------------------------------

  const retry = useCallback(() => {
    void fetchFirstPage('initial');
  }, [fetchFirstPage]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void fetchFirstPage('refresh').finally(() => setRefreshing(false));
  }, [fetchFirstPage]);

  const loadMore = useCallback(() => {
    const cursorSnapshot = cursor.current;
    if (!repository || !orgId || audienceKeys.length === 0) return;
    if (!cursorSnapshot || loadingMore) return;

    const mine = generation.current;
    setLoadingMore(true);

    void (async () => {
      try {
        const page = await repository.fetchFeed({ ...queryParams, cursor: cursorSnapshot });
        if (mine !== generation.current) return;

        cursor.current = page.nextCursor;
        setLoadMoreError(null);
        setLoaded((current) =>
          current && current.key === key && current.data.status === 'ready'
            ? {
                key: current.key,
                data: {
                  status: 'ready',
                  data: {
                    items: appendPage(current.data.data.items, page),
                    hasMore: page.hasMore,
                  },
                },
              }
            : current,
        );
      } catch (error) {
        if (mine !== generation.current) return;
        setLoadMoreError(isAppError(error) ? error : toAppError(error));
      } finally {
        if (mine === generation.current) setLoadingMore(false);
      }
    })();
  }, [repository, orgId, audienceKeys, key, queryParams, loadingMore]);

  // --- État dérivé ----------------------------------------------------------

  const current = loaded && loaded.key === key ? loaded.data : null;
  const status: AsyncData<FeedData>['status'] = !enabled
    ? 'idle'
    : current === null
      ? 'loading'
      : current.status;

  const items = current?.status === 'ready' ? current.data.items : [];
  const pinnedIds = useMemo(() => new Set(pinned.map((post) => post.id)), [pinned]);
  const posts = useMemo(() => items.filter((post) => !pinnedIds.has(post.id)), [items, pinnedIds]);

  return {
    status,
    posts,
    pinned,
    hasMore: current?.status === 'ready' ? current.data.hasMore : false,
    error: current?.status === 'error' ? current.error : null,
    loadMoreError,
    loadingMore,
    refreshing,
    category,
    setCategory,
    retry,
    refresh,
    loadMore,
  };
}
