/**
 * Les liens profonds se relisent-ils comme ils s'écrivent ?
 *
 * Deux choses sont vérifiées ici, et ce sont deux choses différentes.
 *
 * 1. **L'aller-retour.** `parseDeeplink` doit reconnaître exactement ce que
 *    `buildDeeplink` produit, et refuser tout le reste. Un analyseur trop
 *    permissif laisse passer une chaîne qu'on n'a pas écrite ; un analyseur
 *    trop strict rend l'application muette au tap, sans erreur nulle part.
 * 2. **La couverture.** Chaque type de cible doit être soit ouvrable, soit
 *    déclaré sans route avec sa raison écrite — et chaque route déclarée doit
 *    correspondre à un fichier réel de `apps/mobile/app/`. C'est ce second
 *    point qui empêche la table des routes de se désynchroniser du dossier
 *    `app/` en silence : renommer un écran ne casse aucun test sans lui.
 *
 * Les fichiers sont lus sur le disque, comme `paths.test.ts` compare les noms
 * de collections : deux listes recopiées divergent en silence, et rien ne le
 * signale avant qu'un parent ne tape sur une notification.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  APP_SCHEME,
  buildDeeplink,
  DEEPLINK_ROUTES,
  DEEPLINK_TARGET_TYPES,
  parseDeeplink,
  routeForDeeplink,
  TYPES_SANS_ROUTE,
} from './deeplinks.js';
import { findRepoRoot } from './test-helpers/repo-root.js';

/** `expo.scheme` tel que déclaré par l'application mobile. */
function schemeDeclareParApplication(): unknown {
  const chemin = join(findRepoRoot(), 'apps', 'mobile', 'app.json');
  const app = JSON.parse(readFileSync(chemin, 'utf8')) as { expo?: { scheme?: unknown } };
  return app.expo?.scheme;
}

const DOSSIER_ROUTES = (): string => join(findRepoRoot(), 'apps', 'mobile', 'app');

/**
 * Contenu du dossier de route, ou `null` s'il n'existe pas.
 *
 * Le dossier est celui qui suit la base : `/post` se vérifie dans
 * `apps/mobile/app/post/`, et non dans `apps/mobile/app/post`.
 */
