/**
 * Le dépôt des canaux, éprouvé sur une base **injectable**.
 *
 * ## Ce que ce fichier prouve, et ce qu'il ne prouve pas
 *
 * Il prouve ce que le **dépôt** écrit et ce qu'il refuse. Il ne prouve **rien**
 * de Firestore : `firebase/firestore` est remplacé par un faux, et une écriture
 * acceptée ici peut parfaitement être refusée par les règles.
 *
 * Les deux moitiés vivent séparément, et c'est voulu.
 * `packages/testing/src/firestore.rules.test.ts` fixe ce que les **règles**
 * permettent — dont le fait qu'une liste de canaux non contrainte sur `type`
 * est refusée à un parent. Ici, on mesure la couche au-dessus.
 *
 * ## Le faux est délibérément bête
 *
 * Il enregistre, il restitue, il ne juge rien. Un faux qui *déciderait*
 * quelque chose mesurerait le faux, et un test vert ne dirait plus rien du code
 * de production.
 *
 * ## Le premier test est le plus important
 *
 * `sendMessage` doit écrire les six champs que la règle de modification fige.
 * `unchanged()` **lève une erreur sur un champ absent**, et une erreur vaut
 * refus : un message créé sans `attachments` ou sans `createdAt` ne pourrait
 * plus jamais être corrigé par son auteur. Aucun test de règle ne peut le
 * voir — les règles voient le document tel qu'il est écrit, pas ce que le
 * dépôt a oublié.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Firestore } from 'firebase/firestore';
import type * as sdkFirestore from 'firebase/firestore';
import type { AppError } from '@fl/types';

import { VISIBLE_CHANNEL_TYPES, createChannelRepository } from './channels.js';

/** Ce que rend `serverTimestamp()`. Une sentinelle, surtout pas une date. */
const SENTINELLE = { __sentinelle: 'serverTimestamp' } as const;

interface DocFactice {
  readonly path: string;
  readonly id: string;
}

/** Les documents écrits, par chemin. */
const documents = new Map<string, Record<string, unknown>>();

/** Les écritures observées, dans l'ordre. */
const ecritures: Array<{ path: string; data: Record<string, unknown> }> = [];

/** Les contraintes de la dernière requête construite. */
let derniereRequete: { champs: Array<{ type: string; args: unknown[] }>; limite?: number } = {
  champs: [],
};

/** Le contenu que `getDocs` et `onSnapshot` rendront, par chemin de collection. */
const collections = new Map<string, Array<{ id: string; data: Record<string, unknown> }>>();

/** Les gestionnaires de l'abonnement en cours, pour les déclencher à la main. */
let abonnement: {
  onChange: (snapshot: unknown) => void;
  onError?: (error: unknown) => void;
  desabonne: boolean;
} | null = null;

vi.mock('firebase/firestore', async (importOriginal) => {
  const reel = await importOriginal<typeof sdkFirestore>();

  const faux = {
    collection: (_db: unknown, path: string): { __collection: string } => ({ __collection: path }),

    doc: (premier: unknown, second?: unknown): DocFactice => {
      if (typeof second === 'string') return { path: second, id: second.split('/').pop() ?? '' };
      const chemin = (premier as { __collection: string }).__collection;
      return { path: `${chemin}/identifiant-genere`, id: 'identifiant-genere' };
    },

    getDoc: async (ref: DocFactice) => {
      const donnees = documents.get(ref.path);
      return { id: ref.id, exists: () => donnees !== undefined, data: () => donnees };
    },

    setDoc: async (ref: DocFactice, data: Record<string, unknown>) => {
      ecritures.push({ path: ref.path, data });
      documents.set(ref.path, { ...documents.get(ref.path), ...data });
    },

    where: (champ: string, operateur: string, valeur: unknown) => {
      derniereRequete.champs.push({ type: 'where', args: [champ, operateur, valeur] });
      return { __where: champ };
    },

    orderBy: (champ: string, sens: string) => {
      derniereRequete.champs.push({ type: 'orderBy', args: [champ, sens] });
      return { __orderBy: champ };
    },

    limit: (valeur: number) => {
      derniereRequete.limite = valeur;
      return { __limit: valeur };
    },

    query: (...pieces: unknown[]) => ({ __query: pieces }),

    getDocs: async (requete: { __query: unknown[] }) => {
      const chemin = collectionDe(requete);
      const contenu = collections.get(chemin) ?? [];
      return { docs: contenu.map((entree) => snapshot(entree)) };
    },

    onSnapshot: (
      _requete: unknown,
      onChange: (snapshot: unknown) => void,
      onError?: (error: unknown) => void,
    ) => {
      abonnement = { onChange, onError, desabonne: false };
      return () => {
        if (abonnement) abonnement.desabonne = true;
      };
    },

    serverTimestamp: () => SENTINELLE,
  };

  return { ...reel, ...faux } as unknown as typeof reel;
});

