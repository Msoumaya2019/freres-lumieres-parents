# 01 — Architecture technique

> Phase 1 · Document de référence · École Frères Lumières, Montmagny

## 1. Vue d'ensemble

Le projet est un **monorepo npm workspaces** contenant deux applications et trois
packages partagés, adossés à un seul backend Firebase.

```
┌──────────────────────┐        ┌──────────────────────┐
│  apps/mobile         │        │  apps/admin          │
│  Expo + expo-router  │        │  Next.js + Tailwind  │
│  iOS · Android       │        │  Web responsive      │
└──────────┬───────────┘        └──────────┬───────────┘
           │                               │
           │     ┌─────────────────────┐   │
           └────►│  packages/firebase  │◄──┘
                 │  SDK + repositories │
                 └──────────┬──────────┘
                            │
                 ┌──────────▼───────────┐
                 │   packages/shared    │  permissions · audiences
                 │                      │  validation Zod · thème
                 └──────────┬───────────┘
                            │
                 ┌──────────▼───────────┐
                 │    packages/types    │  modèle de domaine
                 └──────────────────────┘

                            ▲
                            │ mêmes schémas Zod rejoués côté serveur
                            │
┌───────────────────────────┴──────────────────────────────┐
│                    Firebase (2 projets)                  │
│  Auth · Firestore · Storage · Functions · App Check      │
│  dev  : freres-lumieres-dev                              │
│  prod : freres-lumieres-prod                             │
└──────────────────────────────────────────────────────────┘
```

### Pourquoi un monorepo plutôt que trois dépôts

Un seul dépôt permet de modifier en un même commit le modèle de données, les
règles de sécurité et les deux interfaces qui en dépendent. Sur un projet
maintenu par une personne seule, c'est la différence entre « je change un champ
et tout reste cohérent » et « je casse la production un vendredi soir ». Le
typage partagé fait échouer la CI dès qu'une interface n'est plus alignée.

### Pourquoi npm workspaces et pas pnpm/Turborepo

`npm` est déjà installé partout, ne demande aucune configuration
supplémentaire et gère correctement les workspaces. pnpm apporte un gain de
place disque et une meilleure isolation, mais impose des réglages spécifiques
à Metro (Expo) et à Next.js. Turborepo apporte un cache de tâches utile à
partir de plusieurs équipes et de plusieurs pipelines.

**Décision : npm workspaces.** Le jour où les temps de CI deviennent
pénibles, Turborepo s'ajoute en une ligne sans rien casser.

---

## 2. Arborescence

```
/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                 # audit · formatage · lint · types · tests,
│   │   │                          # puis admin · Expo · functions · règles
│   │   ├── mobile-build.yml       # builds EAS (manuel, ou sur un tag v*)
│   │   └── codeql.yml             # analyse de sécurité statique
│   └── dependabot.yml             # veille npm + GitHub Actions
│
├── apps/
│   ├── mobile/                    # Expo SDK 57 · React Native 0.86 · expo-router
│   │   ├── app/                   # routes (expo-router)
│   │   │   ├── _layout.tsx        # providers : thème, auth, requêtes
│   │   │   ├── (auth)/            # connexion, inscription, en attente
│   │   │   ├── (pending)/         # compte créé, profil non encore résolu
│   │   │   ├── (tabs)/            # Accueil · Discussions · + · Agenda · Profil
│   │   │   ├── +native-intent.ts  # filtre des liens entrants
│   │   │   └── +not-found.tsx
│   │   ├── src/
│   │   │   ├── components/        # composants réutilisables
│   │   │   ├── hooks/             # hooks dédiés (useAuth, useFeed, …)
│   │   │   ├── providers/         # contextes React
│   │   │   └── lib/               # config Firebase, helpers
│   │   ├── assets/
│   │   ├── app.json               # configuration Expo
│   │   └── eas.json               # profils EAS — dans le dossier de l'app
│   │
│   └── admin/                     # Next.js 16 · App Router · Tailwind 4
│       ├── src/
│       │   ├── app/               # routes et layouts
│       │   ├── components/        # composants de tableau de bord
│       │   ├── features/          # écrans par domaine
│       │   ├── lib/               # config Firebase, garde d'accès
│       │   └── providers/         # contextes React
│       └── next.config.ts
│
├── packages/
│   ├── types/                     # modèle de domaine — aucune dépendance
│   ├── shared/                    # permissions · audiences · Zod · thème
│   ├── firebase/                  # SDK, chemins, converters, repositories
│   └── testing/                   # tests des Security Rules (émulateur)
│
├── functions/                     # Cloud Functions TypeScript (Node 22)
│   └── src/
│       ├── auth/                  # claims, cycle de vie des comptes
│       ├── triggers/              # compteurs, audiences, notifications
│       ├── callable/              # actions privilégiées (envoi ciblé, RGPD)
│       └── lib/                   # helpers partagés
│
├── firebase/
│   ├── firestore.rules            # règles Firestore
│   ├── firestore.indexes.json     # index composites
│   └── storage.rules              # règles Storage
│
├── docs/                          # cette documentation
├── .env.example                   # modèle de configuration (aucune valeur)
├── .gitignore                     # strict — voir § Sécurité
├── firebase.json                  # émulateurs, déploiement
├── package.json                   # workspaces + scripts racine
├── tsconfig.base.json             # options TypeScript communes
└── README.md
```

