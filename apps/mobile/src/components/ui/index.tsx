/**
 * Composants de base réutilisables.
 *
 * Règles appliquées partout dans l'application :
 *  - toute cible tactile fait au moins 48 points de haut ;
 *  - la mise à l'échelle système de la police reste active (Dynamic Type sur
 *    iOS, taille de police sur Android) — c'est indispensable pour les
 *    parents qui agrandissent le texte ;
 *  - chaque élément interactif porte un libellé d'accessibilité en français,
 *    lu par VoiceOver et TalkBack ;
 *  - les couleurs viennent exclusivement des jetons de thème, jamais de
 *    valeurs écrites en dur dans un écran.
 */
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { BadgeStyle } from '@fl/shared';

import { useTheme } from '@/providers/theme-provider';

// ---------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------

export type TextVariant =
  'display' | 'title' | 'subtitle' | 'body' | 'bodyStrong' | 'caption' | 'label';

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  /** Couleur sémantique. Par défaut, la couleur de texte principale. */
  color?: 'primary' | 'secondary' | 'muted' | 'accent' | 'danger' | 'success' | 'onPrimary';
  align?: 'left' | 'center' | 'right';
}

export function AppText({
  variant = 'body',
  color = 'primary',
  align = 'left',
  style,
  ...rest
}: AppTextProps): React.JSX.Element {
  const { theme } = useTheme();

  const colorValue = {
    primary: theme.colors.textPrimary,
    secondary: theme.colors.textSecondary,
    muted: theme.colors.textMuted,
    accent: theme.colors.accent,
    danger: theme.colors.danger,
    success: theme.colors.success,
    onPrimary: theme.colors.textOnPrimary,
  }[color];

  const variantStyle: TextStyle = {
    display: {
      fontSize: theme.typography.size.display,
      lineHeight: theme.typography.size.display * theme.typography.lineHeight.tight,
      fontWeight: theme.typography.weight.bold,
    },
    title: {
      fontSize: theme.typography.size.xl,
      lineHeight: theme.typography.size.xl * theme.typography.lineHeight.tight,
      fontWeight: theme.typography.weight.bold,
    },
    subtitle: {
      fontSize: theme.typography.size.lg,
      lineHeight: theme.typography.size.lg * theme.typography.lineHeight.normal,
      fontWeight: theme.typography.weight.semibold,
    },
    body: {
      fontSize: theme.typography.size.md,
      lineHeight: theme.typography.size.md * theme.typography.lineHeight.normal,
      fontWeight: theme.typography.weight.regular,
    },
    bodyStrong: {
      fontSize: theme.typography.size.md,
      lineHeight: theme.typography.size.md * theme.typography.lineHeight.normal,
      fontWeight: theme.typography.weight.semibold,
    },
    caption: {
      fontSize: theme.typography.size.sm,
      lineHeight: theme.typography.size.sm * theme.typography.lineHeight.normal,
      fontWeight: theme.typography.weight.regular,
    },
    label: {
      fontSize: theme.typography.size.sm,
      lineHeight: theme.typography.size.sm * theme.typography.lineHeight.normal,
      fontWeight: theme.typography.weight.semibold,
      letterSpacing: 0.3,
      textTransform: 'uppercase' as const,
    },
  }[variant];

  return (
    <Text
      // `allowFontScaling` reste à true : c'est ce qui permet à un parent
      // ayant agrandi le texte de son téléphone de lire confortablement.
      allowFontScaling
      style={[variantStyle, { color: colorValue, textAlign: align }, style]}
      {...rest}
    />
  );
}

// ---------------------------------------------------------------------------
// Écran
// ---------------------------------------------------------------------------

export interface ScreenProps {
  children: React.ReactNode;
  /** Rend le contenu défilable. */
  scroll?: boolean;
  /** Ajoute une marge horizontale standard. */
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Bords à protéger. Les onglets gèrent déjà le bas. */
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}

export function Screen({
  children,
  scroll = false,
  padded = true,
  style,
  edges = ['top'],
}: ScreenProps): React.JSX.Element {
  const { theme } = useTheme();
  const padding = padded ? { paddingHorizontal: theme.spacing.lg } : undefined;

  if (scroll) {
    return (
      <SafeAreaView
        edges={edges}
        style={[styles.flex, { backgroundColor: theme.colors.background }]}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[padding, { paddingBottom: theme.spacing.xxxl }, style]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.flex, padding, style]}>{children}</View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Carte
// ---------------------------------------------------------------------------

export interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Élément affiché à droite du titre (badge, date…). */
  onPress?: () => void;
  accessibilityLabel?: string;
}

export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
}: CardProps): React.JSX.Element {
  const { theme } = useTheme();

  const cardStyle: StyleProp<ViewStyle> = [
    {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      padding: theme.spacing.lg,
      shadowColor: theme.colors.shadow,
      shadowOpacity: 1,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    style,
  ];

  if (!onPress) {
    return <View style={cardStyle}>{children}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [cardStyle, pressed && { opacity: 0.85 }]}
    >
      {children}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Bouton
// ---------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: ButtonVariant;
  /** Affiche un indicateur et désactive les interactions. */
  loading?: boolean;
  /** Icône optionnelle, affichée avant le libellé. */
  icon?: React.ReactNode;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  variant = 'primary',
  loading = false,
  icon,
  fullWidth = true,
  disabled,
  style,
  ...rest
}: ButtonProps): React.JSX.Element {
  const { theme } = useTheme();
  const isDisabled = disabled === true || loading;

  const background = {
    primary: theme.colors.primary,
    secondary: theme.colors.primarySoft,
    ghost: 'transparent',
    danger: theme.colors.danger,
  }[variant];

  const textColor = {
    primary: theme.colors.textOnPrimary,
    secondary: theme.colors.primary,
    ghost: theme.colors.primary,
    danger: theme.colors.textOnPrimary,
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        {
          minHeight: theme.touchTarget,
          paddingHorizontal: theme.spacing.lg,
          borderRadius: theme.radii.md,
          backgroundColor: background,
          borderWidth: variant === 'ghost' ? StyleSheet.hairlineWidth : 0,
          borderColor: theme.colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: theme.spacing.sm,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <>
          {icon}
          <AppText variant="bodyStrong" style={{ color: textColor }}>
            {label}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Étiquette
// ---------------------------------------------------------------------------

export interface BadgeProps {
  label: string;
  /** Couleur issue de `BADGE_COLORS` ou style personnalisé. */
  tone?: BadgeStyle;
  icon?: React.ReactNode;
}

export function Badge({ label, tone, icon }: BadgeProps): React.JSX.Element {
  const { theme } = useTheme();
  const resolved: BadgeStyle = tone ?? {
    color: theme.colors.textSecondary,
    background: theme.colors.surfaceMuted,
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
        borderRadius: theme.radii.pill,
        backgroundColor: resolved.background,
        alignSelf: 'flex-start',
      }}
    >
      {icon}
      <Text
        allowFontScaling
        style={{
          color: resolved.color,
          fontSize: theme.typography.size.xs,
          fontWeight: theme.typography.weight.semibold,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Séparateur
// ---------------------------------------------------------------------------

export function Divider({ style }: { style?: StyleProp<ViewStyle> }): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      style={[{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border }, style]}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
