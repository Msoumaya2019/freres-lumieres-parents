/**
 * Un message dans un fil de discussion.
 *
 * ## Ce que la carte n'affiche pas, et pourquoi
 *
 * Ni réactions, ni signalement. Le modèle porte bien `reactions` et
 * `reportCount`, mais `channels/{id}/messages/{mid}/reactions` n'a **ni chemin
 * ni règle** : aucun client ne peut y écrire, et Firestore refuse par défaut
 * toute écriture non autorisée. Afficher un compteur à zéro et un bouton qui
 * échouerait serait une promesse que le code ne tient pas. Les deux figurent au
 * plan de la phase 6, avec les règles qui leur manquent.
 *
 * ## La réponse citée est dénormalisée
 *
 * `replyToPreview` est écrit au moment de l'envoi par `sendMessage`. La carte
 * n'a donc pas à relire le message parent, qui peut être hors de la fenêtre
 * chargée — ou masqué depuis. C'est le même choix que la liste des canaux, qui
 * affiche l'aperçu du dernier message sans le relire.
 *
 * ## « Vous » plutôt que le nom
 *
 * Sur un fil suivi, la question « est-ce moi qui ai écrit ça ? » se pose à
 * chaque message. Répondre par le nom demanderait de le comparer à chaque
 * ligne ; l'écran le sait une fois pour toutes et le transmet.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';

import { formatRelative } from '@fl/shared';
import type { ChannelMessage } from '@fl/types';

import { AppText, Card } from '@/components/ui';
import { useTheme } from '@/providers/theme-provider';

export interface MessageCardProps {
  message: ChannelMessage;
  /** Le message a été écrit par la personne qui lit. */
  isMine: boolean;
  /**
   * Absent sur un canal en lecture seule : la carte n'offre alors pas de
   * réponse. Masquer le geste vaut mieux que de le laisser échouer.
   */
  onReply?: (message: ChannelMessage) => void;
}

export function MessageCard({ message, isMine, onReply }: MessageCardProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <Card>
      <View style={{ gap: theme.spacing.xs }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
          }}
        >
          <AppText variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {isMine ? 'Vous' : message.authorName}
          </AppText>

          {/* Pousse la date à droite sans mesurer le nom : `flex: 1` sur un
              ressort, plutôt qu'un calcul de largeur. */}
          <View style={{ flex: 1 }} />

          <AppText variant="caption" color="muted">
            {formatRelative(message.createdAt)}
          </AppText>
        </View>

        {message.replyToPreview ? (
          <View
            style={{
              borderLeftWidth: 2,
              borderLeftColor: theme.colors.primary,
              paddingLeft: theme.spacing.sm,
            }}
          >
            <AppText variant="caption" color="muted" numberOfLines={2}>
              {message.replyToPreview}
            </AppText>
          </View>
        ) : null}

        <AppText variant="body">{message.body}</AppText>

        {onReply ? (
          <Pressable
            onPress={() => onReply(message)}
            accessibilityRole="button"
            accessibilityLabel={`Répondre à ${message.authorName}`}
            hitSlop={theme.spacing.sm}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.xs,
              alignSelf: 'flex-start',
            }}
          >
            <Ionicons name="arrow-undo-outline" size={14} color={theme.colors.primary} />
            <AppText variant="caption" color="accent">
              Répondre
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}
