/**
 * Commentaire d'une publication, ou réponse à un commentaire.
 *
 * ## Les cinq émoticônes sont toujours affichées, même à zéro
 *
 * C'était l'inverse tant que les réactions étaient en lecture seule : afficher
 * « 0 » partout donnait l'impression que personne n'avait réagi. Dès lors
 * qu'elles sont actionnables, l'inverse est vrai — on ne peut pas toucher ce
 * qui n'est pas affiché, et un bouton qui n'apparaît qu'après la première
 * réaction ne serait jamais découvert. L'ordre est celui de `REACTION_EMOJIS`,
 * donc stable d'un commentaire à l'autre : un bouton qui change de place à
 * chaque ligne ne s'apprend pas.
 *
 * ## Les réponses sont indentées, pas imbriquées
 *
 * Un seul niveau de réponse est prévu par le modèle (`parentId`). L'indentation
 * et le trait vertical suffisent à le montrer sans construire un arbre : au-delà
 * d'un niveau, une conversation sur téléphone devient illisible.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  BADGE_COLORS,
  REACTION_EMOJIS,
  REACTION_LABELS,
  USER_ROLE_LABELS,
  formatRelative,
  type ReactionEmoji,
} from '@fl/shared';
import type { Comment } from '@fl/types';

import { AppText, Badge } from '@/components/ui';
import { useTheme } from '@/providers/theme-provider';

export interface CommentCardProps {
  comment: Comment;
  /** Profondeur d'indentation : 0 pour un commentaire, 1 pour une réponse. */
  depth?: number;
  /**
   * Ouvre la saisie d'une réponse à ce commentaire.
   *
   * Absent sur une réponse : le modèle ne prévoit qu'un niveau
   * (`parentId` désigne un commentaire racine), et une réponse à une réponse
   * produirait une structure que l'écran ne sait pas représenter.
   */
  onReply?: ((comment: Comment) => void) | undefined;
  /** Réaction que j'ai posée sur ce commentaire, s'il y en a une. */
  myReaction?: ReactionEmoji | undefined;
  onReact?: ((emoji: ReactionEmoji) => void) | undefined;
}

export function CommentCard({
  comment,
  depth = 0,
  onReply,
  myReaction,
  onReact,
}: CommentCardProps): React.JSX.Element {
  const { theme } = useTheme();

  const relativeDate = formatRelative(comment.createdAt);
  const authorIsStaff = comment.authorRole !== 'parent';
  const reactions = REACTION_EMOJIS.filter((emoji) => (comment.reactions[emoji] ?? 0) > 0);

  const accessibilityLabel = [
    depth > 0 ? 'Réponse de' : 'Commentaire de',
    comment.authorName,
    `, ${relativeDate}.`,
    comment.body,
    reactions.length > 0
      ? reactions
          .map((emoji) => `${comment.reactions[emoji] ?? 0} ${REACTION_LABELS[emoji]}`)
          .join(', ')
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={{
        marginLeft: depth > 0 ? theme.spacing.lg : 0,
        paddingLeft: depth > 0 ? theme.spacing.md : 0,
        borderLeftWidth: depth > 0 ? 2 : 0,
        borderLeftColor: theme.colors.border,
        gap: theme.spacing.xs,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          flexWrap: 'wrap',
        }}
      >
        <AppText variant="bodyStrong">{comment.authorName}</AppText>
        {authorIsStaff ? (
          <Badge label={USER_ROLE_LABELS[comment.authorRole]} tone={BADGE_COLORS.info} />
        ) : null}
        <AppText variant="caption" color="muted">
          {relativeDate}
        </AppText>
      </View>

      <AppText variant="body" color="secondary">
        {comment.body}
      </AppText>

      {onReact ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: theme.spacing.sm,
            marginTop: theme.spacing.xs,
          }}
        >
          {REACTION_EMOJIS.map((emoji) => {
            const count = comment.reactions[emoji] ?? 0;
            const mine = myReaction === emoji;

            return (
              <Pressable
                key={emoji}
                onPress={() => onReact(emoji)}
                accessibilityRole="button"
                accessibilityState={{ selected: mine }}
                accessibilityLabel={
                  count > 0
                    ? `${REACTION_LABELS[emoji]}, ${count}${mine ? ', la vôtre' : ''}`
                    : REACTION_LABELS[emoji]
                }
                // La puce est plus petite que la cible tactile recommandée :
                // cinq pastilles de 48 points par commentaire rendraient la
                // conversation illisible. `hitSlop` rattrape la différence sans
                // occuper d'espace.
                hitSlop={theme.spacing.sm}
                style={({ pressed }) => [
                  styles.reaction,
                  {
                    minHeight: theme.touchTarget * 0.75,
                    paddingHorizontal: theme.spacing.sm,
                    gap: theme.spacing.xs,
                    borderRadius: theme.radii.pill,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: mine ? theme.colors.primary : theme.colors.border,
                    backgroundColor: mine ? theme.colors.primarySoft : theme.colors.surfaceMuted,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                <AppText variant="caption">{emoji}</AppText>
                {count > 0 ? (
                  <AppText
                    variant="caption"
                    style={{ color: mine ? theme.colors.primary : theme.colors.textMuted }}
                  >
                    {count}
                  </AppText>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {depth === 0 && onReply ? (
        <Pressable
          onPress={() => onReply(comment)}
          accessibilityRole="button"
          accessibilityLabel={`Répondre au commentaire de ${comment.authorName}`}
          hitSlop={theme.spacing.sm}
          style={({ pressed }) => [
            styles.reply,
            {
              minHeight: theme.touchTarget * 0.75,
              gap: theme.spacing.xs,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons name="arrow-undo-outline" size={16} color={theme.colors.primary} />
          <AppText variant="caption" style={{ color: theme.colors.primary }}>
            Répondre
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  reply: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reaction: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
