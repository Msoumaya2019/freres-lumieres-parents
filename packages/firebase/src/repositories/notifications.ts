/**
 * Repository de l'historique des notifications.
 *
 * Seule couche autorisée à lire la collection `notifications`. Elle est **en
 * lecture seule** : les documents sont écrits par les Cloud Functions, et les
 * règles Firestore refusent toute écriture cliente — administrateur compris.
 * L'historique d'envoi est une pièce comptable, pas un brouillon.
 *
 * ## Pourquoi la requête contraint l'organisation
 *
 * Ce n'est pas une optimisation mais une obligation : les règles ne sont pas
 * des filtres, et un `list` qui ne contraint pas `orgId` est refusé. La
 * frontière d'organisation s'écrit donc ici, et elle correspond exactement à
 * l'index composite déclaré — `orgId` croissant, `sentAt` décroissant.
 *
 * ## Pourquoi il n'y a pas de filtre par catégorie
 *
 * Firestore exige un index composite par combinaison de critères. Ajouter un
 * second filtre demanderait un second index, et une requête non couverte est
 * refusée à l'exécution avec un message qui ne dit pas lequel manque. Le
 * repository n'expose donc que ce qui est couvert ; l'écran filtre ce qu'il
 * affiche s'il en a besoin, sur une page déjà lue.
 *
 * ## `deliveredCount` peut être `null`, et ce n'est pas une absence
 *
 * À l'envoi, on sait ce que le service a **accepté**, pas ce qu'il a remis. Le
 * nombre de remises n'existe qu'après la relecture des reçus, une quinzaine de
 * minutes plus tard. `null` veut donc dire « pas encore su » — jamais « zéro »,
 * qui affirmerait qu'aucun message n'est arrivé. C'est à l'écran de rendre
 * cette distinction, et le repository se garde de la confondre en convertissant
 * la valeur.
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

import type { NotificationLog } from '@fl/types';

import { paginate, type FirestorePage } from '../pagination.js';
import { COLLECTIONS } from '../paths.js';

/** Envois par page. Un envoi occupe plusieurs lignes d'information. */
const NOTIFICATIONS_PAGE_SIZE = 25;

export interface NotificationRepository {
  /** Page de l'historique, du plus récent envoi au plus ancien. */
  list(
    orgId: string,
    cursor?: QueryDocumentSnapshot | null,
  ): Promise<FirestorePage<NotificationLog>>;
}

export function createNotificationRepository(db: Firestore): NotificationRepository {
  const notifications = collection(db, COLLECTIONS.notifications);

  function buildQuery(orgId: string): Query<DocumentData> {
    return query(notifications, where('orgId', '==', orgId), orderBy('sentAt', 'desc'));
  }

  function list(
    orgId: string,
    cursor: QueryDocumentSnapshot | null = null,
  ): Promise<FirestorePage<NotificationLog>> {
    return paginate<NotificationLog>({
      pageSize: NOTIFICATIONS_PAGE_SIZE,
      cursor,
      buildQuery: () => buildQuery(orgId),
      mapDocument: (snapshot) => ({
        ...(snapshot.data() as Omit<NotificationLog, 'id'>),
        id: snapshot.id,
      }),
    });
  }

  return { list };
}
