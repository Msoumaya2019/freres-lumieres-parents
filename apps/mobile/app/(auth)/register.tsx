import { Link } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Input, Screen } from '@/components/ui';
import { colors, typography } from '@/constants/theme';

export default function RegisterPage() {
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.intro}>
          <Text style={styles.title}>Créer mon compte</Text>
          <Text style={styles.subtitle}>
            Les informations sur les enfants restent volontairement minimales.
          </Text>
        </View>
        <View style={styles.form}>
          <Input label="Prénom" />
          <Input label="Nom" />
          <Input
            label="Adresse email"
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Input label="Mot de passe" secureTextEntry />
          <Input
            label="Établissement"
            placeholder="Élémentaire ou maternelle"
          />
          <Input label="Niveau" placeholder="Ex. CE1" />
        </View>
        <Card>
          <Text style={styles.note}>
            Après l’inscription, votre compte sera en attente de validation par
            l’équipe FCPE.
          </Text>
        </Card>
        <Button label="Envoyer ma demande" />
        <Link href="/(auth)/login" style={styles.link}>
          J’ai déjà un compte
        </Link>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 22 },
  intro: { gap: 8 },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.body, color: colors.muted },
  form: { gap: 15 },
  note: { ...typography.small, color: colors.muted },
  link: {
    color: colors.primary,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
});
