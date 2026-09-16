import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Screen } from '../../components/ui';
import { colors, spacing, typography } from '../../constants/theme';

export default function ContactPage() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View>
          <Text style={styles.eyebrow}>CONTACT PRIVÉ</Text>
          <Text style={styles.title}>Contacter la FCPE</Text>
          <Text style={styles.subtitle}>
            Une messagerie de support privée, sans création de compte.
          </Text>
        </View>
        <Card tone="success">
          <Text style={styles.heading}>Confidentiel par conception</Text>
          <Text style={styles.body}>
            Chaque conversation sera protégée par un secret conservé uniquement
            sur ce téléphone. Connaître son identifiant ne permettra pas de la
            lire.
          </Text>
        </Card>
        <Button label="Bientôt disponible" disabled />
        <Text style={styles.help}>
          Le chat sécurisé sera activé en Phase 6 après App Check, limitation
          anti-abus et tests d’isolation.
        </Text>
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
  help: { ...typography.small, color: colors.muted, textAlign: 'center' },
});
