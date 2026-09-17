/**
 * Filtrage et découpage des destinataires d'une notification.
 *
 * ## Pourquoi ces deux fonctions méritent des tests
 *
 * Elles décident **qui** reçoit une information, et leurs erreurs ne se voient
 * pas : un parent simplement privé de ce à quoi il a droit, ou un envoi refusé
 * par l'API parce qu'un lot est trop gros — et dans ce second cas, c'est tout
 * le lot qui échoue, pas seulement le jeton en trop.
 *
 * `filterRecipients` porte en plus la seule exception de tout le système : les
 * alertes `urgent` ne sont jamais filtrées. C'est la règle qui compte le plus,
 * et c'est donc celle qu'il faut éprouver en premier.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { NotificationCategory } from '@fl/types';

import type { PushMessage, PushRecipient } from './dispatcher.js';
import {
  androidChannelId,
  chunkRecipients,
  filterRecipients,
  messageTopics,
} from './dispatcher.js';
import { findRepoRoot } from '../test-helpers/repo-root.js';

/** Toutes les catégories de la spécification, dans son ordre. */
const CATEGORIES: readonly NotificationCategory[] = [
  'urgent',
  'publications',
  'discussions',
  'sondages',
  'signalements',
  'agenda',
  'vie_fcpe',
];

function recipient(overrides: Partial<PushRecipient> = {}): PushRecipient {
  return {
    token: 'ExponentPushToken[abc]',
    platform: 'android',
    enabled: true,
    disabledCategories: [],
    audienceKeys: ['org:fcpe-montmagny'],
    ...overrides,
  };
}

function message(overrides: Partial<PushMessage> = {}): PushMessage {
  return {
    title: 'Cantine',
    body: 'Le menu change lundi',
    category: 'publications',
    audienceKeys: ['org:fcpe-montmagny'],
    data: { type: 'post', orgId: 'fcpe-montmagny' },
    ...overrides,
  };
}

describe('androidChannelId', () => {
  it('dérive un canal par catégorie', () => {
    expect(androidChannelId('urgent')).toBe('fl-urgent');
    expect(androidChannelId('vie_fcpe')).toBe('fl-vie_fcpe');
  });

  it('donne un canal distinct à chaque catégorie', () => {
    // Deux catégories qui partageraient un canal imposeraient le même réglage
    // de son à l'utilisateur : couper « discussions » couperait « urgent ».
    expect(new Set(CATEGORIES.map(androidChannelId)).size).toBe(CATEGORIES.length);
  });
});

describe('messageTopics', () => {
  it('convertit chaque clé d’audience en topic', () => {
    // Les topics ne servent pas en V1 — l'envoi passe par Expo —, mais la
    // conversion doit rester celle du client, sinon une bascule vers FCM
    // direct viserait des topics que personne n'écoute.
    expect(
      messageTopics(message({ audienceKeys: ['org:fcpe-montmagny', 'level:elem:CE1'] })),
    ).toEqual(['org_fcpe-montmagny', 'level_elem_ce1']);
  });

  it('rend une liste vide sans clé d’audience', () => {
    expect(messageTopics(message({ audienceKeys: [] }))).toEqual([]);
  });
});

