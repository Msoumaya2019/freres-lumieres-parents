/**
 * Repository des utilisateurs.
 *
 * Seule couche autorisée à parler à la collection `users`. Les écrans et les
 * hooks passent par ces fonctions, jamais par le SDK directement.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';

import type {
  ChildProfile,
  ClassId,
  ClassLevel,
  OrganizationId,
  SchoolId,
  UserConsents,
  UserProfile,
  UserStatus,
} from '@fl/types';

import { invalidArgument, permissionDenied, toAppError } from '../errors.js';
import { paginate, type FirestorePage } from '../pagination.js';
import { COLLECTIONS, paths } from '../paths.js';

/** Taille de page de la liste d'administration. */
const USERS_PAGE_SIZE = 25;

/** Rattachement d'un enfant, tel que saisi dans le formulaire d'inscription. */
export interface ChildRegistrationInput {
  firstName?: string;
  schoolId: SchoolId;
  level: ClassLevel;
  classId?: ClassId;
  academicYear: string;
}

/**
 * Données d'une inscription.
 *
 * Le rôle et le statut n'y figurent pas : ils sont fixés par le dépôt à
 * `parent` et `pending`. Les accepter en entrée laisserait croire qu'un client
 * peut choisir son niveau de droits — ce que les règles refusent de toute
 * façon.
 */
export interface RegistrationInput {
  firstName: string;
  lastName: string;
  email: string;
  orgId: OrganizationId;
  children: readonly ChildRegistrationInput[];
  consents: UserConsents;
}

export interface UserRepository {
  /** Lit un profil. Renvoie `null` s'il n'existe pas. */
  get(uid: string): Promise<UserProfile | null>;

  /**
   * Crée le profil d'un parent qui vient de s'inscrire, ainsi que le
   * rattachement de ses enfants.
   *
   * L'écriture est **groupée** : le profil et les enfants sont validés
   * ensemble, ou pas du tout. Un profil sans enfant laisserait l'utilisateur
   * dans un état que le formulaire ne permet pas d'atteindre, et que la
   * validation administrative ne saurait pas interpréter.
   *
   * Le compte est créé en `pending` : il ne verra rien tant qu'un membre de la
   * FCPE ne l'aura pas validé.
   */
  createAccount(uid: string, input: RegistrationInput): Promise<void>;

  /**
   * Observe un profil en temps réel.
   *
   * C'est le **seul** listener temps réel autorisé en dehors de la
   * messagerie : il permet de réagir immédiatement à une validation, une
   * suspension ou un changement de rôle, sans interrogation périodique.
   */
  watch(
    uid: string,
    onChange: (user: UserProfile | null) => void,
    onError?: (error: unknown) => void,
  ): Unsubscribe;

  /** Met à jour les champs modifiables par l'utilisateur lui-même. */
  updateOwnProfile(
    uid: string,
    data: Partial<Pick<UserProfile, 'firstName' | 'lastName' | 'phone'>>,
  ): Promise<void>;

  /** Met à jour les préférences de notification. */
  updateNotificationPrefs(uid: string, prefs: UserProfile['notificationPrefs']): Promise<void>;

  /** Enregistre l'activité. Appelée au plus une fois par jour par l'application. */
  touchLastSeen(uid: string): Promise<void>;

  /** Liste les enfants déclarés par un parent. */
  listChildren(uid: string): Promise<ChildProfile[]>;

  /**
   * File de validation de l'administration : comptes d'une organisation
   * ayant un statut donné, du plus récent au plus ancien.
   */
  listByStatus(
    orgId: string,
    status: UserStatus,
    cursor?: QueryDocumentSnapshot | null,
  ): Promise<FirestorePage<UserProfile>>;
}

