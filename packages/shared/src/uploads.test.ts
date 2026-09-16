import { describe, expect, it } from 'vitest';

import { UPLOAD_LIMITS } from './constants.js';
import { exceedsSourceLimit, fitWithin } from './uploads.js';

describe('fitWithin', () => {
  it('ramène le plus grand côté à la limite', () => {
    expect(fitWithin({ width: 4000, height: 3000 })).toEqual({ width: 1600, height: 1200 });
  });

  it('traite aussi une image en portrait', () => {
    expect(fitWithin({ width: 3000, height: 4000 })).toEqual({ width: 1200, height: 1600 });
  });

  it('n’agrandit jamais une petite image', () => {
    expect(fitWithin({ width: 400, height: 300 })).toEqual({ width: 400, height: 300 });
  });

  it('laisse intacte une image exactement à la limite', () => {
    expect(fitWithin({ width: 1600, height: 1600 })).toEqual({ width: 1600, height: 1600 });
  });

  it('conserve le rapport d’origine', () => {
    const result = fitWithin({ width: 4032, height: 3024 });

    expect(result).not.toBeNull();
    expect(result!.width / result!.height).toBeCloseTo(4032 / 3024, 2);
  });

  it('renvoie null quand la taille d’origine est inconnue', () => {
    // Le sélecteur du système documente `width` et `height` à 0 lorsque
    // l’information n’est pas disponible.
    expect(fitWithin({ width: 0, height: 0 })).toBeNull();
    expect(fitWithin({ width: 4000, height: 0 })).toBeNull();
  });

  it('n’arrondit jamais un côté à zéro', () => {
    // 20000 × 3 : la réduction ramènerait la hauteur à 0,24 px, donc à 0 après
    // arrondi — une image que le manipulateur refuse de produire.
    const result = fitWithin({ width: 20000, height: 3 });

    expect(result).toEqual({ width: 1600, height: 1 });
  });

  it('respecte un cadre fourni', () => {
    expect(fitWithin({ width: 1000, height: 500 }, { width: 200, height: 200 })).toEqual({
      width: 200,
      height: 100,
    });
  });

  it('s’appuie sur les limites partagées, pas sur des valeurs recopiées', () => {
    const result = fitWithin({ width: 10_000, height: 10_000 });

    expect(result).toEqual({
      width: UPLOAD_LIMITS.image.maxWidth,
      height: UPLOAD_LIMITS.image.maxHeight,
    });
  });
});

describe('exceedsSourceLimit', () => {
  it('refuse un octet au-delà de la limite', () => {
    expect(exceedsSourceLimit(UPLOAD_LIMITS.image.maxSourceBytes + 1)).toBe(true);
  });

  it('accepte exactement à la limite', () => {
    expect(exceedsSourceLimit(UPLOAD_LIMITS.image.maxSourceBytes)).toBe(false);
  });

  it('accepte une taille inconnue plutôt que de bloquer', () => {
    expect(exceedsSourceLimit(undefined)).toBe(false);
  });
});