describe('filterRecipients', () => {
  it('écarte le parent qui a désactivé la catégorie', () => {
    const destinataires = [
      recipient({ token: 'a' }),
      recipient({ token: 'b', disabledCategories: ['publications'] }),
    ];

    expect(filterRecipients(destinataires, 'publications').map((r) => r.token)).toEqual(['a']);
  });

  it('garde tout le monde pour une alerte urgente', () => {
    // L'exception de tout le système, et la règle qui compte le plus : une
    // fermeture d'école doit atteindre tout le monde, y compris un parent qui
    // a décoché « urgent » — ou tout décoché.
    const destinataires = [
      recipient({ token: 'a', disabledCategories: ['urgent'] }),
      recipient({ token: 'b', disabledCategories: CATEGORIES }),
    ];

    expect(filterRecipients(destinataires, 'urgent').map((r) => r.token)).toEqual(['a', 'b']);
  });

  it('écarte l’appareil éteint, sauf pour une alerte urgente', () => {
    // L'interrupteur général d'un téléphone ne coupe pas les alertes. Cette
    // règle n'était appliquée **nulle part** : la requête Firestore écartait
    // les appareils éteints avant même que le filtre les voie, donc un parent
    // ayant coupé ses notifications ne recevait plus aucune fermeture d'école.
    const destinataires = [
      recipient({ token: 'allume' }),
      recipient({ token: 'eteint', enabled: false }),
    ];

    expect(filterRecipients(destinataires, 'publications').map((r) => r.token)).toEqual(['allume']);
    expect(filterRecipients(destinataires, 'urgent').map((r) => r.token)).toEqual([
      'allume',
      'eteint',
    ]);
  });

  it('ne filtre que la catégorie concernée', () => {
    // Un parent qui a coupé « discussions » doit continuer de recevoir les
    // publications. Filtrer sur la simple présence d'une catégorie désactivée,
    // quelle qu'elle soit, le priverait de tout — le défaut le plus coûteux
    // possible, et le plus discret.
    const destinataires = [recipient({ disabledCategories: ['discussions'] })];

    expect(filterRecipients(destinataires, 'publications')).toHaveLength(1);
    expect(filterRecipients(destinataires, 'discussions')).toHaveLength(0);
  });

  it('conserve l’ordre des destinataires', () => {
    const destinataires = ['a', 'b', 'c'].map((token) => recipient({ token }));

    expect(filterRecipients(destinataires, 'publications').map((r) => r.token)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('rend une liste vide quand tous ont désactivé la catégorie', () => {
    const destinataires = ['a', 'b'].map((token) =>
      recipient({ token, disabledCategories: ['agenda'] }),
    );

    expect(filterRecipients(destinataires, 'agenda')).toEqual([]);
  });

  it('ne modifie pas la liste reçue', () => {
    // La liste vient d'une requête Firestore. La tronquer sur place fausserait
    // un envoi suivant qui réutiliserait les mêmes objets.
    const destinataires = [recipient({ disabledCategories: ['agenda'] })];

    filterRecipients(destinataires, 'agenda');

    expect(destinataires).toHaveLength(1);
  });

  it('rend une copie même quand personne n’est filtré', () => {
    // Le cas `urgent` rend `[...recipients]` : le résultat ne doit pas être la
    // liste d'origine, sinon un appelant qui la trie réordonnerait la source.
    const destinataires = [recipient()];

    expect(filterRecipients(destinataires, 'urgent')).not.toBe(destinataires);
  });
});

describe('chunkRecipients', () => {
  function destinataires(nombre: number): PushRecipient[] {
    return Array.from({ length: nombre }, (_, index) => recipient({ token: `t${index}` }));
  }

  it('tient dans un seul lot en dessous de la taille limite', () => {
    expect(chunkRecipients(destinataires(2))).toHaveLength(1);
  });

  it('coupe à la taille demandée', () => {
    expect(chunkRecipients(destinataires(5), 2).map((lot) => lot.length)).toEqual([2, 2, 1]);
  });

  it('ne dépasse jamais la limite de l’API', () => {
    // L'API Expo Push accepte 100 jetons par requête. Un lot de 101 fait
    // échouer l'envoi **entier** — pas seulement le jeton en trop.
    expect(chunkRecipients(destinataires(101)).map((lot) => lot.length)).toEqual([100, 1]);
  });

  it('fait exactement un lot à la taille limite', () => {
    // La borne est inclusive : découper « au-delà de 100 » au lieu de « 100 et
    // plus » produirait ici un second lot vide, donc un appel réseau inutile.
    expect(chunkRecipients(destinataires(100))).toHaveLength(1);
  });

  it('ne perd aucun destinataire', () => {
    const total = chunkRecipients(destinataires(37), 5).reduce((sum, lot) => sum + lot.length, 0);

    expect(total).toBe(37);
  });

  it('rend aucun lot pour une liste vide', () => {
    // Un lot vide ferait un appel réseau qui ne peut rien envoyer.
    expect(chunkRecipients([])).toEqual([]);
  });
});

/**
 * L'exception est-elle lue dans la liste, ou recopiée ?
 *
 * `filterRecipients` doit interroger `MANDATORY_NOTIFICATION_CATEGORIES`, et
 * non comparer à la chaîne `'urgent'`. Les deux se comportent **identiquement**
 * aujourd'hui — la liste ne contient qu'une valeur —, donc aucun test de
 * comportement ne peut les distinguer. C'est précisément ce qui rend la recopie
 * dangereuse : le jour où une seconde catégorie deviendrait obligatoire, elle
 * serait refusée par le schéma, absente des interrupteurs de l'écran, et
 * appliquée quand même à l'envoi — sans que rien ne tombe.
 *
 * La source est donc lue, comme `deeplinks.test.ts` lit le dossier `app/` et
 * `paths.test.ts` la table des collections.
 */
describe('source unique de l’exception', () => {
  const SOURCE = readFileSync(
    join(findRepoRoot(), 'packages', 'shared', 'src', 'push', 'dispatcher.ts'),
    'utf8',
  );

  it('interroge la liste plutôt que de comparer à `urgent`', () => {
    expect(SOURCE).toContain('isMandatoryNotificationCategory(category)');
    expect(SOURCE).not.toContain("=== 'urgent'");
  });

  it('lit bien le fichier attendu', () => {
    // Sans cette garde, un chemin erroné ferait échouer le test précédent pour
    // une mauvaise raison — ou, si la lecture rendait une chaîne vide, le
    // ferait passer en ne vérifiant rien.
    expect(SOURCE).toContain('export function filterRecipients');
  });
});
