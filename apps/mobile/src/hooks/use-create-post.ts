/**
 * Publier une information, photos comprises.
 *
 * ## L'ordre des opérations est imposé par les règles
 *
 * Le chemin d'une pièce jointe contient l'identifiant de la publication
 * (`orgs/{orgId}/posts/{postId}/…`), donc les photos ne peuvent pas être
 * envoyées avant que cet identifiant existe. Mais elles ne peuvent pas non plus
 * être ajoutées après coup : `publishedAt` est **figé** par les règles et posé
 * à la création, si bien qu'un brouillon publié après l'envoi porterait la date
 * du brouillon.
 *
 * La sortie est de **pré-générer l'identifiant** (`newPostId()`, qui n'écrit
 * rien), d'envoyer les photos à leur place définitive, puis de créer la
 * publication complète du premier coup. Aucun état intermédiaire n'est visible
 * par les parents, et il n'y a jamais deux écritures sur le même document.
 *
 * ## Pourquoi les fichiers sont supprimés quand la création échoue
 *
 * Les règles Storage ne vérifient pas que le document existe : un envoi vers
 * une publication jamais créée réussit. Ces fichiers ne seraient alors
 * référencés par aucun document, donc **plus supprimables par personne** — et
 * le bucket les facture. L'échec de la création déclenche donc leur nettoyage,
 * au mieux : un nettoyage raté ne doit pas masquer l'erreur d'origine, qui est
 * celle que l'utilisateur doit lire.
 */
import { useCallback, useMemo, useState } from 'react';

import {
  buildStorageFileName,
  createPostRepository,
  isAppError,
  storagePaths,
  toAppError,
  type PostRepository,
} from '@fl/firebase';
import { displayName, type PostInput } from '@fl/shared';
import type { AppError, Attachment, PostCategory } from '@fl/types';

import { compressImage } from '@/lib/compress-image';
import { initializeFirebase } from '@/lib/firebase';
import { useAuth } from '@/providers/auth-provider';

import { useStorage } from './use-storage';

/** Photo choisie par l'utilisateur, avant compression. */
export interface PickedPhoto {
  uri: string;
  /** Peut valoir 0 : le sélecteur du système ne connaît pas toujours la taille. */
  width: number;
  height: number;
  /** Nom d'origine, conservé pour l'affichage de la pièce jointe. */
  fileName: string;
}

export interface PostDraft {
  title: string;
  body: string;
  category: PostCategory;
  /**
   * Ciblage, tel que le produit le schéma.
   *
   * Le type est dérivé de `postInputSchema` et non repris de `@fl/types` :
   * `Audience` y est une forme souple, où `schoolId` et `level` sont facultatifs
   * quel que soit le type. L'union discriminée du schéma interdit, elle, un
   * ciblage « niveau » sans niveau — et c'est cette garantie-là que la règle
   * Firestore vérifiera de son côté.
   */
  audience: PostInput['audience'];
  /**
   * Photos jointes.
   *
   * Pas de champ `schoolId` ici : la publication en porte un en base, mais
   * aucune règle ne le lit et l'éditeur d'administration ne le renseigne pas
   * non plus. L'ajouter depuis le seul écran mobile créerait une information
   * que rien n'utilise, et deux chemins de création qui ne remplissent pas les
   * mêmes champs. L'école concernée se lit dans `audience`.
   */
  photos: readonly PickedPhoto[];
  commentsEnabled: boolean;
  /** Lien externe, absent s'il n'y en a pas. */
  linkUrl?: string;
}

export interface CreatePostResult {
  submitting: boolean;
  /** Étape en cours, affichée pendant l'envoi. `null` au repos. */
  progress: string | null;
  error: AppError | null;
  /**
   * Publie, et rend l'identifiant de la publication créée.
   *
   * `null` en cas d'échec — l'erreur est alors dans `error`. Rendre
   * l'identifiant plutôt qu'un booléen permet à l'écran d'ouvrir la publication
   * qui vient d'être créée : le fil charge des pages et ne s'abonne pas aux
   * écritures, donc y revenir montrerait une liste **sans** la nouvelle
   * publication, et son auteur conclurait que l'envoi a échoué.
   */
  submit: (draft: PostDraft) => Promise<string | null>;
}

export function useCreatePost(): CreatePostResult {
  const { profile, firebaseUser } = useAuth();
  const storage = useStorage();
  const [firebase] = useState(() => initializeFirebase());

  const repository = useMemo<PostRepository | null>(
    () => (firebase ? createPostRepository(firebase.db) : null),
    [firebase],
  );

  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  const submit = useCallback(
    async (draft: PostDraft): Promise<string | null> => {
      const uid = firebaseUser?.uid ?? null;
      const orgId = profile?.orgId ?? null;

      if (!repository || !storage || !uid || !profile || !orgId) return null;

      setSubmitting(true);
      setError(null);

      const postId = repository.newPostId();
      const uploaded: string[] = [];
      const total = draft.photos.length;

      try {
        const attachments: Attachment[] = [];

        for (const [index, photo] of draft.photos.entries()) {
          const position = `photo ${index + 1} sur ${total}`;

          setProgress(`Préparation de la ${position}…`);
          const compressed = await compressImage(photo);

          setProgress(`Envoi de la ${position}…`);
          const attachment = await storage.uploadImage({
            // L'index entre dans le préfixe : deux photos portant le même nom
            // et envoyées dans la même milliseconde écriraient sinon au même
            // chemin, et la seconde écraserait la première sans rien signaler.
            storagePath: storagePaths.postAttachment(
              orgId,
              postId,
              buildStorageFileName(`photo-${index + 1}`, photo.fileName, Date.now()),
            ),
            uri: compressed.uri,
            contentType: compressed.contentType,
            fileName: photo.fileName,
            width: compressed.width,
            height: compressed.height,
          });

          uploaded.push(attachment.storagePath);
          attachments.push(attachment);
        }

        setProgress('Publication…');

        await repository.create({
          postId,
          orgId,
          authorId: uid,
          authorName: displayName(profile.firstName, profile.lastName),
          authorRole: profile.role,
          input: {
            title: draft.title,
            body: draft.body,
            category: draft.category,
            audience: draft.audience,
            attachments,
            commentsEnabled: draft.commentsEnabled,
            ...(draft.linkUrl ? { linkUrl: draft.linkUrl } : {}),
            // L'épinglage est un acte de modération : `allow create` refuse
            // `pinned: true` à un simple membre, et l'écran n'offre pas le choix.
            pinned: false,
            status: 'published',
            // `postInputSchema` déclare `notify`, mais `create()` ne l'écrit pas
            // dans Firestore et rien ne le lit : le transmettre à `false` dit
            // qu'aucune notification n'est demandée, sans laisser croire qu'un
            // réglage existe.
            notify: false,
          },
        });

        return postId;
      } catch (caught) {
        await Promise.allSettled(uploaded.map((path) => storage.remove(path)));
        setError(isAppError(caught) ? caught : toAppError(caught));
        return null;
      } finally {
        setSubmitting(false);
        setProgress(null);
      }
    },
    [repository, storage, firebaseUser, profile],
  );

  return { submitting, progress, error, submit };
}
