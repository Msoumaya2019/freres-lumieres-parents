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

> **Ce que coûte un `EXPO_ACCESS_TOKEN` expiré, et comment le reconnaître.** Il ne
> fait pas échouer _un_ envoi : il les fait tous échouer. Les fonctions le
> distinguent maintenant d'une panne ordinaire — `PushCredentialsError` —,
> interrompent l'envoi, et écrivent une ligne `error` qui nomme la cause. Ni
> historique ni `notifiedAt` ne sont écrits, donc rien n'affirme qu'un message
> est parti. C'est le seul message de cette forme : une alerte de journal peut
> s'y accrocher. Détail dans `docs/05-notifications.md` § 7.

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

Déclenché sur **push** (toutes les branches) et sur **pull request** visant
`main`. Il doit être rapide (objectif : moins de 5 minutes) et échouer
clairement.

Le workflow n'est pas une suite linéaire : **un travail `quality` commande
quatre travaux parallèles**. Chacun déclare `needs: quality`, donc un échec de
formatage, de lint, de types ou de tests les **annule tous** — au lieu de les
laisser tourner pour rien.

| Travail (nom affiché)                     | Contenu                                                           | Dépend de |
| ----------------------------------------- | ----------------------------------------------------------------- | --------- |
| `quality` — Format · Lint · Types · Tests | audit, flux de travail, packages, formatage, ESLint, types, tests | —         |
| `build-admin` — Build Web Admin           | build Next.js de production, archivé en artefact                  | `quality` |
| `mobile-check` — Vérification Expo        | `expo config`, puis `expo export --platform android`              | `quality` |
| `build-functions` — Build Cloud Functions | compilation TypeScript des Cloud Functions                        | `quality` |
| `rules` — Tests des règles Firebase       | émulateur Firestore sous Java 21, `npm run rules:test`            | `quality` |

Le travail `quality`, lui, est bien une suite d'étapes :

| Étape                    | Commande                               | Bloque la PR |
| ------------------------ | -------------------------------------- | ------------ |
| 1. Checkout              | `actions/checkout`                     | oui          |
| 2. Node 22 + cache npm   | `actions/setup-node` avec `cache: npm` | oui          |
| 3. Installation          | `npm ci` (lockfile strict)             | oui          |
| 4. Flux de travail       | `npm run workflows:check`              | oui          |
| 5. Audit des dépendances | `npm audit --audit-level=high`         | oui          |
| 6. Build des packages    | `npm run build:packages`               | oui          |
| 7. Formatage             | `npm run format:check`                 | oui          |
| 8. ESLint                | `npm run lint`                         | oui          |
| 9. TypeScript            | `npm run typecheck`                    | oui          |
| 10. Tests unitaires      | `npm run test`                         | oui          |

L'étape 4 est le contrôle statique des flux de travail — voir § 5. Elle est
placée tôt parce qu'une faute de syntaxe dans un script `run:` ne se voit
qu'à l'exécution du flux concerné, c'est-à-dire sur un exécuteur macOS réservé
pour quinze minutes.

L'étape 5 est bloquante et son seuil est `high`. Il est haut parce que les avis
modérés de cet arbre sont, pour l'essentiel, des outils de construction qui ne
quittent jamais la machine. Mais **la porte ne remplace pas la lecture** : un
avis réellement joignable dans le paquet livré n'est pas forcément « haut », et
c'est arrivé — voir `docs/04-security.md` § 11.

Chaque travail refait `npm ci` et le build des packages : deux travaux GitHub
Actions ne partagent pas de système de fichiers, et transporter un artefact
coûterait plus cher que reconstruire. Les exécutions précédentes sur la même
branche sont **annulées** (`concurrency`), et les actions tierces sont
**épinglées à un SHA de commit**, jamais à un tag — un tag est mutable, et le
dépôt est public.

**Pourquoi `expo export` et pas un build natif :** exporter le bundle
JavaScript vérifie que **tout se résout** (imports, monorepo, TypeScript,
packages partagés) sans exiger Android SDK ni Xcode, et en moins d'une minute.
Un build natif complet est dix fois plus lent et n'apporterait rien de plus à
chaque pull request.

**Pourquoi les tests de règles tournent en CI :** l'émulateur Firestore
fonctionne sur les runners GitHub (Java préinstallé), et c'est le seul moyen
de vérifier réellement les règles de sécurité avant la production.

