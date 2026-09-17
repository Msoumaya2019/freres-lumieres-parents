/**
 * Le comptage des reçus, sans réseau ni attente.
 *
 * ## Pourquoi cette fonction a ses propres tests
 *
 * Elle est le seul endroit qui décide de ce que signifient les trois réponses
 * possibles du service — remis, échoué, pas encore de reçu — et de ce que
 * signifie une réponse qu'on ne comprend pas. Ces décisions se vérifient ligne
 * à ligne ici ; les tests d'`expo.ts` vérifient qu'elles sont bien atteintes à
 * travers un `fetch` simulé, ce qui est un autre travail.
 *
 * ## L'invariant, et pourquoi il est testé
 *
 * `delivered + failed + pending === ticketIds.length`. Un identifiant oublié
 * dans le comptage ne produit aucune erreur : il produit un total plus petit,
 * et l'administration lit un envoi partiel sans savoir qu'il manque quelque
 * chose. C'est l'invariant qui rend l'omission visible.
 */
import { describe, expect, it } from 'vitest';

import { summariseReceipts } from './receipts.js';

describe('summariseReceipts', () => {
  it('compte un reçu « ok » comme remis', () => {
    const comptes = summariseReceipts(['t1'], { t1: { status: 'ok' } });

    expect(comptes).toEqual({ delivered: 1, failed: 0, pending: 0, deadTicketIds: [] });
  });

  it('compte un reçu en erreur comme échoué', () => {
    const comptes = summariseReceipts(['t1'], {
      t1: { status: 'error', message: 'Message too long' },
    });

    expect(comptes).toEqual({ delivered: 0, failed: 1, pending: 0, deadTicketIds: [] });
  });

  it('compte un identifiant sans reçu comme en attente', () => {
    // Le service omet les identifiants dont il n'a pas encore la réponse ; il
    // ne rend jamais un reçu vide. L'absence n'est donc ni une remise ni une
    // panne — c'est l'ignorance, et elle a son propre compteur.
    const comptes = summariseReceipts(['t1'], {});

    expect(comptes).toEqual({ delivered: 0, failed: 0, pending: 1, deadTicketIds: [] });
  });

  it('retient l’identifiant d’un appareil désinstallé', () => {
    const comptes = summariseReceipts(['t-mort', 't-vivant'], {
      't-mort': { status: 'error', details: { error: 'DeviceNotRegistered' } },
      't-vivant': { status: 'ok' },
    });

    expect(comptes.deadTicketIds).toEqual(['t-mort']);
    expect(comptes.delivered).toBe(1);
    expect(comptes.failed).toBe(1);
  });

  it('compte comme échoué un statut qu’il ne connaît pas', () => {
    // Quatrième cas, celui que le service n'envoie pas : une évolution de son
    // vocabulaire. Un reçu illisible n'est pas une confirmation de remise, et
    // se tromper dans ce sens-là ferait annoncer des parents informés qui ne le
    // sont pas. Le doute se tranche toujours du côté sombre.
    const comptes = summariseReceipts(['t1'], {
      t1: { status: 'peut-être' } as unknown as { status: 'ok' },
    });

    expect(comptes).toEqual({ delivered: 0, failed: 1, pending: 0, deadTicketIds: [] });
  });

  it('n’oublie aucun identifiant, quel que soit le mélange', () => {
    const identifiants = ['a', 'b', 'c', 'd', 'e'];
    const comptes = summariseReceipts(identifiants, {
      a: { status: 'ok' },
      b: { status: 'error', details: { error: 'DeviceNotRegistered' } },
      c: { status: 'error', message: 'MessageRateExceeded' },
      // d et e : pas de reçu.
    });

    expect(comptes.delivered + comptes.failed + comptes.pending).toBe(identifiants.length);
    expect(comptes).toEqual({ delivered: 1, failed: 2, pending: 2, deadTicketIds: ['b'] });
  });

  it('ignore un reçu qu’on n’a pas demandé', () => {
    // La référence est la demande, pas la réponse : compter ce qu'on n'a pas
    // demandé gonflerait un total que rien ne bornerait.
    const comptes = summariseReceipts(['t1'], {
      t1: { status: 'ok' },
      inconnu: { status: 'ok' },
    });

    expect(comptes.delivered).toBe(1);
  });
});
