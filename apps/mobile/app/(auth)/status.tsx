import { ScrollView, StyleSheet, Text } from 'react-native';
import { Button, Card, LoadingState, Screen } from '../../components/ui';
import { colors, typography } from '../../constants/theme';
import { useAuth } from '../../providers/auth-provider';
import { logout } from '../../services/auth';

const content = {
  pending: {
    title: 'Votre inscription est en cours de validation.',
    message:
      'L’équipe vérifiera votre demande avant de vous donner accès aux espaces réservés aux parents.',
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
  const { profile, loading, refreshProfile } = useAuth();
  if (loading || !profile)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  const copy =
    content[profile.status as keyof typeof content] ?? content.pending;
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
