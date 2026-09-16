/**
 * Accès aux fichiers du bucket.
 *
 * ## Pourquoi l'URL est demandée à l'affichage, et jamais stockée
 *
 * `Attachment.storagePath` porte le **chemin** du fichier, pas une URL. C'est
 * délibéré : une URL de téléchargement Firebase contient un jeton qui rend le
 * fichier lisible par quiconque la possède, **sans repasser par les règles
 * Storage**. L'écrire dans Firestore reviendrait à publier la pièce jointe à
 * tous ceux qui peuvent lire le document — y compris ceux que le ciblage par
 * audience exclut du fil. Le chemin seul est donc durable ; l'URL se redemande
 * à chaque affichage, et les règles Storage s'appliquent à ce moment-là.
 *
 * ## Pourquoi un cache mémoire
 *
 * Une même publication s'ouvre plusieurs fois dans une session, et une liste
 * de pièces jointes redemande l'URL de chacune à chaque rendu. Le cache évite
 * ces allers-retours. Il ne survit pas au redémarrage, ce qui est la bonne
 * durée de vie : il ne sert qu'à ne pas refaire deux fois le même appel.
 *
 * ## Pourquoi l'envoi revérifie la taille
 *
 * Les règles Storage bornent déjà une image à 2 Mio, mais **une règle ne peut
 * pas compresser** : un dépassement se manifesterait par un `PERMISSION_DENIED`
 * que le parent ne comprendrait pas. Le contrôle est donc refait ici, *avant*
 * l'envoi, pour produire un message utile. C'est un doublon assumé : la règle
 * reste la barrière, ce contrôle n'est que l'explication.
 *
 * ## Pourquoi la taille vient du blob, et non du fichier d'origine
 *
 * `Attachment.size` doit décrire ce qui est réellement stocké, donc le fichier
 * compressé. Le lire sur le blob juste avant l'envoi évite de le demander au
 * système de fichiers — et donc d'ajouter une dépendance pour un seul nombre.
 */
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
  type FirebaseStorage,
} from 'firebase/storage';

import { UPLOAD_LIMITS, formatBytes } from '@fl/shared';
import type { Attachment } from '@fl/types';

import { invalidArgument, toAppError } from './errors.js';

export interface UploadImageParams {
  /** Chemin complet dans le bucket, déjà cloisonné par organisation. */
  storagePath: string;
  /** URI locale du fichier **compressé** — jamais celui choisi par l'utilisateur. */
  uri: string;
  contentType: string;
  /** Nom d'origine, conservé pour l'affichage. */
  fileName: string;
  width?: number;
  height?: number;
}

export interface StorageRepository {
  /** URL de téléchargement d'un fichier du bucket, mémorisée pour la session. */
  downloadUrl(storagePath: string): Promise<string>;
  /** Envoie une image et renvoie la pièce jointe à écrire dans Firestore. */
  uploadImage(params: UploadImageParams): Promise<Attachment>;
  /**
   * Supprime un fichier.
   *
   * Sert à ne pas laisser d'orphelins quand une publication échoue après que
   * ses photos ont été envoyées : le bucket facture le stockage, et un fichier
   * que plus aucun document ne référence n'est plus supprimable par personne.
   */
  remove(storagePath: string): Promise<void>;
}

/**
 * Lit un fichier local sous forme de blob.
 *
 * `fetch` sur une URI `file://` est le moyen le plus court d'obtenir les
 * octets sous React Native. La bibliothèque `expo-file-system` ferait la même
 * chose en ajoutant une dépendance, pour un seul appel.
 */
async function readBlob(uri: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(uri);
  } catch (error) {
    throw toAppError(error);
  }

  const blob = await response.blob();

  // Un blob vide signifie que la compression a produit un fichier illisible.
  // Sans ce contrôle, on enverrait zéro octet : les règles l'accepteraient
  // (la taille est bien sous la limite), et la pièce jointe serait cassée.
  if (blob.size === 0) {
    throw invalidArgument("Le fichier préparé est vide et n'a pas pu être envoyé.");
  }

  return blob;
}

export function createStorageRepository(storage: FirebaseStorage): StorageRepository {
  /**
   * La promesse est mise en cache, pas son résultat : deux rendus simultanés
   * du même fichier partagent donc un seul appel réseau.
   */
  const cache = new Map<string, Promise<string>>();

  function downloadUrl(storagePath: string): Promise<string> {
    const cached = cache.get(storagePath);
    if (cached) return cached;

    const pending = getDownloadURL(ref(storage, storagePath)).catch((error: unknown) => {
      // Un échec ne reste pas en cache : sans cela, une coupure réseau
      // condamnerait la pièce jointe pour toute la session, même une fois la
      // connexion revenue.
      cache.delete(storagePath);
      throw toAppError(error);
    });

    cache.set(storagePath, pending);
    return pending;
  }

  async function uploadImage({
    storagePath,
    uri,
    contentType,
    fileName,
    width,
    height,
  }: UploadImageParams): Promise<Attachment> {
    const blob = await readBlob(uri);

    if (blob.size > UPLOAD_LIMITS.image.maxBytes) {
      throw invalidArgument(
        `L’image « ${fileName} » pèse ${formatBytes(blob.size)} après compression, ` +
          `au-delà de la limite de ${formatBytes(UPLOAD_LIMITS.image.maxBytes)}.`,
      );
    }

    try {
      await uploadBytes(ref(storage, storagePath), blob, { contentType });
    } catch (error) {
      throw toAppError(error);
    }

    return {
      storagePath,
      contentType,
      fileName,
      size: blob.size,
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
    };
  }

  async function remove(storagePath: string): Promise<void> {
    cache.delete(storagePath);

    try {
      await deleteObject(ref(storage, storagePath));
    } catch (error) {
      throw toAppError(error);
    }
  }

  return { downloadUrl, uploadImage, remove };
}
