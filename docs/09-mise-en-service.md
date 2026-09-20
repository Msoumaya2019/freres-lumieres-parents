# 09 — Mise en service, pas à pas

> Guide opérationnel · De zéro à l'application installée sur un iPhone

## Ce que ce document est, et ce qu'il n'est pas

Le chemin complet, **dans l'ordre**, pour quelqu'un qui n'a jamais créé de projet
Firebase. À chaque étape, il dit **qui** agit : vous, ou l'assistant.

`README.md` décrit les commandes et leur raison d'être. Ce document décrit la
**suite d'actions** : ce qui se clique, ce qui se recopie, et dans quel ordre.
Les deux se lisent ensemble.

### Deux choses différentes, à ne pas confondre

| Ce qu'on veut                  | Ce qu'il faut                          | Sans quoi                                            |
| ------------------------------ | -------------------------------------- | ---------------------------------------------------- |
| **Construire** l'application   | les 7 valeurs                          | pas d'IPA                                            |
| **Faire fonctionner** l'appli. | règles, fonctions et données déployées | l'application s'installe, s'ouvre, et n'affiche rien |

Le second cas est le pire des symptômes : il ressemble à un bogue alors que c'est
une installation incomplète.

### Ce que vous seul pouvez faire

Créer le projet Firebase et obtenir un identifiant Apple demandent **vos
comptes**. Tout le reste — les variables de dépôt, la compilation, le déploiement
des règles, des fonctions et des données de référence — l'assistant le fait, dès
qu'il a ce que la partie C demande.

---

## Partie A — Le projet Firebase (vous, ~15 minutes)

### A1. Créer le projet

1. Ouvrez <https://console.firebase.google.com/>.
2. **Créer un projet**.
3. **Nom du projet** : `Frères Lumières`. C'est le nom affiché, il est libre.
4. **Identifiant du projet** : cliquez sur _Modifier l'identifiant_ et tapez
   exactement `freres-lumieres-prod`.

   C'est le seul champ qui compte : `.firebaserc` et les scripts du dépôt s'y
   réfèrent par ce nom. S'il est déjà pris — les identifiants sont uniques dans
   tout Google Cloud — choisissez-en un autre et **dites-le** : `.firebaserc`
   devra suivre, et l'assistant s'en charge.

5. **Google Analytics : désactivez-le.** L'application ne s'en sert pas
   (`EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID` est lu mais facultatif), et c'est une
   collecte de données sur des familles en moins.
6. **Créer le projet**, puis attendre la fin de l'initialisation.

### A2. Passer au plan Blaze — inévitable

**Cloud Functions et Cloud Storage exigent le plan Blaze** (paiement à l'usage).
Ce n'est pas un choix de confort :

- depuis le **3 février 2026**, un projet resté sur le plan gratuit Spark **perd
  l'accès à Cloud Storage** — appels en erreur `402` et `403` ;
- et pour **créer** un bucket, le plan Blaze est exigé depuis octobre 2024 ;
- les Cloud Functions, elles, ne se déploient pas du tout sur Spark.

Le plan Blaze conserve un **niveau gratuit**, et pour une association de parents
la facture réelle se compte en centimes.

> **Changer de région ne dispense pas du plan Blaze.** C'est la question qui vient
> naturellement, et la réponse est non : la région n'entre pas dans la condition.
> La documentation officielle dit « _to deploy functions, your project must be on
> the Blaze pricing plan_ » — une condition **au niveau du projet**, sans
> exception géographique. La région n'intervient qu'à un seul endroit : le palier
> _Always Free_ de Cloud Storage n'existe que pour `US-CENTRAL1`, `US-EAST1` et
> `US-WEST1`. C'est un **quota**, pas une condition d'accès — et il ne nous
> servirait à rien : nous n'utilisons pas Storage, et héberger les données de
> familles françaises aux États-Unis serait un choix à défendre devant le RGPD,
> pas une économie.

1. ⚙️ → **Utilisation et facturation** → **Modifier le plan** → **Blaze**, en
   liant un moyen de paiement.
2. **Fixez immédiatement une alerte budgétaire** (Google Cloud → Facturation →
   Budgets et alertes) : 5 € par mois, alerte à 50 %. C'est ce qui évite la
   mauvaise surprise. Voir `docs/06-couts.md`.

### A3. Créer la base Firestore

1. Menu de gauche → **Créer une base de données**.
2. Mode **Production**. Le mode « test » ouvrirait la base à tout le monde, et
   les règles ne sont déployées qu'à la partie C.
3. **Emplacement : `europe-west1` (Belgique).**
4. Activer.

> **Ce choix est définitif.** Un emplacement Firestore ne se déplace pas : le
> changer demande d'exporter puis de réimporter les données. Et il doit
> **correspondre à la région des Cloud Functions** — `europe-west1`, déclarée
> dans `functions/src/index.ts` (`setGlobalOptions({ region: 'europe-west1' })`).
> Un déclencheur Firestore ne se déploie pas dans une autre région que la base :
> se tromper ici ne se voit qu'au premier `deploy:functions`, après avoir tout
> saisi.

### A4. Créer le bucket Storage

1. Menu de gauche → **Storage** → **Commencer**.
2. **Emplacement : `europe-west1`**, comme Firestore.
3. Accepter les règles par défaut — elles seront remplacées à la partie C.

> Le niveau « toujours gratuit » de Cloud Storage ne s'applique **qu'aux buckets
> américains** (`us-central1`, `us-east1`, `us-west1`). Stocker en Europe n'y
> donne donc pas droit. Mais pour quelques mégaoctets de pièces jointes, l'écart
> se compte en centimes, alors que la localisation des données des familles, non.
> Les pièces jointes ne sont d'ailleurs **pas encore implémentées** (phase 6 de
> `docs/08-roadmap.md`).

