/**
 * Données de référence : organisation, établissements, classes.
 *
 * Ces trois collections changent une fois par an et comptent quelques dizaines
 * de documents. Elles sont lues à l'inscription (pour proposer les
 * établissements et les classes) et à l'affichage du profil.
 *
 * ## Pourquoi le tri se fait côté client
 *
 * Trier par `orderBy` sur une seconde colonne exigerait un index composite
 * pour chaque combinaison de filtre. Sur des collections de cette taille, le
 * coût d'un tri en mémoire est nul, alors qu'un index de plus est une chose à
 * déployer, à maintenir et à expliquer. Le tri suit l'ordre pédagogique
 * (`CLASS_LEVELS`), pas l'ordre alphabétique : « CM1 » avant « CP » n'aurait
 * aucun sens pour un parent.
 *
 * ## Pourquoi ces lectures sont possibles avant validation du compte
 *
 * Les règles n'exigent qu'une session ouverte (`isSignedIn()`), pas un compte
 * actif : sans cela, personne ne pourrait s'inscrire, puisque le formulaire a
 * besoin de ces listes alors que le compte est encore `pending`. Aucune de ces
 * données n'est confidentielle — ce sont des noms d'écoles et de classes.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';

import { CLASS_LEVELS } from '@fl/shared';
import type { ClassId, Organization, School, SchoolClass, SchoolId } from '@fl/types';

import { toAppError } from '../errors.js';
import { COLLECTIONS, paths } from '../paths.js';

export interface ReferenceRepository {
  /** Lit une organisation. Renvoie `null` si elle n'existe pas. */
  getOrganization(orgId: string): Promise<Organization | null>;

  /**
   * Lit une organisation par son identifiant lisible (« fcpe-montmagny »).
   *
   * L'application mobile ne connaît que le *slug* configuré et a besoin de
   * l'identifiant de document pour rattacher un profil. Les deux coïncident
   * aujourd'hui parce que le script d'amorçage les crée identiques, mais rien
   * ne le garantit : les confondre ferait dépendre le rattachement d'une
   * coïncidence d'amorçage plutôt que du modèle de données.
   *
   * Renvoie `null` si aucune organisation ne porte ce slug — ce qui signale
   * presque toujours que les données de référence n'ont pas été installées.
   */
  getOrganizationBySlug(slug: string): Promise<Organization | null>;

  /** Établissements actifs, triés par nom. */
  listSchools(): Promise<School[]>;

  /**
   * Classes actives, triées par niveau puis par nom.
   *
   * Sans argument, renvoie **toutes** les classes de l'organisation. C'est la
   * forme utilisée par le formulaire d'inscription : un parent peut rattacher
   * un enfant à la maternelle et un autre à l'élémentaire, et les classes des
   * deux établissements doivent donc être disponibles simultanément. Avec
   * quelques dizaines de documents, une seule lecture groupée coûte moins
   * cher que deux lectures conditionnelles — et évite un aller-retour réseau
   * à chaque changement d'école.
   */
  listClasses(schoolId?: SchoolId): Promise<SchoolClass[]>;

  /** Lit une classe. Utilisé pour vérifier un rattachement existant. */
  getClass(classId: ClassId): Promise<SchoolClass | null>;
}

/** Rang d'un niveau dans l'ordre pédagogique. Les inconnus passent en dernier. */
function levelRank(level: string): number {
  const index = (CLASS_LEVELS as readonly string[]).indexOf(level);
  return index === -1 ? CLASS_LEVELS.length : index;
}

function compareByName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'fr');
}

export function createReferenceRepository(db: Firestore): ReferenceRepository {
  async function getOrganization(orgId: string): Promise<Organization | null> {
    try {
      const snapshot = await getDoc(doc(db, paths.organization(orgId)));
      if (!snapshot.exists()) return null;
      return { ...(snapshot.data() as Omit<Organization, 'id'>), id: snapshot.id };
    } catch (error) {
      throw toAppError(error);
    }
  }

  async function getOrganizationBySlug(slug: string): Promise<Organization | null> {
    try {
      // Requête sur un champ unique : aucun index composite n'est nécessaire.
      // La règle de lecture (`isSignedIn()`) ne contraint aucun champ, la
      // requête est donc acceptée par Firestore.
      const snapshot = await getDocs(
        query(collection(db, COLLECTIONS.organizations), where('slug', '==', slug), limit(1)),
      );

      const first = snapshot.docs[0];
      if (!first) return null;
      return { ...(first.data() as Omit<Organization, 'id'>), id: first.id };
    } catch (error) {
      throw toAppError(error);
    }
  }

  async function listSchools(): Promise<School[]> {
    try {
      // Les règles n'autorisent la lecture qu'aux comptes connectés, sans
      // contrainte de champ : la requête peut donc être non filtrée, et le
      // filtre `active` est appliqué ici pour rester tolérant à une école
      // désactivée.
      const snapshot = await getDocs(collection(db, COLLECTIONS.schools));

      return snapshot.docs
        .map((entry) => ({ ...(entry.data() as Omit<School, 'id'>), id: entry.id }))
        .filter((school) => school.active !== false)
        .sort(compareByName);
    } catch (error) {
      throw toAppError(error);
    }
  }

  async function listClasses(schoolId?: SchoolId): Promise<SchoolClass[]> {
    try {
      const classesCollection = collection(db, COLLECTIONS.classes);
      const snapshot = await getDocs(
        schoolId ? query(classesCollection, where('schoolId', '==', schoolId)) : classesCollection,
      );

      return snapshot.docs
        .map((entry) => ({ ...(entry.data() as Omit<SchoolClass, 'id'>), id: entry.id }))
        .sort((a, b) => levelRank(a.level) - levelRank(b.level) || compareByName(a, b));
    } catch (error) {
      throw toAppError(error);
    }
  }

  async function getClass(classId: ClassId): Promise<SchoolClass | null> {
    try {
      const snapshot = await getDoc(doc(db, paths.schoolClass(classId)));
      if (!snapshot.exists()) return null;
      return { ...(snapshot.data() as Omit<SchoolClass, 'id'>), id: snapshot.id };
    } catch (error) {
      throw toAppError(error);
    }
  }

  return { getOrganization, getOrganizationBySlug, listSchools, listClasses, getClass };
}
