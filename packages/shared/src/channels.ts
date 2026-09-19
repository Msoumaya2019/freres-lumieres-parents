/**
 * Canaux de discussion créés par défaut pour une organisation.
 *
 * ## Une seule liste
 *
 * Elle était recopiée dans l'écran Discussions de l'application, où elle
 * servait de maquette. Le script d'amorçage a besoin de la même : deux copies
 * divergeraient, et l'écran annoncerait un canal que la base ne contient pas.
 *
 * ## Les audiences ne sont pas écrites à la main
 *
 * `audienceKeys` sera calculé par `buildAudienceKeys` — la même fonction que
 * pour les publications et les sondages. Une clé écrite à la main pourrait
 * désigner une école inexistante, et seul un envoi de notification le
 * révélerait. Le canal de niveau retrouve son école par `schoolForLevel`, qui
 * lève si le niveau n'est ouvert nulle part.
 *
 * ## Aucun canal `fcpe`
 *
 * Un canal de type `fcpe` est invisible aux parents : les règles le refusent.
 * Aucun n'est créé ici, et en ajouter un est un acte délibéré.
 */
import type { Audience, ChannelType, ClassLevel } from '@fl/types';

import { SCHOOL_IDS, schoolForLevel } from './reference.js';

export interface DefaultChannel {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type: ChannelType;
  readonly audience: Audience;
  /** Ordre d'affichage dans la liste, à partir de 1. */
  readonly order: number;
}

/** Canal de niveau : l'école est retrouvée, jamais écrite. */
function levelChannel(level: ClassLevel, order: number): DefaultChannel {
  return {
    id: `niveau-${level.toLowerCase()}`,
    name: level,
    description: `Parents des ${level}`,
    type: 'level',
    audience: { type: 'level', schoolId: schoolForLevel(level).id, level },
    order,
  };
}

/** Canal thématique, ouvert à tous les parents de l'organisation. */
function themeChannel(
  id: string,
  name: string,
  description: string,
  order: number,
): DefaultChannel {
  return { id, name, description, type: 'theme', audience: { type: 'all' }, order };
}

/**
 * Les treize canaux, dans leur ordre d'affichage.
 *
 * La maternelle n'a pas de canal par niveau : celui de son école la couvre, et
 * trois canaux de plus pour trois classes seraient du bruit.
 */
export const DEFAULT_CHANNELS: readonly DefaultChannel[] = [
  {
    id: 'general',
    name: 'Général',
    description: 'Échanges tous publics',
    type: 'general',
    audience: { type: 'all' },
    order: 1,
  },
  {
    id: 'ecole-maternelle',
    name: 'Maternelle',
    description: 'Parents de la maternelle',
    type: 'school',
    audience: { type: 'school', schoolId: SCHOOL_IDS.maternelle },
    order: 2,
  },
  {
    id: 'ecole-elementaire',
    name: 'Élémentaire',
    description: 'Parents de l’élémentaire',
    type: 'school',
    audience: { type: 'school', schoolId: SCHOOL_IDS.elementaire },
    order: 3,
  },
  levelChannel('CP', 4),
  levelChannel('CE1', 5),
  levelChannel('CE2', 6),
  levelChannel('CM1', 7),
  levelChannel('CM2', 8),
  themeChannel('cantine', 'Cantine', 'Menus et retours sur la cantine', 9),
  themeChannel('periscolaire', 'Périscolaire', 'Accueil du matin et du soir', 10),
  themeChannel('entraide', 'Entraide', 'Coup de main entre parents', 11),
  themeChannel('objets-perdus', 'Objets perdus', 'Trouvé ou perdu à l’école', 12),
  themeChannel('sorties', 'Sorties et événements', 'Organisation des sorties', 13),
];
