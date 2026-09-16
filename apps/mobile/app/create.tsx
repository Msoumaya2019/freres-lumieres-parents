/**
 * Feuille modale ouverte par le bouton central « + ».
 *
 * Quatre intentions, volontairement peu nombreuses : au-delà, l'utilisateur
 * hésite. Chaque option indique clairement ce qu'elle fait et à qui elle
 * s'adresse.
 *
 * ⚠️ ÉTAT : Phase 1. La feuille s'ouvre et se ferme correctement ; chaque
 * destination est reliée à sa phase de développement.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { hasPermission } from '@fl/shared';

import { AppText, Badge, Card, Screen } from '@/components/ui';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';

interface CreateOption {
  key: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Phase de développement correspondante. */
  phase: string;
  /** Route cible, une fois la phase réalisée. */
  route?: string;
  /** Réservé à certains rôles. */
  visible?: boolean;
}

export default function CreateSheet(): React.JSX.Element {
  const { theme } = useTheme();
  const { profile } = useAuth();
  const router = useRouter();

  const canPublish = hasPermission(profile?.role, 'post.create');

  const options: CreateOption[] = [
    {
      key: 'question',
      title: 'Poser une question',
      description: 'Une question sur la cantine, les horaires, une sortie…',
      icon: 'help-circle-outline',
      phase: 'Phase 6 — Discussions',
    },
    {
      key: 'idea',
      title: 'Proposer une idée',
      description: 'Une suggestion pour l’école ou pour la FCPE.',
      icon: 'bulb-outline',
      phase: 'Phase 13 — Sujets collectifs',
    },
    {
      key: 'report',
      title: 'Signaler un problème',
      description: 'Cantine, sécurité, périscolaire, locaux…',
      icon: 'alert-circle-outline',
      phase: 'Phase 7 — Signalements',
    },
    {
      key: 'post',
      title: 'Publier une information',
      description: 'Réservé aux membres de la FCPE.',
      icon: 'megaphone-outline',
      phase: 'Phase 3 — Publications',
      visible: canPublish,
    },
  ];

  return (
    <Screen scroll edges={['bottom']}>
      <View style={{ gap: theme.spacing.md, paddingTop: theme.spacing.sm }}>
        <AppText variant="title">Que souhaitez-vous faire ?</AppText>
        <AppText variant="body" color="secondary">
          Choisissez l’option qui correspond à votre besoin. Vous pourrez toujours annuler.
        </AppText>

        {options
          .filter((option) => option.visible !== false)
          .map((option) => (
            <Card
              key={option.key}
              onPress={() => {
                // Tant que la fonctionnalité n'existe pas, on referme la
                // feuille plutôt que d'ouvrir un écran vide.
                router.back();
              }}
              accessibilityLabel={option.title}
            >
              <View style={{ flexDirection: 'row', gap: theme.spacing.md, alignItems: 'center' }}>
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: theme.radii.md,
                    backgroundColor: theme.colors.primarySoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name={option.icon} size={22} color={theme.colors.primary} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="bodyStrong">{option.title}</AppText>
                  <AppText variant="caption" color="secondary">
                    {option.description}
                  </AppText>
                </View>
                <Badge label={option.phase.split(' — ')[0] ?? ''} />
              </View>
            </Card>
          ))}

        {!canPublish ? (
          <AppText variant="caption" color="muted">
            La publication d’informations est réservée aux membres de la FCPE. Vous pouvez en
            revanche poser une question, proposer une idée ou signaler un problème.
          </AppText>
        ) : null}
      </View>
    </Screen>
  );
}
