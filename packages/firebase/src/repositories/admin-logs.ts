/**
 * Repository du journal d'audit.
 *
 * Seule couche autorisée à parler à la collection `adminLogs`. Elle est **en
 * lecture seule** : aucune fonction d'écriture n'existe ici, et les règles
 * Firestore refusent de toute façon toute écriture cliente, administrateur
 * compris. Un journal falsifiable n'aurait aucune valeur en cas de litige.
 *
 * ## Pourquoi un seul filtre, et pas un filtre libre
 *
 * Firestore n'exécute une requête que si un index composite la couvre. Trois
 * index sont déclarés pour `adminLogs` — `actorId + at`, `action + at`,
 * `targetType + targetId + at` — et **aucun** ne combine deux critères entre
 * eux. Un filtre libre produirait une requête refusée à l'exécution, avec un
 * message qui ne dit pas quel index manque : le genre d'erreur qu'on ne
 * découvre qu'en production, devant un écran vide.
 *
 * Le filtre est donc une union fermée dont chaque variante correspond à un
 * index. Deux sont utilisées : `action` par la consultation du journal, et
 * `targetType + targetId` par la fiche d'un compte, qui affiche ce qui lui est
 * arrivé. `actorId` — « ce qu'a fait cet administrateur » — reste disponible
 * pour une future fiche d'équipe, et s'ajoute ici en trois lignes.
 */
import {
  collection,
  orderBy,
  query,
  where,
  type DocumentData,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

import type { AdminAction, AdminLog } from '@fl/types';

import { paginate, type FirestorePage } from '../pagination.js';
import { COLLECTIONS } from '../paths.js';

/** Entrées par page. Le journal est dense : une page courte reste lisible. */
const ADMIN_LOGS_PAGE_SIZE = 25;

/** Filtre du journal. Chaque variante correspond à un index composite déclaré. */
export type AdminLogFilter =
  /** Tout le journal, de la plus récente entrée à la plus ancienne. */
  | { readonly kind: 'all' }
  /** Les entrées d'un type d'action donné. */
  | { readonly kind: 'action'; readonly action: AdminAction }
  /** Tout ce qui est arrivé à une ressource : un compte, une publication… */
  | { readonly kind: 'target'; readonly targetType: string; readonly targetId: string };

export interface AdminLogRepository {
  /** Page du journal, de l'entrée la plus récente à la plus ancienne. */
  list(
    filter: AdminLogFilter,
    cursor?: QueryDocumentSnapshot | null,
  ): Promise<FirestorePage<AdminLog>>;
}

export function createAdminLogRepository(db: Firestore): AdminLogRepository {
  const logsCollection = collection(db, COLLECTIONS.adminLogs);

  function mapLog(snapshot: QueryDocumentSnapshot): AdminLog {
    return { ...(snapshot.data() as Omit<AdminLog, 'id'>), id: snapshot.id };
  }

  function buildQuery(filter: AdminLogFilter): Query<DocumentData> {
    switch (filter.kind) {
      case 'action':
        return query(logsCollection, where('action', '==', filter.action), orderBy('at', 'desc'));
      case 'target':
        return query(
          logsCollection,
          where('targetType', '==', filter.targetType),
          where('targetId', '==', filter.targetId),
          orderBy('at', 'desc'),
        );
      case 'all':
        return query(logsCollection, orderBy('at', 'desc'));
    }
  }

  function list(
    filter: AdminLogFilter,
    cursor: QueryDocumentSnapshot | null = null,
  ): Promise<FirestorePage<AdminLog>> {
    return paginate<AdminLog>({
      pageSize: ADMIN_LOGS_PAGE_SIZE,
      cursor,
      buildQuery: () => buildQuery(filter),
      mapDocument: mapLog,
    });
  }

  return { list };
}
