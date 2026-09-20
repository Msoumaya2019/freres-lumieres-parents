-- ---------------------------------------------------------------------------
-- 0001 — Le socle
--
-- Ce que cette migration pose :
--   - les types énumérés, alignés sur `packages/types/src/enums.ts` ;
--   - les six tables dont toutes les autres dépendent ;
--   - les index et les contraintes d'unicité qui vont avec.
--
-- Ce qu'elle ne pose PAS : aucune politique de sécurité. C'est la migration
-- 0002, et l'ordre est délibéré — une politique écrite avant sa table ne se
-- relit pas, et un refus ne se distingue plus d'un oubli.
--
-- `public.users` et `auth.users` :
--   Supabase fournit `auth.users` — identifiants, courriel, secrets. `public.users`
--   porte le profil, et sa clé primaire EST celle de `auth.users` : une ligne, un
--   compte. Les deux noms cohabitent, et c'est le prix de garder le vocabulaire du
--   projet (`users/{uid}` dans Firestore, `UserProfile` en TypeScript). Conséquence
--   à retenir : une requête qui écrit `users` sans qualifier vise le PROFIL.
--
-- Aucune donnée nominative d'enfant : `children` ne porte qu'un prénom facultatif,
-- un niveau, une classe et une année. Rien de plus n'est nécessaire pour cibler une
-- information, et ce qui n'est pas stocké ne peut pas fuir.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Types énumérés
--
-- Chacun doit porter EXACTEMENT les valeurs de son homologue TypeScript. Un écart
-- se paie en écriture refusée à l'exécution, sans que rien n'ait échoué à la
-- compilation — c'est pourquoi `scripts/verifier-schema-supabase.mjs` compare les
-- deux listes et échoue si elles divergent.
-- ---------------------------------------------------------------------------

create type user_role as enum ('parent', 'fcpe', 'moderator', 'admin');

create type user_status as enum ('pending', 'active', 'suspended', 'rejected');

create type school_level as enum ('maternelle', 'elementaire', 'primaire');

create type class_level as enum (
  'PS',
  'MS',
  'GS',
  'CP',
  'CE1',
  'CE2',
  'CM1',
  'CM2',
  'ULIS',
  'autre'
);

create type device_platform as enum ('ios', 'android', 'web');

-- ---------------------------------------------------------------------------
-- Organisations — la racine multi-tenant
--
-- C'est elle qui porte la frontière de sécurité : toute table lisible porte un
-- `org_id`, et la politique correspondante le compare à celui du porteur du
-- jeton. Sans cette colonne, une organisation n'aurait aucun moyen d'en isoler
-- une autre.
-- ---------------------------------------------------------------------------

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  city text not null,
  -- RGPD : durée de conservation des signalements, et seuil au-delà duquel des
  -- signalements isolés sont regroupés en sujet collectif.
  report_retention_days integer not null default 180 check (report_retention_days > 0),
  collective_issue_threshold integer not null default 5 check (collective_issue_threshold > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Établissements et classes
-- ---------------------------------------------------------------------------

create table schools (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  level school_level not null,
  -- Niveaux proposés, pour alimenter les formulaires d'inscription.
  class_levels class_level[] not null default '{}',
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create index schools_org_idx on schools (org_id) where active;

create table classes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  school_id uuid not null references schools (id) on delete cascade,
  name text not null,
  level class_level not null,
  academic_year text not null,
  created_at timestamptz not null default now(),
  unique (school_id, name, academic_year)
);

create index classes_org_idx on classes (org_id);
create index classes_school_idx on classes (school_id, academic_year);

-- ---------------------------------------------------------------------------
-- Profils
--
-- `role` et `status` sont ici la SOURCE, et le jeton en est la copie — l'inverse
-- de Firestore, où les Custom Claims faisaient autorité et le document les
-- reflétait. La conséquence est favorable : une révocation prend effet au
-- prochain jeton, sans qu'une fonction serveur ait à propager quoi que ce soit.
--
-- Les listes dénormalisées (`levels`, `class_ids`, `audience_keys`) sont
-- recalculées depuis `children` par un déclencheur, jamais écrites par le client.
-- ---------------------------------------------------------------------------

create table users (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  role user_role not null default 'parent',
  status user_status not null default 'pending',
  org_ids uuid[] not null default '{}',
  school_ids uuid[] not null default '{}',
  -- Dénormalisé depuis `children`.
  levels class_level[] not null default '{}',
  class_ids uuid[] not null default '{}',
  -- Cœur du fil d'actualité : la requête s'y adresse par recoupement, sans lire
  -- les enfants. Vide tant que le compte n'est pas actif — un appareil dont on
  -- ne sait rien ne doit rien recevoir.
  audience_keys text[] not null default '{}',
  notification_enabled boolean not null default true,
  disabled_categories text[] not null default '{}',
  consent_privacy_policy boolean not null default false,
  consent_community_rules boolean not null default false,
  consent_fcpe_contact boolean not null default false,
  privacy_policy_version text,
  last_seen_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references users (id) on delete set null,
  status_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_org_idx on users using gin (org_ids);
create index users_status_idx on users (status);
create index users_email_idx on users (lower(email));
create index users_audience_idx on users using gin (audience_keys);

-- ---------------------------------------------------------------------------
-- Enfants
--
-- Jamais une table racine : aucun besoin légitime d'interroger les enfants
-- globalement, et les exposer multiplierait les risques de fuite sans bénéfice.
-- ---------------------------------------------------------------------------

create table children (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  first_name text,
  school_id uuid not null references schools (id) on delete restrict,
  level class_level not null,
  class_id uuid references classes (id) on delete set null,
  academic_year text not null,
  created_at timestamptz not null default now()
);

create index children_user_idx on children (user_id);
create index children_school_idx on children (school_id);

-- ---------------------------------------------------------------------------
-- Appareils
--
-- L'identifiant EST le jeton : l'enregistrement est donc idempotent, et un
-- appareil partagé entre deux comptes met à jour `user_id` au lieu de créer un
-- doublon.
--
-- Trois colonnes sont réservées au serveur — `audience_keys`,
-- `disabled_categories` et `org_id`. Là où Firestore exigeait `unchanged()`,
-- Postgres l'obtient par un privilège de colonne : le client n'aura le droit
-- d'écrire que `enabled` et `last_used_at`. C'est la même garantie, sans les
-- exceptions que `unchanged()` traînait.
-- ---------------------------------------------------------------------------

create table device_tokens (
  token text primary key,
  user_id uuid not null references users (id) on delete cascade,
  org_id uuid not null references organizations (id) on delete cascade,
  platform device_platform not null,
  audience_keys text[] not null default '{}',
  disabled_categories text[] not null default '{}',
  enabled boolean not null default true,
  locale text,
  app_version text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index device_tokens_user_idx on device_tokens (user_id);
create index device_tokens_org_idx on device_tokens (org_id);
create index device_tokens_audience_idx on device_tokens using gin (audience_keys);