### Un document qui ne bloque pas l'étape de formatage

L'étape 7 — le formatage — échoue parfois pour une raison qui n'a rien à voir
avec le contenu. Deux constructions, et deux seulement, ont été trouvées et
mesurées — **toutes deux à l'intérieur d'une entrée de liste**, et **toutes deux
seulement au retrait six**, celui des documents de ce dépôt :

| Construction, sous une puce indentée de six espaces | Effet d'une passe                  | Converge ?                   |
| --------------------------------------------------- | ---------------------------------- | ---------------------------- |
| deux blocs de paragraphe de plusieurs lignes        | le second bloc **gagne** 4 espaces | non — 10, 14, 18, 22         |
| un span de code coupé par un retour à la ligne      | la ligne **perd** 2 espaces        | oui — 6, 4, 2, 0, hors liste |

La première est la plus mauvaise : `format:check` la signale à chaque exécution,
quoi qu'on écrive, et `prettier --write` annonce pourtant avoir réécrit le
fichier à chaque passage. Le symptôme est trompeur — ni les fins de ligne, ni
l'encodage, ni une liste imbriquée ne sont en cause.

La seconde converge, mais à la colonne 0, c'est-à-dire **hors de l'entrée de
liste**, où la ligne devient un paragraphe de premier niveau et **rompt la
phrase**. La convergence n'est donc pas une bonne nouvelle : elle **modifie le
document**.

**Aux deux espaces de retrait, aucune des deux ne se déclenche** — mesuré, les
deux restent stables sur quatre passes. Une sonde écrite trop haut dans la marge
ne prouve donc rien sur ces documents, et c'est l'erreur qui a été commise une
fois ici.

La convention qui tient est double : **un seul bloc par entrée**, et **ne pas
couper un span de code en fin de ligne**. Un paragraphe long ne craint rien, et
deux paragraphes d'une ligne chacun non plus.

### La porte se lance sur l'état final

`format:check` valide l'instant où on l'exécute, pas le contenu du commit.
Éditer un fichier **après** l'avoir lancé, puis pousser sans relancer, fait
échouer la CI sur un document qu'on croyait propre — et comme les travaux
suivants déclarent `needs:`, ils sont **annulés en cascade** derrière. Un run
entier a été perdu ainsi, pour un seul fichier.

### Protection de branche

À activer dans `Settings → Branches → Branch protection rules` pour `main` :

- ✅ Require a pull request before merging
- ✅ Require status checks to pass : `Format · Lint · Types · Tests`, `Build Web Admin`, `Vérification Expo`, `Build Cloud Functions`, `Tests des règles Firebase`
- ✅ Require branches to be up to date before merging
- ✅ Require conversation resolution

Ces cinq noms sont ceux des travaux de `ci.yml` : GitHub propose le `name:` du
travail, pas son identifiant. C'est pourquoi l'en-tête de `ci.yml` qualifie le
nom de `quality` de **stable** — le renommer ferait disparaître le contrôle
attendu sans que rien ne le signale.

Une PR ne peut pas être fusionnée si le formatage, ESLint, le typage, les tests,
le build admin, le bundle Expo, les Cloud Functions ou les règles échouent.

---

## 4. Le workflow `mobile-build.yml`

**Déclenchement manuel** (`workflow_dispatch`), avec trois entrées :

| Entrée     | Valeurs                 | Défaut    |
| ---------- | ----------------------- | --------- |
| `platform` | `android`, `ios`, `all` | `android` |
| `profile`  | `preview`, `production` | `preview` |
| `submit`   | booléen                 | `false`   |

```
Actions → Mobile Build → Run workflow
   platform: [android ▾]
   profile:  [preview ▾]
   submit:   [ ] Soumettre aux stores après le build
```

Puis `eas build --platform … --profile … --non-interactive --no-wait`.
`--no-wait` est volontaire : un build EAS dure des dizaines de minutes, et le
workflow rend la main avec un lien de suivi plutôt que d'immobiliser un
exécuteur pour rien.

**Un second déclenchement est déjà en place : le tag de version.** Pousser un
tag `v*` construit **les deux plateformes en profil `production`**, sans passer
par les entrées manuelles. C'est la voie recommandée pour une publication
réelle.

