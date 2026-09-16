/**
 * Écran affiché lorsque la configuration Firebase est incomplète.
 *
 * C'est le tout premier écran que verra une personne qui clone le dépôt sans
 * avoir rempli son fichier `.env.local`. Il doit donc être parfaitement
 * explicite : quoi faire, où trouver les valeurs, et pourquoi ce n'est pas
 * grave de les partager.
 */
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, Card } from '@/components/ui';
import { useTheme } from '@/providers/theme-provider';
import { missingConfigMessage } from '@/lib/env';

export default function ConfigurationScreen(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.flex, { padding: theme.spacing.xl, gap: theme.spacing.lg }]}>
        <AppText variant="title">Configuration requise</AppText>

        <AppText variant="body" color="secondary">
          L’application ne peut pas démarrer : les variables d’environnement Firebase sont absentes.
        </AppText>

        <Card>
          <AppText variant="label" color="muted" style={{ marginBottom: theme.spacing.sm }}>
            À exécuter
          </AppText>
          <AppText variant="body">1. Copiez `.env.example` en `apps/mobile/.env.local`</AppText>
          <AppText variant="body" style={{ marginTop: theme.spacing.xs }}>
            2. Remplissez les variables ci-dessous
          </AppText>
          <AppText variant="body" style={{ marginTop: theme.spacing.xs }}>
            3. Relancez avec `npm run dev:mobile`
          </AppText>
        </Card>

        <Card>
          <AppText variant="label" color="muted" style={{ marginBottom: theme.spacing.sm }}>
            Variables manquantes
          </AppText>
          <AppText variant="caption">{missingConfigMessage}</AppText>
        </Card>

        <Card>
          <AppText variant="label" color="muted" style={{ marginBottom: theme.spacing.sm }}>
            Où les trouver
          </AppText>
          <AppText variant="body" color="secondary">
            Console Firebase → Paramètres du projet → Vos applications → Configuration du SDK.
          </AppText>
        </Card>

        <AppText variant="caption" color="muted">
          Ces valeurs ne sont pas des secrets : elles finissent de toute façon dans l’application
          distribuée. La sécurité repose sur les règles Firestore et les Cloud Functions.
        </AppText>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
