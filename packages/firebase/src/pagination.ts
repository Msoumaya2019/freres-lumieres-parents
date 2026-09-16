/**
 * Pagination par curseur.
 *
 * Toute liste de l'application passe par ici. Aucune requête ne charge une
 * collection entière : c'est la première cause de dépassement de quota
 * Firestore, et la première cause de lenteur ressentie.
 *
 * Le curseur est un `QueryDocumentSnapshot` conservé en mémoire par l'écran
 * (dans une `ref`, jamais dans l'état React). On ne devine jamais une
 * position à partir d'un index numérique : un index devient faux dès qu'un
 * document est supprimé ou inséré, ce qui provoque des doublons et des
 * éléments manquants dans la liste.
 */
import {
  getDocs,
  limit as limitTo,
  query,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

import { toAppError } from './errors.js';

/** Une page de résultats Firestore, avec son curseur. */
export interface FirestorePage<T> {
  readonly items: readonly T[];
  /**
   * Curseur à repasser pour obtenir la page suivante.
   * `null` lorsqu'il n'y a plus rien à charger.
   */
  readonly nextCursor: QueryDocumentSnapshot | null;
  readonly hasMore: boolean;
}

export interface PaginateOptions<T> {
  /**
   * Construit la requête. Reçoit le curseur de la page précédente, ou `null`
   * pour la première page. Cette inversion de contrôle évite de manipuler les
   * internes du SDK et garde `paginate` totalement générique.
   */
  buildQuery: (cursor: QueryDocumentSnapshot | null) => Query<DocumentData>;
  /** Nombre d'éléments par page. */
  pageSize: number;
  /** Curseur de la page précédente. */
  cursor?: QueryDocumentSnapshot | null;
  /** Transforme un document Firestore en modèle de domaine. */
  mapDocument: (snapshot: QueryDocumentSnapshot) => T;
}

/**
 * Exécute une requête paginée.
 *
 * On demande un document de plus que la taille de page : sa présence indique
 * qu'il reste des éléments. C'est la méthode standard, et elle coûte une
 * lecture supplémentaire par page — un prix dérisoire pour une pagination
 * exacte.
 */
export async function paginate<T>(options: PaginateOptions<T>): Promise<FirestorePage<T>> {
  try {
    const { buildQuery, pageSize, cursor = null, mapDocument } = options;

    // On demande un document de plus que la taille de page : sa présence
    // indique qu'il reste des éléments. C'est la méthode standard, et elle
    // coûte une lecture supplémentaire par page — un prix dérisoire pour une
    // pagination exacte.
    const limitedQuery: Query<DocumentData> = query(buildQuery(cursor), limitTo(pageSize + 1));
    const snapshot = await getDocs(limitedQuery);

    const hasMore = snapshot.docs.length > pageSize;
    const visibleDocs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;
    const lastDoc = visibleDocs[visibleDocs.length - 1] ?? null;

    return {
      items: visibleDocs.map((document) => mapDocument(document)),
      nextCursor: hasMore ? lastDoc : null,
      hasMore,
    };
  } catch (error) {
    throw toAppError(error);
  }
}

/** Page vide, pour l'état initial d'un écran. */
export function emptyPage<T>(): FirestorePage<T> {
  return { items: [], nextCursor: null, hasMore: false };
}

/**
 * Ajoute une page à la suite d'une liste existante, en écartant les doublons.
 *
 * Un document peut être renvoyé deux fois si un contenu est publié pendant la
 * pagination. Sans cette déduplication, la liste afficherait deux fois le même
 * élément — un défaut visible et déroutant pour l'utilisateur.
 */
export function appendPage<T extends { id: string }>(
  current: readonly T[],
  page: FirestorePage<T>,
): T[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...page.items.filter((item) => !seen.has(item.id))];
}
