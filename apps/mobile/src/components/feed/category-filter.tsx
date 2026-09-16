/**
 * Filtre par catégorie, en bandeau défilant.
 *
 * ## Pourquoi les catégories sont toutes affichées
 *
 * Une liste ne montrant que les catégories présentes dans la page chargée
 * serait instable : elle changerait à chaque page, et une catégorie absente de
 * la première page serait introuvable — donc impossible à sélectionner, alors
 * même qu'elle contient des publications. Les onze catégories sont donc
 * toujours proposées.
 *
 * Le filtre est appliqué par la **requête**, pas après coup (voir
 * `FeedParams.category`) : filtrer la page déjà chargée annoncerait « aucune
 * publication » alors que la page suivante en contient.
 */
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { POST_CATEGORIES, POST_CATEGORY_LABELS } from '@fl/shared';
import type { PostCategory } from '@fl/types';

import { AppText } from '@/components/ui';
import { useTheme } from '@/providers/theme-provider';

import { CategoryIcon } from './category-icon';

export interface CategoryFilterProps {
  /** Catégorie sélectionnée, ou `null` pour « Tout ». */
  value: PostCategory | null;
  onChange: (category: PostCategory | null) => void;
}

export function CategoryFilter({ value, onChange }: CategoryFilterProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Le bandeau est purement décoratif au défilement : les lecteurs d'écran
      // doivent parcourir les boutons, pas la zone de défilement.
      accessibilityRole="tablist"
      contentContainerStyle={{
        gap: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
        paddingRight: theme.spacing.lg,
      }}
    >
      <Chip label="Tout" selected={value === null} onPress={() => onChange(null)} />

      {POST_CATEGORIES.map((category) => (
        <Chip
          key={category}
          label={POST_CATEGORY_LABELS[category]}
          category={category}
          selected={value === category}
          // Retoucher la catégorie active la désélectionne : c'est le geste
          // attendu pour revenir au fil complet, sans chercher « Tout ».
          onPress={() => onChange(value === category ? null : category)}
        />
      ))}
    </ScrollView>
  );
}

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  category?: PostCategory;
}

function Chip({ label, selected, onPress, category }: ChipProps): React.JSX.Element {
  const { theme } = useTheme();

  const textColor = selected ? theme.colors.textOnPrimary : theme.colors.textSecondary;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        {
          minHeight: theme.touchTarget * 0.75,
          paddingHorizontal: theme.spacing.md,
          borderRadius: theme.radii.pill,
          backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceMuted,
          borderColor: theme.colors.border,
          gap: theme.spacing.xs,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {category ? <CategoryIcon category={category} size={14} color={textColor} /> : null}
      <AppText variant="caption" style={{ color: textColor }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
