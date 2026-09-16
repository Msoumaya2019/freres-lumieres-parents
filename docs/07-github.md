# 07 — Dépôt GitHub public, CI/CD et publications

> Phase 1 · Document de référence · couvre les sections 36 à 54 du cahier des charges

## 1. Un dépôt public, mais aucun secret

Le dépôt contient **l'intégralité du code source non sensible** : les deux
applications, les packages, les Security Rules, les index, les Cloud
Functions, les tests, la documentation et les workflows.

Ce qui n'y est **jamais** :

| Interdit                                              | Où cela vit à la place                          |
| ----------------------------------------------------- | ----------------------------------------------- |
| `.env` avec de vraies valeurs                         | `.env.local` en local, GitHub **Secrets** en CI |
| Clé privée Firebase Admin (JSON de compte de service) | GitHub Secret `FIREBASE_SERVICE_ACCOUNT_*`      |
| `google-services.json`, `GoogleService-Info.plist`    | EAS Credentials                                 |
| Token Expo                                            | GitHub Secret `EXPO_TOKEN`                      |
| Clé APNs, certificat `.p12`, `.mobileprovision`       | EAS Credentials                                 |
| Compte de service Google Play                         | GitHub Secret                                   |
| Données réelles (parents, enfants, signalements)      | nulle part                                      |

Le fichier `.gitignore` couvre ces cas, **y compris les variantes de nommage**
(`*service-account*.json`, `*firebase-adminsdk*.json`, `*.p12`, `*.jks`,
`*.keystore`, `credentials.json`). C'est volontaire : on ne peut pas compter
sur le fait qu'un fichier portera exactement le nom prévu.

### Distinguer variables publiques et secrètes

C'est la confusion la plus fréquente, et elle est traitée explicitement dans
`.env.example` :

**Publiques — embarquées dans le bundle, visibles par n'importe qui :**

```
EXPO_PUBLIC_FIREBASE_API_KEY        NEXT_PUBLIC_FIREBASE_API_KEY
EXPO_PUBLIC_FIREBASE_PROJECT_ID     NEXT_PUBLIC_FIREBASE_PROJECT_ID
EXPO_PUBLIC_FIREBASE_APP_ID         NEXT_PUBLIC_FIREBASE_APP_ID
```

Ces valeurs **ne sont pas des secrets**. Elles identifient un projet Firebase.
Les cacher est impossible : elles finissent dans l'application distribuée. La
sécurité repose entièrement sur les Security Rules.

**Secrètes — jamais dans un préfixe public :**

```
EXPO_TOKEN                       → GitHub Secret
FIREBASE_SERVICE_ACCOUNT_DEV     → GitHub Secret
FIREBASE_SERVICE_ACCOUNT_PROD    → GitHub Secret
GOOGLE_PLAY_SERVICE_ACCOUNT      → GitHub Secret
EXPO_ACCESS_TOKEN                → variable d'environnement des Functions
```

> **Règle absolue : aucune clé Admin ne doit jamais apparaître dans une
> variable `EXPO_PUBLIC_*` ou `NEXT_PUBLIC_*`.** Le préfixe signifie
> littéralement « ceci est public ».

### En cas de fuite

Un secret commité dans un dépôt public est **compromis dès le push**, même
s'il est retiré au commit suivant : les robots qui indexent GitHub le
détectent en quelques minutes.

1. **Révoquer** le secret (console Firebase / Expo / Apple / Google Play).
2. **Émettre** un nouveau secret, placé dans GitHub Secrets.
3. Purger l'historique avec `git filter-repo`.

La purge vient **en dernier** : elle ne sert à rien tant que le secret est
encore actif.

---

## 2. GitHub Secrets et variables

`Settings → Secrets and variables → Actions`

