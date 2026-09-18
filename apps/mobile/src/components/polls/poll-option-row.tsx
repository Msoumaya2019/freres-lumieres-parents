/**
 * Une réponse possible, telle qu'on la choisit.
 *
 * ## La marque dit le type de choix
 *
 * Un carré pour un choix multiple, un rond pour un choix unique. Ce n'est pas
 * décoratif : c'est ce qui indique, avant toute lecture, si l'on peut cocher
 * plusieurs lignes ou si cocher remplace la précédente. Un parent qui ne sait
 * pas lequel des deux s'applique hésite à répondre.
 *
 * ## Désactivée, mais lisible
 *
 * Quand le sondage est clos, ou que la modification du vote n'est pas
 * autorisée, la ligne reste **affichée** — c'est ce qui permet de relire la
 * réponse qu'on a donnée — mais n'est plus actionnable. La retirer laisserait
 * le parent devant une question sans ses réponses.
 *
 * Le rôle d'accessibilité suit le même partage : VoiceOver et TalkBack
 * annoncent « case à cocher » ou « bouton radio », et non « bouton », ce qui
 * ferait croire à une action immédiate.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/providers/theme-provider';

export interface PollOptionRowProps {
  label: string;
  selected: boolean;
  /** Sondage à choix multiple : la marque est une case, sinon un bouton radio. */
  multiple: boolean;
  /** Absent quand la ligne n'est pas actionnable (sondage clos, vote figé). */
  onPress?: (() => void) | undefined;
}

export function PollOptionRow({
  label,
  selected,
  multiple,
  onPress,
}: PollOptionRowProps): React.JSX.Element {
  const { theme } = useTheme();
  const actif = onPress !== undefined;

  return (
    <Pressable
      onPress={onPress}
      disabled={!actif}
      accessibilityRole={multiple ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected, disabled: !actif }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          // Toute cible tactile fait au moins 48 points, y compris ici : ces
          // lignes sont les boutons les plus touchés de l'écran.
          minHeight: theme.touchTarget,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
          borderRadius: theme.radii.md,
          borderWidth: 1,
          borderColor: selected ? theme.colors.primary : theme.colors.border,
          backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surface,
          opacity: actif ? (pressed ? 0.85 : 1) : 0.6,
        },
      ]}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: multiple ? theme.radii.sm : theme.radii.pill,
          borderWidth: 2,
          borderColor: selected ? theme.colors.primary : theme.colors.borderStrong,
          backgroundColor: selected ? theme.colors.primary : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? (
          <Ionicons name="checkmark" size={16} color={theme.colors.textOnPrimary} />
        ) : null}
      </View>

      <AppText variant="body" style={{ flex: 1 }}>
        {label}
      </AppText>
    </Pressable>
  );
}
