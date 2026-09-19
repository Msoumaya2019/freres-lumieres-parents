/**
 * Discussions — la liste des canaux.
 *
 * ## Ce qui a changé depuis la maquette
 *
 * L'écran affichait la constante de référence en dur, pour valider la mise en
 * page. Il lit maintenant Firestore, et la liste vient de `DEFAULT_CHANNELS` par
 * l'intermédiaire du script d'amorçage — une seule source pour les deux.
 *
 * ## L'aperçu peut être absent, et ce n'est pas une erreur
 *
 * Un canal neuf n'a pas de dernier message. L'écran retombe alors sur la
 * description du canal, et non sur une ligne vide : une ligne vide se lirait
 * comme un chargement qui n'a pas abouti. `messageCount` n'est jamais affiché —
 * il n'a aucun écrivain, et un « 0 » permanent donnerait l'impression que
 * personne n'écrit.
 *
 * ## La liste ne s'abonne pas
 *
 * Elle se relit au geste de rafraîchissement. Un onglet ne se démonte pas quand
 * on le quitte : sans ce geste, l'écran resterait figé sur ses données jusqu'au
 * redémarrage de l'application.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import { CHANNEL_TYPE_LABELS, appErrorMessage, formatRelative } from '@fl/shared';
import type { Channel } from '@fl/types';

import { AppText, Card, Screen } from '@/components/ui';
import { EmptyState, ErrorState, LoadingView } from '@/components/ui/state-views';
import { useChannels } from '@/hooks/use-channels';
import { useTheme } from '@/providers/theme-provider';

export default function DiscussionsScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const router = useRouter();
  const { channels, status, error, refreshError, refreshing, retry, refresh } = useChannels();

  const handlePressChannel = useCallback(
    (channel: Channel) => {
      router.push(`/discussion/${channel.id}`);
    },
    [router],
  );

  return (
    <Screen>
      <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.xs }}>
        <AppText variant="display">Discussions</AppText>
        <AppText variant="body" color="secondary">
          Échangez avec les autres parents, par thème et par niveau.
        </AppText>
      </View>

      {error ? (
        <ErrorState
          message={appErrorMessage(error)}
          technicalDetail={error.message}
          onRetry={retry}
        />
      ) : status === 'ready' ? (
        <FlatList
          style={{ flex: 1, marginTop: theme.spacing.md }}
          data={channels}
          keyExtractor={(channel) => channel.id}
          renderItem={({ item }) => (
            <ChannelRow channel={item} onPress={() => handlePressChannel(item)} />
          )}
          ItemSeparatorComponent={() => <View style={{ height: theme.spacing.sm }} />}
          contentContainerStyle={{
            // Sans `flexGrow`, une liste vide n'offre rien à tirer, et le geste
            // de rafraîchissement ne prend pas là où il sert le plus.
            flexGrow: 1,
            paddingBottom: theme.spacing.xxxl,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }
          ListFooterComponent={
            refreshError ? (
              <AppText
                variant="caption"
                color="danger"
                align="center"
                style={{ marginTop: theme.spacing.md }}
              >
                {appErrorMessage(refreshError)}
              </AppText>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon={<Ionicons name="chatbubbles-outline" size={40} color="#9AA3B2" />}
              title="Aucun canal pour le moment"
              description="Les canaux de discussion sont créés par la FCPE. Ils apparaîtront ici."
            />
          }
        />
      ) : (
        <LoadingView message="Chargement des canaux…" />
      )}
    </Screen>
  );
}

/** Une ligne de la liste : le canal, son dernier message, ou sa description. */
function ChannelRow({
  channel,
  onPress,
}: {
  channel: Channel;
  onPress: () => void;
}): React.JSX.Element {
  const { theme } = useTheme();

  const preview = channel.stats?.lastMessagePreview;
  const author = channel.stats?.lastMessageAuthorName;
  const when = formatRelative(channel.stats?.lastMessageAt);

  return (
    <Card onPress={onPress} accessibilityLabel={`Ouvrir le canal ${channel.name}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <Ionicons name="chatbubble-ellipses-outline" size={22} color={theme.colors.primary} />

        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <AppText variant="bodyStrong" style={{ flex: 1 }}>
              {channel.name}
            </AppText>
            {/* Le drapeau existe pour les archives et les annonces : aucun
                canal par défaut ne l'utilise, mais l'afficher évite qu'il
                devienne un réglage sans effet. */}
            {channel.readOnly ? (
              <Ionicons name="lock-closed-outline" size={13} color={theme.colors.textMuted} />
            ) : null}
            {preview && when ? (
              <AppText variant="caption" color="muted">
                {when}
              </AppText>
            ) : null}
          </View>

          <AppText variant="caption" color={preview ? 'secondary' : 'muted'} numberOfLines={1}>
            {preview
              ? author
                ? `${author} : ${preview}`
                : preview
              : `${CHANNEL_TYPE_LABELS[channel.type]} · ${channel.description ?? ''}`}
          </AppText>
        </View>
      </View>
    </Card>
  );
}
