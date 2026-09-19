import { describe, expect, it } from 'vitest';

import { buildAudienceKeys } from './audience.js';
import { DEFAULT_CHANNELS, MESSAGE_PREVIEW_LENGTH, messagePreview } from './channels.js';
import { REFERENCE_SCHOOLS, schoolForLevel } from './reference.js';

const ORG = 'fcpe-montmagny';
const schoolIds = REFERENCE_SCHOOLS.map((school) => school.id);

describe('DEFAULT_CHANNELS', () => {
  it('identifie chaque canal une seule fois', () => {
    const ids = DEFAULT_CHANNELS.map((channel) => channel.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('numérote l’ordre d’affichage de 1 à N, sans trou ni doublon', () => {
    const orders = DEFAULT_CHANNELS.map((channel) => channel.order).sort((a, b) => a - b);
    expect(orders).toEqual(DEFAULT_CHANNELS.map((_, index) => index + 1));
  });

  it('adresse chaque canal à une audience qui reçoit au moins une clé', () => {
    // Le point qui compte : une audience qui ne produit aucune clé est un
    // canal que personne ne reçoit, et rien d'autre ne le signalerait.
    for (const channel of DEFAULT_CHANNELS) {
      expect(buildAudienceKeys(channel.audience, ORG), `canal « ${channel.id} »`).not.toEqual([]);
    }
  });

  it('ne vise aucune école qui n’existe pas', () => {
    for (const channel of DEFAULT_CHANNELS) {
      const { schoolId } = channel.audience;
      if (schoolId) {
        expect(schoolIds, `canal « ${channel.id} »`).toContain(schoolId);
      }
    }
  });

  it('retrouve l’école d’un canal de niveau au lieu de l’écrire', () => {
    const levelChannels = DEFAULT_CHANNELS.filter((channel) => channel.type === 'level');
    expect(levelChannels.length).toBeGreaterThan(0);
    for (const channel of levelChannels) {
      const { level } = channel.audience;
      if (!level) {
        throw new Error(`Canal de niveau « ${channel.id} » sans niveau : audience incomplète.`);
      }
      expect(channel.audience.schoolId).toBe(schoolForLevel(level).id);
    }
  });

  it('ne crée aucun canal réservé à la FCPE', () => {
    // Un canal `fcpe` est invisible aux parents : les règles le refusent.
    // En ajouter un est un acte délibéré, pas un effet de bord d'un refactor.
    expect(DEFAULT_CHANNELS.filter((channel) => channel.type === 'fcpe')).toEqual([]);
    expect(DEFAULT_CHANNELS.filter((channel) => channel.audience.type === 'fcpe')).toEqual([]);
  });

  it('donne à chaque canal un nom et une description lisibles', () => {
    for (const channel of DEFAULT_CHANNELS) {
      expect(channel.name.trim(), `canal « ${channel.id} »`).not.toBe('');
      expect(channel.description.trim(), `canal « ${channel.id} »`).not.toBe('');
    }
  });
});

describe('messagePreview', () => {
  it('laisse intact un message qui tient déjà sur une ligne', () => {
    expect(messagePreview('Bonjour à tous.')).toBe('Bonjour à tous.');
  });

  it('ramène les blancs à une seule espace', () => {
    // Un aperçu tient sur une ligne, alors qu'un message en porte plusieurs.
    expect(messagePreview('Première ligne\n\nSeconde   ligne')).toBe(
      'Première ligne Seconde ligne',
    );
  });

  it('retire les blancs de bord', () => {
    expect(messagePreview('   Bonjour.   ')).toBe('Bonjour.');
  });

  it('coupe à la longueur annoncée, ellipse comprise', () => {
    const apercu = messagePreview('a'.repeat(500));

    expect(apercu.length).toBe(MESSAGE_PREVIEW_LENGTH);
    expect(apercu.endsWith('…')).toBe(true);
  });

  it('ne laisse pas d’espace avant l’ellipse', () => {
    // Sans le retrait, la coupe au milieu d'un mot laisse un blanc, et
    // l'ellipse flotterait après un trou.
    const apercu = messagePreview(`${'mot '.repeat(40)}fin`);

    expect(apercu.endsWith(' …')).toBe(false);
    expect(apercu.endsWith('…')).toBe(true);
  });

  it('ne coupe pas un message de la longueur exacte', () => {
    const exact = 'a'.repeat(MESSAGE_PREVIEW_LENGTH);

    expect(messagePreview(exact)).toBe(exact);
    expect(messagePreview(exact)).not.toContain('…');
  });
});
