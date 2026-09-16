'use client';

/**
 * Une publication dans la liste d'administration.
 *
 * ## Pourquoi chaque action est filtrée par permission *et* par propriété
 *
 * Deux conditions différentes, souvent confondues :
 *
 *  - **la permission** (`post.pin`, `post.update.any`) dit ce que le rôle a le
 *    droit de faire ;
 *  - **la propriété** dit sur quoi il peut le faire. Modifier le texte d'une
 *    publication est réservé à son auteur — la règle de mise à jour exige
 *    `resource.data.authorId == request.auth.uid` pour la branche « auteur », et
 *    la branche « modération » ne sait que masquer et épingler. Proposer
 *    « Modifier » sur la publication d'un autre ne pourrait donc qu'échouer.
 *
 * Aucune des deux n'est une protection : les Security Rules restent seules
 * juges. Elles évitent un bouton qui échoue systématiquement.
 */
import {
  POST_CATEGORY_BADGES,
  POST_CATEGORY_LABELS,
  audienceLabel,
  formatDateTime,
  hasPermission,
  pluralize,
} from '@fl/shared';
import type { Post, UserRole } from '@fl/types';

interface PostRowProps {
  readonly post: Post;
  readonly role: UserRole | undefined;
  readonly currentUid: string | undefined;
  /** Une écriture est en cours : les actions sont neutralisées. */
  readonly busy: boolean;
  readonly onEdit: (post: Post) => void;
  readonly onTogglePin: (post: Post) => void;
  readonly onHide: (post: Post) => void;
}

const ACTION_CLASS =
  'rounded-md border border-border px-3 py-1.5 text-sm text-secondary hover:bg-surface-muted disabled:opacity-50';

export function PostRow({
  post,
  role,
  currentUid,
  busy,
  onEdit,
  onTogglePin,
  onHide,
}: PostRowProps): React.JSX.Element {
  const badge = POST_CATEGORY_BADGES[post.category];
  const isAuthor = Boolean(currentUid) && post.authorId === currentUid;
  const canEdit = isAuthor && hasPermission(role, 'post.update.own');
  const canPin = hasPermission(role, 'post.pin');
  const canHide = hasPermission(role, 'post.update.any');

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded px-2 py-0.5 text-xs font-semibold"
          style={{ color: badge.color, backgroundColor: badge.background }}
        >
          {POST_CATEGORY_LABELS[post.category]}
        </span>

        {post.pinned ? (
          <span className="rounded bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">
            Épinglée
          </span>
        ) : null}

        <span className="text-xs text-muted">{audienceLabel(post.audience)}</span>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="font-semibold text-foreground">{post.title}</h3>
        <p className="line-clamp-3 whitespace-pre-line text-sm text-secondary">{post.body}</p>
      </div>

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <div className="flex gap-1">
          <dt>Publiée le</dt>
          <dd>{formatDateTime(post.publishedAt)}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Par</dt>
          <dd>{post.authorName}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Commentaires</dt>
          <dd>{pluralize(post.stats.commentCount, 'commentaire')}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Commentaires</dt>
          <dd>{post.commentsEnabled ? 'ouverts' : 'fermés'}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        {canEdit ? (
          <button
            type="button"
            className={ACTION_CLASS}
            disabled={busy}
            onClick={() => onEdit(post)}
          >
            Modifier
          </button>
        ) : null}

        {canPin ? (
          <button
            type="button"
            className={ACTION_CLASS}
            disabled={busy}
            onClick={() => onTogglePin(post)}
          >
            {post.pinned ? 'Désépingler' : 'Épingler'}
          </button>
        ) : null}

        {canHide ? (
          <button
            type="button"
            className={ACTION_CLASS}
            disabled={busy}
            onClick={() => onHide(post)}
          >
            Masquer
          </button>
        ) : null}
      </div>
    </article>
  );
}
