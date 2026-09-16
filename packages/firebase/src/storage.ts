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
 */
import { getDownloadURL, ref, type FirebaseStorage } from 'firebase/storage';

import { toAppError } from './errors.js';

export interface StorageRepository {
  /** URL de téléchargement d'un fichier du bucket, mémorisée pour la session. */
  downloadUrl(storagePath: string): Promise<string>;
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

  return { downloadUrl };
}