/** Chemin de collection porté par une requête construite par le faux. */
function collectionDe(requete: { __query: unknown[] }): string {
  const collection = requete.__query.find(
    (piece): piece is { __collection: string } =>
      typeof piece === 'object' && piece !== null && '__collection' in piece,
  );
  return collection?.__collection ?? '';
}

function snapshot(entree: { id: string; data: Record<string, unknown> }) {
  return { id: entree.id, exists: () => true, data: () => entree.data };
}

const depot = createChannelRepository({} as Firestore);

/**
 * Attend un refus, et le rend.
 *
 * Il **lève** si l'appel réussit : un `catch` qui rendrait `undefined` sans rien
 * dire ferait passer un appel accepté pour un appel refusé. Le code reste à
 * vérifier par l'appelant, parce que « refusé » ne dit pas **pourquoi**.
 */
async function refusDe(appel: Promise<unknown>): Promise<AppError> {
  let resultat: unknown;
  let refuse = false;

  try {
    resultat = await appel;
  } catch (error) {
    refuse = true;
    resultat = error;
  }

  if (!refuse) {
    throw new Error(`l’appel devait être refusé, et il a rendu ${JSON.stringify(resultat)}`);
  }

  return resultat as AppError;
}

/** Auteur de test : les trois champs que le dépôt doit recopier. */
const AUTEUR = { id: 'parent-1', name: 'Camille Durand', role: 'parent' } as const;

beforeEach(() => {
  documents.clear();
  // `Array` n'a pas de `clear()` — c'est une méthode de `Map`. La longueur est
  // la seule façon de vider une liste sans la réaffecter.
  ecritures.length = 0;
  collections.clear();
  abonnement = null;
  derniereRequete = { champs: [] };
});

describe('sendMessage', () => {
  it('écrit les six champs que la règle de modification fige', async () => {
    // C'est le test qui compte. `unchanged()` lève sur un champ absent, donc
    // oublier l'un de ces six rendrait le message définitivement incorrigible
    // par son auteur — et aucun test de règle ne peut le voir.
    await depot.sendMessage({
      channelId: 'channel-1',
      author: AUTEUR,
      input: { body: 'Bonjour à tous.', attachments: [] },
    });

    const ecrit = ecritures[0]?.data;
    expect(ecrit).toBeDefined();

    for (const champ of [
      'authorName',
      'authorRole',
      'attachments',
      'reactions',
      'reportCount',
      'createdAt',
    ]) {
      expect(Object.keys(ecrit ?? {}), `champ figé manquant : ${champ}`).toContain(champ);
    }
  });

  it('écrit l’identité de l’auteur telle qu’elle lui est donnée', async () => {
    await depot.sendMessage({
      channelId: 'channel-1',
      author: AUTEUR,
      input: { body: 'Bonjour.', attachments: [] },
    });

    expect(ecritures[0]?.data).toMatchObject({
      channelId: 'channel-1',
      authorId: 'parent-1',
      authorName: 'Camille Durand',
      authorRole: 'parent',
      status: 'visible',
      reportCount: 0,
      reactions: {},
    });
  });

  it('refuse un message vide', async () => {
    const refus = await refusDe(
      depot.sendMessage({
        channelId: 'channel-1',
        author: AUTEUR,
        input: { body: '   ', attachments: [] },
      }),
    );

    expect(refus.code).toBe('invalid-argument');
    expect(ecritures).toEqual([]);
  });

  it('refuse un message plus long que la limite', async () => {
    const refus = await refusDe(
      depot.sendMessage({
        channelId: 'channel-1',
        author: AUTEUR,
        input: { body: 'a'.repeat(2001), attachments: [] },
      }),
    );

    expect(refus.code).toBe('invalid-argument');
    expect(ecritures).toEqual([]);
  });

  it('retient le message cité et son aperçu', async () => {
    await depot.sendMessage({
      channelId: 'channel-1',
      author: AUTEUR,
      input: { body: 'Je réponds.', replyToId: 'message-1', attachments: [] },
      replyToPreview: 'Quelqu’un a une perceuse ?',
    });

    expect(ecritures[0]?.data).toMatchObject({
      replyToId: 'message-1',
      replyToPreview: 'Quelqu’un a une perceuse ?',
    });
  });

  it('tronque un aperçu trop long plutôt que de recopier le message entier', async () => {
    await depot.sendMessage({
      channelId: 'channel-1',
      author: AUTEUR,
      input: { body: 'Je réponds.', replyToId: 'message-1', attachments: [] },
      replyToPreview: 'a'.repeat(500),
    });

    const apercu = ecritures[0]?.data.replyToPreview as string;
    expect(apercu.length).toBe(120);
    expect(apercu.endsWith('…')).toBe(true);
  });

  it('n’écrit aucune référence de réponse quand il n’y en a pas', async () => {
    await depot.sendMessage({
      channelId: 'channel-1',
      author: AUTEUR,
      input: { body: 'Bonjour.', attachments: [] },
    });

    expect(ecritures[0]?.data).not.toHaveProperty('replyToId');
    expect(ecritures[0]?.data).not.toHaveProperty('replyToPreview');
  });
});

