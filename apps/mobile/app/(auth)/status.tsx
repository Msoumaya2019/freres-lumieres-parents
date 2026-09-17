import { Redirect } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { Button, Card, LoadingState, Screen } from '../../components/ui';
import { colors, typography } from '../../constants/theme';
import { useAuth } from '../../providers/auth-provider';
import { logout } from '../../services/auth';

const content = {
  active: {
    title: 'Votre accès est actif.',
    message: 'Redirection vers l’espace privé FCPE.',
    tone: 'success' as const,
  },
  pending: {
    title: 'Votre inscription est en cours de validation.',
    message:
      'Un administrateur vérifiera votre demande avant de vous donner accès à l’espace privé FCPE.',
    tone: 'warning' as const,
  },
  suspended: {
    title: 'Votre compte est suspendu.',
    message:
      'Contactez l’équipe FCPE si vous pensez qu’il s’agit d’une erreur.',
    tone: 'danger' as const,
  },
  rejected: {
    title: 'Votre inscription n’a pas été validée.',
    message:
      'Vous pouvez contacter l’équipe FCPE pour obtenir plus d’informations.',
    tone: 'warm' as const,
  },
} as const;

export default function AccountStatusPage() {
  const { firebaseUser, profile, loading, refreshProfile } = useAuth();
  if (loading)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  if (!firebaseUser) return <Redirect href="/(auth)/login" />;
  if (profile?.status === 'active') return <Redirect href="/(member)" />;
  if (!profile)
    return (
      <Screen>
        <Card tone="danger">
          <Text style={styles.title}>Profil membre introuvable.</Text>
          <Text style={styles.message}>
            Reconnectez-vous ou contactez un administrateur FCPE.
          </Text>
        </Card>
      </Screen>
    );
  const copy = content[profile.status];
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>Parents Frères Lumières</Text>
        <Card style={styles.card} tone={copy.tone}>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.message}>{copy.message}</Text>
        </Card>
        <Button
          label="Actualiser mon statut"
          onPress={() => void refreshProfile()}
        />
        <Button
          label="Se déconnecter"
          onPress={() => void logout()}
          secondary
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 18 },
  eyebrow: { color: colors.primary, textAlign: 'center', fontWeight: '800' },
  card: { paddingVertical: 30 },
  title: { ...typography.heading, color: colors.text, textAlign: 'center' },
  message: { ...typography.body, color: colors.muted, textAlign: 'center' },
});
