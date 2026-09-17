import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Screen } from '../../components/ui';
import { colors, spacing, typography } from '../../constants/theme';
import { useAuth } from '../../providers/auth-provider';
import { logout } from '../../services/auth';

const roleLabels = {
  fcpe: 'Membre FCPE',
  moderator: 'Modérateur',
  admin: 'Administrateur',
} as const;

export default function MemberHomePage() {
  const { profile } = useAuth();
  const router = useRouter();
  if (!profile) return null;
  async function signOut() {
    await logout();
    router.replace('/(tabs)');
  }
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View>
          <Text style={styles.eyebrow}>ESPACE PRIVÉ</Text>
          <Text style={styles.title}>Bonjour {profile.firstName}</Text>
          <Text style={styles.subtitle}>
            {roleLabels[profile.role]} · accès actif
          </Text>
        </View>
        <Card tone="success">
          <Text style={styles.heading}>Votre accès est validé</Text>
          <Text style={styles.body}>
            Les modules privés FCPE seront ajoutés dans leurs phases dédiées.
            Aucun contenu public ne nécessite cette connexion.
          </Text>
        </Card>
        <Button
          label="Revenir à l’espace public"
          onPress={() => router.replace('/(tabs)')}
          secondary
        />
        <Button
          label="Se déconnecter"
          onPress={() => void signOut()}
          secondary
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  eyebrow: { color: colors.primary, fontWeight: '900' },
  title: { ...typography.title, color: colors.primaryDark },
  subtitle: { ...typography.body, color: colors.muted },
  heading: { ...typography.heading, color: colors.text },
  body: { ...typography.body, color: colors.muted },
});