Le nom du bucket est `<identifiant-du-projet>.firebasestorage.app`. La console
l'affiche : **c'est cette valeur qu'il faut recopier**, jamais une valeur déduite.

### A5. Activer la connexion par e-mail et mot de passe

1. Menu de gauche → **Authentication** → **Commencer**.
2. Onglet **Méthode de connexion** → **E-mail/Mot de passe** → **Activer**.
3. **Ne rien activer d'autre.** L'application n'emploie que
   `signInWithEmailAndPassword`, `createUserWithEmailAndPassword` et
   `sendPasswordResetEmail`. Activer Google ou Apple ouvrirait des chemins que
   personne n'a testés.

### A6. Enregistrer l'application iOS

1. ⚙️ **Paramètres du projet** → onglet **Vos applications** → icône **iOS**.
2. **Identifiant de bundle** : `fr.fcpe.frereslumieres`

   C'est celui de `apps/mobile/app.json`, et il doit être **exactement** celui-là.

3. **Surnom** : `Frères Lumières iOS` — libre.
4. **App Store ID** : laisser vide.
5. **Enregistrer l'application**.
6. La console affiche alors un bloc `firebaseConfig` : **c'est là que sont les six
   valeurs**.

   Ne téléchargez **pas** `GoogleService-Info.plist` : l'application n'en a pas
   besoin, elle lit ces valeurs dans ses variables d'environnement.

### A7. Relever les six valeurs

Recopiez-les **telles quelles**, sans rien reconstruire.

| Dans la console     | Variable de dépôt GitHub                   |
| ------------------- | ------------------------------------------ |
| `apiKey`            | `EXPO_PUBLIC_FIREBASE_API_KEY`             |
| `authDomain`        | `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`         |
| `projectId`         | `EXPO_PUBLIC_FIREBASE_PROJECT_ID`          |
| `storageBucket`     | `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`      |
| `messagingSenderId` | `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` |
| `appId`             | `EXPO_PUBLIC_FIREBASE_APP_ID`              |

> **Ne construisez pas `storageBucket` de mémoire.** Les projets créés depuis fin
> 2024 utilisent `<projet>.firebasestorage.app` ; les plus anciens
> `<projet>.appspot.com`. C'est la console qui a raison.
>
> De même, `appId` doit être celui de l'application **iOS** : il commence par
> `1:` et contient `:ios:`.

Ces valeurs **ne sont pas des secrets** : elles sont embarquées en clair dans
l'application livrée. La sécurité réelle est assurée par les règles Firestore.

### A8. Créer la clé de compte de service

C'est elle qui permet de déployer les règles et d'écrire les données de
référence.

1. ⚙️ **Paramètres du projet** → **Comptes de service**.
2. **Générer une nouvelle clé privée** → **JSON**. Le fichier se télécharge.
3. Rangez-le **hors du dépôt** et notez son chemin.

