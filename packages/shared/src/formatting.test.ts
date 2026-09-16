import { describe, expect, it } from 'vitest';

import { getAcademicYear, getAcademicYearRange } from './formatting.js';

/**
 * L'année scolaire est un calcul qui ne se trompe qu'une fois par an. Ces
 * tests existent pour que l'erreur soit détectée en intégration continue
 * plutôt qu'en août, sur les données réelles des familles.
 *
 * Ils verrouillent aussi la **date de bascule** : le script d'amorçage et
 * l'application mobile s'appuient sur la même fonction, et une bascule
 * déplacée d'un mois ferait diverger les classes créées et les rattachements
 * enregistrés.
 */
describe('getAcademicYear', () => {
  it('désigne l’année qui commence en août', () => {
    expect(getAcademicYear(new Date('2026-08-01T12:00:00'))).toBe('2026-2027');
  });

  it('reste sur l’année en cours pendant tout le reste de l’année civile', () => {
    // Le piège : en janvier 2027, l'année scolaire est toujours 2026-2027.
    expect(getAcademicYear(new Date('2027-01-15T08:00:00'))).toBe('2026-2027');
    expect(getAcademicYear(new Date('2027-06-30T23:00:00'))).toBe('2026-2027');
    expect(getAcademicYear(new Date('2027-07-31T23:59:00'))).toBe('2026-2027');
  });

  it('bascule le 1er août, et pas à la rentrée de septembre', () => {
    // C'est en août que la FCPE crée les classes de l'année à venir. Une
    // bascule en septembre étiquetterait ces classes de l'année sortante.
    expect(getAcademicYear(new Date('2027-08-01T00:00:00'))).toBe('2027-2028');
    expect(getAcademicYear(new Date('2027-08-15T12:00:00'))).toBe('2027-2028');
  });

  it('reste cohérente sur une année complète', () => {
    const inYear = ['2026-08-15', '2026-09-15', '2026-12-25', '2027-01-01', '2027-03-20'];
    const outOfYear = ['2026-07-31', '2026-01-15'];

    for (const day of inYear) {
      expect(getAcademicYear(new Date(`${day}T12:00:00`))).toBe('2026-2027');
    }
    for (const day of outOfYear) {
      expect(getAcademicYear(new Date(`${day}T12:00:00`))).toBe('2025-2026');
    }
  });

  it('produit toujours un format accepté par le schéma d’inscription', () => {
    for (const year of [2026, 2027, 2030, 2100]) {
      for (const month of [0, 3, 7, 11]) {
        const value = getAcademicYear(new Date(year, month, 15));
        expect(value).toMatch(/^\d{4}-\d{4}$/);

        const [start, end] = value.split('-');
        expect(Number(end)).toBe(Number(start) + 1);
      }
    }
  });
});

describe('getAcademicYearRange', () => {
  it('couvre du 1er août au 31 juillet', () => {
    const { start, end } = getAcademicYearRange('2026-2027');

    expect(start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-07-31T23:59:59.000Z');
  });

  it('produit des bornes cohérentes avec la fonction de calcul', () => {
    const { start } = getAcademicYearRange(getAcademicYear(new Date('2026-09-15T12:00:00')));
    expect(start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('accepte aussi une année seule, format admis par les documents', () => {
    // `documentInputSchema.year` accepte « 2026 » comme « 2026-2027 » : la
    // fonction doit donc accepter les deux, sinon une borne légitime
    // deviendrait impossible à calculer.
    const { start, end } = getAcademicYearRange('2026');

    expect(start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-07-31T23:59:59.000Z');
  });

  it('refuse une année non numérique', () => {
    expect(() => getAcademicYearRange('abcd')).toThrow();
    expect(() => getAcademicYearRange('')).toThrow();
  });
});