| Nom                             | Type      | Usage                                              | Obligatoire                 |
| ------------------------------- | --------- | -------------------------------------------------- | --------------------------- |
| `EXPO_TOKEN`                    | Secret    | builds EAS                                         | oui, pour les builds mobile |
| `FIREBASE_SERVICE_ACCOUNT_DEV`  | Secret    | déploiement règles/functions en dev                | Phase 12                    |
| `FIREBASE_SERVICE_ACCOUNT_PROD` | Secret    | déploiement en production                          | Phase 12                    |
| `FIREBASE_PROJECT_ID_DEV`       | Variable  | nom du projet dev                                  | Phase 12                    |
| `FIREBASE_PROJECT_ID_PROD`      | Variable  | nom du projet prod                                 | Phase 12                    |
| `NEXT_PUBLIC_FIREBASE_*`        | Variables | configuration client de l'admin, injectée au build | oui, pour le build admin    |

**Principe du moindre privilège :** on ne crée un secret que lorsqu'un
workflow en a réellement besoin. Aucun secret « au cas où ».

Les valeurs ne sont **jamais** affichées dans les logs. GitHub masque
automatiquement les secrets, et les workflows évitent tout `echo` de variable
sensible.

---

## 3. Le workflow `ci.yml`

Déclenché sur **push** et **pull request**. Il doit être rapide (objectif :
moins de 5 minutes) et échouer clairement.

| Étape                  | Commande                               | Bloque la PR |
| ---------------------- | -------------------------------------- | ------------ |
| 1. Checkout            | `actions/checkout`                     | oui          |
| 2. Node 22 + cache npm | `actions/setup-node` avec `cache: npm` | oui          |
| 3. Installation        | `npm ci` (lockfile strict)             | oui          |
| 4. Build des packages  | `npm run build:packages`               | oui          |
| 5. Formatage           | `npm run format:check`                 | oui          |
| 6. ESLint              | `npm run lint`                         | oui          |
| 7. TypeScript          | `npm run typecheck`                    | oui          |
| 8. Tests unitaires     | `npm run test`                         | oui          |
| 9. Build admin         | `npm run build -w @fl/admin`           | oui          |
| 10. Export Expo        | `npx expo export --platform android`   | oui          |
| 11. Règles Firebase    | `firebase emulators:exec` + tests      | oui          |

**Pourquoi `expo export` et pas un build natif :** exporter le bundle
JavaScript vérifie que **tout se résout** (imports, monorepo, TypeScript,
packages partagés) sans exiger Android SDK ni Xcode, et en moins d'une minute.
Un build natif complet est dix fois plus lent et n'apporterait rien de plus à
chaque pull request.

**Pourquoi les tests de règles tournent en CI :** l'émulateur Firestore
fonctionne sur les runners GitHub (Java préinstallé), et c'est le seul moyen
de vérifier réellement les règles de sécurité avant la production.

### Protection de branche

À activer dans `Settings → Branches → Branch protection rules` pour `main` :

- ✅ Require a pull request before merging
- ✅ Require status checks to pass : `ci` / `lint`, `typecheck`, `test`, `build-admin`, `rules`
- ✅ Require branches to be up to date before merging
- ✅ Require conversation resolution

Une PR ne peut pas être fusionnée si le typage, ESLint, les tests ou le build
admin échouent.

---

## 4. Le workflow `mobile-build.yml`

**Déclenchement manuel uniquement** (`workflow_dispatch`), avec deux choix :

| Entrée     | Valeurs                 | Défaut    |
| ---------- | ----------------------- | --------- |
| `platform` | `android`, `ios`, `all` | `android` |
| `profile`  | `preview`, `production` | `preview` |

```
Actions → Mobile Build → Run workflow
   platform: [android ▾]
   profile:  [preview ▾]
```

Puis `eas build --platform ${{ inputs.platform }} --profile ${{ inputs.profile }} --non-interactive`.

**Aucun build natif automatique à chaque push.** Un build iOS + Android
consomme du quota EAS et de la file d'attente pour rien si le code n'est pas
encore relu. Les déclenchements possibles :