> Cette clé donne les **pleins droits d'administration** sur le projet, sans
> qu'aucune règle de sécurité ne l'arrête. Deux conséquences :
>
> - elle ne doit **jamais** être commitée (`.gitignore` couvre déjà
>   `*firebase-adminsdk*.json`, mais ne comptez pas là-dessus) ;
> - une fois la mise en service terminée, **révoquez-la** dans la console et
>   supprimez le fichier. C'est même recommandé.

---

## Partie B — La septième valeur

Elle ne vient pas de Firebase :

```
EXPO_PUBLIC_DEFAULT_ORG_SLUG=fcpe-montmagny
```

C'est l'identifiant de l'organisation, créé par `seed:reference` à la partie C.
Un slug erroné ne donne aucun droit — mais l'inscription échouerait.

---

## Partie C — Ce que fait l'assistant, et ce dont il a besoin

Dès que vous avez les **six valeurs** et la **clé de compte de service**, il :

1. pose les **sept variables de dépôt** — aucune recopie manuelle dans GitHub :
   l'assistant peut écrire ces variables lui-même, ce qui a été vérifié ;
2. **lance la compilation de l'IPA** ; elle dure une quinzaine de minutes ;
3. pendant ce temps :

```bash
npm run build:packages
npm run deploy:rules
npm run deploy:functions
node scripts/seed-reference-data.mjs --project freres-lumieres-prod --confirm-production --yes
```

4. puis crée **le premier administrateur** — l'étape qui rend l'application
   réellement utilisable (voir juste en dessous).

### Pourquoi un premier administrateur est indispensable

Ce n'est pas une étape de confort. Un compte créé par l'application l'est avec
`status: 'pending'` (`functions/src/auth/user-triggers.ts`), et un compte en
attente **ne peut lire que son propre profil**. Le passer à `active` est une
action réservée aux rôles `fcpe`, `moderateur` et `admin`.

Sur une base vide, personne ne détient ces rôles. **Sans ce script, chaque parent
qui s'inscrit reste en attente pour toujours, et l'application ne sert à rien.**
C'est aussi la seule opération de tout le projet qui contourne volontairement les
règles de sécurité — il n'existe aucun autre moyen d'amorcer le système.

Il faut donc préparer, de votre côté :

- une **adresse e-mail** (la vôtre convient) ;
- un **prénom** et un **nom** ;
- un **mot de passe** solide : il est validé par le même schéma que le formulaire
  d'inscription, donc un mot de passe que le client refuserait est refusé ici
  aussi. Il n'est **affiché nulle part** — conservez-le.

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/chemin/compte-de-service.json
export BOOTSTRAP_ADMIN_PASSWORD='…'      # préférable à --password, qui reste
                                          # dans l'historique du shell
node scripts/bootstrap-admin.mjs \
  --project freres-lumieres-prod --confirm-production --yes \
  --email direction@exemple.fr --first-name Camille --last-name Durand
