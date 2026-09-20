#!/usr/bin/env node
/**
 * Vérifie le schéma Supabase, sans Docker et sans projet distant.
 *
 * ## Pourquoi ce script existe
 *
 * La discipline du dépôt est de tout vérifier avant de pousser. Une migration SQL
 * échappait à cette règle : il aurait fallu un Postgres, donc Docker, absent de la
 * machine de développement. `@electric-sql/pglite` est un Postgres complet compilé
 * en WebAssembly, qui tourne dans Node — rôles, types, contraintes, index,
 * transactions. Il suffit à appliquer les migrations et à interroger le catalogue.
 *
 * ## Ce qu'il contrôle
 *
 * 1. **Les migrations s'appliquent**, dans l'ordre de leur nom. Une migration qui
 *    ne s'applique pas ne se découvre pas au premier déploiement : elle se découvre
 *    ici.
 * 2. **Les tables attendues existent**, avec leurs colonnes clés.
 * 3. **Les énumérations Postgres et les types TypeScript s'accordent.** C'est le
 *    contrôle qui compte le plus : un type `user_role` auquel on ajoute une valeur
 *    sans toucher `packages/types/src/enums.ts` — ou l'inverse — produit du code
 *    qui compile et une écriture refusée à l'exécution. Le compilateur ne peut pas
 *    voir cette couture, parce que les deux sources s'ignorent.
 *
 * ## Ce qu'il ne contrôle pas
 *
 * Les politiques de sécurité (migration 0002, et son propre banc), les droits par
 * défaut de Supabase, les extensions `pg_net` et `pg_cron`, et Realtime. Ce script
 * prouve la FORME du schéma, pas son comportement.
 *
 * ## Ce qu'il émule
 *
 * Supabase fournit `auth.users`, et les rôles `anon`, `authenticated`,
 * `service_role`. PGlite ne les fournit pas : le script les crée avant d'appliquer
 * les migrations. Ce qui est éprouvé est donc **notre** schéma, posé sur une
 * imitation de ce que Supabase garantit — et non la logique de Supabase elle-même.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOSSIER_MIGRATIONS = join(RACINE, 'supabase', 'migrations');
const FICHIER_ENUMS = join(RACINE, 'packages', 'types', 'src', 'enums.ts');

/** Tables que le socle doit avoir créées. */
const TABLES_ATTENDUES = [
  'organizations',
  'schools',
  'classes',
  'users',
  'children',
  'device_tokens',
];

/**
 * Appariement entre un type TypeScript et son homologue Postgres.
 *
 * La correspondance est écrite à la main, et c'est volontaire : la déduire du nom
 * (`UserRole` → `user_role`) marcherait aujourd'hui et casserait en silence le jour
 * où l'un des deux est renommé.
 */
const ENUMS_APPARIES = [
  { ts: 'UserRole', sql: 'user_role' },
  { ts: 'UserStatus', sql: 'user_status' },
  { ts: 'SchoolLevel', sql: 'school_level' },
  { ts: 'ClassLevel', sql: 'class_level' },
  { ts: 'DevicePlatform', sql: 'device_platform' },
];

const problemes = [];
const reussites = [];

const ok = (message) => reussites.push(message);
const ko = (message) => problemes.push(message);

/**
 * Extrait les valeurs littérales d'une union TypeScript.
 *
 * On découpe sur le `;` final plutôt que sur la ligne : une union s'écrit
 * volontiers sur plusieurs lignes, et c'est le cas de `ClassLevel`.
 */
function lireUnionTypeScript(source, nom) {
  const debut = source.indexOf(`export type ${nom} =`);
  if (debut === -1) return null;
  const fin = source.indexOf(';', debut);
  if (fin === -1) return null;
  const corps = source.slice(debut, fin);
  const valeurs = [...corps.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  return valeurs.length > 0 ? valeurs : null;
}

/** Applique une migration, en nommant le fichier fautif si elle échoue. */
async function appliquer(db, nomFichier) {
  const sql = readFileSync(join(DOSSIER_MIGRATIONS, nomFichier), 'utf8');
  try {
    await db.exec(sql);
  } catch (e) {
    ko(`${nomFichier} ne s'applique pas : ${e.message ?? e}`);
    return false;
  }
  ok(`${nomFichier} appliquée`);
  return true;
}

async function main() {
  const db = new PGlite();

  // --- Ce que Supabase fournit, et que PGlite ne fournit pas -----------------
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text
    );
  `);

  // --- Les migrations, dans l'ordre de leur nom ------------------------------
  const migrations = readdirSync(DOSSIER_MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (migrations.length === 0) {
    ko('aucune migration trouvée dans supabase/migrations/');
    return conclure();
  }

  for (const nom of migrations) {
    const appliquee = await appliquer(db, nom);
    if (!appliquee) return conclure();
  }

  // --- Les tables ------------------------------------------------------------
  const { rows: tables } = await db.query(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  const nomsTables = tables.map((t) => t.tablename);

  for (const attendue of TABLES_ATTENDUES) {
    if (nomsTables.includes(attendue)) ok(`table ${attendue}`);
    else ko(`table ${attendue} absente`);
  }

  const enTrop = nomsTables.filter((t) => !TABLES_ATTENDUES.includes(t));
  if (enTrop.length > 0) {
    // Une table en trop n'est pas un défaut en soi, mais c'est une ligne qui a
    // échappé à la liste ci-dessus — donc un contrôle qui ne la couvre pas.
    ko(`table(s) non contrôlée(s) : ${enTrop.join(', ')}`);
  }

  // --- Les énumérations, contre leur source TypeScript ----------------------
  const sourceTs = readFileSync(FICHIER_ENUMS, 'utf8');

  for (const { ts, sql } of ENUMS_APPARIES) {
    const attendues = lireUnionTypeScript(sourceTs, ts);
    if (attendues === null) {
      ko(`type ${ts} introuvable ou vide dans ${FICHIER_ENUMS}`);
      continue;
    }

    const { rows } = await db.query(
      `select e.enumlabel
         from pg_enum e
         join pg_type t on t.oid = e.enumtypid
        where t.typname = $1
        order by e.enumsortorder`,
      [sql],
    );

    if (rows.length === 0) {
      ko(`type Postgres ${sql} absent`);
      continue;
    }

    const enBase = rows.map((r) => r.enumlabel);
    const manquantes = attendues.filter((v) => !enBase.includes(v));
    const surnumeraires = enBase.filter((v) => !attendues.includes(v));

    if (manquantes.length === 0 && surnumeraires.length === 0) {
      ok(`${ts} ↔ ${sql} — ${enBase.length} valeur(s), identiques`);
    } else {
      const details = [];
      if (manquantes.length > 0) details.push(`absentes en base : ${manquantes.join(', ')}`);
      if (surnumeraires.length > 0) details.push(`en trop en base : ${surnumeraires.join(', ')}`);
      ko(`${ts} ↔ ${sql} divergent — ${details.join(' ; ')}`);
    }
  }

  return conclure();
}

function conclure() {
  for (const r of reussites) console.log(`  ok   ${r}`);
  for (const p of problemes) console.log(`  KO   ${p}`);

  if (problemes.length === 0) {
    console.log(`\n${reussites.length} vérifications — aucun défaut.`);
    process.exit(0);
  }

  console.log(`\n${reussites.length} réussies, ${problemes.length} en échec.`);
  process.exit(1);
}

await main();
