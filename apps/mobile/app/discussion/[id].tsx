/**
 * Fil d'un canal : les messages, et la zone d'écriture.
 *
 * ## La liste est inversée, et c'est ce qui règle trois choses d'un coup
 *
 * Une messagerie s'ouvre sur le message le plus récent, et non sur le plus
 * ancien. `inverted` place l'élément 0 en bas et démarre la vue sur le bas :
 * la conversation s'ouvre donc au bon endroit sans qu'aucun `scrollToEnd`
 * n'ait à être déclenché après un rendu — ce qui demanderait une référence,
 * un effet et un cas particulier pour la liste vide.
 *
 * Le troisième effet est moins visible : charger des messages plus anciens
 * **ajoute** des éléments du côté éloigné du point d'ancrage. Ce qui est à
 * l'écran ne bouge donc pas, alors qu'une liste ordinaire sauterait de la
 * hauteur des messages insérés.
 *
 * ## L'état vide est rendu hors de la liste
 *
 * `inverted` retourne la liste et chaque cellule ; `ListEmptyComponent`, lui,
 * n'est pas contre-retourné de façon fiable selon les versions. Un texte
 * inversé serait pire qu'un état vide absent : il est donc rendu à côté.
 *
 * ## L'écran ne détient aucun message
 *
 * Il n'y a pas de copie locale, pas de fusion optimiste : l'abonnement est la
 * source, et un message envoyé revient par lui. C'est ce qui rend impossible
 * l'écart entre ce qui est affiché et ce qui est enregistré.
 */
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';

import { appErrorMessage } from '@fl/shared';
import type { ChannelMessage } from '@fl/types';

import { MessageCard } from '@/components/discussion/message-card';
import { AppText, Button, Screen } from '@/components/ui';
import { Composer } from '@/components/ui/composer';
import { EmptyState, ErrorState, LoadingView } from '@/components/ui/state-views';
import { useChannel, useChannelThread } from '@/hooks/use-channels';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';

/**
 * Message auquel la prochaine saisie répondra.
 *
 * Les trois champs servent à deux endroits différents : `authorName` s'affiche
 * dans le bandeau du composeur, et `id` avec `preview` partent dans le message
 * écrit. Les séparer obligerait l'écran à tenir deux états pour un seul geste.
 */
interface ReplyTarget {
  readonly id: string;
  readonly authorName: string;
  readonly preview: string;
}

