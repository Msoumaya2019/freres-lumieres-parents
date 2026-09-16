import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Screen } from './ui';
import { colors, spacing, typography } from '../constants/theme';

export function ResourcePlaceholder({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  const router = useRouter();
  return (
    <Screen>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>ESPACE PUBLIC</Text>
        <Text style={styles.title}>{title}</Text>
        <Card tone="success">
          <Text style={styles.body}>{message}</Text>
        </Card>
        <Button label="Retour" onPress={() => router.back()} secondary />
      </View>
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.lg,
  },
  eyebrow: { color: colors.primary, fontWeight: '900' },
  title: { ...typography.title, color: colors.primaryDark },
  body: { ...typography.body, color: colors.text },
});
