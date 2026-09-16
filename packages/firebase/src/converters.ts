/**
 * Conversions entre les documents Firestore et le modèle de domaine.
 *
 * Objectif : que `post.id` soit toujours renseigné. L'identifiant vit dans le
 * chemin du document, pas dans ses champs — c'est une source classique de
 * `undefined` silencieux. Ces helpers le remettent systématiquement en place.
 *
 * On évite volontairement `withConverter()` du SDK, dont les contraintes de
 * types (`WithFieldValue`) rendent le code générique pénible à lire pour un
 * bénéfice limité. Ces deux fonctions couvrent le même besoin, en clair.
 */
import type {
  DocumentData,
  DocumentSnapshot,
  QueryDocumentSnapshot,
  QuerySnapshot,
} from 'firebase/firestore';

/** Modèle doté d'un identifiant. */
export interface Identified {
  id: string;
}

/** Convertit un document en modèle typé, ou `null` s'il n'existe pas. */
export function toModel<T extends Identified>(
  snapshot: DocumentSnapshot | QueryDocumentSnapshot,
): T | null {
  if (!snapshot.exists()) return null;
  return { ...(snapshot.data() as Omit<T, 'id'>), id: snapshot.id } as T;
}

/**
 * Convertit un document en modèle typé, en levant une erreur s'il n'existe pas.
 * À utiliser lorsqu'un document absent est une anomalie, pas un cas normal.
 */
export function toModelOrThrow<T extends Identified>(
  snapshot: DocumentSnapshot | QueryDocumentSnapshot,
): T {
  const model = toModel<T>(snapshot);
  if (!model) {
    throw new Error(`Document introuvable : ${snapshot.ref.path}`);
  }
  return model;
}

/** Convertit un ensemble de documents en liste typée. */
export function toModels<T extends Identified>(snapshot: QuerySnapshot): T[] {
  return snapshot.docs.map((doc) => ({ ...(doc.data() as Omit<T, 'id'>), id: doc.id }) as T);
}

/**
 * Prépare un modèle pour l'écriture : retire l'identifiant, qui ne doit
 * jamais être dupliqué dans les champs du document.
 */
export function toDocumentData<T extends Identified>(model: T): DocumentData {
  const { id: _id, ...data } = model;
  return data as DocumentData;
}

/**
 * Variante pour une création : l'identifiant peut être fourni explicitement
 * (pour utiliser un UID comme identifiant de document) ou laissé au SDK.
 */
export function toCreateData<T extends Record<string, unknown>>(
  input: T,
  options: { stripKeys?: readonly string[] } = {},
): DocumentData {
  const strip = new Set(options.stripKeys ?? ['id']);
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => !strip.has(key) && value !== undefined),
  ) as DocumentData;
}
