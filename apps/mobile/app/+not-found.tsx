import { Link, Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/providers/theme-provider';

export default function NotFoundScreen(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <>
      <Stack.Screen options={{ title: 'Page introuvable', headerShown: true }} />
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <AppText variant="title" align="center">
          Cet écran n’existe pas
        </AppText>
        <AppText
          variant="body"
          color="secondary"
          align="center"
          style={{ marginTop: theme.spacing.md }}
        >
          Le lien que vous avez suivi ne correspond à aucun contenu de l’application.
        </AppText>
        <Link href="/(tabs)" style={{ marginTop: theme.spacing.xl }}>
          <AppText variant="bodyStrong" color="accent">
            Revenir à l’accueil
          </AppText>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});
