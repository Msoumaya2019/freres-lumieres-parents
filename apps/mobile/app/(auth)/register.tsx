import { memberRegistrationSchema } from '@flp/validation';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Input, Screen } from '../../components/ui';
import { colors, spacing, typography } from '../../constants/theme';
import { useAuth } from '../../providers/auth-provider';
import { authErrorMessage, registerMember } from '../../services/auth';

export default function RegisterPage() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [declaredFunction, setDeclaredFunction] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  const { refreshProfile } = useAuth();
  async function submit() {
    const parsed = memberRegistrationSchema.safeParse({
      firstName,
      lastName,
      email,
      password,
      declaredFunction: declaredFunction || undefined,
      organizationId: 'freres-lumieres',
    });
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? 'Vérifiez le formulaire.');
      return;
    }
    setSubmitting(true);
    setMessage('');
    try {
      await registerMember(parsed.data);
      await refreshProfile();
      router.replace('/(auth)/status');
    } catch (error) {
      setMessage(authErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.intro}>
          <Text style={styles.eyebrow}>ACCÈS MEMBRES</Text>
          <Text style={styles.title}>Demander un accès FCPE</Text>
          <Text style={styles.subtitle}>
            Cette demande concerne uniquement les membres FCPE. L’espace public
            ne nécessite jamais de compte.
          </Text>
        </View>
        <Card style={styles.form} tone="warm">
          <Input label="Prénom" value={firstName} onChangeText={setFirstName} />
          <Input label="Nom" value={lastName} onChangeText={setLastName} />
          <Input
            label="Adresse email"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <Input
            label="Fonction dans la FCPE (facultatif)"
            value={declaredFunction}
            onChangeText={setDeclaredFunction}
          />
          <Input
            label="Mot de passe"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <Text style={styles.help}>
            12 caractères minimum, avec majuscule, minuscule et chiffre.
          </Text>
        </Card>
        <Text style={styles.note}>
          Un administrateur devra valider votre demande.
        </Text>
        {message ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {message}
          </Text>
        ) : null}
        <Button
          label="Envoyer ma demande"
          loading={submitting}
          onPress={() => void submit()}
        />
        <Link href="/(auth)/login" style={styles.link}>
          J’ai déjà un accès membre
        </Link>
        <Link href="/(tabs)" style={styles.link}>
          Revenir à l’espace public
        </Link>
      </ScrollView>
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  intro: { gap: 8 },
  form: { gap: 15, padding: spacing.lg },
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
  help: { ...typography.small, color: colors.muted },
  note: { ...typography.small, color: colors.muted, textAlign: 'center' },
  error: { color: colors.urgent },
  link: {
    color: colors.primary,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
});
