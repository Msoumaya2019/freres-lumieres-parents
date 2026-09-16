/**
 * Publication affichée en entier.
 *
 * ## Le lien externe est filtré avant d'être ouvert
 *
 * `linkUrl` est saisie par un membre de la FCPE et validée par le schéma
 * partagé. Le filtre appliqué ici est une seconde barrière, volontaire : une
 * donnée écrite avant que le schéma n'existe, ou importée, ne repasserait pas
 * par lui. Seuls `http` et `https` sont ouverts — un `javascript:` ou un
 * `intent:` ferait exécuter au téléphone une action que personne n'a demandée.
 *
 * ## Le rôle de l'auteur n'est affiché que s'il n'est pas « parent »
 *
 * Préciser « Parent » sous chaque publication n'apprend rien : c'est le cas
 * ordinaire. C'est l'exception — membre de la FCPE, modérateur, administrateur
 * — qui mérite d'être signalée, parce qu'elle change le poids de l'information.
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { Linking, View } from 'react-native';

import {
  POST_CATEGORY_BADGES,
  POST_CATEGORY_LABELS,
  USER_ROLE_LABELS,
  formatDateTime,
  isUrgentCategory,
} from '@fl/shared';
import type { Post } from '@fl/types';

import { CategoryIcon } from '@/components/feed/category-icon';
import { AttachmentList } from '@/components/post/attachment-list';
import { AppText, Badge, Button, Divider } from '@/components/ui';
import { useTheme } from '@/providers/theme-provider';

export interface PostDetailCardProps {
  post: Post;
}

export function PostDetailCard({ post }: PostDetailCardProps): React.JSX.Element {
  const { theme } = useTheme();
  const [linkError, setLinkError] = useState(false);

  const categoryTone = POST_CATEGORY_BADGES[post.category];
  const link = post.linkUrl && isSafeExternalUrl(post.linkUrl) ? post.linkUrl : null;
  const urgent = isUrgentCategory(post.category);

  const openLink = useCallback(() => {
    if (!link) return;
    void Linking.openURL(link).catch(() => setLinkError(true));
  }, [link]);

  return (
    <View
      style={
        urgent
          ? {
              borderLeftWidth: 4,
              borderLeftColor: theme.colors.urgent,
              paddingLeft: theme.spacing.md,
            }
          : undefined
      }
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        <Badge
          label={POST_CATEGORY_LABELS[post.category]}
          tone={categoryTone}
          icon={<CategoryIcon category={post.category} color={categoryTone.color} />}
        />
        {post.pinned ? <Badge label="Épinglé" /> : null}
      </View>

      <AppText variant="title" style={{ marginTop: theme.spacing.md }}>
        {post.title}
      </AppText>

      <AppText variant="caption" color="muted" style={{ marginTop: theme.spacing.sm }}>
        {post.authorRole === 'parent'
          ? `${post.authorName} · ${formatDateTime(post.publishedAt)}`
          : `${post.authorName} · ${USER_ROLE_LABELS[post.authorRole]} · ${formatDateTime(post.publishedAt)}`}
      </AppText>

      <AppText variant="body" style={{ marginTop: theme.spacing.lg }}>
        {post.body}
      </AppText>

      {link ? (
        <View style={{ marginTop: theme.spacing.lg }}>
          <Button
            label="Ouvrir le lien"
            variant="secondary"
            fullWidth={false}
            icon={<Ionicons name="open-outline" size={18} color={theme.colors.primary} />}
            onPress={openLink}
          />
          {linkError ? (
            <AppText variant="caption" color="danger" style={{ marginTop: theme.spacing.sm }}>
              Le lien n’a pas pu être ouvert.
            </AppText>
          ) : null}
        </View>
      ) : null}

      <AttachmentList attachments={post.attachments} />

      <Divider style={{ marginTop: theme.spacing.xl }} />
    </View>
  );
}

/** Voir l'en-tête : seuls les schémas web sont ouverts. */
function isSafeExternalUrl(value: string): boolean {
  return value.startsWith('https://') || value.startsWith('http://');
}