- manuellement, depuis l'interface GitHub ;
- automatiquement sur un **tag** de version (`v*`) ;
- optionnellement, sur `main` après un merge — à activer quand le rythme de
  publication le justifiera.

### Profils EAS

| Profil        | Usage                              | Android | Distribution                     |
| ------------- | ---------------------------------- | ------- | -------------------------------- |
| `development` | développement avec dev client      | APK     | interne                          |
| `preview`     | test par la FCPE avant publication | APK     | interne (lien de téléchargement) |
| `production`  | App Store / Play Store             | AAB     | store                            |

Le profil `production` a `autoIncrement: true` : EAS gère `versionCode` et
`buildNumber` automatiquement, sans intervention manuelle.

---

## 5. Les autres workflows

### `codeql.yml`

Analyse de sécurité statique sur JavaScript/TypeScript. Tourne sur push vers
`main` et une fois par semaine. Signale les motifs dangereux — injection,
données non validées, usage incorrect de la cryptographie.

### `rules-tests.yml`

Exécute les tests des Security Rules sur émulateur, en isolation, pour qu'un
échec soit immédiatement identifiable. (Peut aussi tourner dans `ci.yml` ; les
deux options sont prévues.)

---

## 6. Dependabot

`Settings → Code security → Dependabot`

```yaml
# .github/dependabot.yml
updates:
  - package-ecosystem: npm # dépendances JavaScript
  - package-ecosystem: github-actions # actions des workflows
```

Configuration retenue :

| Réglage                              | Valeur                                                   | Raison                                           |
| ------------------------------------ | -------------------------------------------------------- | ------------------------------------------------ |
| Fréquence                            | hebdomadaire, lundi matin                                | on traite les mises à jour une fois par semaine  |
| Mises à jour majeures                | **PR séparées, jamais automatiques**                     | React Native et Next.js cassent sur les majeures |
| Mises à jour mineures et correctives | groupées                                                 | moins de bruit                                   |
| Limite de PR ouvertes                | 5                                                        | évite l'engorgement                              |
| Groupes                              | `expo`, `react-native`, `firebase`, `next`, `typescript` | chaque écosystème est mis à jour ensemble        |

**Toute PR Dependabot passe par la même CI.** Aucune fusion automatique.

Les écosystèmes à surveiller en priorité : **Firebase, Expo, React Native,
Next.js**. Ce sont ceux dont une mise à jour peut casser le build ou
introduire une vulnérabilité.

---

## 7. CodeQL et détection de secrets

À activer dans `Settings → Code security` :

- ✅ **Dependabot alerts** — vulnérabilités connues dans les dépendances
- ✅ **Dependabot security updates** — correctifs automatiques de sécurité
- ✅ **Secret scanning** — détection de secrets commités
- ✅ **Push protection** — _bloque le push_ contenant un secret détecté
- ✅ **CodeQL analysis** — analyse statique

> **Push protection est la mesure la plus utile du lot.** Elle empêche le
> commit d'aboutir, au lieu de signaler après coup. Elle doit être activée en
> premier.

### Ce qu'il ne faut pas faire

Ne pas ajouter un « outil de détection de secrets » maison — un script
`grep` sur quelques motifs donne une fausse impression de protection tout en
laissant passer l'essentiel. Les mécanismes natifs de GitHub, entraînés sur
des millions de motifs réels, sont strictement meilleurs.

---

## 8. Branches, commits et releases

### Branches

| Branche       | Rôle                                          |
| ------------- | --------------------------------------------- |
| `main`        | branche stable, protégée, toujours déployable |
| `feature/...` | nouvelle fonctionnalité                       |
| `fix/...`     | correction de bug                             |
| `chore/...`   | maintenance, dépendances, outillage           |

`main` ne reçoit **jamais** de commit direct. Toute modification passe par une
pull request.

### Convention de commits

