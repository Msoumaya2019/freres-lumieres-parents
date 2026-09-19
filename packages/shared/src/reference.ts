/**
 * Données de référence de l'organisation : établissements, niveaux, classes.
 *
 * ## Pourquoi elles vivent ici, et pas dans le script
 *
 * Elles étaient dans `scripts/seed-reference-data.mjs`. Or les canaux de
 * discussion par défaut s'adressent à une **école** ou à un **niveau**, et
 * doivent donc les désigner. Deux tables recopiées divergent en silence : un
 * canal de niveau viserait une école qui n'existe pas, et rien ne le
 * signalerait — l'écran afficherait un canal que personne ne reçoit.
 *
 * Une seule source, donc, lue par le script d'amorçage **et** par les canaux.
 * `channels.test.ts` vérifie que chaque canal résout contre ce fichier.
 */
import type { ClassLevel, SchoolLevel } from '@fl/types';

export interface ReferenceSchool {
  readonly id: string;
  readonly name: string;
  readonly level: SchoolLevel;
  readonly levels: readonly { readonly code: ClassLevel; readonly label: string }[];
}

/**
 * Identifiants des établissements.
 *
 * Nommés, et non écrits en clair dans les canaux : c'est ce qui permet de
 * renommer un identifiant en un seul endroit.
 */
export const SCHOOL_IDS = {
  maternelle: 'maternelle-freres-lumieres',
  elementaire: 'elementaire-freres-lumieres',
} as const;

export const REFERENCE_ORG = {
  name: 'FCPE — Écoles Frères Lumières',
  city: 'Montmagny',
  settings: {
    // Conservation des signalements clos : un an couvre une année scolaire.
    reportRetentionDays: 365,
    // Nombre de signalements distincts au-delà duquel on propose d'en faire un
    // sujet collectif plutôt que de traiter les cas isolément.
    collectiveIssueThreshold: 5,
  },
  active: true,
} as const;

export const REFERENCE_SCHOOLS: readonly ReferenceSchool[] = [
  {
    id: SCHOOL_IDS.maternelle,
    name: 'École maternelle Frères Lumières',
    level: 'maternelle',
    levels: [
      { code: 'PS', label: 'Petite section' },
      { code: 'MS', label: 'Moyenne section' },
      { code: 'GS', label: 'Grande section' },
    ],
  },
  {
    id: SCHOOL_IDS.elementaire,
    name: 'École élémentaire Frères Lumières',
    level: 'elementaire',
    levels: [
      { code: 'CP', label: 'CP' },
      { code: 'CE1', label: 'CE1' },
      { code: 'CE2', label: 'CE2' },
      { code: 'CM1', label: 'CM1' },
      { code: 'CM2', label: 'CM2' },
    ],
  },
];

/** Identifiant de classe déterministe : « elementaire-freres-lumieres-ce1 ». */
export function classIdFor(schoolId: string, level: ClassLevel): string {
  return `${schoolId}-${level.toLowerCase()}`;
}

/**
 * École qui ouvre ce niveau.
 *
 * Lève plutôt que de rendre `undefined` : un canal de niveau sans école est une
 * donnée incohérente, et une clé d'audience vide enverrait la notification à
 * personne sans que rien ne le dise. L'échec est immédiat, à l'import.
 */
export function schoolForLevel(level: ClassLevel): ReferenceSchool {
  const school = REFERENCE_SCHOOLS.find((entry) =>
    entry.levels.some((offered) => offered.code === level),
  );
  if (!school) {
    throw new Error(`Aucune école n’ouvre le niveau ${level} : voir REFERENCE_SCHOOLS.`);
  }
  return school;
}
