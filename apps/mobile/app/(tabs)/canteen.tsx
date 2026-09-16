import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge, Card, Screen } from '../../components/ui';
import { colors, spacing, typography } from '../../constants/theme';

export default function CanteenPage() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View>
          <Text style={styles.eyebrow}>CANTINE</Text>
          <Text style={styles.title}>Menus de la semaine</Text>
          <Text style={styles.subtitle}>
            Les menus publics seront disponibles ici, sans connexion.
          </Text>
        </View>
        <Card tone="warning">
          <Badge tone="accent">À VENIR</Badge>
          <Text style={styles.heading}>Menu du jour</Text>
          <Text style={styles.body}>
            Le module cantine sera alimenté pendant la Phase 3.
          </Text>
        </Card>
        <Card>
          <Text style={styles.heading}>Informations exceptionnelles</Text>
          <Text style={styles.body}>
            Les changements de menu et alertes allergènes pourront être mis en
            avant.
          </Text>
        </Card>
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