function contenuDuDossierDeRoute(base: string): string[] | null {
  const nom = base.replace(/^\//, '');
  const chemin = join(DOSSIER_ROUTES(), nom);
  return existsSync(chemin) ? readdirSync(chemin) : null;
}

describe('liens profonds', () => {
  it('emploie le schéma déclaré dans app.json', () => {
    // Si ce test casse, ce n'est pas lui qu'il faut corriger : c'est l'un des
    // deux côtés. Changer le schéma de l'application sans changer celui-ci
    // rendrait toutes les notifications muettes au tap, sans erreur nulle part.
    expect(schemeDeclareParApplication()).toBe(APP_SCHEME);
  });

  it('construit le lien d’une publication', () => {
    expect(buildDeeplink({ type: 'post', id: 'post-abc123' })).toBe(
      'frereslumieres://post/post-abc123',
    );
  });

  it('suit la même forme pour les autres écrans', () => {
    // La forme est un contrat : l'application analysera `{type}/{id}`. Un
    // écran qui s'écarterait de cette forme casserait l'analyse, pas ce test.
    expect(buildDeeplink({ type: 'channel', id: 'ce1' })).toBe('frereslumieres://channel/ce1');
    expect(buildDeeplink({ type: 'poll', id: 'sondage-1' })).toBe(
      'frereslumieres://poll/sondage-1',
    );
  });

  it('relit ce qu’il a écrit, pour chaque type de cible', () => {
    // La borne opposée du refus : un analyseur qui rendrait toujours `null`
    // passerait tous les tests de refus ci-dessous sans rien valoir. C'est la
    // boucle sur les types réels — et non sur une liste recopiée — qui
    // l'empêche.
    for (const type of DEEPLINK_TARGET_TYPES) {
      const cible = { type, id: 'abc123' };
      expect(parseDeeplink(buildDeeplink(cible))).toEqual(cible);
    }
  });
});

describe('relecture d’un lien profond', () => {
  it('refuse un autre schéma', () => {
    // Cas le plus probable en pratique : un lien `https://` collé par erreur,
    // ou une notification forgée par un tiers.
    expect(parseDeeplink('https://post/abc123')).toBeNull();
    expect(parseDeeplink('autrelumiere://post/abc123')).toBeNull();
  });

  it('refuse un schéma ou un type en majuscules', () => {
    // `buildDeeplink` ne produit jamais ces formes : les tolérer reviendrait à
    // accepter une chaîne que personne n'a écrite.
    expect(parseDeeplink('Frereslumieres://post/abc123')).toBeNull();
    expect(parseDeeplink('frereslumieres://POST/abc123')).toBeNull();
  });

  it('refuse un type de cible inconnu', () => {
    expect(parseDeeplink('frereslumieres://facture/abc123')).toBeNull();
  });

  it('refuse un identifiant vide ou absent', () => {
    expect(parseDeeplink('frereslumieres://post/')).toBeNull();
    expect(parseDeeplink('frereslumieres://post')).toBeNull();
  });

  it('refuse un segment supplémentaire, une requête ou un fragment', () => {
    // `id` est le dernier morceau, un point c'est tout. Accepter une suite
    // ferait entrer dans le chemin de route une valeur non prévue.
    expect(parseDeeplink('frereslumieres://post/abc123/commentaires')).toBeNull();
    expect(parseDeeplink('frereslumieres://post/abc123?x=1')).toBeNull();
    expect(parseDeeplink('frereslumieres://post/abc123#haut')).toBeNull();
  });

  it('refuse une traversée de chemin dans l’identifiant', () => {
    // L'identifiant finit dans un chemin de route. Ces formes-là n'existent
    // pas dans Firestore, et les accepter ouvrirait la porte à autre chose.
    expect(parseDeeplink('frereslumieres://post/..')).toBeNull();
    expect(parseDeeplink('frereslumieres://post/a%2Fb')).toBeNull();
    expect(parseDeeplink('frereslumieres://post/a b')).toBeNull();
  });

  it('refuse tout ce qui n’est pas une chaîne', () => {
    // La valeur vient d'une notification : elle peut être absente, nulle, ou
    // d'un type inattendu. Aucune de ces formes ne doit lever.
    expect(parseDeeplink(undefined)).toBeNull();
    expect(parseDeeplink(null)).toBeNull();
    expect(parseDeeplink(42)).toBeNull();
    expect(parseDeeplink({ type: 'post', id: 'abc' })).toBeNull();
    expect(parseDeeplink('')).toBeNull();
  });
});

describe('route à ouvrir pour un lien profond', () => {
  it('rend le chemin d’une publication', () => {
    expect(routeForDeeplink('frereslumieres://post/abc123')).toBe('/post/abc123');
  });

  it('ne rend rien pour un type sans écran', () => {
    // Les quatre autres types sont reconnus mais aucun écran ne les ouvre
    // encore. Rendre un chemin quand même enverrait l'application sur une
    // route inexistante — l'écran « introuvable » à la place du contenu.
    for (const type of DEEPLINK_TARGET_TYPES) {
      if (DEEPLINK_ROUTES[type]) continue;
      expect(routeForDeeplink(buildDeeplink({ type, id: 'abc123' }))).toBeNull();
    }
  });

  it('ne rend rien pour un lien illisible', () => {
    expect(routeForDeeplink('frereslumieres://facture/abc123')).toBeNull();
    expect(routeForDeeplink(undefined)).toBeNull();
  });
});

describe('couverture des types de cible', () => {
  it('déclare chaque type soit ouvrable, soit sans route avec sa raison', () => {
    // Une exception muette devient une exception qu'on oublie. Sans cette
    // garde, ajouter un type de cible ne forcerait à rien : il serait reconnu
    // par l'analyse, et le tap ne ferait rien.
    for (const type of DEEPLINK_TARGET_TYPES) {
      const ouvrable = Boolean(DEEPLINK_ROUTES[type]);
      const declare = TYPES_SANS_ROUTE[type];
      expect(
        ouvrable || (typeof declare === 'string' && declare.trim().length > 0),
        `${type} n'est ni ouvrable ni déclaré sans route`,
      ).toBe(true);
    }
  });

  it('n’excuse un type que s’il n’est pas déjà ouvrable', () => {
    // L'inverse : une exception qui survit à l'écran qu'elle excusait ferait
    // croire à un manque qui n'existe plus.
    for (const type of DEEPLINK_TARGET_TYPES) {
      if (DEEPLINK_ROUTES[type]) {
        expect(TYPES_SANS_ROUTE[type], `${type} est ouvrable mais encore excusé`).toBeUndefined();
      }
    }
  });

  it('ne déclare ni route ni exception pour un type inconnu', () => {
    const connus = new Set<string>(DEEPLINK_TARGET_TYPES);
    for (const type of Object.keys(DEEPLINK_ROUTES)) {
      expect(connus.has(type), `route déclarée pour un type inconnu : ${type}`).toBe(true);
    }
    for (const type of Object.keys(TYPES_SANS_ROUTE)) {
      expect(connus.has(type), `exception déclarée pour un type inconnu : ${type}`).toBe(true);
    }
  });
});

describe('routes déclarées et écrans réels', () => {
  // Le complément — un type déclaré sans route n'en a pas — est déjà affirmé
  // dans « couverture des types de cible ». Le répéter ici serait le même
  // invariant vu de l'autre côté : deux tests qui tombent ensemble ne
  // mesurent pas deux choses.
  it('trouve le dossier de l’application mobile', () => {
    // Le pire des échecs, celui qui rassure : une analyse cassée ne trouve
    // aucun dossier et rend tout vert. Vérifié d'abord, comme pour la garde
    // des règles Firestore.
    expect(existsSync(DOSSIER_ROUTES())).toBe(true);
    expect(contenuDuDossierDeRoute('/post')).not.toBeNull();
  });

  it('trouve un écran pour chaque route déclarée', () => {
    // C'est ici que la table des routes cesse d'être une chaîne recopiée :
    // renommer `app/post/[id].tsx` sans toucher à `DEEPLINK_ROUTES` fait
    // échouer ce test, au lieu de produire un tap qui n'ouvre rien.
    for (const [type, base] of Object.entries(DEEPLINK_ROUTES)) {
      if (!base) continue;
      const contenu = contenuDuDossierDeRoute(base);
      expect(contenu, `aucun dossier d'écran pour ${type} (${base})`).not.toBeNull();
      expect(
        contenu?.some((fichier) => fichier === '[id].tsx'),
        `${base} n'a pas d'écran [id].tsx pour ${type}`,
      ).toBe(true);
    }
  });
});
