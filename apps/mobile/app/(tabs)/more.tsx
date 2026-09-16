import { Link, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, Screen } from '../../components/ui';
import { colors, spacing, typography } from '../../constants/theme';

const links = [
  ['/documents', 'Documents', 'Flyers, comptes rendus et informations'],
  [
    '/school-councils',
    'Conseils d’école',
    'Dates, ordres du jour et décisions',
  ],
  ['/polls', 'Sondages', 'Consultations publiques anonymes'],
  [
    '/notification-preferences',
    'Préférences notifications',
    'Choisir les sujets suivis',
  ],
  ['/(auth)/login', 'Espace membres FCPE', 'Connexion réservée aux membres'],
] as const;
export default function MorePage() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View>
          <Text style={styles.eyebrow}>PLUS</Text>
          <Text style={styles.title}>Toutes les ressources</Text>
        </View>
        {links.map(([href, title, description]) => (
          <Link href={href as Href} asChild key={title}>
            <Pressable accessibilityRole="button">
              <Card>
                <Text style={styles.heading}>{title}</Text>
                <Text style={styles.body}>{description}</Text>
              </Card>
            </Pressable>
          </Link>
        ))}
      </ScrollView>
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  eyebrow: { color: colors.primary, fontWeight: '900' },
  title: { ...typography.title, color: colors.primaryDark },
  heading: { ...typography.heading, color: colors.text },
  body: { ...typography.body, color: colors.muted },
});