/** Dédoublonne en conservant l'ordre d'apparition. */
function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function createUserRepository(db: Firestore): UserRepository {
  const usersCollection = collection(db, COLLECTIONS.users);

  function mapUser(snapshot: QueryDocumentSnapshot): UserProfile {
    return { ...(snapshot.data() as Omit<UserProfile, 'id'>), id: snapshot.id };
  }

  async function get(uid: string): Promise<UserProfile | null> {
    try {
      const snapshot = await getDoc(doc(db, paths.user(uid)));
      if (!snapshot.exists()) return null;
      return { ...(snapshot.data() as Omit<UserProfile, 'id'>), id: snapshot.id };
    } catch (error) {
      throw toAppError(error);
    }
  }

  async function createAccount(uid: string, input: RegistrationInput): Promise<void> {
    if (input.children.length === 0) {
      throw invalidArgument('Renseignez au moins un enfant.');
    }

    try {
      const batch = writeBatch(db);

      // Dénormalisation : ces listes sont recopiées depuis les enfants pour
      // permettre le ciblage des notifications sans lire la sous-collection.
      // La Cloud Function `rebuildAudienceKeysForUser` les recalcule et
      // remplace ces valeurs — ce n'est qu'une première approximation.
      const schoolIds = unique(input.children.map((child) => child.schoolId));
      const levels = unique(input.children.map((child) => child.level));
      const classIds = unique(
        input.children
          .map((child) => child.classId)
          .filter((classId): classId is ClassId => Boolean(classId)),
      );

      batch.set(doc(db, paths.user(uid)), {
        id: uid,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        // Rôle et statut sont figés ici, et les règles Firestore refusent
        // toute valeur différente à la création.
        role: 'parent',
        status: 'pending',
        orgId: input.orgId,
        orgIds: [input.orgId],
        schoolIds,
        levels,
        classIds,
        // Volontairement vide : les clés d'audience sont calculées par le
        // serveur, jamais par le client. Un tableau vide est honnête — il
        // signifie « pas encore calculé » — et ne donne accès à rien.
        audienceKeys: [],
        notificationPrefs: { enabled: true, disabledCategories: [] },
        consents: input.consents,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      for (const child of input.children) {
        // Identifiant généré côté client : le lot doit être complet avant
        // d'être envoyé, on ne peut donc pas attendre une réponse du serveur.
        const childRef = doc(collection(db, paths.userChildren(uid)));

        batch.set(childRef, {
          id: childRef.id,
          // Le prénom reste facultatif, et n'est jamais transmis à personne
          // d'autre qu'au parent lui-même.
          ...(child.firstName ? { firstName: child.firstName } : {}),
          schoolId: child.schoolId,
          level: child.level,
          ...(child.classId ? { classId: child.classId } : {}),
          academicYear: child.academicYear,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();
    } catch (error) {
      throw toAppError(error);
    }
  }

  function watch(
    uid: string,
    onChange: (user: UserProfile | null) => void,
    onError?: (error: unknown) => void,
  ): Unsubscribe {
    return onSnapshot(
      doc(db, paths.user(uid)),
      (snapshot) => {
        onChange(
          snapshot.exists()
            ? { ...(snapshot.data() as Omit<UserProfile, 'id'>), id: snapshot.id }
            : null,
        );
      },
      (error) => onError?.(toAppError(error)),
    );
  }

  async function updateOwnProfile(
    uid: string,
    data: Partial<Pick<UserProfile, 'firstName' | 'lastName' | 'phone'>>,
  ): Promise<void> {
    try {
      await updateDoc(doc(db, paths.user(uid)), { ...data, updatedAt: serverTimestamp() });
    } catch (error) {
      throw toAppError(error);
    }
  }

  async function updateNotificationPrefs(
    uid: string,
    prefs: UserProfile['notificationPrefs'],
  ): Promise<void> {
    try {
      await updateDoc(doc(db, paths.user(uid)), {
        notificationPrefs: prefs,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      throw toAppError(error);
    }
  }

  async function touchLastSeen(uid: string): Promise<void> {
    try {
      await updateDoc(doc(db, paths.user(uid)), { lastSeenAt: serverTimestamp() });
    } catch (error) {
      throw toAppError(error);
    }
  }

  async function listChildren(uid: string): Promise<ChildProfile[]> {
    try {
      const snapshot = await getDocs(collection(db, paths.userChildren(uid)));
      return snapshot.docs.map(
        (child) =>
          ({ ...(child.data() as Omit<ChildProfile, 'id'>), id: child.id }) as ChildProfile,
      );
    } catch (error) {
      throw toAppError(error);
    }
  }

  function listByStatus(
    orgId: string,
    status: UserStatus,
    cursor: QueryDocumentSnapshot | null = null,
  ): Promise<FirestorePage<UserProfile>> {
    return paginate<UserProfile>({
      pageSize: USERS_PAGE_SIZE,
      cursor,
      buildQuery: () =>
        query(
          usersCollection,
          where('orgId', '==', orgId),
          where('status', '==', status),
          orderBy('createdAt', 'desc'),
        ),
      mapDocument: mapUser,
    });
  }

  return {
    get,
    createAccount,
    watch,
    updateOwnProfile,
    updateNotificationPrefs,
    touchLastSeen,
    listChildren,
    listByStatus,
  };
}

/**
 * Garde-fou utilisé par la couche services avant toute action sensible.
 * Complète la vérification des règles, ne la remplace pas.
 */
export function assertActive(user: UserProfile | null): asserts user is UserProfile {
  if (!user || user.status !== 'active') {
    throw permissionDenied('Votre compte doit être validé pour effectuer cette action.');
  }
}
