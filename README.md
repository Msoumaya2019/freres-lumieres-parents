# Parents Frères Lumières

**Informations • Échanges • Entraide**

Application iOS/Android destinée aux parents des écoles Frères Lumières à Montmagny, accompagnée d’une interface Web d’administration FCPE. Le dépôt est conçu pour être public sans exposer de secret ni de donnée réelle.

> État : Phase 2 — authentification, inscription parent, validation des comptes et gestion des utilisateurs. Les modules éditoriaux restent réservés aux phases suivantes.

## Architecture

- `apps/mobile` : Expo SDK 57.0.23, React Native 0.86.3, Expo Router.
- `apps/admin` : Next.js 16.3.5 App Router.
- `packages/*` : types, validation Zod, permissions, configuration Firebase.
- `functions` : Functions Node.js 22 pour les opérations privilégiées.
- `firebase` : Rules et index.
- `docs` : décisions, modèle de données, rôles, sécurité et notifications.

Les raisons et compromis sont détaillés dans `docs/architecture.md`.

## Prérequis

- Node.js 22.23.2 (voir `.nvmrc`)
- pnpm 11.19.0
- Java 21 pour les émulateurs Firestore/Storage
- Xcode uniquement pour un build iOS local; GitHub Actions utilise macOS 26 + Xcode 26.4.1

## Installation

```bash
pnpm install
cp .env.example .env.local
```

Les valeurs d’exemple pointent vers un projet fictif. Ne jamais placer de service account dans le dépôt.

## Commandes racine

```bash
pnpm dev                 # mobile + admin
pnpm lint
pnpm typecheck
pnpm test                # tests unitaires rapides
pnpm test:rules:emulated # lance Firestore/Storage et les tests de Rules
pnpm test:phase2:emulated # teste Auth + Functions + cycle d'approbation
pnpm build
pnpm emulators
pnpm seed:demo           # lance Auth/Firestore, injecte le jeu fictif puis s'arrête
pnpm expo:check
```

## Mobile

```bash
pnpm --filter @flp/mobile dev
pnpm --filter @flp/mobile android
pnpm --filter @flp/mobile ios
pnpm --filter @flp/mobile web
```

Les parcours Connexion, Mot de passe oublié, Inscription, Statut du compte et Profil sont fonctionnels. Une session active ouvre les onglets; un compte en attente, suspendu ou refusé reste sur l’écran de statut. La direction visuelle est centralisée dans `apps/mobile/constants/theme.ts` : fond crème, vert profond, couleurs sémantiques par catégorie, typographie et élévations réutilisables. Les modules Accueil, Discussions, Créer et Agenda restent des fondations de navigation jusqu’aux phases métier correspondantes.

Les dossiers `ios/` et `android/` sont générés par Expo Prebuild et ne sont pas versionnés. Les personnalisations natives futures devront utiliser des config plugins.

## Administration Web

```bash
pnpm --filter @flp/admin dev
```

Routes : `/login`, `/dashboard`, `/publications`, `/users`, `/moderation`, `/reports`, `/polls`, `/events`, `/documents`, `/school-councils`, `/settings`.

La connexion admin et la route `/users` sont fonctionnelles. L’interface permet la recherche, le filtrage, l’approbation, la suspension, le refus, la réactivation et le changement de rôle. Les mutations passent par des Cloud Functions; le garde client améliore la navigation mais ne constitue pas une frontière de sécurité.

## Firebase et émulateurs

```bash
pnpm emulators
```

Pour créer séparément un jeu de démonstration éphémère, exécuter `pnpm seed:demo` : la commande lance elle-même les émulateurs Auth/Firestore, transmet leurs hôtes au processus de seed puis les arrête. Elle ne doit donc pas être lancée en même temps que `pnpm emulators`.

L’UI Emulator est disponible sur `http://127.0.0.1:4000`. Le seed refuse de s’exécuter sans hôtes Auth/Firestore Emulator et sans identifiant `demo-*`.

Le seed crée un administrateur actif, un parent actif, un parent en attente, les écoles, niveaux et options publiques d’inscription de démonstration. Environnements prévus : `freres-lumieres-dev` et `freres-lumieres-prod`. Aucun projet réel n’est lié automatiquement.

## Tests et qualité

- TypeScript strict et options de sécurité supplémentaires.
- ESLint flat config et Prettier.
- Tests unitaires de la matrice de permissions.
- Tests Firestore/Storage Rules avec Emulator Suite.
- Test d’intégration du cycle inscription → attente → approbation avec Auth, Firestore et Functions Emulator.
- CI : format, lint, types, tests, règles, Expo config et builds.

## Build iOS non signé

Dans GitHub : **Actions → Build iOS Unsigned → Run workflow**.

Le workflow :

1. démarre sur `macos-26` ARM64;
2. sélectionne exactement Xcode 26.4.1 et vérifie CocoaPods 1.17.0;
3. installe Node 22.23.2 et pnpm 11.19.0;
4. génère `ios/` avec Expo Prebuild;
5. compile Release pour `generic/platform=iOS` avec la signature désactivée;
6. vérifie `iphoneos`, le binaire ARM64 et l’absence de signature;
7. crée `ParentsFreresLumieres-v0.1.0-build…-unsigned.ipa`;
8. publie l’Artifact `ios-unsigned-ipa` pendant 14 jours.

Aucun compte Apple, certificat, provisioning profile, Team ID ou EAS Build n’est utilisé. Une IPA non signée ne peut pas être installée normalement sur un appareil grand public; elle sert d’artefact technique jusqu’à la future stratégie de signature.

Le choix est vérifié contre la [matrice officielle Expo SDK 57](https://docs.expo.dev/versions/latest/) (Xcode 26.4 minimum) et l’[inventaire officiel du runner `macos-26` ARM64](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md), qui contient Xcode 26.4.1 au chemin épinglé et CocoaPods 1.17.0. Les actions tierces sont référencées par SHA immuable, avec leur version majeure en commentaire. L’image GitHub elle-même restant maintenue par GitHub, le workflow échoue explicitement si l’outil épinglé disparaît au lieu de changer silencieusement de Xcode.

## Futur Android

La configuration contient déjà `versionCode: 1` et le package Android. Le workflow APK n’est volontairement pas créé avant la phase prévue.

## Sécurité

- Authentification Firebase, Custom Claims et Rules côté serveur.
- Rôles `parent`, `fcpe`, `moderator`, `admin`; statuts séparés.
- Aucun bouton masqué n’est considéré comme une autorisation.
- `.gitignore` couvre secrets, certificats et artefacts.
- Dependabot et CodeQL configurés.
- App Check prévu avant production.

Voir `docs/security.md` et `docs/roles-permissions.md`.

## Contribution et licence

Voir `CONTRIBUTING.md`. Le dépôt public n’est pas automatiquement open source; aucun fichier `LICENSE` n’est ajouté à ce stade.