**Aucun build natif automatique à chaque push.** Un build iOS + Android
consomme du quota EAS et de la file d'attente pour rien si le code n'est pas
encore relu. Le troisième déclenchement possible — sur `main` après un merge —
n'est **pas** activé, et ne le sera que quand le rythme de publication le
justifiera.

Un second travail, `submit`, soumet aux stores. Il ne tourne que sur un tag, ou
si l'entrée `submit` a été cochée. Il s'arrête proprement, en avertissement, si
aucun identifiant de soumission n'est configuré : une publication sur les
stores doit rester un acte délibéré.

### Profils EAS

| Profil        | Usage                              | Android | Distribution                     |
| ------------- | ---------------------------------- | ------- | -------------------------------- |
| `development` | développement avec dev client      | APK     | interne                          |
| `preview`     | test par la FCPE avant publication | APK     | interne (lien de téléchargement) |
| `production`  | App Store / Play Store             | AAB     | store                            |

Le profil `production` a `autoIncrement: true` : EAS gère `versionCode` et
`buildNumber` automatiquement, sans intervention manuelle.

### Où vit `eas.json`

Dans **`apps/mobile/`**, et pas à la racine du dépôt. EAS cherche le fichier à
`join(projectDir, 'eas.json')` — sans remonter les répertoires parents — et
`projectDir` est le dossier du `package.json` le plus proche, donc
`apps/mobile`. Un `eas.json` posé à la racine est **invisible** : le build
échoue sur `eas.json could not be found at …/apps/mobile/eas.json`, et il
échoue là **avant** de parler d'authentification.

C'est la règle d'Expo pour un monorepo : les commandes EAS se lancent depuis le
dossier de l'application, et les fichiers EAS y vivent. Le workflow s'y tient
déjà (`working-directory: apps/mobile`), le fichier doit donc y être.

---

## 5. Les autres workflows

### `codeql.yml`

Analyse de sécurité statique sur JavaScript/TypeScript (`javascript-typescript`,
requêtes `security-extended`). Tourne sur push vers `main`, **sur pull request
visant `main`**, et une fois par semaine — une nouvelle règle d'analyse peut
détecter un problème dans du code ancien. Signale les motifs dangereux —
injection, données non validées, usage incorrect de la cryptographie.

### `ios-unsigned.yml`

**Déclenchement manuel uniquement** (`workflow_dispatch`) : un build natif iOS
occupe un exécuteur macOS une quinzaine de minutes, et la majorité des commits ne
mérite pas un binaire.

Il produit un **IPA non signé**, et c'est le point à comprendre avant de le
lancer : iOS refuse d'installer ce qui n'est pas signé. Le fichier est un
**produit intermédiaire**, à re-signer sur la machine de l'utilisateur
(Sideloadly, AltStore) avec son propre identifiant Apple. Signer en CI exigerait
un certificat et un profil de provisionnement, qui n'ont pas leur place dans un
dépôt public.

**Pourquoi ce flux existe à côté de `mobile-build.yml` :** celui-ci passe par
EAS, qui demande un compte Expo, un jeton et un `projectId` renseigné dans
`app.json` — trois choses à obtenir avant de produire quoi que ce soit.
`ios-unsigned.yml` n'en demande **aucune** : il génère le projet Xcode avec
`expo prebuild`, compile sans signature, et empaquette.

Il exige en revanche **sept variables de dépôt** — les six
`EXPO_PUBLIC_FIREBASE_*` et `EXPO_PUBLIC_DEFAULT_ORG_SLUG` — déclarées dans
`Settings → Secrets and variables → Actions → onglet Variables`. Ce ne sont pas
des secrets : elles sont embarquées en clair dans l'application livrée, et les
mettre en secret donnerait une fausse impression de protection. Le flux
**s'arrête avant toute installation** si l'une manque, plutôt que de partir sur
quinze minutes de compilation.

Ces variables sont déclarées **au niveau du job**, et non de l'étape
`expo prebuild`. Metro remplace `process.env.EXPO_PUBLIC_*` pendant la phase
« Bundle React Native code and images », **à l'intérieur de `xcodebuild`** :
déclarées sur le prebuild seul, elles ne seraient jamais inlinées. Le binaire se
compilerait, s'installerait, et n'afficherait **aucune donnée** — un défaut
invisible avant l'installation sur un téléphone. C'est ce que vérifie
`scripts/verify-bundle-config.mjs`, après empaquetage, sur le bundle réellement
embarqué, et dans les deux encodages — une table de chaînes Hermes range le non
ASCII en UTF-16LE.