**Écarts assumés par rapport à la structure proposée dans le cahier des charges :**

| Proposition initiale                         | Retenu                                        | Raison                                                                                               |
| -------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `packages/shared` + `packages/types` séparés | conservé, mais `types` sans aucune dépendance | `types` est consommé par les Cloud Functions : le garder pur évite d'y embarquer React Native ou Zod |
| `firebase/` à la racine                      | conservé                                      | sépare les règles (déclaratif) du code des Functions (impératif)                                     |
| `functions/` à la racine                     | conservé                                      | imposé par le déploiement Firebase                                                                   |
| —                                            | ajout de `packages/testing`                   | les tests de Security Rules doivent tourner sur l'émulateur, isolés des tests unitaires              |
| —                                            | ajout de `docs/`                              | le README reste court et lisible ; l'analyse détaillée vit ici                                       |

---

## 3. Stack et versions

| Composant       | Choix                                   | Version                            | Justification                                    |
| --------------- | --------------------------------------- | ---------------------------------- | ------------------------------------------------ |
| Mobile          | Expo + React Native                     | SDK 57 / RN 0.86                   | builds EAS sans Mac, mises à jour OTA possibles  |
| Navigation      | expo-router                             | 57.x                               | routage par fichiers, deep links natifs          |
| Langage         | TypeScript                              | 6.0 (mobile/packages), 5.x (admin) | `strict: true` partout                           |
| Admin           | Next.js App Router                      | 16.3                               | rendu serveur, SEO interne, déploiement simple   |
| Styles admin    | Tailwind CSS                            | 4                                  | pas de CSS à maintenir, responsive immédiat      |
| Styles mobile   | StyleSheet + jetons `@fl/shared`        | —                                  | évite NativeWind et son outillage supplémentaire |
| Base de données | Cloud Firestore                         | —                                  | temps réel, règles déclaratives, offline natif   |
| Auth            | Firebase Authentication                 | —                                  | e-mail / mot de passe + Custom Claims            |
| Fichiers        | Firebase Storage                        | —                                  | règles dédiées, URLs signées à la demande        |
| Notifications   | Expo Notifications → FCM / APNs         | —                                  | voir `05-notifications.md`                       |
| Serveur         | Cloud Functions                         | Node 22, 2ᵉ génération             | validation, claims, compteurs, envois            |
| Validation      | Zod                                     | 4.x                                | un schéma, trois usages (mobile, admin, serveur) |
| Tests           | Vitest + `@firebase/rules-unit-testing` | —                                  | rapide, unifié                                   |

**Ce qui n'est volontairement pas installé** (et pourquoi) :

- **Turborepo** — inutile à cette échelle, ajoutable plus tard.
- **Redux / Zustand / React Query** — les besoins de cache sont couverts par
  des hooks dédiés au-dessus des repositories Firestore. Ajouter une
  bibliothèque de gestion d'état maintenant créerait deux sources de vérité.
- **NativeWind** — StyleSheet et les jetons partagés suffisent.
- **Sentry** — prévu dans le `.env.example`, activable en Phase 13 une fois
  l'application stabilisée.

