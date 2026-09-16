'use client';

/**
 * Écran d'administration des publications.
 *
 * ## Ce que cet écran montre
 *
 * Les publications **publiées** de l'organisation, toutes audiences confondues.
 * C'est la différence avec le fil mobile, qui filtre sur les clés d'audience de
 * celui qui regarde : un membre de la FCPE dont les enfants sont en CE1 ne voit
 * pas, dans l'application, une publication destinée au CM2. Ici, si — c'est même
 * tout l'intérêt.
 *
 * Il ne peut pas, en revanche, montrer les brouillons. Une règle de requête doit
 * être démontrable à partir des contraintes de la requête, et `status ==
 * 'published'` est la seule qui le soit pour `posts` (voir l'en-tête de
 * `firestore.rules`). C'est la raison pour laquelle l'éditeur ne propose pas non
 * plus de brouillon : voir `post-editor.tsx`.
 *
 * ## Pourquoi la liste est rechargée après chaque écriture
 *
 * Épingler ne change pas la composition de la liste, mais masquer en retire une
 * ligne, et publier en ajoute une. Retoucher l'état local donnerait une liste
 * juste jusqu'à la prochaine ouverture ; le rechargement coûte une requête sur
 * une collection de quelques dizaines de documents, et garantit que ce qui est
 * affiché existe vraiment. C'est le choix déjà fait pour la file des comptes.
 */
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';

import {
  appendPage,
  createPostRepository,
  createReferenceRepository,
  userMessage,
} from '@fl/firebase';
import type { Post, School, SchoolClass } from '@fl/types';

import { PostEditor } from '@/features/posts/post-editor';
import { PostRow } from '@/features/posts/post-row';
import { initializeFirebase } from '@/lib/firebase';
import { useAdminAuth } from '@/providers/auth-provider';

interface LoadedPage {
  readonly items: readonly Post[];
  readonly cursor: QueryDocumentSnapshot | null;
  readonly hasMore: boolean;
}

