/**
 * Préparation d'une image avant son envoi.
 *
 * ## Pourquoi ces calculs vivent ici
 *
 * Redimensionner une image est une règle métier, pas une affaire d'interface :
 * les limites sont celles des Storage Rules (`UPLOAD_LIMITS`), et
 * l'administration devra compresser à son tour le jour où elle enverra des
 * pièces jointes. La géométrie est donc partagée et testée ici, plutôt que
 * réécrite dans chaque application.
 *
 * ## Ce que ces fonctions ne font pas
 *
 * Elles ne touchent à aucun fichier : elles calculent. La compression
 * elle-même dépend de la plateforme — `expo-image-manipulator` sur mobile, un
 * canevas sur le web — et reste dans l'application.
 */
import { UPLOAD_LIMITS } from './constants.js';

/** Dimensions d'une image, en pixels. */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** Cadre par défaut : celui des Storage Rules. */
const DEFAULT_BOX: ImageSize = {
  width: UPLOAD_LIMITS.image.maxWidth,
  height: UPLOAD_LIMITS.image.maxHeight,
};

/**
 * Dimensions à donner à une image pour qu'elle tienne dans un cadre.
 *
 * **N'agrandit jamais** : une image de 400 px envoyée dans un cadre de 1600 px
 * reste à 400 px. L'agrandir alourdirait le fichier sans ajouter un seul
 * détail — et l'économie annoncée (÷20) vient du redimensionnement, pas d'un
 * sur-échantillonnage.
 *
 * Renvoie `null` quand la taille d'origine est inconnue : le sélecteur du
 * système documente explicitement que `width` et `height` peuvent valoir `0`.
 * L'appelant se contente alors de réencoder, ce qui suffit déjà à diviser le
 * poids d'une photo de téléphone.
 */
export function fitWithin(size: ImageSize, box: ImageSize = DEFAULT_BOX): ImageSize | null {
  if (size.width <= 0 || size.height <= 0) return null;

  const ratio = Math.min(box.width / size.width, box.height / size.height, 1);
  if (ratio === 1) return { width: Math.round(size.width), height: Math.round(size.height) };

  // Jamais zéro : un côté à 0 px donne une image que le manipulateur refuse, et
  // l'échec serait signalé très loin de sa cause — une photo très allongée
  // (panorama, capture d'une longue page) suffit à produire ce cas.
  return {
    width: Math.max(1, Math.round(size.width * ratio)),
    height: Math.max(1, Math.round(size.height * ratio)),
  };
}

/**
 * Le fichier choisi dépasse-t-il ce que le sélecteur accepte ?
 *
 * Vérifié **avant** la compression : une photo de 40 Mio occuperait la mémoire
 * du téléphone pour rien, alors qu'un refus immédiat et expliqué est plus utile
 * qu'un échec au milieu du traitement.
 *
 * Une taille inconnue n'est pas un refus : le système ne la fournit pas
 * toujours, et bloquer sur une donnée absente serait pire que de laisser la
 * compression faire son travail.
 */
export function exceedsSourceLimit(bytes: number | undefined): boolean {
  return bytes !== undefined && bytes > UPLOAD_LIMITS.image.maxSourceBytes;
}
