/**
 * Discussions entre parents.
 *
 * ⚠️ ÉTAT : Phase 1 (fondations).
 *
 * La liste des canaux est affichée à partir de la constante de référence, ce
 * qui permet de valider la mise en page et la lisibilité. Le chargement réel
 * depuis Firestore, les messages et la modération arrivent en Phase 6.
 *
 * Rappel d'architecture : aucune messagerie privée 1-à-1 n'est prévue. Tous
 * les échanges sont collectifs et modérables, ce qui est le bon compromis
 * entre utilité et responsabilité pour une association de parents.
 */
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';

import { CHANNEL_TYPE_LABELS } from '@fl/shared';
import type { ChannelType } from '@fl/types';

import { AppText, Card, Screen } from '@/components/ui';
import { useTheme } from '@/providers/theme-provider';

/** Canaux créés par défaut pour une nouvelle organisation (Phase 6). */
const PLANNED_CHANNELS: { name: string; type: ChannelType; description: string }[] = [
  { name: 'Général', type: 'general', description: 'Échanges tous publics' },
  { name: 'Maternelle', type: 'school', description: 'Parents de la maternelle' },
  { name: 'Élémentaire', type: 'school', description: 'Parents de l’élémentaire' },
  { name: 'CP', type: 'level', description: 'Parents des CP' },
  { name: 'CE1', type: 'level', description: 'Parents des CE1' },
  { name: 'CE2', type: 'level', description: 'Parents des CE2' },
  { name: 'CM1', type: 'level', description: 'Parents des CM1' },
  { name: 'CM2', type: 'level', description: 'Parents des CM2' },
  { name: 'Cantine', type: 'theme', description: 'Menus et retours sur la cantine' },
  { name: 'Périscolaire', type: 'theme', description: 'Accueil du matin et du soir' },
  { name: 'Entraide', type: 'theme', description: 'Coup de main entre parents' },
  { name: 'Objets perdus', type: 'theme', description: 'Trouvé ou perdu à l’école' },
  { name: 'Sorties et événements', type: 'theme', description: 'Organisation des sorties' },
];

export default function DiscussionsScreen(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <Screen scroll>
      <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.xs }}>
        <AppText variant="display">Discussions</AppText>
        <AppText variant="body" color="secondary">
          Échangez avec les autres parents, par thème et par niveau.
        </AppText>
      </View>

      <Card
        style={{
          marginTop: theme.spacing.lg,
          backgroundColor: theme.colors.infoSoft,
          borderColor: theme.colors.info,
        }}
      >
        <AppText variant="body" color="secondary">
          Les {PLANNED_CHANNELS.length} canaux ci-dessous seront créés automatiquement. Ils ne sont
          pas encore reliés à Firestore : c’est l’objet de la Phase 6.
        </AppText>
      </Card>

      <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.sm }}>
        {PLANNED_CHANNELS.map((channel) => (
          <Card key={channel.name}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <Ionicons name="chatbubble-ellipses-outline" size={22} color={theme.colors.primary} />
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="bodyStrong">{channel.name}</AppText>
                <AppText variant="caption" color="muted">
                  {CHANNEL_TYPE_LABELS[channel.type]} · {channel.description}
                </AppText>
              </View>
            </View>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
