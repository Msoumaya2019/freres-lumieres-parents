/**
 * Choix des photos jointes à une publication.
 *
 * ## Aucune compression ici
 *
 * Le sélecteur ne fait que choisir : la compression a lieu au moment de
 * l'envoi (`use-create-post`), une fois pour toutes, sur les photos qui
 * partent réellement. Compresser à la sélection produirait un fichier
 * intermédiaire par photo retirée ensuite — du travail et du cache pour rien.
 * L'aperçu affiche donc l'original, ce qui est aussi plus rapide à obtenir.
 *
 * ## Pourquoi le sélecteur n'est pas prié de compresser
 *
 * `quality` est laissé au maximum : la compression est faite par l'application,
 * avec ses propres réglages (1600 px, qualité 0,8). Demander au sélecteur d'en
 * faire une première serait une double compression — donc une perte de qualité
 * pour un gain de taille nul, la seconde écrasant la première.
 *
 * ## Pourquoi les fichiers trop lourds sont refusés tout de suite
 *
 * Une photo de 40 Mio occuperait la mémoire du téléphone pendant la
 * compression, pour finir refusée par les Storage Rules. Le refus est donc
 * prononcé avant, avec le nom du fichier et la limite — un message qu'un parent
 * peut comprendre et corriger.
 */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { UPLOAD_LIMITS, exceedsSourceLimit, formatBytes } from '@fl/shared';

import { AppText, Button } from '@/components/ui';
import type { PickedPhoto } from '@/hooks/use-create-post';
import { useTheme } from '@/providers/theme-provider';

const THUMBNAIL_SIZE = 88;

export interface PhotoFieldProps {
  photos: readonly PickedPhoto[];
  onChange: (photos: readonly PickedPhoto[]) => void;
  /** Erreur du formulaire, affichée sous la liste. */
  error?: string | undefined;
  disabled?: boolean;
}

/**
 * Nom du fichier tel qu'il sera affiché.
 *
 * Le sélecteur ne le fournit pas toujours : les permissions limitées sur iOS et
 * certains fournisseurs de contenu sur Android le laissent vide. Le dernier
 * segment de l'URI en tient lieu — c'est le nom du fichier dans le cache de
 * l'application, qui reste lisible.
 */
function fileNameOf(asset: ImagePicker.ImagePickerAsset): string {
  const fromUri = asset.uri.split('/').pop();
  if (asset.fileName) return asset.fileName;
  return fromUri && fromUri.length > 0 ? fromUri : 'photo.jpg';
}

export function PhotoField({
  photos,
  onChange,
  error,
  disabled = false,
}: PhotoFieldProps): React.JSX.Element {
  const { theme } = useTheme();

  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);

  const max = UPLOAD_LIMITS.maxAttachmentsPerPost;
  const remaining = max - photos.length;
  const canAdd = remaining > 0 && !disabled;

  async function pick(): Promise<void> {
    setPickerError(null);
    setPicking(true);

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        setPickerError(
          'L’accès aux photos est nécessaire pour en joindre une. ' +
            'Vous pouvez l’autoriser dans les réglages de votre téléphone.',
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 1,
      });

      if (result.canceled) return;

      const accepted: PickedPhoto[] = [];
      const rejected: string[] = [];

      for (const asset of result.assets) {
        if (exceedsSourceLimit(asset.fileSize)) {
          rejected.push(fileNameOf(asset));
          continue;
        }

        accepted.push({
          uri: asset.uri,
          width: asset.width,
          height: asset.height,
          fileName: fileNameOf(asset),
        });
      }

      // La troncature est une ceinture : `selectionLimit` couvre la sélection
      // courante, mais l'ajout à une liste déjà garnie pourrait la dépasser.
      onChange([...photos, ...accepted].slice(0, max));

      if (rejected.length > 0) {
        setPickerError(
          `${rejected.join(', ')} : au-delà de ${formatBytes(UPLOAD_LIMITS.image.maxSourceBytes)}. ` +
            'Ces photos n’ont pas été ajoutées.',
        );
      }
    } catch {
      setPickerError('Les photos n’ont pas pu être ouvertes. Réessayez.');
    } finally {
      setPicking(false);
    }
  }

  function remove(index: number): void {
    onChange(photos.filter((_, position) => position !== index));
  }

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <AppText variant="bodyStrong">
        {photos.length > 0 ? `Photos (${photos.length} sur ${max})` : 'Photos (facultatif)'}
      </AppText>

      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}
        accessibilityRole="list"
      >
        {photos.map((photo, index) => (
          <View
            key={photo.uri}
            style={{
              width: THUMBNAIL_SIZE,
              height: THUMBNAIL_SIZE,
              borderRadius: theme.radii.md,
              overflow: 'hidden',
              backgroundColor: theme.colors.surfaceMuted,
            }}
          >
            <Image
              source={{ uri: photo.uri }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
              // L'aperçu vient d'un fichier local déjà lu : le fondu d'apparition
              // d'`expo-image` ajouterait un délai visible pour rien.
              transition={0}
              accessibilityLabel={`Photo ${index + 1} : ${photo.fileName}`}
            />

            <Pressable
              onPress={() => remove(index)}
              // La croix est petite pour ne pas masquer la photo ; la zone
              // tactile, elle, doit rester confortable. `hitSlop` étend la cible
              // sans agrandir le dessin.
              hitSlop={14}
              accessibilityRole="button"
              accessibilityLabel={`Retirer ${photo.fileName}`}
              style={{
                position: 'absolute',
                top: theme.spacing.xs,
                right: theme.spacing.xs,
                width: 26,
                height: 26,
                borderRadius: 13,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.colors.surface,
              }}
            >
              <Ionicons name="close" size={16} color={theme.colors.danger} />
            </Pressable>
          </View>
        ))}

        {canAdd ? (
          <Pressable
            onPress={() => void pick()}
            disabled={picking}
            accessibilityRole="button"
            accessibilityLabel="Ajouter une photo"
            accessibilityState={{ busy: picking, disabled: picking }}
            style={({ pressed }) => ({
              width: THUMBNAIL_SIZE,
              height: THUMBNAIL_SIZE,
              borderRadius: theme.radii.md,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: theme.colors.borderStrong,
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.spacing.xs,
              backgroundColor: theme.colors.surfaceMuted,
              opacity: pressed || picking ? 0.7 : 1,
            })}
          >
            {picking ? (
              <ActivityIndicator color={theme.colors.primary} />
            ) : (
              <>
                <Ionicons name="add" size={24} color={theme.colors.primary} />
                <AppText variant="caption" color="secondary">
                  Ajouter
                </AppText>
              </>
            )}
          </Pressable>
        ) : null}
      </View>

      {photos.length === 0 ? (
        <AppText variant="caption" color="muted">
          Les photos sont réduites à {UPLOAD_LIMITS.image.maxWidth} pixels de côté avant l’envoi,
          pour rester légères.
        </AppText>
      ) : null}

      {photos.length >= max ? (
        <AppText variant="caption" color="muted">
          {`Maximum atteint : ${max} photos par publication.`}
        </AppText>
      ) : null}

      {(error ?? pickerError) ? (
        <AppText variant="caption" color="danger">
          {error ?? pickerError}
        </AppText>
      ) : null}

      {photos.length > 0 && !disabled ? (
        <Button
          label="Retirer toutes les photos"
          variant="ghost"
          fullWidth={false}
          onPress={() => onChange([])}
        />
      ) : null}
    </View>
  );
}
