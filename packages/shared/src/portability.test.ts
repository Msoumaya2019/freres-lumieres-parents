/**
 * `@fl/shared` reste-t-il importable par React Native ?
 *
 * ## Pourquoi cette garde existe
 *
 * Le paquet était compilé avec `"types": []`, ce qui **garantissait par
 * construction** qu'aucune API d'environnement n'y était employée : écrire
 * `process.env` ou `import fs from 'node:fs'` ne compilait pas. Le module
 * d'envoi push, venu de `@fl/firebase`, a besoin de `fetch`,
 * `AbortController` et des minuteurs — il a donc fallu ouvrir les types de
 * Node, et la garantie est tombée.
 *
 * Elle ne peut pas être remplacée par un commentaire : `@fl/shared` est
 * consommé par l'application mobile, où `fs`, `path` et `process` n'existent
 * pas. Metro ne s'en plaindrait pas à la compilation — l'échec arriverait à
 * l'exécution, sur le téléphone d'un parent.
 *
 * La garde lit donc la source du paquet et refuse les modules intégrés de Node
 * et ses globales. Les primitives universelles — `fetch`, `AbortController`,
 * `setTimeout`, `clearTimeout`, `console` — ne sont pas concernées : elles
 * existent aussi bien en Node 22 qu'en React Native et dans le navigateur.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findRepoRoot } from './test-helpers/repo-root.js';

const SOURCE = join(findRepoRoot(), 'packages', 'shared', 'src');

/** Modules intégrés de Node, absents de React Native. */
const MODULES_NODE = [
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'crypto',
  'dgram',
  'dns',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'querystring',
  'readline',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
];

/** Globales propres à Node. */
const GLOBALES_NODE = [
  /\bprocess\./,
  /\b__dirname\b/,
  /\b__filename\b/,
  /\bBuffer\./,
  /\brequire\(/,
];

/**
 * Les sources du paquet, tests et utilitaires de test exclus.
 *
 * `test-helpers/` est écarté pour la même raison que les fichiers `.test.ts` :
 * ces modules lisent le disque, c'est leur travail. Ils sont également exclus
 * de la compilation (`tsconfig.json`), donc ils ne partent pas dans le paquet.
 */
function fichiers(): string[] {
  return readdirSync(SOURCE, { recursive: true, encoding: 'utf8' })
    .filter(
      (chemin) =>
        chemin.endsWith('.ts') &&
        !chemin.endsWith('.test.ts') &&
        !chemin.split(/[\\/]/).includes('test-helpers'),
    )
    .map((chemin) => join(SOURCE, chemin));
}

/** Spécificateurs d'import, quelle que soit la forme employée. */
function specificateurs(code: string): string[] {
  const motifs = [
    /from\s+['"]([^'"]+)['"]/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  const trouves: string[] = [];
  for (const motif of motifs) {
    for (const correspondance of code.matchAll(motif)) {
      const specificateur = correspondance[1];
      if (specificateur) trouves.push(specificateur);
    }
  }
  return trouves;
}

describe('portabilité de @fl/shared', () => {
  it('analyse bien l’ensemble du paquet', () => {
    // Le pire des échecs est celui qui rassure : un parcours cassé rendrait
    // tous les tests suivants verts en ne trouvant rien à examiner. La borne
    // est basse à dessein — elle dit « le parcours a trouvé des fichiers »,
    // pas « le paquet a exactement douze fichiers ».
    expect(fichiers().length).toBeGreaterThanOrEqual(10);
  });

  it('n’importe aucun module intégré de Node', () => {
    const fautifs: string[] = [];

    for (const fichier of fichiers()) {
      for (const specificateur of specificateurs(readFileSync(fichier, 'utf8'))) {
        const nom = specificateur.startsWith('node:')
          ? specificateur.slice('node:'.length)
          : specificateur;
        if (specificateur.startsWith('node:') || MODULES_NODE.includes(nom)) {
          fautifs.push(`${relative(SOURCE, fichier)} → ${specificateur}`);
        }
      }
    }

    expect(fautifs).toEqual([]);
  });

  it('n’emploie aucune globale propre à Node', () => {
    const fautifs: string[] = [];

    for (const fichier of fichiers()) {
      const code = readFileSync(fichier, 'utf8');
      for (const motif of GLOBALES_NODE) {
        const trouve = code.match(motif);
        if (trouve) fautifs.push(`${relative(SOURCE, fichier)} → ${trouve[0]}`);
      }
    }

    expect(fautifs).toEqual([]);
  });

  it('laisse passer les primitives universelles', () => {
    // Le pendant de la garde : sans lui, un test qui refuserait **tout**
    // passerait les deux précédents. Ces quatre globales sont celles dont le
    // module d'envoi push a besoin, et elles existent partout où ce paquet est
    // consommé.
    const code = readFileSync(join(SOURCE, 'push', 'expo.ts'), 'utf8');

    for (const primitive of ['fetch(', 'AbortController', 'setTimeout(', 'clearTimeout(']) {
      expect(code).toContain(primitive);
    }
  });
});