export function PostsView(): React.JSX.Element {
  const { profile } = useAdminAuth();
  const orgId = profile?.orgId ?? null;

  // `initializeFirebase()` est idempotent : l'appeler ici ne crée pas une
  // seconde application Firebase.
  const [ready] = useState(() => initializeFirebase());
  const posts = useMemo(() => (ready ? createPostRepository(ready.db) : null), [ready]);
  const reference = useMemo(() => (ready ? createReferenceRepository(ready.db) : null), [ready]);

  const [page, setPage] = useState<LoadedPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Incrémenté pour forcer un rechargement de la première page. `page` n'est
  // volontairement pas une dépendance de l'effet.
  const [reloadToken, setReloadToken] = useState(0);

  const [schools, setSchools] = useState<readonly School[]>([]);
  const [classes, setClasses] = useState<readonly SchoolClass[]>([]);

  const [editor, setEditor] = useState<{ readonly open: boolean; readonly post: Post | null }>({
    open: false,
    post: null,
  });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Données de référence, nécessaires au ciblage uniquement.
  useEffect(() => {
    if (!reference) return;

    let cancelled = false;

    void Promise.all([reference.listSchools(), reference.listClasses()])
      .then(([loadedSchools, loadedClasses]) => {
        if (cancelled) return;
        setSchools(loadedSchools);
        setClasses(loadedClasses);
      })
      .catch(() => {
        // Un échec ici ne doit pas empêcher de lire la liste : le sélecteur
        // d'audience désactive simplement les types qu'il ne peut pas décrire,
        // plutôt que de proposer un ciblage incomplet.
        if (cancelled) return;
        setSchools([]);
        setClasses([]);
      });

    return () => {
      cancelled = true;
    };
  }, [reference]);

  useEffect(() => {
    if (!posts || !orgId) return;

    let cancelled = false;

    void posts
      .fetchForAdmin({ orgId })
      .then((result) => {
        if (cancelled) return;
        setLoadError(null);
        setPage({ items: result.items, cursor: result.nextCursor, hasMore: result.hasMore });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(userMessage(error));
      });

    return () => {
      cancelled = true;
    };
  }, [posts, orgId, reloadToken]);

  const loading = Boolean(orgId) && page === null && loadError === null;
  const items = page?.items ?? [];

  function reload(): void {
    setLoadError(null);
    setPage(null);
    setReloadToken((value) => value + 1);
  }

  async function loadMore(): Promise<void> {
    if (!posts || !orgId || !page?.cursor) return;

    setLoadingMore(true);
    try {
      const next = await posts.fetchForAdmin({ orgId, cursor: page.cursor });
      setPage((previous) =>
        previous
          ? {
              items: appendPage(previous.items, next),
              cursor: next.nextCursor,
              hasMore: next.hasMore,
            }
          : previous,
      );
    } catch (error) {
      setLoadError(userMessage(error));
    } finally {
      setLoadingMore(false);
    }
  }

  async function run(action: () => Promise<void>, message: string): Promise<void> {
    setBusy(true);
    setActionError(null);
    setNotice(null);

    try {
      await action();
      setNotice(message);
      reload();
    } catch (error) {
      setActionError(userMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function openEditor(post: Post | null): void {
    setEditor({ open: true, post });
    setActionError(null);
    setNotice(null);
  }

  function closeEditor(): void {
    setEditor({ open: false, post: null });
  }

  function togglePin(target: Post): void {
    if (!posts) return;
    void run(
      () => posts.setPinned(target.id, !target.pinned),
      target.pinned ? 'Publication désépinglée.' : 'Publication épinglée.',
    );
  }

  function hide(target: Post): void {
    if (!posts) return;
    void run(
      () => posts.setStatus(target.id, 'hidden'),
      'Publication masquée. Elle n’apparaît plus dans le fil.',
    );
  }

  const author = profile
    ? {
        id: profile.id,
        name: `${profile.firstName} ${profile.lastName}`.trim(),
        role: profile.role,
      }
    : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">Publications</h1>
        <p className="text-secondary">
          Rédigez les informations destinées aux familles, puis épinglez les plus importantes en
          tête du fil.
        </p>
      </header>

      {notice ? (
        <p className="rounded-md bg-success-soft p-3 text-sm text-success" role="status">
          {notice}
        </p>
      ) : null}

      {actionError ? (
        <p className="rounded-md bg-danger-soft p-3 text-sm text-danger" role="alert">
          {actionError}
        </p>
      ) : null}

      {editor.open && posts && author && orgId ? (
        <PostEditor
          // La clé réinitialise le formulaire quand on passe d'une publication à
          // une autre : sans elle, React réutiliserait l'état du champ précédent.
          key={editor.post?.id ?? 'nouvelle-publication'}
          repository={posts}
          orgId={orgId}
          author={author}
          schools={schools}
          classes={classes}
          post={editor.post}
          onSaved={() => {
            const wasEditing = editor.post !== null;
            setEditor({ open: false, post: null });
            setNotice(wasEditing ? 'Publication modifiée.' : 'Publication publiée.');
            reload();
          }}
          onCancel={closeEditor}
        />
      ) : (
        <button
          type="button"
          onClick={() => openEditor(null)}
          className="self-start rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Nouvelle publication
        </button>
      )}

      {loading ? (
        <p className="text-muted" role="status">
          Chargement des publications…
        </p>
      ) : null}

      {loadError ? (
        <div className="flex flex-col items-start gap-3 rounded-md bg-danger-soft p-4" role="alert">
          <p className="text-danger">{loadError}</p>
          <button
            type="button"
            onClick={reload}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-secondary hover:bg-surface-muted"
          >
            Réessayer
          </button>
        </div>
      ) : null}

      {!loading && !loadError && items.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="font-semibold text-foreground">Aucune publication pour le moment</p>
          <p className="mt-2 text-secondary">
            Les informations publiées ici apparaissent dans le fil d’actualité des familles.
          </p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {items.map((post) => (
            <li key={post.id}>
              <PostRow
                post={post}
                role={profile?.role}
                currentUid={profile?.id}
                busy={busy}
                onEdit={openEditor}
                onTogglePin={togglePin}
                onHide={hide}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {page?.hasMore ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="self-start rounded-md border border-border bg-surface px-4 py-2 text-sm text-secondary hover:bg-surface-muted disabled:opacity-50"
        >
          {loadingMore ? 'Chargement…' : 'Charger la suite'}
        </button>
      ) : null}
    </div>
  );
}
