'use client';

/**
 * Éditeur d'une publication — création et modification.
 *
 * ## Ce que ce formulaire n'offre pas, et pourquoi
 *
 * **Ni brouillon.** Aucune requête ne peut lister un brouillon : la règle
 * `list` de `posts` n'autorise que `status == 'published'`, parce qu'une règle
 * de requête doit être démontrable à partir des contraintes de la requête (voir
 * l'en-tête de `firestore.rules`). Un brouillon enregistré ici disparaîtrait de
 * l'écran aussitôt écrit, sans moyen de le retrouver depuis l'administration.
 * Tant que les brouillons ne sont pas listables, mieux vaut ne pas les proposer
 * que de faire perdre son travail à quelqu'un.
 *
 * **Ni épinglage.** `post.pin` est réservé aux rôles de modération, et la règle
 * le vérifie : `allow create` refuse `pinned: true` à un membre de la FCPE.
 * Épingler se fait depuis la liste, sur une publication qui existe déjà — un
 * seul chemin, donc un seul endroit à corriger.
 *
 * **Ni notification.** `postInputSchema` déclare un champ `notify`, mais rien
 * ne le lit : `create()` ne l'écrit pas dans Firestore. Une case à cocher qui
 * ne déclenche rien serait un mensonge d'interface.
 *
 * ## Pourquoi la validation passe par le schéma partagé
 *
 * Les mêmes règles sont vérifiées trois fois : ici pour le message affiché, par
 * le dépôt au moment de l'écriture, et par les Security Rules. Ce n'est pas de
 * la redondance — chacune couvre un client différent, et seule la dernière est
 * une barrière.
 */
import { useState } from 'react';

import type { PostRepository } from '@fl/firebase';
import { userMessage } from '@fl/firebase';
import { POST_CATEGORIES, POST_CATEGORY_LABELS, postInputSchema } from '@fl/shared';
import type { Audience, Post, PostCategory, School, SchoolClass, UserRole } from '@fl/types';

import { AudiencePicker } from '@/features/posts/audience-picker';

const FIELD_CLASS =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground';
const LABEL_CLASS = 'text-sm font-medium text-foreground';

interface PostEditorProps {
  readonly repository: PostRepository;
  readonly orgId: string;
  readonly author: { readonly id: string; readonly name: string; readonly role: UserRole };
  readonly schools: readonly School[];
  readonly classes: readonly SchoolClass[];
  /** Publication à modifier, ou `null` pour en créer une. */
  readonly post: Post | null;
  readonly onSaved: () => void;
  readonly onCancel: () => void;
}

export function PostEditor({
  repository,
  orgId,
  author,
  schools,
  classes,
  post,
  onSaved,
  onCancel,
}: PostEditorProps): React.JSX.Element {
  const [title, setTitle] = useState(post?.title ?? '');
  const [body, setBody] = useState(post?.body ?? '');
  const [category, setCategory] = useState<PostCategory>(post?.category ?? 'information');
  const [audience, setAudience] = useState<Audience>(post?.audience ?? { type: 'all' });
  const [linkUrl, setLinkUrl] = useState(post?.linkUrl ?? '');
  const [commentsEnabled, setCommentsEnabled] = useState(post?.commentsEnabled ?? true);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmedLink = linkUrl.trim();

  async function submit(): Promise<void> {
    // Le lien vide est omis de la validation : `z.url()` refuse la chaîne vide,
    // alors que « pas de lien » est un état légitime du formulaire.
    const parsed = postInputSchema.safeParse({
      title: title.trim(),
      body: body.trim(),
      category,
      audience,
      commentsEnabled,
      ...(trimmedLink ? { linkUrl: trimmedLink } : {}),
    });

    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === 'string' && !errors[field]) errors[field] = issue.message;
      }
      setFieldErrors(errors);
      setSubmitError(null);
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setSubmitting(true);

    try {
      if (post) {
        // `pinned` est volontairement absent de cette charge : la règle le fige
        // pour l'auteur, et le schéma le défaut à `false` — l'envoyer
        // désépinglerait la publication, ce qui est refusé.
        //
        // `linkUrl` est transmis même vide : c'est ainsi que le dépôt exprime
        // « effacer le lien ».
        await repository.update(post.id, {
          title: parsed.data.title,
          body: parsed.data.body,
          category: parsed.data.category,
          audience: parsed.data.audience,
          commentsEnabled: parsed.data.commentsEnabled,
          linkUrl: trimmedLink,
          status: 'published',
        });
      } else {
        await repository.create({
          orgId,
          authorId: author.id,
          authorName: author.name,
          authorRole: author.role,
          input: parsed.data,
        });
      }

      onSaved();
    } catch (error) {
      setSubmitError(userMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h2 className="text-lg font-semibold text-foreground">
        {post ? 'Modifier la publication' : 'Nouvelle publication'}
      </h2>

      <div className="flex flex-col gap-1">
        <label className={LABEL_CLASS} htmlFor="post-title">
          Titre
        </label>
        <input
          id="post-title"
          className={FIELD_CLASS}
          value={title}
          maxLength={140}
          onChange={(event) => setTitle(event.target.value)}
        />
        {fieldErrors.title ? <p className="text-sm text-danger">{fieldErrors.title}</p> : null}
      </div>

      <div className="flex flex-col gap-1">
        <label className={LABEL_CLASS} htmlFor="post-body">
          Texte
        </label>
        <textarea
          id="post-body"
          className={`${FIELD_CLASS} min-h-40 resize-y`}
          value={body}
          maxLength={8000}
          onChange={(event) => setBody(event.target.value)}
        />
        {fieldErrors.body ? <p className="text-sm text-danger">{fieldErrors.body}</p> : null}
      </div>

      <div className="flex flex-col gap-1">
        <label className={LABEL_CLASS} htmlFor="post-category">
          Catégorie
        </label>
        <select
          id="post-category"
          className={FIELD_CLASS}
          value={category}
          onChange={(event) => setCategory(event.target.value as PostCategory)}
        >
          {POST_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {POST_CATEGORY_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      <AudiencePicker value={audience} onChange={setAudience} schools={schools} classes={classes} />
      {fieldErrors.audience ? <p className="text-sm text-danger">{fieldErrors.audience}</p> : null}

      <div className="flex flex-col gap-1">
        <label className={LABEL_CLASS} htmlFor="post-link">
          Lien externe (facultatif)
        </label>
        <input
          id="post-link"
          className={FIELD_CLASS}
          value={linkUrl}
          inputMode="url"
          placeholder="https://…"
          onChange={(event) => setLinkUrl(event.target.value)}
        />
        {fieldErrors.linkUrl ? <p className="text-sm text-danger">{fieldErrors.linkUrl}</p> : null}
      </div>

      <label className="flex items-center gap-2 text-sm text-secondary">
        <input
          type="checkbox"
          checked={commentsEnabled}
          onChange={(event) => setCommentsEnabled(event.target.checked)}
        />
        Autoriser les commentaires
      </label>

      {submitError ? (
        <p className="rounded-md bg-danger-soft p-3 text-sm text-danger" role="alert">
          {submitError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Enregistrement…' : post ? 'Enregistrer' : 'Publier'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-md border border-border px-4 py-2 text-sm text-secondary hover:bg-surface-muted disabled:opacity-50"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}
