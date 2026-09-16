/**
 * Commentaire d'une publication, ou réponse à un commentaire.
 *
 * ## Les réactions affichées sont celles qui existent
 *
 * `comment.reactions` est un dictionnaire maintenu par une Cloud Function. Seuls
 * les émoticônes réellement posés sont affichés, dans l'ordre de
 * `REACTION_EMOJIS` : afficher les cinq avec « 0 » donnerait l'impression que
 * personne n'a réagi, alors que c'est l'émoticône qui n'est pas utilisée qui
 * occupe la place. L'ordre, lui, reste stable d'un commentaire à l'autre — un
 * décompte qui change de position à chaque ligne est illisible.
 *
 * ## Les réponses sont indentées, pas imbriquées
 *
 * Un seul niveau de réponse est prévu par le modèle (`parentId`). L'indentation
 * et le trait vertical suffisent à le montrer sans construire un arbre : au-delà
 * d'un niveau, une conversation sur téléphone devient illisible.
 */
import { View } from 'react-native';

import { BADGE_COLORS, REACTION_EMOJIS, USER_ROLE_LABELS, formatRelative } from '@fl/shared';
import type { Comment } from '@fl/types';

import { AppText, Badge } from '@/components/ui';
import { useTheme } from '@/providers/theme-provider';

export interface CommentCardProps {
  comment: Comment;
  /** Profondeur d'indentation : 0 pour un commentaire, 1 pour une réponse. */
  depth?: number;
}

export function CommentCard({ comment, depth = 0 }: CommentCardProps): React.JSX.Element {
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
          .map((emoji) => `${comment.reactions[emoji] ?? 0} ${reactionName(emoji)}`)
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

      {reactions.length > 0 ? (
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginTop: 2 }}
        >
          {reactions.map((emoji) => (
            <AppText key={emoji} variant="caption" color="muted">
              {emoji} {comment.reactions[emoji] ?? 0}
            </AppText>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Nom lisible d'une émoticône, pour les lecteurs d'écran.
 *
 * Sans cette traduction, VoiceOver énonce « pouce vers le haut, 3 » — ce qui
 * passe encore — mais aussi « visage avec des étoiles, 2 », incompréhensible
 * hors contexte visuel.
 */
function reactionName(emoji: string): string {
  const names: Record<string, string> = {
    '👍': 'approbation',
    '🎉': 'bravo',
    '🙏': 'merci',
    '😮': 'surprise',
    '😍': 'soutien',
  };
  return names[emoji] ?? 'réaction';
}
