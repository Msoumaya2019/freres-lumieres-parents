import { loginSchema } from '@flp/validation';
import { Link } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Input, Screen } from '../../components/ui';
import { colors, spacing, typography } from '../../constants/theme';
import { authErrorMessage, login, resetPassword } from '../../services/auth';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function submit() {
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? 'Formulaire invalide.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      await login(parsed.data.email, parsed.data.password);
    } catch (error) {
      setMessage(authErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function forgotPassword() {
    const parsed = loginSchema.shape.email.safeParse(email);
    if (!parsed.success) {
      setMessage('Saisissez d’abord votre adresse email.');
      return;
    }
    try {
      await resetPassword(parsed.data);
      setMessage('Un email de réinitialisation vient de vous être envoyé.');
    } catch (error) {
      setMessage(authErrorMessage(error));
    }
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.intro}>
          <Text style={styles.eyebrow}>ESPACE PARENTS</Text>
          <Text style={styles.title}>Heureux de vous revoir</Text>
          <Text style={styles.subtitle}>
            Informations • Échanges • Entraide
          </Text>
        </View>
        <Card style={styles.form} tone="warm">
          <Input
            label="Adresse email"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <Input
            label="Mot de passe"
            autoComplete="current-password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          {message ? (
            <Text accessibilityLiveRegion="polite" style={styles.message}>
              {message}
            </Text>
          ) : null}
          <Button
            label="Se connecter"
            loading={loading}
            onPress={() => void submit()}
          />
          <Button
            label="Mot de passe oublié"
            disabled={loading}
            onPress={() => void forgotPassword()}
            secondary
          />
        </Card>
        <Link href="/(auth)/register" style={styles.link}>
          Créer un compte parent
        </Link>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.xl,
  },
  intro: { gap: 8 },
  eyebrow: {
    alignSelf: 'flex-start',
    color: colors.primary,
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    fontSize: 12,
    fontWeight: '900',
    overflow: 'hidden',
  },
  title: { ...typography.display, color: colors.primaryDark },
  subtitle: { ...typography.body, color: colors.muted },
  form: { gap: 18, padding: spacing.lg },
  message: { color: colors.urgent, fontSize: 14 },
  link: {
    color: colors.primary,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
});
