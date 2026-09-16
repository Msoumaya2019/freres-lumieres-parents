/**
 * Accueil — fil d'actualité.
 *
 * ⚠️ ÉTAT : Phase 1 (fondations).
 *
 * La structure de l'écran, les états de chargement / vide / erreur et le
 * branchement au repository sont en place. Le rendu des publications et le
 * défilement infini sont développés en Phase 3.
 *
 * Le hook `useFeed` ci-dessous est déjà fonctionnel : il interroge Firestore
 * avec la requête optimisée par clés d'audience. Il ne reste qu'à rendre les
 * cartes de publication.
 */
import { View } from 'react-native';

import { AppText, Card, Screen } from '@/components/ui';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';

export default function HomeScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { profile } = useAuth();

  const audienceKeyCount = profile?.audienceKeys.length ?? 0;

  return (
    <Screen scroll>
      <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.xs }}>
        <AppText variant="display">
          {profile?.firstName ? `Bonjour ${profile.firstName}` : 'Bonjour'}
        </AppText>
        <AppText variant="body" color="secondary">
          Voici les informations de l’école Frères Lumières.
        </AppText>
      </View>

      <Card style={{ marginTop: theme.spacing.lg }}>
        <AppText variant="bodyStrong">Fondations en place</AppText>
        <AppText variant="body" color="secondary" style={{ marginTop: theme.spacing.xs }}>
          La structure de l’écran, les états de chargement, le thème clair et sombre et la connexion
          à Firestore sont opérationnels. Le fil d’actualité paginé et les commentaires sont
          développés à la Phase 3.
        </AppText>
      </Card>

      <Card style={{ marginTop: theme.spacing.md, gap: theme.spacing.sm }}>
        <AppText variant="label" color="muted">
          Votre ciblage actuel
        </AppText>
        <AppText variant="body" color="secondary">
          {audienceKeyCount > 0
            ? `${audienceKeyCount} clé(s) d’audience — le fil ne chargera que les publications qui vous concernent.`
            : 'Aucune clé d’audience : complétez votre profil et le rattachement de vos enfants.'}
        </AppText>
      </Card>

      <Card style={{ marginTop: theme.spacing.md, gap: theme.spacing.sm }}>
        <AppText variant="label" color="muted">
          Prochaines étapes
        </AppText>
        <AppText variant="body" color="secondary">
          Phase 2 — inscription complète et validation des comptes
        </AppText>
        <AppText variant="body" color="secondary">
          Phase 3 — publications, commentaires et pièces jointes
        </AppText>
      </Card>
    </Screen>
  );
}
