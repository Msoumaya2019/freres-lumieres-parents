import { Stack } from 'expo-router';

import { useTheme } from '@/providers/theme-provider';

/**
 * Layout du groupe d'authentification.
 * En-tête masqué : chaque écran dessine son propre titre, ce qui permet de
 * soigner la mise en page d'accueil (logo, message chaleureux).
 */
export default function AuthLayout(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    />
  );
}