L'exécuteur est `macos-26`, et non `macos-15` : Xcode 26 est le premier à fournir
Swift 6.2, exigé par `expo-modules-jsi` (`swift-tools-version: 6.2`). L'image
`macos-15` a Xcode 26 installé mais **16.4 par défaut**, et la compilation
échouerait sur un message qui nomme « apple » — le dossier du paquet, et non
Apple.

Trois obstacles attendent la re-signature, et **aucun message d'erreur ne les
nomme** : un mot de passe d'application est refusé par un compte gratuit (il faut
le mot de passe principal et la double authentification), le mode développeur est
obligatoire depuis iOS 16, et sous Windows iTunes doit venir du site d'Apple —
la version du Microsoft Store n'installe pas les pilotes Apple Mobile Device.

### Les tests de règles ne sont pas un workflow à part

Ils forment le travail `rules` de `ci.yml`. Il n'existe **aucun**
`rules-tests.yml` : un workflow séparé n'apporterait rien, puisqu'il faudrait le
déclencher en plus pour obtenir un résultat déjà visible.

### Le contrôle des flux de travail

`scripts/check-workflows.mjs`, lancé par `npm run workflows:check` — étape 4 de
`ci.yml`. Il analyse les quatre flux, puis passe **chaque** script `run:` à
`bash -n`. Un flux de travail se teste normalement en le poussant, c'est-à-dire
au pire moment : une faute de frappe dans un script ne se paie pas en secondes
mais en un aller-retour complet, après l'installation des dépendances. Ici, elle
se paie en une seconde.

Sa portée est écrite dans son en-tête, et elle est volontairement étroite :
`bash -n` **analyse sans évaluer**, donc il attrape un `then` manquant ou une
quote non fermée, mais **pas** une expansion fautive. Il vérifie en outre que le
déclencheur existe, que chaque action est épinglée à un SHA, que `permissions`
est déclaré, que les `working-directory` et les chemins de scripts cités
existent, et que les expressions `steps.X.outputs.Y` et `inputs.X` désignent
quelque chose de réel — y compris, pour une étape `run:`, une sortie qu'elle
**écrit** réellement.

La liste des flux attendus est **fermée dans les deux sens** : un flux supprimé
échoue, et un flux ajouté mais non déclaré échoue aussi. C'est le seul contrôle
du dépôt dont l'absence d'un sujet produirait un vert trompeur — rien d'autre
dans la chaîne ne lit `.github/workflows`.

Les quatre workflows du dépôt sont `ci.yml`, `codeql.yml`, `ios-unsigned.yml`
et `mobile-build.yml`.

---

## 6. Dependabot

`Settings → Code security → Dependabot`

```yaml
# .github/dependabot.yml — extrait : les deux écosystèmes surveillés
updates:
  - package-ecosystem: npm # dépendances JavaScript
  - package-ecosystem: github-actions # actions des workflows
```

La configuration complète vit dans `.github/dependabot.yml`. Ce qui est retenu :

| Réglage                              | Valeur                                                    | Raison                                                                                      |
| ------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Fréquence                            | hebdomadaire, lundi matin (Europe/Paris)                  | on traite les mises à jour une fois par semaine                                             |
| Mises à jour majeures                | `expo`, `react-native`, `react`, `next` : **ignorées**    | ces montées exigent de lire les notes de version et souvent de reconstruire les profils EAS |
| Mises à jour mineures et correctives | groupées par écosystème                                   | moins de bruit                                                                              |
| Limite de PR ouvertes                | 5 pour npm, 3 pour les actions                            | évite l'engorgement                                                                         |
| Groupes                              | `expo`, `firebase`, `next`, `tailwind`, `tests`, `outils` | chaque écosystème est mis à jour ensemble                                                   |

Les groupes suivent les **écosystèmes qui doivent monter ensemble**, pas les
noms de paquets : `react-native` est un motif du groupe `expo`, et `typescript`
un motif du groupe `outils`. Le groupe `outils` est en outre restreint aux
mineures et correctives — une majeure de TypeScript mérite sa propre PR.

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
  GitHub Actions : audit · formatage · lint · types · tests
                   puis admin · Expo · functions · règles
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