export default function ChannelThreadScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ id?: string }>();
  const channelId = typeof params.id === 'string' ? params.id : '';

  const { theme } = useTheme();
  const { profile } = useAuth();
  const channel = useChannel(channelId);
  const thread = useChannelThread(channelId);

  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);

  /**
   * Du plus récent au plus ancien, pour une liste inversée.
   *
   * `thread.messages` change d'identité à chaque instantané, donc la copie est
   * refaite à chaque fois : sur soixante messages, c'est sans conséquence, et
   * l'alternative — inverser dans le rendu de chaque ligne — serait pire.
   */
  const ordered = useMemo(() => [...thread.messages].reverse(), [thread.messages]);

  const handleReply = useCallback((message: ChannelMessage) => {
    // Le corps brut, non tronqué : c'est le dépôt qui applique la même règle
    // d'aperçu que pour le dernier message d'un canal.
    setReplyTo({ id: message.id, authorName: message.authorName, preview: message.body });
  }, []);

  const cancelReply = useCallback(() => setReplyTo(null), []);

  const resolved = channel.channel;
  const readOnly = resolved?.readOnly === true;
  const myId = profile?.id ?? '';

  let body: React.JSX.Element;

  if (channelId === '') {
    // Un identifiant absent ne se lit pas : les deux lectures resteraient
    // muettes et l'écran tournerait indéfiniment. Un lien profond tronqué est
    // la seule façon d'arriver ici, et il mérite une phrase, pas un sablier.
    body = (
      <EmptyState
        icon={<Ionicons name="help-circle-outline" size={40} color="#9AA3B2" />}
        title="Discussion introuvable"
        description="Le lien qui a ouvert cet écran ne désigne aucun canal."
      />
    );
  } else if (channel.error) {
    body = (
      <ErrorState
        message={appErrorMessage(channel.error)}
        technicalDetail={channel.error.message}
        onRetry={channel.retry}
      />
    );
  } else if (!resolved) {
    // `resolved` est faux tant que la lecture n'a pas abouti : c'est le
    // chargement, pas l'absence. `null` avec `resolved` vrai, plus bas, veut
    // dire que le canal n'existe plus.
    body = <LoadingView message="Chargement du canal…" />;
  } else if (thread.error) {
    body = (
      <ErrorState
        message={appErrorMessage(thread.error)}
        technicalDetail={thread.error.message}
        onRetry={thread.retry}
      />
    );
  } else if (thread.status !== 'ready') {
    body = <LoadingView message="Chargement des messages…" />;
  } else {
    body = (
      <KeyboardAvoidingView
        // Sans cela, le clavier recouvre la zone de saisie sur iOS. Sur
        // Android, le système remonte déjà la vue (`adjustResize`), et ajouter
        // `padding` la remonterait deux fois.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {thread.messages.length === 0 ? (
          <EmptyState
            icon={<Ionicons name="chatbubble-outline" size={40} color="#9AA3B2" />}
            title="Aucun message"
            description={
              readOnly
                ? 'Ce canal ne contient encore rien.'
                : 'Écrivez le premier message pour ouvrir la conversation.'
            }
          />
        ) : (
          <>
            {/* Hors de la liste : avec `inverted`, un pied de liste est rendu
                en haut, et le placer ici évite de dépendre de ce retournement. */}
            <OlderMessages
              hasOlder={thread.hasOlder}
              loading={thread.loadingOlder}
              onLoadOlder={thread.loadOlder}
            />

            <FlatList
              inverted
              data={ordered}
              keyExtractor={(message) => message.id}
              renderItem={({ item }) => (
                <MessageCard
                  message={item}
                  isMine={item.authorId === myId}
                  onReply={readOnly ? undefined : handleReply}
                />
              )}
              ItemSeparatorComponent={() => <View style={{ height: theme.spacing.sm }} />}
              contentContainerStyle={{
                paddingHorizontal: theme.spacing.lg,
                paddingVertical: theme.spacing.md,
              }}
            />
          </>
        )}

        {readOnly ? (
          <ReadOnlyNotice />
        ) : (
          <View style={{ paddingHorizontal: theme.spacing.lg }}>
            <Composer
              noun="message"
              replyTo={replyTo}
              onCancelReply={cancelReply}
              onSubmit={(text) => thread.send(text, replyTo ?? undefined)}
              submitting={thread.sending}
              error={thread.sendError}
            />
          </View>
        )}
      </KeyboardAvoidingView>
    );
  }

  return (
    <>
      {/* Le titre est posé ici et non dans la pile : il n'est connu qu'après
          la lecture du canal, et le faire transiter par les paramètres de
          route l'encoderait dans l'URL. */}
      <Stack.Screen options={{ title: resolved?.name ?? 'Discussion' }} />
      <Screen edges={[]} padded={false}>
        {body}
      </Screen>
    </>
  );
}

/**
 * Le chargement des messages plus anciens.
 *
 * `hasOlder` se déduit du remplissage de la fenêtre : une fenêtre pleine peut
 * en cacher d'autres, une fenêtre incomplète est le début du canal. Rien ne
 * permet de savoir s'il reste un message ou trente — et c'est sans
 * conséquence, puisque le bouton disparaît de lui-même au chargement suivant.
 */
function OlderMessages({
  hasOlder,
  loading,
  onLoadOlder,
}: {
  hasOlder: boolean;
  loading: boolean;
  onLoadOlder: () => void;
}): React.JSX.Element | null {
  const { theme } = useTheme();

  if (loading) {
    return (
      <View
        style={{ paddingVertical: theme.spacing.sm, alignItems: 'center' }}
        accessibilityRole="progressbar"
        accessibilityLabel="Chargement des messages plus anciens"
      >
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (!hasOlder) return null;

  return (
    <View style={{ paddingVertical: theme.spacing.sm, alignItems: 'center' }}>
      <Button
        label="Afficher les messages plus anciens"
        variant="secondary"
        fullWidth={false}
        onPress={onLoadOlder}
      />
    </View>
  );
}

/** Bandeau d'un canal en lecture seule, à la place de la zone d'écriture. */
function ReadOnlyNotice(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.border,
        backgroundColor: theme.colors.surface,
      }}
    >
      <Ionicons name="lock-closed-outline" size={16} color={theme.colors.textMuted} />
      <AppText variant="caption" color="muted" style={{ flexShrink: 1 }}>
        Ce canal est en lecture seule : seuls les membres de la FCPE peuvent y écrire.
      </AppText>
    </View>
  );
}
