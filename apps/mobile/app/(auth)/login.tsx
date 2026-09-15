import { Link } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Input, Screen } from '@/components/ui';
import { colors, typography } from '@/constants/theme';

export default function LoginPage() {
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.intro}>
          <Text style={styles.eyebrow}>Parents Frères Lumières</Text>
          <Text style={styles.title}>Heureux de vous revoir</Text>
          <Text style={styles.subtitle}>
            Informations • Échanges • Entraide
          </Text>
        </View>
        <View style={styles.form}>
          <Input
            label="Adresse email"
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="parent@exemple.fr"
          />
          <Input
            label="Mot de passe"
            secureTextEntry
            placeholder="Votre mot de passe"
          />
          <Button label="Se connecter" />
        </View>
        <Link href="/(auth)/register" style={styles.link}>
          Créer un compte parent
        </Link>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 32 },
  intro: { gap: 8 },
  eyebrow: { color: colors.primary, fontWeight: '800' },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.body, color: colors.muted },
  form: { gap: 18 },
  link: {
    color: colors.primary,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
});
