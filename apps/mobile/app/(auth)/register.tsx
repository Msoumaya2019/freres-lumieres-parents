import type { RegistrationConfig } from '@flp/types';
import { registrationSchema } from '@flp/validation';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Button,
  Card,
  ErrorState,
  Input,
  LoadingState,
  Screen,
} from '../../components/ui';
import { colors, spacing, typography } from '../../constants/theme';
import { useAuth } from '../../providers/auth-provider';
import {
  authErrorMessage,
  loadRegistrationConfig,
  registerParent,
} from '../../services/auth';

interface ChildDraft {
  schoolId: string;
  levelId: string;
}
const organizationId =
  process.env.EXPO_PUBLIC_REGISTRATION_ORGANIZATION_ID ?? 'freres-lumieres';

export default function RegisterPage() {
  const [config, setConfig] = useState<RegistrationConfig | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [children, setChildren] = useState<ChildDraft[]>([]);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { refreshProfile } = useAuth();

  useEffect(() => {
    loadRegistrationConfig(organizationId)
      .then((value) => {
        setConfig(value);
        const school = value.schools[0];
        const level = school?.levels[0];
        if (school && level)
          setChildren([{ schoolId: school.id, levelId: level.id }]);
      })
      .catch(() => setLoadError(true));
  }, []);

  function chooseSchool(index: number, schoolId: string) {
    const school = config?.schools.find((entry) => entry.id === schoolId);
    const levelId = school?.levels[0]?.id ?? '';
    setChildren((current) =>
      current.map((child, i) => (i === index ? { schoolId, levelId } : child)),
    );
  }

  function chooseLevel(index: number, levelId: string) {
    setChildren((current) =>
      current.map((child, i) => (i === index ? { ...child, levelId } : child)),
    );
  }

  function addChild() {
    const school = config?.schools[0];
    const level = school?.levels[0];
    if (school && level && children.length < 5)
      setChildren((current) => [
        ...current,
        { schoolId: school.id, levelId: level.id },
      ]);
  }

  async function submit() {
    const parsed = registrationSchema.safeParse({
      firstName,
      lastName,
      email,
      password,
      organizationId,
      children,
    });
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? 'Vérifiez le formulaire.');
      return;
    }
    setSubmitting(true);
    setMessage('');
    try {
      await registerParent(parsed.data);
      await refreshProfile();
    } catch (error) {
      setMessage(authErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (!config && !loadError)
    return (
      <Screen>
        <LoadingState label="Chargement des établissements…" />
      </Screen>
    );
  if (loadError || !config)
    return (
      <Screen>
        <View style={styles.center}>
          <ErrorState message="Les inscriptions sont momentanément indisponibles." />
          <Link href="/(auth)/login" style={styles.link}>
            Revenir à la connexion
          </Link>
        </View>
      </Screen>
    );

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.intro}>
          <Text style={styles.eyebrow}>INSCRIPTION</Text>
          <Text style={styles.title}>Créer mon compte</Text>
          <Text style={styles.subtitle}>
            Aucun nom d’enfant n’est demandé. Seuls l’établissement et le niveau
            sont conservés.
          </Text>
        </View>
        <Card style={styles.form} tone="warm">
          <Input
            label="Prénom"
            autoComplete="given-name"
            value={firstName}
            onChangeText={setFirstName}
          />
          <Input
            label="Nom"
            autoComplete="family-name"
            value={lastName}
            onChangeText={setLastName}
          />
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
            autoComplete="new-password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <Text style={styles.help}>
            12 caractères minimum, avec majuscule, minuscule et chiffre.
          </Text>
        </Card>
        {children.map((child, index) => {
          const selectedSchool = config.schools.find(
            (school) => school.id === child.schoolId,
          );
          return (
            <Card key={`child-${index}`}>
              <View style={styles.row}>
                <Text style={styles.heading}>Enfant {index + 1}</Text>
                {children.length > 1 ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      setChildren((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                  >
                    <Text style={styles.remove}>Retirer</Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={styles.label}>Établissement</Text>
              <View style={styles.choices}>
                {config.schools.map((school) => (
                  <Choice
                    key={school.id}
                    label={school.name}
                    selected={school.id === child.schoolId}
                    onPress={() => chooseSchool(index, school.id)}
                  />
                ))}
              </View>
              <Text style={styles.label}>Niveau</Text>
              <View style={styles.choices}>
                {selectedSchool?.levels.map((level) => (
                  <Choice
                    key={level.id}
                    label={level.name}
                    selected={level.id === child.levelId}
                    onPress={() => chooseLevel(index, level.id)}
                  />
                ))}
              </View>
            </Card>
          );
        })}
        {children.length < 5 ? (
          <Button
            label="Ajouter un autre enfant"
            onPress={addChild}
            secondary
          />
        ) : null}
        <Card>
          <Text style={styles.note}>
            Après l’inscription, votre compte sera en attente de validation par
            l’équipe FCPE.
          </Text>
        </Card>
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
          J’ai déjà un compte
        </Link>
      </ScrollView>
    </Screen>
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  intro: { gap: 8 },
  form: { gap: 15, padding: spacing.lg },
  center: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: 18 },
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
  heading: { ...typography.heading, color: colors.text },
  help: { ...typography.small, color: colors.muted },
  note: { ...typography.small, color: colors.muted },
  label: { color: colors.text, fontWeight: '700', marginTop: 8 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  choiceSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  choiceText: { color: colors.text },
  choiceTextSelected: { color: colors.white, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  remove: { color: colors.urgent, fontWeight: '700' },
  error: { color: colors.urgent },
  link: {
    color: colors.primary,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
});
