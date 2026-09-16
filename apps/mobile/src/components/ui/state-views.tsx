/**
 * Vues d'état génériques : chargement, liste vide, erreur.
 *
 * Chaque écran de l'application doit traiter ces trois états. Les regrouper
 * ici garantit qu'ils sont tous cohérents visuellement et qu'aucun écran
 * n'affiche un écran blanc silencieux — ce qui est la première source
 * d'incompréhension pour un utilisateur peu à l'aise avec le numérique.
 */
import { ActivityIndicator, View } from 'react-native';

import { AppText, Button } from './index';
import { useTheme } from '@/providers/theme-provider';

/** Indicateur de chargement centré, avec message optionnel. */
export function LoadingView({ message }: { message?: string }): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.spacing.xl,
        gap: theme.spacing.lg,
      }}
      accessibilityRole="progressbar"
      accessibilityLabel={message ?? 'Chargement en cours'}
    >
      <ActivityIndicator size="large" color={theme.colors.primary} />
      {message ? (
        <AppText variant="body" color="secondary" align="center">
          {message}
        </AppText>
      ) : null}
    </View>
  );
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** Icône ou illustration. */
  icon?: React.ReactNode;
  /** Bouton d'action facultatif. */
  actionLabel?: string;
  onAction?: () => void;
}

/** État vide : explique pourquoi il n'y a rien, et quoi faire ensuite. */
export function EmptyState({
  title,
  description,
  icon,
  actionLabel,
  onAction,
}: EmptyStateProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.spacing.xl,
        gap: theme.spacing.md,
      }}
    >
      {icon}
      <AppText variant="subtitle" align="center">
        {title}
      </AppText>
      {description ? (
        <AppText variant="body" color="secondary" align="center">
          {description}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant="secondary" fullWidth={false} />
      ) : null}
    </View>
  );
}

export interface ErrorStateProps {
  /** Message lisible, déjà traduit en français. */
  message: string;
  /** Détail technique, affiché uniquement en développement. */
  technicalDetail?: string;
  onRetry?: () => void;
}

/** État d'erreur : jamais de message technique brut à l'utilisateur. */
export function ErrorState({
  message,
  technicalDetail,
  onRetry,
}: ErrorStateProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.spacing.xl,
        gap: theme.spacing.md,
      }}
      accessibilityRole="alert"
    >
      <AppText variant="subtitle" align="center" color="danger">
        Un problème est survenu
      </AppText>
      <AppText variant="body" color="secondary" align="center">
        {message}
      </AppText>

      {technicalDetail && __DEV__ ? (
        <AppText variant="caption" color="muted" align="center">
          {technicalDetail}
        </AppText>
      ) : null}

      {onRetry ? (
        <Button label="Réessayer" onPress={onRetry} variant="secondary" fullWidth={false} />
      ) : null}
    </View>
  );
}