describe('subscribeToMessages', () => {
  it('rend les messages du plus ancien au plus récent', () => {
    // La requête est descendante — c'est le seul moyen d'obtenir les *derniers*
    // trente — et l'écran lit de haut en bas. Le retournement est donc ici.
    const messages = [
      { id: 'recent', data: { body: 'Le plus récent' } },
      { id: 'ancien', data: { body: 'Le plus ancien' } },
    ];
    collections.set('channels/channel-1/messages', messages);

    let rendus: Array<{ id: string }> = [];
    depot.subscribeToMessages({
      channelId: 'channel-1',
      onChange: (recus) => {
        rendus = recus;
      },
    });

    abonnement?.onChange({ docs: messages.map(snapshot) });

    expect(rendus.map((message) => message.id)).toEqual(['ancien', 'recent']);
  });

  it('contraint le statut, sans quoi la lecture serait refusée en bloc', () => {
    depot.subscribeToMessages({ channelId: 'channel-1', onChange: () => undefined });

    expect(derniereRequete.champs).toContainEqual({
      type: 'where',
      args: ['status', '==', 'visible'],
    });
  });

  it('remet l’erreur au gestionnaire au lieu de la lever', () => {
    // Un abonnement refusé est parfaitement silencieux : l'écran resterait vide
    // sans que rien ne dise pourquoi. Sans gestionnaire, le dépôt lève.
    let recue: unknown = null;
    depot.subscribeToMessages({
      channelId: 'channel-1',
      onChange: () => undefined,
      onError: (error) => {
        recue = error;
      },
    });

    const erreur = Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
    abonnement?.onError?.(erreur);

    expect(recue).not.toBeNull();
  });

  it('rend une fonction de désabonnement', () => {
    const desabonner = depot.subscribeToMessages({
      channelId: 'channel-1',
      onChange: () => undefined,
    });

    desabonner();
    expect(abonnement?.desabonne).toBe(true);
  });
});

describe('listChannels', () => {
  it('écarte le type fcpe pour un parent', () => {
    // Mesuré par `firestore.rules.test.ts` : sans cette contrainte, la requête
    // est refusée en `permission-denied` — une règle n'est pas un filtre.
    depot.listChannels({ orgId: 'fcpe-montmagny', isFcpe: false });

    expect(derniereRequete.champs).toContainEqual({
      type: 'where',
      args: ['type', 'in', [...VISIBLE_CHANNEL_TYPES]],
    });
  });

  it('n’écarte rien pour un membre FCPE, à qui la règle ouvre tout', () => {
    depot.listChannels({ orgId: 'fcpe-montmagny', isFcpe: true });

    const contraintesType = derniereRequete.champs.filter(
      (champ) => champ.type === 'where' && champ.args[0] === 'type',
    );
    expect(contraintesType).toEqual([]);
  });

  it('ne propose jamais fcpe parmi les types visibles', () => {
    expect(VISIBLE_CHANNEL_TYPES).not.toContain('fcpe');
  });

  it('range les canaux par ordre d’affichage, pour un parent', () => {
    // Le tri est fait par Firestore, pas par l'écran. Sans cette contrainte,
    // les treize canaux sortiraient dans l'ordre des identifiants — `general`,
    // qui doit ouvrir la liste, pourrait arriver dernier.
    depot.listChannels({ orgId: 'fcpe-montmagny', isFcpe: false });

    expect(derniereRequete.champs).toContainEqual({ type: 'orderBy', args: ['order', 'asc'] });
  });

  it('range les canaux par ordre d’affichage, pour un membre FCPE', () => {
    // Les deux rôles construisent leur requête séparément : une régression
    // peut n'en toucher qu'une, et la liste ne changerait d'ordre que pour
    // l'un des deux. C'est le même invariant, mais pas le même chemin.
    depot.listChannels({ orgId: 'fcpe-montmagny', isFcpe: true });

    expect(derniereRequete.champs).toContainEqual({ type: 'orderBy', args: ['order', 'asc'] });
  });
});
