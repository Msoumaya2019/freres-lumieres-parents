/**
 * Accès aux fichiers du bucket, mémorisé pour la session.
 *
 * Le dépôt de stockage est créé une fois par composant qui l'utilise et
 * conserve son propre cache d'URL. Ce cache n'est pas partagé entre écrans,
 * ce qui est sans conséquence : il n'évite que les appels répétés d'un même
 * affichage, et `initializeFirebase()` est idempotent.
 */
import { useMemo, useState } from 'react';

import { createStorageRepository, type StorageRepository } from '@fl/firebase';

import { initializeFirebase } from '@/lib/firebase';

export function useStorage(): StorageRepository | null {
  const [firebase] = useState(() => initializeFirebase());

  return useMemo<StorageRepository | null>(
    () => (firebase ? createStorageRepository(firebase.storage) : null),
    [firebase],
  );
}