---

## 4. Découpage des responsabilités

Le principe directeur : **une seule direction de dépendances**, jamais de
dépendance circulaire, et aucune couche ne saute par-dessus une autre.

```
apps/*  ──►  packages/firebase  ──►  packages/shared  ──►  packages/types
                                        ▲
functions ──────────────────────────────┘
```

- **`packages/types`** — uniquement des types. Aucune ligne exécutable.
- **`packages/shared`** — logique métier pure et testable : matrice de
  permissions, calcul des audiences, schémas Zod, jetons de thème, formatage.
  Aucun accès réseau, aucun import Firebase.
- **`packages/firebase`** — tout ce qui touche au SDK Firebase : initialisation,
  chemins de collections, converters typés, repositories. C'est la seule couche
  qui parle à Firestore.
- **`apps/*`** — interface et orchestration. Aucun appel direct à Firestore en
  dehors des repositories.
- **`functions/`** — la même logique métier, mais rejouée côté serveur avec
  les mêmes schémas Zod. Le serveur ne fait jamais confiance au client.

### Règle des composants

Aucun fichier ne doit dépasser ~250 lignes. Un écran assemble des composants
et branche un hook ; il ne contient ni requête Firestore ni calcul métier.

---

## 5. Multi-tenant : anticiper sans sur-concevoir

Le cahier des charges ne concerne aujourd'hui qu'un groupe scolaire. Pour
autant, **aucune valeur ne doit être codée en dur** :

- `organizations/{orgId}` est la racine de rattachement ;
- `schools/{schoolId}` porte l'établissement, `classes/{classId}` la classe ;
- chaque contenu porte `orgId` et, le cas échéant, `schoolId` ;
- chaque audience se traduit en clés préfixées par l'organisation.

Ajouter une seconde école, puis une seconde ville, ne demandera donc
**aucune migration de schéma** : on crée un document `organizations`, des
`schools` et on rattache des utilisateurs. Le code de ciblage, les règles et
les notifications fonctionnent déjà.

Ce qui reste volontairement limité à la V1 : un utilisateur appartient à une
seule organisation à la fois dans l'interface (`orgId` principal), même si le
modèle autorise `orgIds[]`. Cela évite une complexité d'interface dont
personne n'a besoin aujourd'hui.

---

## 6. Cycle de développement

```
feature/ma-fonctionnalite
        │
        ├── npm run typecheck      (types alignés partout)
        ├── npm run lint
        ├── npm run test
        ├── npm run build:packages
        ├── npm run build -w @fl/admin
        └── npm run rules:test     (règles Firebase sur émulateur)
        │
        ▼
   Pull Request  ──►  CI GitHub  ──►  ✅  ──►  merge dans main
```

Les émulateurs Firebase permettent de développer sans consommer de quota :

```bash
npm run dev:emulators     # auth, firestore, storage, functions
npm run dev:mobile        # Expo, connecté aux émulateurs
npm run dev:admin         # Next.js, connecté aux émulateurs
```

---

## 7. Décisions structurantes à valider

| #   | Décision                                                                              | Alternative écartée                                    | Impact si l'on change d'avis                                                                        |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| D1  | Notifications via **Expo Notifications**, qui relaie vers FCM (Android) et APNs (iOS) | `@react-native-firebase/messaging` + topics FCM natifs | L'abstraction `PushDispatcher` isole le changement ; seul `packages/shared/src/push` est à réécrire |
| D2  | Fil d'actualité par **clés d'audience dénormalisées**                                 | Fan-out dans une collection `feeds/{uid}`              | Le fan-out coûte une écriture par destinataire ; les clés coûtent zéro écriture supplémentaire      |
| D3  | **npm workspaces**                                                                    | pnpm + Turborepo                                       | Migration mécanique                                                                                 |
| D4  | Rôles dans les **Custom Claims**                                                      | Lecture du document `users/{uid}` dans chaque règle    | Les claims évitent une lecture facturée par évaluation de règle                                     |
| D5  | **Pas de messagerie privée 1-à-1** en V1                                              | Ajouter `conversations`                                | Ajout additif, aucun impact sur l'existant                                                          |

Ces cinq points sont détaillés dans les documents suivants.
