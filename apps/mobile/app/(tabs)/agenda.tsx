import { ScrollView, StyleSheet, Text } from 'react-native';
import { Badge, Card, Screen } from '@/components/ui';
import { colors, typography } from '@/constants/theme';

export default function AgendaPage() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Agenda</Text>
        <Card>
          <Badge tone="accent">22 SEPT.</Badge>
          <Text style={styles.event}>Réunion des parents d’élèves</Text>
          <Text style={styles.meta}>18h30 · École élémentaire</Text>
        </Card>
        <Card>
          <Badge>5 OCT.</Badge>
          <Text style={styles.event}>Conseil d’école</Text>
          <Text style={styles.meta}>Ordre du jour à venir</Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { padding: 20, gap: 14 },
  title: { ...typography.title, color: colors.text },
  event: { ...typography.heading, color: colors.text },
  meta: { ...typography.body, color: colors.muted },
});
