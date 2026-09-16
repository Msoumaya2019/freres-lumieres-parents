/**
 * Carte d'une publication dans le fil.
 *
 * ## Ce qui est affiché, et ce qui ne l'est pas
 *
 * Le nombre de commentaires vient de `stats.commentCount`, tenu par une Cloud
 * Function — il est donc fiable. `stats.reactionCount` n'est **pas** affiché :
 * rien ne l'alimente, les réactions vivant sur les commentaires (voir
 * `docs/08-roadmap.md`). Afficher un compteur toujours à zéro donnerait
 * l'impression que personne ne réagit, ce qui est faux.
 *
 * ## Accessibilité
 *
 * La carte entière est une cible unique, avec un libellé lu par VoiceOver et
 * TalkBack qui résume la publication. Sans lui, un lecteur d'écran énoncerait
 * les cinq textes de la carte à la suite, sans dire qu'ils forment un tout ni
 * qu'on peut les ouvrir.
 */
import { View } from 'react-native';

import {
  BADGE_COLORS,
  POST_CATEGORY_BADGES,
  POST_CATEGORY_LABELS,
  USER_ROLE_LABELS,
  formatRelative,
  isUrgentCategory,
  pluralize,
} from '@fl/shared';
import type { Post } from '@fl/types';

import { AppText, Badge, Card, Divider } from '@/components/ui';
import { useTheme } from '@/providers/theme-provider';

import { CategoryIcon } from './category-icon';

export interface PostCardProps {
  post: Post;
  onPress?: () => void;
}

export function PostCard({ post, onPress }: PostCardProps): React.JSX.Element {
  const { theme } = useTheme();
  const urgent = isUrgentCategory(post.category);
  const categoryTone = POST_CATEGORY_BADGES[post.category];
  const authorIsStaff = post.authorRole !== 'parent';

  const relativeDate = formatRelative(post.publishedAt);
  const commentLabel = pluralize(post.stats.commentCount, 'commentaire');

  const accessibilityLabel = [
    urgent ? 'Publication urgente.' : null,
    `${POST_CATEGORY_LABELS[post.category]}.`,
    post.title,
    `Par ${post.authorName}, ${relativeDate}.`,
    post.stats.commentCount > 0
      ? `${post.stats.commentCount} ${commentLabel}.`
      : 'Aucun commentaire.',
    onPress ? 'Touchez pour ouvrir.' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Card
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      style={
        urgent
          ? {
              borderLeftWidth: 4,
              borderLeftColor: theme.colors.urgent,
              backgroundColor: theme.colors.urgentSoft,
            }
          : undefined
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Badge
          label={POST_CATEGORY_LABELS[post.category]}
          tone={categoryTone}
          icon={<CategoryIcon category={post.category} color={categoryTone.color} />}
        />
        {post.pinned ? <Badge label="Épinglé" /> : null}
      </View>

      <AppText variant="subtitle" style={{ marginTop: theme.spacing.md }} numberOfLines={2}>
        {post.title}
      </AppText>

      <AppText
        variant="body"
        color="secondary"
        style={{ marginTop: theme.spacing.sm }}
        numberOfLines={4}
      >
        {post.body}
      </AppText>

      <Divider style={{ marginTop: theme.spacing.md }} />

      <View
        style={{
          marginTop: theme.spacing.sm,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.spacing.sm,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            flexShrink: 1,
          }}
        >
          <AppText variant="caption" color="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
            {post.authorName}
          </AppText>
          {authorIsStaff ? (
            // La pastille de rôle garde sa propre couleur : elle qualifie
            // l'auteur, pas la publication. Utiliser la teinte de la catégorie
            // ferait croire à un lien entre les deux.
            <Badge label={USER_ROLE_LABELS[post.authorRole]} tone={BADGE_COLORS.info} />
          ) : null}
        </View>

        <AppText variant="caption" color="muted" numberOfLines={1}>
          {relativeDate}
        </AppText>
      </View>

      <AppText variant="caption" color="muted" style={{ marginTop: theme.spacing.xs }}>
        {post.stats.commentCount > 0 ? commentLabel : 'Aucun commentaire'}
      </AppText>
    </Card>
  );
}
