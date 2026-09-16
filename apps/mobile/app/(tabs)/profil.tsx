/**
 * Profil.
 *
 * Écran partiellement fonctionnel dès la Phase 1 : affichage du profil,
 * choix de l'apparence (clair / sombre / système) et déconnexion.
 *
 * Les préférences de notification et la gestion des enfants sont branchées
 * respectivement en Phase 5 et en Phase 2.
 */
import { Ionicons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { USER_ROLE_LABELS, USER_STATUS_BADGES, USER_STATUS_LABELS } from '@fl/shared';

import { AppText, Badge, Button, Card, Divider } from '@/components/ui';
import { useAuth } from '@/providers/auth-provider';
import { useTheme, type ThemePreference } from '@/providers/theme-provider';

const APPEARANCE_OPTIONS: {
  value: ThemePreference;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { value: 'system', label: 'Système', icon: 'phone-portrait-outline' },
  { value: 'light', label: 'Clair', icon: 'sunny-outline' },
  { value: 'dark', label: 'Sombre', icon: 'moon-outline' },
];

export default function ProfileScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { profile, signOut } = useAuth();

  const status = profile?.status ?? 'pending';

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
    >
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}>
        <AppText variant="display">Profil</AppText>

        <Card style={{ gap: theme.spacing.sm }}>
          <AppText variant="subtitle">
            {profile ? `${profile.firstName} ${profile.lastName}` : 'Chargement…'}
          </AppText>
          <AppText variant="body" color="secondary">
            {profile?.email ?? ''}
          </AppText>
          <View
            style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.xs }}
          >
            <Badge label={USER_STATUS_LABELS[status]} tone={USER_STATUS_BADGES[status]} />
            {profile ? <Badge label={USER_ROLE_LABELS[profile.role]} /> : null}
          </View>
        </Card>

        <Card style={{ gap: theme.spacing.md }}>
          <AppText variant="label" color="muted">
            Apparence
          </AppText>
          <AppText variant="body" color="secondary">
            Le mode « Système » suit le réglage de votre téléphone.
          </AppText>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            {APPEARANCE_OPTIONS.map((option) => (
              <AppearanceOption key={option.value} option={option} />
            ))}
          </View>
        </Card>

        <Card style={{ gap: theme.spacing.md }}>
          <AppText variant="label" color="muted">
            Mes enfants
          </AppText>
          <AppText variant="body" color="secondary">
            Le rattachement des enfants (école, niveau, classe) sera disponible à la Phase 2. Il
            détermine les informations et les notifications qui vous parviennent.
          </AppText>
        </Card>

        <Card style={{ gap: theme.spacing.md }}>
          <AppText variant="label" color="muted">
            Notifications
          </AppText>
          <AppText variant="body" color="secondary">
            Le choix des catégories de notifications sera disponible à la Phase 5. Les alertes
            urgentes resteront toujours actives.
          </AppText>
        </Card>

        <Card style={{ gap: theme.spacing.md }}>
          <AppText variant="label" color="muted">
            Mes données
          </AppText>
          <AppText variant="body" color="secondary">
            Vous pourrez à tout moment consulter, exporter et supprimer vos données depuis cet écran
            (Phase 2 pour l’export et la suppression de compte).
          </AppText>
        </Card>

        <Divider />

        <Button label="Se déconnecter" variant="ghost" onPress={() => void signOut()} />
      </ScrollView>
    </SafeAreaView>
  );
}

function AppearanceOption({
  option,
}: {
  option: { value: ThemePreference; label: string; icon: keyof typeof Ionicons.glyphMap };
}): React.JSX.Element {
  const { theme, preference, setPreference } = useTheme();
  const selected = preference === option.value;

  return (
    <View style={{ flex: 1 }}>
      <Button
        label={option.label}
        variant={selected ? 'secondary' : 'ghost'}
        icon={<Ionicons name={option.icon} size={18} color={theme.colors.primary} />}
        onPress={() => setPreference(option.value)}
        accessibilityState={{ selected }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
