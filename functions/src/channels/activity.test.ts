/**
 * La décision d'aperçu d'un canal, éprouvée sans SDK ni émulateur.
 *
 * ## Ce que ce fichier prouve, et ce qu'il ne prouve pas
 *
 * Il prouve **quand** un aperçu doit être écrit, et ce qu'il contient. Il ne
 * prouve rien de Firestore : ni la transaction, ni la fusion, ni le fait que le
 * déclencheur soit branché. Ces trois-là se voient dans
 * `triggers/channel-activity.ts` et dans l'émulateur.
 *
 * ## Le cas qui compte le plus
 *
 * Firestore garantit « au moins une fois » et **pas** l'ordre. Un aperçu écrit
 * sans comparaison de dates reculerait, et la liste des canaux annoncerait un
 * dernier message qui n'est pas le dernier. C'est un défaut qu'aucun test
 * d'intégration ne produit facilement — il faut forcer l'ordre des livraisons,
 * ce qui est exactement ce qu'une fonction pure rend trivial.
 */

import { describe, expect, it } from 'vitest';

import type { ChannelStats } from '@fl/types';

import { channelActivityUpdate } from './activity.js';

const STATS_VIDES: ChannelStats = { messageCount: 0 };

function stats(overrides: Partial<ChannelStats> = {}): ChannelStats {
  return { ...STATS_VIDES, ...overrides };
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    body: 'Bonjour à tous.',
    authorName: 'Camille Durand',
    createdAt: new Date('2026-09-19T10:00:00Z'),
    ...overrides,
  };
}

describe('channelActivityUpdate', () => {
  it('écrit l’aperçu d’un canal qui n’a encore rien reçu', () => {
    const activity = channelActivityUpdate({ existing: undefined, message: message() });

    expect(activity).not.toBeNull();
    expect(activity?.lastMessageAt).toEqual(new Date('2026-09-19T10:00:00Z'));
    expect(activity?.lastMessagePreview).toBe('Bonjour à tous.');
    expect(activity?.lastMessageAuthorName).toBe('Camille Durand');
  });

  it('remplace l’aperçu par un message plus récent', () => {
    const activity = channelActivityUpdate({
      existing: stats({
        lastMessageAt: new Date('2026-09-19T09:00:00Z'),
        lastMessagePreview: 'Le précédent',
        lastMessageAuthorName: 'Quelqu’un',
      }),
      message: message({ body: 'Le suivant' }),
    });

    expect(activity?.lastMessagePreview).toBe('Le suivant');
  });

  it('refuse un message plus ancien que l’aperçu en place', () => {
    // Livraison dans le désordre : sans ce garde, l'aperçu reculerait et la
    // liste annoncerait un dernier message qui n'est pas le dernier.
    const activity = channelActivityUpdate({
      existing: stats({ lastMessageAt: new Date('2026-09-19T11:00:00Z') }),
      message: message({ createdAt: new Date('2026-09-19T10:00:00Z') }),
    });

    expect(activity).toBeNull();
  });

  it('refuse un rejeu du même message', () => {
    // « Au moins une fois » : le même événement peut arriver deux fois. Le
    // réécrire ne changerait rien et coûterait une écriture.
    const activity = channelActivityUpdate({
      existing: stats({ lastMessageAt: new Date('2026-09-19T10:00:00Z') }),
      message: message(),
    });

    expect(activity).toBeNull();
  });

  it('rend un aperçu d’une seule ligne, même sur un message qui en porte plusieurs', () => {
    const activity = channelActivityUpdate({
      existing: undefined,
      message: message({ body: 'Première ligne\n\nSeconde ligne' }),
    });

    expect(activity?.lastMessagePreview).toBe('Première ligne Seconde ligne');
  });

  it('coupe un corps trop long au lieu de recopier le message entier', () => {
    const activity = channelActivityUpdate({
      existing: undefined,
      message: message({ body: 'a'.repeat(500) }),
    });

    const apercu = activity?.lastMessagePreview ?? '';
    expect(apercu.length).toBe(120);
    expect(apercu.endsWith('…')).toBe(true);
  });

  it('signale l’absence de nom plutôt que d’en inventer un', () => {
    // Le déclencheur traduit `null` en suppression : sans cela, la fusion
    // laisserait le nom du message précédent, et l'aperçu mélangerait deux
    // messages.
    const activity = channelActivityUpdate({
      existing: stats({ lastMessageAuthorName: 'Le précédent' }),
      message: message({ authorName: '   ' }),
    });

    expect(activity).not.toBeNull();
    expect(activity?.lastMessageAuthorName).toBeNull();
  });

  it('refuse un message sans date lisible', () => {
    // Sans date, impossible de savoir si ce message est le dernier : écrire
    // reviendrait à le décider au hasard.
    for (const createdAt of [undefined, null, 'hier', { bizarre: true }]) {
      expect(
        channelActivityUpdate({ existing: undefined, message: message({ createdAt }) }),
      ).toBeNull();
    }
  });

  it('refuse un corps vide ou illisible', () => {
    for (const body of ['', '   ', undefined, 42, { texte: 'non' }]) {
      expect(channelActivityUpdate({ existing: undefined, message: message({ body }) })).toBeNull();
    }
  });

  it('accepte une date dans les trois formes que Firestore peut rendre', () => {
    // `Date` en test, `Timestamp` en production, et une chaîne ISO si la donnée
    // vient d'un import. `toDate` est le seul endroit qui connaît les trois.
    const attendu = new Date('2026-09-19T10:00:00Z').getTime();

    const formes = [
      new Date('2026-09-19T10:00:00Z'),
      { seconds: 1789812000, nanoseconds: 0, toDate: () => new Date('2026-09-19T10:00:00Z') },
      '2026-09-19T10:00:00Z',
    ];

    for (const createdAt of formes) {
      const activity = channelActivityUpdate({
        existing: undefined,
        message: message({ createdAt }),
      });
      expect(activity?.lastMessageAt.getTime(), `forme ${JSON.stringify(createdAt)}`).toBe(attendu);
    }
  });
});
