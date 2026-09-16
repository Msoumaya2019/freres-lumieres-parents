# FCPE — Écoles Frères Lumières (Montmagny)

Application mobile et interface d'administration pour l'association de parents
d'élèves des écoles maternelle et élémentaire Frères Lumières.

Le projet s'adresse à trois publics, avec des droits très différents :

| Public                 | Accès                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| **Parents**            | Fil d'actualité, discussions, sondages, agenda, documents, signalements                   |
| **Membres de la FCPE** | Tout ce qui précède, plus la publication, les réponses aux signalements et l'espace privé |
| **Administrateurs**    | Tout, plus la validation des comptes, la modération et le journal d'audit                 |

> **État du projet : Phase 1 terminée.** Les fondations (architecture, modèle de
> données, règles de sécurité, squelette du monorepo, CI) sont en place et
> vérifiées. Les fonctionnalités arrivent phase par phase — voir
> [`docs/08-roadmap.md`](docs/08-roadmap.md).

---

## Prérequis

| Outil          | Version           | Nécessaire pour                                    |
| -------------- | ----------------- | -------------------------------------------------- |
| Node.js        | 22.x (`>=22 <23`) | Tout                                               |
| npm            | 10+               | Tout (le monorepo utilise les _workspaces_ npm)    |
| Java (JDK)     | **21 ou plus**    | Les émulateurs Firebase, donc `npm run rules:test` |
| Xcode          | 16+               | Simulateur iOS — macOS uniquement                  |
| Android Studio | SDK 35+           | Émulateur Android                                  |
| EAS CLI        | dernière          | Builds natifs (`npm i -g eas-cli`)                 |

Java est la dépendance la plus souvent oubliée : `firebase-tools` refuse
désormais toute version antérieure à 21, et le message d'erreur n'est pas
explicite. Vérifiez avec `java -version` avant de lancer les tests de règles.

---

## Installation

```bash
git clone <url-du-depot>
cd freres-lumieres
npm install
npm run build:packages
```

`build:packages` n'est pas optionnel : les applications importent les paquets
partagés depuis leur dossier `dist`. Sans cette étape, `npm run typecheck`
échoue sur `@fl/shared`.

---

## Commandes

### Développement

| Commande                | Effet                                                                 |
| ----------------------- | --------------------------------------------------------------------- |
| `npm run dev:mobile`    | Démarre Expo (QR code, simulateur iOS, émulateur Android)             |
| `npm run dev:admin`     | Démarre l'interface d'administration sur `http://localhost:3000`      |
| `npm run dev:emulators` | Démarre les émulateurs Firebase (Auth, Firestore, Storage, Functions) |

### Vérifications

Toutes ces commandes tournent **sans aucun secret** : c'est une contrainte de
conception, pas une coïncidence. La CI les exécute à chaque push.

| Commande               | Effet                                                           |
| ---------------------- | --------------------------------------------------------------- |
| `npm run typecheck`    | Vérifie les types de tous les workspaces                        |
| `npm run lint`         | ESLint sur tous les workspaces                                  |
| `npm run test`         | Tests unitaires (aucun émulateur requis)                        |
| `npm run format`       | Reformate tout le dépôt                                         |
| `npm run format:check` | Vérifie le formatage sans modifier                              |
| `npm run rules:test`   | **Tests des règles de sécurité** sur émulateur (Java 21 requis) |

### Amorçage d'un environnement

À exécuter une fois par environnement (développement, recette, production),
et **après** `npm run build:packages` — les deux scripts s'appuient sur la
logique partagée, et refusent de démarrer avec un message explicite si elle
n'est pas compilée.

| Commande                  | Effet                                                      |
| ------------------------- | ---------------------------------------------------------- |
| `npm run seed:reference`  | Crée l'organisation, les écoles et les classes de l'année  |
| `npm run bootstrap:admin` | Crée le premier compte administrateur et ses Custom Claims |