```

Le script est **idempotent** : le relancer sur une adresse existante répare le
profil et les droits sans créer de doublon. Il sert donc aussi à rétablir un
administrateur dont les claims auraient été perdus.

Donnez-lui la clé **au format texte** (le contenu du fichier JSON) ou son chemin.
Le compte de service sert **aussi** à `firebase deploy` : `firebase-tools` passe
par les identifiants par défaut (`requireAuth` → `autoAuth` → `GoogleAuth`), donc
**aucune connexion dans un navigateur n'est nécessaire**.

`--confirm-production` n'est pas une formalité : `scripts/lib/cli.mjs` refuse
d'écrire dans un projet dont le nom contient « prod » sans ce drapeau, parce que
ces scripts écrivent avec les droits de l'Admin SDK.

---

## Partie D — Installer sur l'iPhone (vous)

1. À la fin de la compilation, ouvrez le run dans **Actions** et téléchargez
   l'artefact `ipa-non-signe`.
2. Installez [Sideloadly](https://sideloadly.io/) sur un ordinateur.
3. Branchez l'iPhone, glissez l'IPA dans Sideloadly, saisissez votre identifiant
   Apple.
   - **Mot de passe principal**, et non un mot de passe d'application : un mot de
     passe d'application n'est accepté qu'avec un compte développeur payant.
   - Si la double authentification est active, un code à six chiffres vous sera
     demandé.
4. Sur l'iPhone : **Réglages → Confidentialité et sécurité → Mode développeur**,
   l'activer, puis **redémarrer**.
5. **Réglages → Général → VPN et gestion de l'appareil** → votre identifiant →
   **Faire confiance**.
6. Ouvrir l'application.

**Sous Windows**, iTunes doit venir du **site d'Apple** : la version du Microsoft
Store n'installe pas les pilotes Apple Mobile Device, et Sideloadly répond alors
« No devices detected ».

Un compte Apple gratuit donne **7 jours** de validité, 3 applications simultanées
et 10 identifiants par tranche de 7 jours. Cocher le rafraîchissement automatique
de Sideloadly évite de resigner chaque semaine.

---

## À préparer pendant que le reste avance

Ces tâches ne dépendent **ni** de Firebase **ni** de l'assistant. Les faire
pendant les temps d'attente — téléchargements, compilation de quinze minutes — ne
coûte rien, et évite de les découvrir au moment où tout est prêt.

### Sur l'ordinateur

- **iTunes, depuis le site d'Apple** (<https://www.apple.com/itunes/>). La version
  du Microsoft Store n'installe pas les pilotes Apple Mobile Device, et Sideloadly
  répond alors « No devices detected ». C'est un téléchargement de plusieurs
  centaines de mégaoctets : le lancer tôt.
- **Sideloadly** (<https://sideloadly.io/>).

### Sur l'iPhone

- **Vérifier la version d'iOS** : Réglages → Général → Informations → Version.
  L'application vise **iOS 16.4 au minimum**.
- **Brancher l'iPhone à l'ordinateur** et accepter « Faire confiance à cet
  ordinateur ». C'est un prérequis de Sideloadly, et cela se fait à froid.
- **Vérifier l'absence de supervision** : Réglages → Général → VPN et gestion de
  l'appareil. Un appareil géré par une organisation refuse les applications
  signées avec un compte personnel.
- **Avoir sous la main** le **mot de passe principal** de l'identifiant Apple —
  pas un mot de passe d'application — et l'iPhone, pour le code à six chiffres de
  la double authentification.

> Le **mode développeur** ne peut pas être préparé à l'avance : le réglage
> n'apparaît qu'**après** l'installation d'une application de développement. Il
> faudra y revenir, et redémarrer le téléphone.

### Les informations du premier administrateur

Voir la partie C : une adresse e-mail, un prénom, un nom, et un mot de passe
solide. Autant les choisir maintenant — sans cet administrateur, personne ne peut
valider les inscriptions.

---

## L'ordre le plus rapide

Firebase est long à cliquer, la compilation aussi, et les préparatifs de la partie
précédente ne dépendent de rien. Les mener de front fait gagner un quart d'heure :

| #   | Qui       | Quoi                                                                |
| --- | --------- | ------------------------------------------------------------------- |
| 1   | vous      | **En parallèle :** iTunes + Sideloadly, vérifier l'iPhone           |
| 2   | vous      | A1 à A7 — projet, services, application iOS, six valeurs            |
| 3   | assistant | poser les variables, **lancer la compilation**                      |
| 4   | vous      | A8 — la clé de compte de service, pendant que ça compile            |
| 5   | assistant | règles, fonctions, données de référence, **premier administrateur** |
| 6   | vous      | D — re-signer et installer                                          |

---

## Ce qui ne marchera pas encore

- **Les notifications.** Le client n'enregistre aucun jeton d'appareil : il faut
  un `projectId` EAS, vide dans `apps/mobile/app.json` (phase 5 de
  `docs/08-roadmap.md`). Et la capacité Push n'existe pas sur un compte Apple
  gratuit. L'application s'installera et fonctionnera — ce sont les notifications
  qui manqueront.
- **Les pièces jointes** (phase 6), ainsi que les réactions et le signalement de
  messages (phases 6 et 7).

## Voir aussi

- `README.md` — les commandes et leur justification.
- `docs/07-github.md` § 5 — les flux de travail, et pourquoi les valeurs sont des
  _variables_ et non des _secrets_.
- `docs/06-couts.md` — la maîtrise des coûts Firebase.
- `docs/08-roadmap.md` — ce qui reste à faire, phase par phase.
