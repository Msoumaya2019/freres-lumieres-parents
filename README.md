# Parents Frères Lumières

Application publique iOS/Android pour les familles des écoles maternelle et élémentaire Frères Lumières de Montmagny, avec espace privé FCPE et administration Web. Le dépôt est public sans secret ni donnée réelle.

> État : Phase 1 révisée — architecture adaptée au modèle sans compte parent. Ne pas commencer la Phase 2 avant validation.

## Principe produit

Le mobile s’ouvre immédiatement sur `Accueil / Agenda / Cantine / Contact / Plus`. Consulter les informations, recevoir des notifications et contacter la FCPE ne nécessite aucun compte. Firebase Authentication est réservé aux membres `fcpe`, `moderator` et `admin`; les demandes d’accès membre sont `pending` jusqu’à validation administrative.

Les commentaires publics, profils enfants et discussions parent-parent ne font pas partie du produit. Le futur contact Parent ↔ FCPE est un support privé passant exclusivement par des Cloud Functions sécurisées, jamais par des collections Firestore publiquement lisibles.

## Stack et structure

- `apps/mobile` : Expo SDK 57.0.23, React Native 0.86.3, Expo Router.
- `apps/admin` : Next.js 16.3.5 App Router.
- `packages/*` : types, Zod, permissions et configuration Firebase partagés.
- `functions` : Functions Node.js 22 pour les opérations privilégiées.
- `firebase` : Rules et index.
- `docs` : architecture, données, rôles, sécurité et notifications.

Les choix et frontières de confiance sont détaillés dans [docs/architecture.md](docs/architecture.md).

## Prérequis et installation

- Node.js 22.23.2 (`.nvmrc`)
- pnpm 11.19.0
- Java 21 pour Firestore/Storage Emulator

```bash
pnpm install
cp .env.example .env.local
pnpm lint
pnpm typecheck
pnpm test
pnpm test:rules:emulated
pnpm build
pnpm expo:check
pnpm expo:config
```

`pnpm emulators` démarre Auth, Firestore, Storage et Functions. `pnpm seed:demo` injecte uniquement un admin, un membre FCPE en attente, les deux écoles et une publication fictive; la commande refuse tout project ID qui ne commence pas par `demo-`.

## Mobile

```bash
pnpm --filter @flp/mobile dev
pnpm --filter @flp/mobile android
pnpm --filter @flp/mobile ios
pnpm --filter @flp/mobile web
```

L’espace public est la route initiale. Les écrans Documents, Conseils d’école, Sondages, Préférences notifications et Espace membres sont accessibles depuis Plus. La direction visuelle est centralisée dans `apps/mobile/constants/theme.ts` : fond crème, vert profond, cartes sémantiques et hiérarchie accessible.

## Administration Web

Routes prévues : `/login`, `/dashboard`, `/publications`, `/notifications`, `/contact`, `/members`, `/fcpe`, `/events`, `/canteen`, `/documents`, `/school-councils`, `/polls`, `/logs`, `/settings`.

Les pages métier restent des fondations de Phase 1. Les mutations sensibles passent par Functions; le garde client n’est jamais une autorisation.

## Build iOS non signé

Dans GitHub : **Actions → Build iOS Unsigned → Run workflow**. Le workflow utilise `macos-26` ARM64, Xcode 26.4.1, CocoaPods 1.17.0, Node 22.23.2 et pnpm 11.19.0. Il exécute Expo Prebuild, compile Release pour `generic/platform=iOS` avec signature désactivée, vérifie `iphoneos`, ARM64, le binaire et l’absence de `_CodeSignature`, puis publie `ios-unsigned-ipa` pendant 14 jours.

Une IPA non signée n’est pas installable normalement sur un iPhone grand public. Les notifications APNs ne fonctionneront qu’après signature avec les capacités Apple appropriées; le workflow ne tente pas de contourner cette exigence.

## Sécurité

- Rules publiques limitées aux ressources explicitement publiées.
- Conversations, messages, notes internes et réponses de sondage fermés à tout accès direct.
- Custom Claims limités à `fcpe`, `moderator`, `admin`.
- `.env` réels, comptes de service, P12, mobileprovision et tokens privés interdits.
- Dependabot, CodeQL, CI, Emulator Suite et workflow IPA conservés.

Voir [docs/security.md](docs/security.md), [docs/firestore-schema.md](docs/firestore-schema.md), [docs/roles-permissions.md](docs/roles-permissions.md) et [docs/notifications.md](docs/notifications.md).
