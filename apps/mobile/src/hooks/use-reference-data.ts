/**
 * Chargement des données de référence (organisation, écoles, classes).
 *
 * ## Pourquoi un état de chargement dérivé, et non stocké
 *
 * Le réflexe serait d'écrire `setLoading(true)` au début de l'effet. C'est
 * exactement ce que la règle `react-hooks/set-state-in-effect` interdit, et à
 * raison : cet appel provoque un rendu supplémentaire avant même que la
 * requête ne parte, et il est faux pendant le rendu initial.
 *
 * Ici, « en cours de chargement » se **déduit** : le résultat mémorisé porte
 * l'empreinte de la demande à laquelle il répond. Tant que cette empreinte
 * diffère de la demande courante, le résultat n'est pas encore arrivé. Aucun
 * état intermédiaire à maintenir, donc aucune incohérence possible.
 *
 * ## Pourquoi le chargement est conditionné
 *
 * Les règles Firestore n'autorisent la lecture des écoles et des classes
 * qu'aux utilisateurs **connectés** — c'est une nécessité du parcours
 * d'inscription, où le compte existe déjà en `pending` lorsque le formulaire
 * affiche les listes. Avant la connexion, la requête serait refusée : on ne
 * la lance donc pas. D'où le paramètre `enabled`.
 *
 * ## Pourquoi l'organisation est résolue par son slug
 *
 * L'application ne connaît que le slug configuré
 * (`EXPO_PUBLIC_DEFAULT_ORG_SLUG`) et a besoin de l'**identifiant de document**
 * pour rattacher un profil. Les deux coïncident aujourd'hui parce que le
 * script d'amorçage les crée identiques — mais les confondre ferait dépendre
 * le rattachement d'une coïncidence d'amorçage plutôt que du modèle de
 * données.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  appError,
  createReferenceRepository,
  isAppError,
  toAppError,
  type ReferenceRepository,
} from '@fl/firebase';
import type { AppError, Organization, School, SchoolClass } from '@fl/types';

import { defaultOrgSlug } from '@/lib/env';
import { initializeFirebase } from '@/lib/firebase';

/** État d'une donnée chargée à distance. */
export type AsyncData<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: T }
  | { readonly status: 'error'; readonly error: AppError };

export interface ReferenceData {
  /** Organisation propriétaire des contenus, résolue depuis le slug configuré. */
  readonly organization: Organization;
  readonly schools: readonly School[];
  readonly classes: readonly SchoolClass[];
}

export interface ReferenceDataResult {
  readonly data: AsyncData<ReferenceData>;
  /** Relance le chargement après un échec réseau. */
  retry: () => void;
}

/**
 * Récupère le dépôt de référence, ou `null` si Firebase n'est pas configuré.
 *
 * `initializeFirebase()` est idempotent : chaque écran peut l'appeler sans
 * créer une seconde application Firebase.
 */
function useReferenceRepository(): ReferenceRepository | null {
  const [firebase] = useState(() => initializeFirebase());

  return useMemo<ReferenceRepository | null>(
    () => (firebase ? createReferenceRepository(firebase.db) : null),
    [firebase],
  );
}

/**
 * Résout l'organisation de l'application.
 *
 * Une absence de correspondance ne signifie pas « mauvaise configuration »
 * mais « données de référence non installées sur cet environnement » — un
 * message explicite évite de chercher au mauvais endroit.
 */
async function resolveOrganization(repository: ReferenceRepository): Promise<Organization> {
  if (!defaultOrgSlug) {
    throw appError(
      'failed-precondition',
      'Aucune organisation n’est configurée pour cette application ' +
        '(EXPO_PUBLIC_DEFAULT_ORG_SLUG est absent).',
    );
  }

  const organization = await repository.getOrganizationBySlug(defaultOrgSlug);

  if (!organization) {
    throw appError(
      'not-found',
      `Aucune organisation ne correspond à « ${defaultOrgSlug} ». ` +
        'Les données de référence n’ont probablement pas été installées sur cet environnement ' +
        '(npm run seed:reference).',
    );
  }

  return organization;
}

export function useReferenceData(enabled: boolean): ReferenceDataResult {
  const repository = useReferenceRepository();

  const [loaded, setLoaded] = useState<AsyncData<ReferenceData> | null>(null);
  // Incrémenté à chaque nouvelle tentative : c'est ce qui relance l'effet,
  // `loaded` n'étant volontairement pas une dépendance.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !repository) return;

    let cancelled = false;

    void (async () => {
      try {
        // L'organisation d'abord : sans elle, les écoles et les classes
        // n'auraient pas de rattachement à proposer.
        const organization = await resolveOrganization(repository);

        // Écoles et classes ensemble, en une seule fois. Le formulaire a
        // besoin des classes de tous les établissements dès qu'un parent
        // rattache plusieurs enfants — un à la maternelle, un à l'élémentaire.
        // Sur quelques dizaines de documents, une lecture groupée coûte moins
        // cher que deux lectures conditionnelles.
        const [schools, classes] = await Promise.all([
          repository.listSchools(),
          repository.listClasses(),
        ]);

        if (cancelled) return;
        setLoaded({ status: 'ready', data: { organization, schools, classes } });
      } catch (error) {
        if (cancelled) return;
        // `isAppError` d'abord : les dépôts lèvent déjà des erreurs
        // applicatives, et les repasser par `toAppError` perdrait la finesse
        // du code d'origine.
        setLoaded({ status: 'error', error: isAppError(error) ? error : toAppError(error) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, repository, attempt]);

  const retry = useCallback(() => {
    setLoaded(null);
    setAttempt((value) => value + 1);
  }, []);

  const data: AsyncData<ReferenceData> =
    !enabled || !repository ? { status: 'idle' } : (loaded ?? { status: 'loading' });

  return { data, retry };
}

/** Classes d'un établissement, dans l'ordre pédagogique fourni par le dépôt. */
export function classesOfSchool(
  reference: ReferenceData | null,
  schoolId: string | null,
): readonly SchoolClass[] {
  if (!reference || !schoolId) return [];
  return reference.classes.filter((schoolClass) => schoolClass.schoolId === schoolId);
}

/**
 * Retrouve une classe par son identifiant.
 *
 * Sert à dériver le niveau et l'année scolaire depuis la classe choisie,
 * plutôt que de les redemander au parent : trois réponses à faire concorder
 * finissent toujours par se contredire.
 */
export function findClass(
  reference: ReferenceData | null,
  classId: string | null,
): SchoolClass | null {
  if (!reference || !classId) return null;
  return reference.classes.find((schoolClass) => schoolClass.id === classId) ?? null;
}
