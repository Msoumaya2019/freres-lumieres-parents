/**
 * Compression d'une photo avant son envoi.
 *
 * ## Pourquoi c'est indispensable, et pas un confort
 *
 * Une photo de téléphone pèse 4 à 8 Mio. Les Storage Rules bornent une image à
 * 2 Mio — et **une règle ne peut pas compresser**. Sans ce traitement, la photo
 * serait refusée par le serveur et le parent lirait « action non autorisée »
 * sans jamais comprendre que le problème est le poids de sa photo. La
 * compression n'est donc pas une optimisation : c'est ce qui rend l'envoi
 * possible. Le commentaire en tête de `firebase/storage.rules` dit la même
 * chose dans l'autre sens.
 *
 * ## Pourquoi tout ressort en JPEG
 *
 * Un PNG de capture d'écran peut être plus lourd qu'une photo après
 * redimensionnement, et le format n'est pas ce qui intéresse le parent : il
 * veut que son image s'affiche. Le JPEG est en outre le seul format que les
 * trois plateformes encodent sans réglage. Contrepartie assumée : une
 * transparence PNG devient un fond uni — cas rare pour une publication, et
 * préférable à un envoi refusé.
 *
 * ## Pourquoi un seul côté est imposé au redimensionnement
 *
 * Lui donner les deux côtés reviendrait à lui demander de respecter un rapport
 * déjà arrondi par `Math.round`, donc légèrement faux. Un seul côté suffit : le
 * manipulateur calcule l'autre pour conserver le rapport exact.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { appError } from '@fl/firebase';
import { UPLOAD_LIMITS, fitWithin } from '@fl/shared';

/** Image prête à être envoyée : fichier local, dimensions, type MIME. */
export interface CompressedImage {
  /** URI du fichier compressé, dans le cache de l'application. */
  uri: string;
  width: number;
  height: number;
  contentType: string;
}

export interface ImageSource {
  uri: string;
  width: number;
  height: number;
}

export async function compressImage(source: ImageSource): Promise<CompressedImage> {
  try {
    const context = ImageManipulator.manipulate(source.uri);

    const target = fitWithin(source);
    if (target) {
      context.resize(
        target.width >= target.height ? { width: target.width } : { height: target.height },
      );
    }

    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: UPLOAD_LIMITS.image.quality,
    });

    return {
      uri: saved.uri,
      width: saved.width,
      height: saved.height,
      contentType: 'image/jpeg',
    };
  } catch (error) {
    // Une image illisible — fichier tronqué, format exotique — échoue ici. Le
    // message doit désigner la photo, pas le traitement : « la compression a
    // échoué » n'apprend rien à quelqu'un qui voulait publier une information.
    throw appError(
      'failed-precondition',
      'Cette photo n’a pas pu être préparée. Essayez-en une autre.',
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}