Format : `type(portée): description`

```
feat(mobile): ajouter l'écran de détail d'un signalement
fix(admin): corriger la pagination de la liste des utilisateurs
chore(deps): mettre à jour Expo SDK 57
docs(readme): documenter la création du premier administrateur
test(rules): couvrir le refus d'accès pour un compte en attente
```

Types : `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `style`, `perf`.

### Versions et releases

Semantic Versioning : `MAJEUR.MINEUR.CORRECTIF`

| Version | Signification                                |
| ------- | -------------------------------------------- |
| `0.x.y` | développement, avant la première publication |
| `1.0.0` | première version publiée sur les stores      |
| `1.1.0` | nouvelles fonctionnalités                    |
| `1.1.1` | correction de bug                            |

```
git tag v0.1.0
git push origin v0.1.0
```

Le tag déclenche la création d'une GitHub Release et, si activé, le build EAS
de production.

**Numérotation des builds :** `eas.json` utilise `appVersionSource: "remote"`
et `autoIncrement: true` en production. EAS incrémente `versionCode` (Android)
et `buildNumber` (iOS) sans intervention. C'est la source d'erreurs la plus
fréquente lors des publications — autant la déléguer.

---

## 9. Environnements Firebase séparés

| Environnement | Projet Firebase        | Usage                               |
| ------------- | ---------------------- | ----------------------------------- |
| développement | `freres-lumieres-dev`  | émulateurs, tests, données fictives |
| production    | `freres-lumieres-prod` | données réelles                     |

Le fichier `.firebaserc` définit les alias `dev` et `prod`. **Les alias vivent
là et nulle part ailleurs** : `firebase-tools` ne lit que ce fichier
(`lib/rc.js`, `projectUtils.js`, `commands/use.js`), jamais une clé `projects`
de `firebase.json`. Une telle clé y serait inerte — elle donnerait l'illusion
que la configuration est faite, alors que `firebase deploy` échouerait faute de
projet actif et que `firebase use prod` viserait un projet littéralement nommé
« prod ».

Sans `.firebaserc`, les émulateurs démarrent quand même, mais sous le projet de
démonstration `demo-no-project` : acceptable pour un essai isolé, trompeur pour
un test qui croit viser `dev`.

**Le développement n'utilise jamais la base de production.** Par défaut, les
applications se connectent aux **émulateurs locaux**
(`EXPO_PUBLIC_USE_FIREBASE_EMULATORS=true`). La CI utilise également les
émulateurs pour les tests.

Les jeux de données de démonstration ne contiennent que des noms
manifestement fictifs.

---

## 10. Le cycle complet

```
  Je développe avec Codex
          │
          ▼
  Codex modifie le dépôt (branche feature/…)
          │
          ▼
  commit · push GitHub
          │
          ▼
  GitHub Actions : lint · typecheck · tests · build admin · règles
          │
     ┌────┴────┐
     ▼         ▼
   ❌         ✅
   corriger   merge dans main
          │
          ▼
  Nouvelle version à publier ?
          │
          ▼
  Actions → Mobile Build (platform, profile)
          │
          ▼
  EAS Build
          │
     ┌────┴─────┐
     ▼          ▼
  Android      iOS
  AAB / APK    build
```

À aucun moment un secret n'est exposé, et le dépôt reste lisible par
n'importe qui.

---

## 11. À décider

| #   | Question                             | Proposition                                                                                        |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| G1  | Licence du dépôt                     | ~~à trancher~~ **tranché : aucune licence** — tous droits réservés, décision assumée (voir README) |
| G2  | Build natif automatique sur `main` ? | non pour l'instant ; à activer quand le rythme de publication augmentera                           |
| G3  | Sentry pour le suivi des erreurs ?   | en Phase 13, après stabilisation                                                                   |
| G4  | Branche `develop` ?                  | non — `main` + branches de fonctionnalité suffisent à cette échelle                                |
