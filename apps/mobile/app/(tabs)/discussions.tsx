import { ScrollView, StyleSheet, Text } from 'react-native';
import { Badge, Card, Screen } from '@/components/ui';
import { colors, typography } from '@/constants/theme';

const channels = [
  ['Général', '42 nouveaux messages'],
  ['Élémentaire', 'Informations et entraide'],
  ['Maternelle', 'Vie de l’école'],
  ['Cantine', 'Menus et retours'],
  ['Objets perdus', 'Retrouver un vêtement ou un objet'],
];
export default function DiscussionsPage() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Discussions</Text>
        <Text style={styles.subtitle}>
          Des espaces collectifs organisés, sans messagerie privée en V1.
        </Text>
        {channels.map(([name, detail]) => (
          <Card key={name}>
            <Badge>CANAL</Badge>
            <Text style={styles.channel}>{name}</Text>
            <Text style={styles.subtitle}>{detail}</Text>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { padding: 20, gap: 14 },
  title: { ...typography.title, color: colors.text },
  channel: { ...typography.heading, color: colors.text },
  subtitle: { ...typography.body, color: colors.muted },
});
