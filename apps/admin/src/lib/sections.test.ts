/**
 * Vérifie la cohérence entre la navigation et les routes réellement servies.
 *
 * L'invariant tenu ici a déjà été violé une fois sans que rien ne le signale :
 * `publications` avait son dossier de route mais n'était pas déclaré dans
 * `DEDICATED_ROUTE_SLUGS`. Next.js n'a produit aucun avertissement — il a
 * simplement prérendu `/publications` deux fois, dont un écran « bientôt
 * disponible » que personne ne voyait. Le build restait vert.
 *
 * Le test lit le système de fichiers plutôt qu'une liste recopiée : c'est le
 * seul moyen de détecter l'oubli, puisqu'un oubli ne se voit que par
 * comparaison avec ce qui existe sur le disque.
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ADMIN_SECTION_SLUGS, DEDICATED_ROUTE_SLUGS } from './sections';

/** Dossier des routes de l'espace connecté. */
const DOSSIER_DASHBOARD = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', '(dashboard)');

/** Le dossier de la route générique n'est pas une section : il les sert toutes. */
const ROUTE_GENERIQUE = '[section]';

/** Noms des dossiers de `app/(dashboard)` qui déclarent une page. */
function dossiersDeRoute(): string[] {
  return readdirSync(DOSSIER_DASHBOARD, { withFileTypes: true })
    .filter((entree) => entree.isDirectory())
    .map((entree) => entree.name)
    .filter((nom) => existsSync(join(DOSSIER_DASHBOARD, nom, 'page.tsx')))
    .filter((nom) => nom !== ROUTE_GENERIQUE)
    .sort();
}

describe('sections de l’administration', () => {
  it('le dossier des routes existe', () => {
    // Si ce test tombe, tous les suivants mesureraient le vide : `readdirSync`
    // lèverait, mais un chemin déplacé mérite un message explicite.
    expect(existsSync(DOSSIER_DASHBOARD)).toBe(true);
  });

  it('tout dossier de route dédié est déclaré dans DEDICATED_ROUTE_SLUGS', () => {
    // C'est l'assertion qui aurait attrapé `publications`.
    expect(dossiersDeRoute()).toEqual([...DEDICATED_ROUTE_SLUGS].sort());
  });

  it('aucun segment déclaré n’est un vestige sans dossier de route', () => {
    const dossiers = dossiersDeRoute();
    for (const slug of DEDICATED_ROUTE_SLUGS) {
      expect(dossiers).toContain(slug);
    }
  });

  it('tout segment déclaré correspond à une section connue', () => {
    for (const slug of DEDICATED_ROUTE_SLUGS) {
      expect(ADMIN_SECTION_SLUGS).toContain(slug);
    }
  });

  it('la route générique ne sert pas un segment déjà servi ailleurs', () => {
    // Le pendant exact de `generateStaticParams` : ce qu'il génère ne doit
    // jamais recouper une route dédiée.
    const servisParLaRouteGenerique = ADMIN_SECTION_SLUGS.filter(
      (slug) => !DEDICATED_ROUTE_SLUGS.includes(slug),
    );
    for (const slug of DEDICATED_ROUTE_SLUGS) {
      expect(servisParLaRouteGenerique).not.toContain(slug);
    }
  });
});
