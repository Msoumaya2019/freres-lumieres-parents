/**
 * Le schéma des liens profonds est-il celui que l'application déclare ?
 *
 * C'est la seule chose que le serveur et l'application doivent partager pour
 * qu'un tap sur une notification ouvre le bon écran. Le test lit
 * `apps/mobile/app.json` sur le disque — comme `paths.test.ts` compare les
 * noms de collections — parce que deux chaînes recopiées divergent en
 * silence, et qu'un lien profond faux n'échoue pas : il ouvre l'écran
 * d'accueil, ce qui ressemble à un fonctionnement normal.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { APP_SCHEME, buildDeeplink } from './deeplinks.js';
import { findRepoRoot } from './test-helpers/repo-root.js';

/** `expo.scheme` tel que déclaré par l'application mobile. */
function schemeDeclareParApplication(): unknown {
  const chemin = join(findRepoRoot(), 'apps', 'mobile', 'app.json');
  const app = JSON.parse(readFileSync(chemin, 'utf8')) as { expo?: { scheme?: unknown } };
  return app.expo?.scheme;
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
});
