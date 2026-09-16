/**
 * Écran affiché tant que le compte n'est pas actif.
 *
 * Trois situations, un seul écran : le message s'adapte au statut.
 *
 * Le ton compte beaucoup ici. Un parent qui vient de s'inscrire et qui tombe
 * sur un écran vide ou technique pensera que l'application est cassée. On lui
 * explique donc ce qui se passe, combien de temps cela prend, et ce qu'il peut
 * faire en attendant.
 */
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { USER_STATUS_LABELS } from '@fl/shared';
import type { UserStatus } from '@fl/types';

import { AppText, Button, Card, Screen } from '@/components/ui';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';

/**
 * Le statut `active` n'a rien à faire ici : un compte actif est redirigé
 * vers les onglets par le garde de navigation. On le retire donc du type,
 * ce qui rend l'indexation de `MESSAGES` exhaustive et vérifiée à la
 * compilation — ajouter un statut sans message devient une erreur de build.
 */
type InactiveStatus = Exclude<UserStatus, 'active'>;

const MESSAGES: Record<
  InactiveStatus,
  { title: string; description: string; tone: 'info' | 'danger' }
> = {
  pending: {
    title: 'Votre inscription est bien enregistrée',
    description:
      'Un membre de la FCPE va vérifier votre demande. Cela prend en général 24 à 48 heures. Vous recevrez une notification dès que votre compte sera activé.',
    tone: 'info' as const,
  },
  suspended: {
    title: 'Votre compte est suspendu',
    description:
      'L’accès à l’application est temporairement désactivé. Si vous pensez qu’il s’agit d’une erreur, contactez directement la FCPE.',
    tone: 'danger' as const,
  },
  rejected: {
    title: 'Votre demande n’a pas été acceptée',
    description:
      'La FCPE n’a pas pu valider votre inscription. Vous pouvez la contacter pour en connaître la raison et déposer une nouvelle demande.',
    tone: 'danger' as const,
  },
} as const;

export default function PendingScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { profile, accountStatus, signOut } = useAuth();
  const router = useRouter();

  // Un compte `active` ne devrait jamais atteindre cet écran ; s'il y arrive
  // (jeton pas encore rafraîchi), on retombe sur le message d'attente.
  const status: InactiveStatus =
    accountStatus && accountStatus !== 'active' ? accountStatus : 'pending';
  const message = MESSAGES[status];

  const toneStyle = {
    info: { background: theme.colors.infoSoft, color: theme.colors.info },
    danger: { background: theme.colors.dangerSoft, color: theme.colors.danger },
  }[message.tone];

  return (
    <Screen scroll edges={['top', 'bottom']}>
      <View style={{ marginTop: theme.spacing.xxl, gap: theme.spacing.md }}>
        <View
          style={{
            alignSelf: 'flex-start',
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.xs,
            borderRadius: theme.radii.pill,
            backgroundColor: toneStyle.background,
          }}
        >
          <AppText variant="label" style={{ color: toneStyle.color }}>
            {USER_STATUS_LABELS[status]}
          </AppText>
        </View>

        <AppText variant="title">{message.title}</AppText>
        <AppText variant="body" color="secondary">
          {message.description}
        </AppText>
      </View>

      {profile ? (
        <Card style={{ marginTop: theme.spacing.xl, gap: theme.spacing.sm }}>
          <AppText variant="label" color="muted">
            Récapitulatif
          </AppText>
          <AppText variant="body">
            {profile.firstName} {profile.lastName}
          </AppText>
          <AppText variant="body" color="secondary">
            {profile.email}
          </AppText>
        </Card>
      ) : null}

      <Card style={{ marginTop: theme.spacing.lg, gap: theme.spacing.sm }}>
        <AppText variant="bodyStrong">En attendant, vous pouvez</AppText>
        <AppText variant="body" color="secondary">
          • vérifier vos informations depuis votre profil
        </AppText>
        <AppText variant="body" color="secondary">
          • ajouter un second enfant si nécessaire
        </AppText>
        <AppText variant="body" color="secondary">
          • contacter la FCPE si votre situation est urgente
        </AppText>
      </Card>

      <View style={{ marginTop: theme.spacing.xl, gap: theme.spacing.md }}>
        <Button
          label="Actualiser mon statut"
          variant="secondary"
          onPress={() => router.replace('/(pending)')}
        />
        <Button label="Se déconnecter" variant="ghost" onPress={() => void signOut()} />
      </View>
    </Screen>
  );
}
