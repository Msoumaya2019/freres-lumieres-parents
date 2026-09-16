/**
 * Pièces jointes d'une publication.
 *
 * ## L'URL n'est demandée qu'au moment de l'ouverture
 *
 * Résoudre l'URL de chaque pièce jointe à l'affichage de la publication
 * déclencherait autant d'appels réseau que de fichiers, pour des documents que
 * beaucoup de parents n'ouvriront jamais. L'URL est donc demandée au toucher,
 * puis ouverte. Le dépôt la mémorise ensuite pour la session.
 *
 * ## Pourquoi le fichier s'ouvre dans le navigateur
 *
 * Afficher une image dans l'application demanderait de la télécharger
 * entièrement et de gérer sa mise en cache ; ouvrir le lien délègue cela au
 * navigateur, qui le fait mieux, et sait aussi afficher un PDF. C'est le
 * compromis retenu pour la première version.
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';

import { appErrorMessage, formatBytes } from '@fl/shared';
import { toAppError } from '@fl/firebase';
import type { AppError, Attachment } from '@fl/types';

import { AppText } from '@/components/ui';
import { useStorage } from '@/hooks/use-storage';
import { useTheme } from '@/providers/theme-provider';

export interface AttachmentListProps {
  attachments: readonly Attachment[];
}

export function AttachmentList({ attachments }: AttachmentListProps): React.JSX.Element | null {
  const { theme } = useTheme();
  const storage = useStorage();

  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  const open = useCallback(
    async (attachment: Attachment) => {
      if (!storage) return;

      setBusyPath(attachment.storagePath);
      setError(null);

      try {
        const url = await storage.downloadUrl(attachment.storagePath);
        await Linking.openURL(url);
      } catch (caught) {
        setError(toAppError(caught));
      } finally {
        setBusyPath(null);
      }
    },
    [storage],
  );

  if (attachments.length === 0) return null;

  return (
    <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.sm }}>
      <AppText variant="label" color="muted">
        {attachments.length > 1 ? 'Pièces jointes' : 'Pièce jointe'}
      </AppText>

      {attachments.map((attachment) => {
        const busy = busyPath === attachment.storagePath;

        return (
          <Pressable
            key={attachment.storagePath}
            onPress={() => void open(attachment)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Ouvrir ${attachment.fileName}, ${formatBytes(attachment.size)}`}
            accessibilityState={{ busy }}
            style={({ pressed }) => [
              styles.row,
              {
                gap: theme.spacing.md,
                padding: theme.spacing.md,
                borderRadius: theme.radii.md,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surfaceMuted,
                opacity: pressed || busy ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons
              name={iconFor(attachment.contentType)}
              size={22}
              color={theme.colors.primary}
            />

            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="bodyStrong" numberOfLines={1}>
                {attachment.fileName}
              </AppText>
              <AppText variant="caption" color="muted">
                {formatBytes(attachment.size)}
              </AppText>
            </View>

            {busy ? (
              <ActivityIndicator color={theme.colors.primary} />
            ) : (
              <Ionicons name="download-outline" size={20} color={theme.colors.textMuted} />
            )}
          </Pressable>
        );
      })}

      {error ? (
        <AppText variant="caption" color="danger">
          {appErrorMessage(error)}
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * Icône du fichier.
 *
 * `contentType` vient de l'upload et a été validé à ce moment-là ; il reste
 * cependant une donnée distante, d'où le cas par défaut plutôt qu'une
 * correspondance exhaustive.
 */
function iconFor(contentType: string): keyof typeof Ionicons.glyphMap {
  if (contentType.startsWith('image/')) return 'image-outline';
  if (contentType === 'application/pdf') return 'document-text-outline';
  return 'document-attach-outline';
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 56,
  },
});
