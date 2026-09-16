import { Stack } from 'expo-router';

import { useTheme } from '@/providers/theme-provider';

/** Layout du groupe « compte non actif » (en attente, suspendu, refusé). */
export default function PendingLayout(): React.JSX.Element {
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
