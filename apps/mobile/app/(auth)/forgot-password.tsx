/**
 * Réinitialisation du mot de passe.
 *
 * Firebase envoie un e-mail contenant un lien de réinitialisation. On ne
 * révèle jamais si l'adresse existe ou non : la réponse est toujours la même,
 * ce qui évite de transformer ce formulaire en outil de vérification
 * d'existence d'un compte.
 */
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { userMessage } from '@fl/firebase';
import { passwordResetSchema } from '@fl/shared';

import { AppText, Button, Card, Screen } from '@/components/ui';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';

export default function ForgotPasswordScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { sendPasswordReset } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(): Promise<void> {
    setErrorMessage(null);

    const parsed = passwordResetSchema.safeParse({ email });
    if (!parsed.success) {
      setErrorMessage('Adresse e-mail invalide.');
      return;
    }

    setSubmitting(true);
    try {
      await sendPasswordReset(parsed.data.email);
      setSent(true);
    } catch (error) {
      setErrorMessage(userMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll edges={['top', 'bottom']}>
      <View style={{ marginTop: theme.spacing.xxl, gap: theme.spacing.sm }}>
        <AppText variant="title">Mot de passe oublié</AppText>
        <AppText variant="body" color="secondary">
          Indiquez votre adresse e-mail : vous recevrez un lien pour choisir un nouveau mot de
          passe.
        </AppText>
      </View>

      {sent ? (
        <Card style={{ marginTop: theme.spacing.xl, gap: theme.spacing.md }}>
          <AppText variant="subtitle" color="success">
            E-mail envoyé
          </AppText>
          <AppText variant="body" color="secondary">
            Si un compte existe avec cette adresse, vous recevrez un message dans les prochaines
            minutes. Pensez à regarder dans vos courriers indésirables.
          </AppText>
          <Button label="Retour à la connexion" variant="secondary" onPress={() => router.back()} />
        </Card>
      ) : (
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
              accessibilityLabel="Adresse e-mail"
              style={[
                styles.input,
                {
                  minHeight: theme.touchTarget,
                  borderRadius: theme.radii.md,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surfaceMuted,
                  color: theme.colors.textPrimary,
                  fontSize: theme.typography.size.md,
                  paddingHorizontal: theme.spacing.md,
                },
              ]}
            />
          </View>

          {errorMessage ? (
            <AppText variant="body" color="danger">
              {errorMessage}
            </AppText>
          ) : null}

          <Button
            label="Envoyer le lien"
            onPress={() => void handleSubmit()}
            loading={submitting}
          />
        </Card>
      )}

      <Link href="/(auth)/sign-in" style={{ marginTop: theme.spacing.xl, alignSelf: 'center' }}>
        <AppText variant="body" color="accent">
          Revenir à la connexion
        </AppText>
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: StyleSheet.hairlineWidth },
});
