import { ScrollView, StyleSheet, Text } from 'react-native';
import { Card, Screen } from '@/components/ui';
import { colors, typography } from '@/constants/theme';

const actions = [
  ['Poser une question', 'À la communauté des parents'],
  ['Signaler un problème', 'Un échange privé avec la FCPE'],
  ['Proposer une idée', 'Pour améliorer la vie de l’école'],
  ['Publier dans une discussion', 'Dans un canal autorisé'],
];
export default function CreatePage() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Que souhaitez-vous faire ?</Text>
        {actions.map(([title, body]) => (
          <Card key={title}>
            <Text style={styles.action}>{title}</Text>
            <Text style={styles.body}>{body}</Text>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { padding: 20, gap: 14 },
  title: { ...typography.title, color: colors.text, marginBottom: 4 },
  action: { ...typography.heading, color: colors.primary },
  body: { ...typography.body, color: colors.muted },
});
