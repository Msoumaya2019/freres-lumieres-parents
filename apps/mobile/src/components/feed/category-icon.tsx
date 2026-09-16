/**
 * Icône d'une catégorie de publication.
 *
 * ## Pourquoi cette table vit ici et non dans `@fl/shared`
 *
 * Un nom de glyphe n'a de sens que pour **une** famille d'icônes. Le domaine ne
 * doit pas dépendre d'Ionicons, que l'interface web d'administration n'utilise
 * pas : `@fl/shared` est partagé par les deux applications.
 *
 * La table qui existait dans `@fl/shared` (`POST_CATEGORY_ICONS`) mélangeait des
 * noms Feather, Ionicons et MaterialCommunityIcons — `utensils`,
 * `calendar-heart`, `school`. Aucune famille installée ne les connaît tous, et
 * rien ne le signalait puisque le type était `string`. Une icône inconnue
 * s'affiche comme un carré vide : un défaut qu'on ne voit qu'à l'œil, sur
 * l'appareil, et seulement si on pense à regarder la bonne catégorie.
 *
 * Ici, `satisfies` fait vérifier **chaque nom à la compilation** contre
 * `Ionicons.glyphMap`. Une faute de frappe devient une erreur de build.
 */
import { Ionicons } from '@expo/vector-icons';

import type { PostCategory } from '@fl/types';

const CATEGORY_GLYPHS = {
  information: 'information-circle-outline',
  urgent: 'warning-outline',
  cantine: 'restaurant-outline',
  periscolaire: 'sunny-outline',
  travaux: 'construct-outline',
  sortie_scolaire: 'bus-outline',
  fcpe: 'people-outline',
  mairie: 'business-outline',
  evenement: 'calendar-outline',
  conseil_ecole: 'school-outline',
  autre: 'document-text-outline',
} as const satisfies Record<PostCategory, keyof typeof Ionicons.glyphMap>;

export interface CategoryIconProps {
  category: PostCategory;
  size?: number;
  color: string;
}

export function CategoryIcon({ category, size = 14, color }: CategoryIconProps): React.JSX.Element {
  return <Ionicons name={CATEGORY_GLYPHS[category]} size={size} color={color} />;
}