L'ordre n'est pas indifférent. Sans données de référence, le formulaire
d'inscription n'a aucune école à proposer. Sans administrateur, personne ne
détient les droits nécessaires pour valider les comptes — les rôles vivent
dans les Custom Claims, que seul l'Admin SDK peut écrire.

`bootstrap:admin` attend `--email`, `--first-name` et `--last-name`, et lit le
mot de passe dans `BOOTSTRAP_ADMIN_PASSWORD`. Cette variable d'environnement
est préférable à `--password`, qui reste visible dans l'historique du shell et
dans la liste des processus :

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/chemin/compte-de-service.json
export BOOTSTRAP_ADMIN_PASSWORD='...'
npm run bootstrap:admin -- --email direction@exemple.fr \
  --first-name Camille --last-name Durand
```

Ces scripts écrivent avec les droits de l'Admin SDK, donc **sans aucune règle
de sécurité pour les arrêter**. Trois garde-fous s'appliquent : ils annoncent
leur cible et demandent confirmation avant d'écrire, ils refusent un
identifiant de projet contenant « prod » sans `--confirm-production`, et ils
sont idempotents — les relancer met à jour sans dupliquer.

Sur les émulateurs (`FIRESTORE_EMULATOR_HOST` défini), aucun identifiant
d'accès n'est nécessaire.

---

### Déploiement

| Commande                   | Effet                                                 |
| -------------------------- | ----------------------------------------------------- |
| `npm run deploy:rules`     | Déploie les règles Firestore et Storage, et les index |
| `npm run deploy:functions` | Déploie les Cloud Functions                           |
| `npm run deploy:admin`     | Construit l'interface d'administration                |

---

## Structure du monorepo

```
.
├── apps/
│   ├── mobile/            # Application Expo / React Native (parents + FCPE)
│   └── admin/             # Interface web Next.js (FCPE + administrateurs)
├── packages/
│   ├── types/             # Types et énumérations — aucune dépendance
│   ├── shared/            # Permissions, audiences, validation Zod, thème
│   ├── firebase/          # SDK client : dépôts, pagination, envoi de notifications
│   └── testing/           # Harnais de tests des règles de sécurité
├── functions/             # Cloud Functions (Custom Claims, compteurs, envois)
├── firebase/              # firestore.rules, storage.rules, index
└── docs/                  # Documentation de conception (8 documents)
```

### Sens des dépendances

```
@fl/types  ←  @fl/shared  ←  @fl/firebase  ←  apps/*
                    ↑
                functions/
```

Une seule direction, jamais d'inversion. `@fl/types` ne dépend de rien, ce qui
permet à n'importe quel paquet de l'importer sans créer de cycle.

---

## Configuration Firebase

### Aucun secret dans le dépôt

Le dépôt est **public**. Les clés privées, comptes de service et fichiers
`google-services.json` sont donc exclus par [`.gitignore`](.gitignore). Si vous
pensez en avoir commité un, considérez-le comme compromis : révoquez-le avant
toute autre chose.

### Variables d'environnement

Copiez [`.env.example`](.env.example) vers `.env` et renseignez vos valeurs.

| Fichier                 | Contenu                                          | Visibilité                  |
| ----------------------- | ------------------------------------------------ | --------------------------- |
| `.env` (racine)         | Configuration Firebase, identifiants d'émulateur | Local uniquement            |
| `apps/admin/.env.local` | `NEXT_PUBLIC_FIREBASE_*`                         | Local uniquement            |
| `apps/mobile/.env`      | `EXPO_PUBLIC_FIREBASE_*`                         | Embarqué dans l'application |

Les variables `NEXT_PUBLIC_*` et `EXPO_PUBLIC_*` finissent **dans le bundle
client** : elles sont donc publiques par nature. La configuration Firebase
(identifiants de projet, clé d'API web) est conçue pour l'être. Ce qui ne doit
jamais y figurer, en revanche, c'est une clé d'administration, un jeton EAS ou
un identifiant de compte de service.

### En intégration continue

Aucun secret n'est nécessaire : le build de l'administration et les tests
tournent sans configuration Firebase. Les secrets ne sont requis que pour les
déploiements et les builds EAS, et sont alors stockés dans les _GitHub Actions
Secrets_ — jamais dans le dépôt.

---

## Sécurité

Le client est **hostile par conception**. La configuration Firebase est
publique, donc n'importe qui peut interroger la base avec un script, sans
passer par l'application. Les règles Firestore sont la seule barrière réelle,
et elles sont testées :

```bash
npm run rules:test
```

Deux principes structurent l'ensemble :

1. **Échec fermé.** Un compte `pending`, `suspended` ou `rejected` ne reçoit
   aucun rôle, donc aucune permission. Toute collection non déclarée est
   inaccessible.
2. **Les rôles viennent des Custom Claims**, jamais d'une lecture de document
   dans une règle. Cela évite une lecture facturée à chaque évaluation, et rend
   impossible l'escalade de privilèges en modifiant son propre profil.

Deux conséquences sont documentées plutôt que masquées :

- Les règles Firestore ne sont **pas des filtres** : une requête doit
  contraindre les champs sur lesquels la règle s'appuie, sinon Firestore la
  refuse entièrement.
- Le ciblage fin par niveau ou par classe est appliqué **par la requête du
  client**, pas par les règles. Ce n'est pas une frontière de confidentialité.
  Les vraies frontières — l'organisation, l'espace privé de la FCPE, les
  signalements, les données des enfants — sont garanties par les règles et
  testées.

Le détail complet est dans [`docs/04-security.md`](docs/04-security.md).

---

## Documentation

| Document                                                  | Contenu                                      |
| --------------------------------------------------------- | -------------------------------------------- |
| [`01-architecture.md`](docs/01-architecture.md)           | Architecture, arborescence, choix techniques |
| [`02-data-model.md`](docs/02-data-model.md)               | Modèle de données Firestore                  |
| [`03-roles-permissions.md`](docs/03-roles-permissions.md) | Rôles, permissions, Custom Claims            |
| [`04-security.md`](docs/04-security.md)                   | Stratégie de sécurité et RGPD                |
| [`05-notifications.md`](docs/05-notifications.md)         | Notifications et ciblage des audiences       |
| [`06-couts.md`](docs/06-couts.md)                         | Maîtrise des coûts Firebase                  |
| [`07-github.md`](docs/07-github.md)                       | Dépôt public, CI/CD, publications            |
| [`08-roadmap.md`](docs/08-roadmap.md)                     | Feuille de route par phases                  |

---

## Licence

**Aucune licence n'est accordée.** Il n'y a pas de fichier `LICENSE`, et
`package.json` déclare `"license": "UNLICENSED"` — la convention npm pour
« tous droits réservés ».

Ce que cela signifie concrètement : le code est **public et lisible**, mais
personne n'est autorisé à le réutiliser, le modifier ou le redistribuer. Un
dépôt public n'implique pas une licence libre, et l'absence de licence n'est
pas un oubli : c'est le régime par défaut du droit d'auteur.

Nuance utile : les conditions d'utilisation de GitHub autorisent toute personne
à _consulter_ ce dépôt et à le _dupliquer_ via la plateforme (bouton « Fork »).
Tout usage en dehors de GitHub — reprendre le code dans un autre projet, le
déployer pour une autre association — n'est en revanche pas permis.

**Cette décision n'engage à rien et se défait en un fichier.** Le titulaire des
droits peut modifier, réorganiser, relicencier ou publier ce code comme il
l'entend : une licence ne restreint jamais l'auteur, seulement les tiers. Si
l'objectif devient un jour de permettre à une autre FCPE de reprendre le code,
ajouter un `LICENSE` (MIT par exemple) suffit — et il n'y a rien d'autre à
changer.
