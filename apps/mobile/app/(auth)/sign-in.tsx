/**
 * Écran de connexion.
 *
 * Objectif de conception : qu'un parent peu à l'aise avec le numérique
 * comprenne en trois secondes quoi faire. Deux champs, un bouton large, un
 * lien de secours visible.
 */
import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';

import { userMessage } from '@fl/firebase';
import { loginSchema } from '@fl/shared';

import { AppText, Button, Card, Screen } from '@/components/ui';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';

export default function SignInScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(): Promise<void> {
    setErrorMessage(null);
    setFieldErrors({});

    // Validation locale : elle évite un aller-retour réseau pour une faute de
    // frappe évidente. La validation qui compte reste celle du serveur.
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.');
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      await signIn(parsed.data.email, parsed.data.password);
    } catch (error) {
      setErrorMessage(userMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.xxl }}>
          <AppText variant="display">Bonjour</AppText>
          <AppText variant="body" color="secondary">
            Connectez-vous pour retrouver les informations de l’école Frères Lumières.
          </AppText>
        </View>

        <Card style={{ marginTop: theme.spacing.xl, gap: theme.spacing.lg }}>
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="bodyStrong">Adresse e-mail</AppText>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="prenom@exemple.fr"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              accessibilityLabel="Adresse e-mail"
              style={[
                styles.input,
                {
                  minHeight: theme.touchTarget,
                  borderRadius: theme.radii.md,
                  borderColor: fieldErrors.email ? theme.colors.danger : theme.colors.border,
                  backgroundColor: theme.colors.surfaceMuted,
                  color: theme.colors.textPrimary,
                  fontSize: theme.typography.size.md,
                  paddingHorizontal: theme.spacing.md,
                },
              ]}
            />
            {fieldErrors.email ? (
              <AppText variant="caption" color="danger">
                {fieldErrors.email}
              </AppText>
            ) : null}
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="bodyStrong">Mot de passe</AppText>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Votre mot de passe"
              placeholderTextColor={theme.colors.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
              textContentType="password"
              accessibilityLabel="Mot de passe"
              onSubmitEditing={() => void handleSubmit()}
              style={[
                styles.input,
                {
                  minHeight: theme.touchTarget,
                  borderRadius: theme.radii.md,
                  borderColor: fieldErrors.password ? theme.colors.danger : theme.colors.border,
                  backgroundColor: theme.colors.surfaceMuted,
                  color: theme.colors.textPrimary,
                  fontSize: theme.typography.size.md,
                  paddingHorizontal: theme.spacing.md,
                },
              ]}
            />
            {fieldErrors.password ? (
              <AppText variant="caption" color="danger">
                {fieldErrors.password}
              </AppText>
            ) : null}
          </View>

          {errorMessage ? (
            <View
              accessibilityRole="alert"
              style={{
                backgroundColor: theme.colors.dangerSoft,
                borderRadius: theme.radii.md,
                padding: theme.spacing.md,
              }}
            >
              <AppText variant="body" color="danger">
                {errorMessage}
              </AppText>
            </View>
          ) : null}

          <Button label="Se connecter" onPress={() => void handleSubmit()} loading={submitting} />

          <Link href="/(auth)/forgot-password" style={styles.centered}>
            <AppText variant="body" color="accent">
              Mot de passe oublié ?
            </AppText>
          </Link>
        </Card>

        <View style={{ marginTop: theme.spacing.xl, alignItems: 'center', gap: theme.spacing.sm }}>
          <AppText variant="body" color="secondary">
            Pas encore de compte ?
          </AppText>
          <Link href="/(auth)/sign-up">
            <AppText variant="bodyStrong" color="accent">
              Créer mon compte parent
            </AppText>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  input: { borderWidth: StyleSheet.hairlineWidth },
  centered: { alignSelf: 'center' },
});
