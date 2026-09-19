/**
 * La garde qui précède le routeur.
 *
 * Deux choses s'éprouvent ici, et ce sont deux choses différentes.
 *
 * 1. **La règle.** Ce qui est refusé, et surtout ce qui ne l'est pas. Une garde
 *    trop large casserait des liens légitimes, et personne ne le verrait : un
 *    lien profond refusé n'échoue pas, il ouvre l'écran d'accueil.
 * 2. **Le branchement.** Le fichier que lit Expo Router est importé pour de
 *    vrai, puis appelé. Le vider, l'inverser ou le supprimer fait échouer ces
 *    tests — alors qu'un contrôle qui n'éprouverait que `filtreUrlEntrante`
 *    resterait vert sans plus rien mesurer.
 */
import { buildDeeplink, DEEPLINK_TARGET_TYPES, parseDeeplink } from '@fl/shared';
import { describe, expect, it } from 'vitest';

import { redirectSystemPath } from '../../app/+native-intent';
import { filtreUrlEntrante } from './incoming-url';

/** Un identifiant de document Firestore, tel qu'il arrive dans un lien. */
const ID = 'AbCdEf1234567890abcd';

describe('filtre d’URL entrante', () => {
  it('laisse passer tout lien profond que l’application écrit', () => {
    // L'accord entre deux sources : la garde et la grammaire du lien. Si
    // `buildDeeplink` se mettait un jour à produire une requête, c'est ici que
    // ça se verrait — et non sur un tap qui n'ouvre rien.
    for (const type of DEEPLINK_TARGET_TYPES) {
      const lien = buildDeeplink({ type, id: ID });
      expect(parseDeeplink(lien), `${lien} n'est plus un lien valide`).not.toBeNull();
      expect(filtreUrlEntrante(lien), `${lien} est refusé par la garde`).toBe(lien);
    }
  });

  it('laisse passer un chemin interne', () => {
    expect(filtreUrlEntrante('/post/abc123')).toBe('/post/abc123');
    expect(filtreUrlEntrante('/')).toBe('/');
  });

  it('refuse une URL qui porte une requête', () => {
    expect(filtreUrlEntrante('frereslumieres://post/abc123?x=1')).toBeNull();
    expect(filtreUrlEntrante('/post/abc123?x=1')).toBeNull();
    expect(filtreUrlEntrante('?')).toBeNull();
  });

  it('refuse la charge qui fige le décodeur', () => {
    // La forme exacte mesurée : une requête de `%C3` répété, que
    // `decode-uri-component@0.2.2` met plusieurs secondes à abandonner. La
    // grammaire la refuse déjà, pour la même raison : les deux s'accordent.
    const charge = `frereslumieres://post/abc123?a=${'%C3'.repeat(256)}`;
    expect(parseDeeplink(charge)).toBeNull();
    expect(filtreUrlEntrante(charge)).toBeNull();
  });

  it('ne refuse que la requête, et rien d’autre', () => {
    // La borne opposée : une garde qui refuserait tout passerait tous les tests
    // de refus ci-dessus sans rien valoir, et l'application n'ouvrirait plus
    // jamais rien. Un pour-cent dans le chemin est inoffensif — il est décodé
    // par le décodeur natif, qui est linéaire.
    expect(filtreUrlEntrante('/post/%C3%C3%C3')).toBe('/post/%C3%C3%C3');
    expect(filtreUrlEntrante('/post/abc#haut')).toBe('/post/abc#haut');
  });

  it('ne rend rien pour ce qui n’est pas une chaîne, et ne lève pas', () => {
    // L'URL vient du système d'exploitation : elle peut être absente, nulle,
    // ou d'un tout autre type. Une exception ici ferait planter le démarrage.
    for (const valeur of [undefined, null, 42, {}, [], true]) {
      expect(() => filtreUrlEntrante(valeur)).not.toThrow();
      expect(filtreUrlEntrante(valeur)).toBeNull();
    }
  });

  it('ne rend rien pour une chaîne vide', () => {
    // Expo Router rend `''` pour dire « aucune URL » : c'est une valeur
    // normale, et elle ne doit pas être présentée comme une URL à ouvrir.
    expect(filtreUrlEntrante('')).toBeNull();
  });
});

describe('branchement dans l’application', () => {
  it('laisse passer un lien profond sans requête', () => {
    const lien = buildDeeplink({ type: 'post', id: ID });
    expect(redirectSystemPath({ path: lien, initial: true })).toBe(lien);
  });

  it('annule la navigation pour une URL qui porte une requête', () => {
    expect(redirectSystemPath({ path: '/post/abc123?x=1', initial: false })).toBeNull();
  });

  it('annule aussi pour la charge forgée', () => {
    const charge = `frereslumieres://post/abc123?a=${'%C3'.repeat(256)}`;
    expect(redirectSystemPath({ path: charge, initial: true })).toBeNull();
  });
});
