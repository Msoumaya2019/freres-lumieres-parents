# 04 — Stratégie de sécurité

> Phase 1 · Document de référence

## 1. Le principe qui gouverne tout

> **Le client est hostile par conception.**

La configuration Firebase du mobile et de l'admin (clé d'API, identifiant de
projet) est **publique**. Elle doit l'être : elle est embarquée dans
l'application distribuée sur l'App Store. Il n'existe aucun moyen de la
cacher, et ce n'est pas grave — cette clé identifie un projet, elle
n'autorise rien.

Conséquence directe : **toute la sécurité repose sur les Security Rules, les
Cloud Functions et les règles Storage.** Rien d'autre.

Trois règles d'or en découlent :

1. Aucune clé privée, aucun compte de service, aucun secret ne touche le
   dépôt Git ni le bundle client.
2. Aucune décision d'autorisation ne vit dans l'interface.
3. Toute écriture est validée **par la règle**, pas par le formulaire.

---

## 2. Ce qui n'a rien à faire dans le dépôt public

| Interdit                                              | Où cela devrait vivre                                   |
| ----------------------------------------------------- | ------------------------------------------------------- |
| `.env` avec de vraies valeurs                         | variables d'environnement locales, GitHub Secrets en CI |
| Clé privée Firebase Admin (JSON de compte de service) | GitHub Secret `FIREBASE_SERVICE_ACCOUNT_*`              |
| `google-services.json` / `GoogleService-Info.plist`   | EAS (credentials gérés) ou secret de build              |
| Token Expo (`EXPO_TOKEN`)                             | GitHub Secret                                           |
| Clé APNs, certificat `.p12`, `.mobileprovision`       | EAS Credentials                                         |
| Compte de service Google Play                         | GitHub Secret                                           |
| Toute donnée réelle (parents, enfants, signalements)  | nulle part dans Git                                     |

`.gitignore` couvre l'ensemble de ces cas, y compris les variantes de nommage
(`*service-account*.json`, `*firebase-adminsdk*.json`, `*.p12`, `*.jks`…).

**Ce qui est légitime dans le dépôt :** `firebase.json`, `.firebaserc` (les
identifiants de projet ne sont pas des secrets), `firestore.rules`,
`firestore.indexes.json`, `storage.rules`, `eas.json`, `.env.example`.

### En cas de fuite accidentelle

Un secret commité dans un dépôt public doit être considéré comme **compromis
dès la seconde du push**, même s'il est supprimé dans le commit suivant :
l'historique Git est répliqué et indexé en quelques minutes.

Procédure, à documenter dans le README :

1. **Révoquer** le secret (console Firebase, Expo, Apple, Google Play).
2. **En émettre un nouveau**, placé dans GitHub Secrets.
3. Purger l'historique (`git filter-repo`) — utile, mais **après** révocation :
   la purge ne protège de rien si le secret est encore actif.

---

## 3. Structure des Security Rules

### Le socle

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // --- Helpers ---------------------------------------------------------
    function isSignedIn()  { return request.auth != null; }
    function token()       { return request.auth.token; }
    function isActive()    { return isSignedIn() && token().status == 'active'; }
    function role()        { return isActive() ? token().role : null; }
    function orgId()       { return isActive() ? token().orgId : null; }
    function isFcpe()      { return role() in ['fcpe', 'moderator', 'admin']; }
    function isModerator() { return role() in ['moderator', 'admin']; }
    function isAdmin()     { return role() == 'admin'; }
    function isSelf(uid)   { return isSignedIn() && request.auth.uid == uid; }
    function unchanged(field) { return request.resource.data[field] == resource.data[field]; }
  }
}
```

Points importants :

- **`isActive()` est la porte d'entrée.** Un compte `pending`, `suspended` ou
  `rejected` n'obtient aucun rôle, donc aucune permission. L'échec est fermé.
- **Le rôle vient du jeton, jamais d'une lecture.** Aucune lecture facturée,
  aucune latence, aucune possibilité de contourner en modifiant son propre
  document utilisateur.
- **`unchanged()`** verrouille les champs qu'un utilisateur ne doit pas
  pouvoir modifier lui-même (`role`, `status`, `orgIds`, `audienceKeys`).

### Validation des écritures

Chaque `create`/`update` valide **le contenu**, pas seulement l'identité :

```
match /posts/{postId} {
  function validPost() {
    let d = request.resource.data;
    return d.title is string && d.title.size() > 2 && d.title.size() <= 140
        && d.body is string  && d.body.size()  > 0 && d.body.size()  <= 8000
        && d.category in ['information','urgent','cantine', /* … */]
        && d.audienceKeys is list && d.audienceKeys.size() > 0
        && d.audienceKeys.size() <= 3
        && d.status in ['draft','published']
        && d.authorId == request.auth.uid
        && d.orgId == orgId()
        // Les compteurs ne sont pas fixés par le client : ils sont tenus par
        // Cloud Function (voir 06-couts.md).
        && d.stats.commentCount is int
        && d.stats.commentCount >= 0;
  }

  allow read:   if isActive() && resource.data.status == 'published'
                   && resource.data.audienceKeys.hasAny(token().orgIds.map(o => 'org:' + o));
  allow create: if isFcpe() && validPost();
  allow update: if isFcpe() && validPost() && unchanged('orgId') && unchanged('authorId');
  allow delete: if isAdmin();
}
```

Trois propriétés en découlent :

- **La lecture est filtrée par les règles**, pas par la requête du client. Un
  parent ne peut pas lire une publication qui ne le concerne pas, même en
  construisant la requête à la main.
- **Les champs sensibles sont figés** : `authorId`, `orgId`, `stats`.
- **La taille est bornée** dans la règle, ce qui rend impossible l'injection
  d'un document de 2 Mo.

### Le piège de la mise à jour : le document entier, pas le champ modifié

Firestore évalue `allow update` sur `request.resource.data`, c'est-à-dire le
document **après fusion**, et non sur les seuls champs envoyés. Une règle qui se
contente de vérifier l'identité — `resource.data.authorId == request.auth.uid` —
n'exige donc rien sur ce qui est écrit : l'auteur peut réécrire n'importe quel
champ du document. Concrètement `authorId` (usurpation, d'autant que
`authorName` est dénormalisé et affiché), `authorRole` (s'afficher comme membre
de la FCPE ou administrateur), `reportCount` (effacer la trace d'un signalement)
ou les compteurs `reactions`.

Ce défaut a existé sur les commentaires **et** sur les messages. Les deux
suivent désormais le même motif, en deux branches :

- **auteur** : valide les champs qu'il peut changer (`body`, `status`) et fige
  le reste par `unchanged()` ;
- **modérateur** : ne peut que masquer — `status in ['visible', 'hidden']` — tout
  le reste étant figé, `body` compris : modérer n'est pas réécrire les propos
  d'un parent.

Un champ facultatif ne peut pas être figé par `unchanged()` : l'accès à une
propriété absente lève une erreur, et une erreur vaut refus. `replyToId` et
`replyToPreview` échappent donc à ces règles — limitation connue, sans incidence
sur la confidentialité, commentée dans `firestore.rules`.

**Les publications suivent le même motif, avec une variante.** La branche
« auteur » ne peut pas réutiliser `validPost()`, puisque celui-ci exige
`authorId == request.auth.uid` — or la modération agit par définition sur la
publication d'un autre. Elle a donc sa propre validation, `validModerationEdit()`,
qui ne revalide pas le contenu mais le **fige** : figer est plus fort que
revalider, puisque la valeur figée a déjà été validée à la création. Un
modérateur ne peut donc toucher qu'à `pinned`, `pinnedUntil` et `status`.

Deux règles en découlent, qui n'existaient que dans l'interface :

- **`pinned` est vérifié à la création.** `post.pin` est réservé à
  `moderator` / `admin` dans la matrice de permissions, mais rien ne l'appliquait
  : il suffisait de passer `pinned: true` pour épingler. Un auteur ne peut pas
  non plus épingler sa propre publication à la mise à jour.
- **`authorRole` est comparé au Custom Claim** (`authorRole == role()`) à la
  création. Le fil affiche un badge à partir de ce champ : le laisser libre
  permettait à un membre de la FCPE de se présenter comme administrateur.

### Pourquoi la lecture est scindée en `get` et `list`

Une règle de **requête** doit être démontrable à partir des contraintes de la
requête. `status == 'published'` l'est ; une disjonction avec `isModerator()` ne
l'est pas, car Firestore ne peut pas la prouver à partir d'un `where`.

`posts/{postId}` déclare donc les deux séparément :

- `allow get` : publié, **ou** j'en suis l'auteur, **ou** je modère. C'est ce qui
  permet à un auteur de rouvrir son brouillon — sans quoi un brouillon serait
  écrit puis définitivement invisible, y compris pour celui qui vient de
  l'écrire — et à un modérateur de revenir sur un masquage.
- `allow list` : `orgId` et `status == 'published'`, rien de plus.

Élargir `get` ne découvre rien : les trois cas sont « c'est publié », « c'est
moi », « je modère ». La contrepartie est assumée et visible dans le produit :
**aucune liste ne peut remonter un brouillon**, d'où un éditeur qui n'en propose
pas.

### Les règles les plus critiques

| Collection                            | Règle clé                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users/{uid}`                         | lecture de soi, ou `user.read.any` ; `role`/`status`/`audienceKeys` non modifiables par l'utilisateur                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `users/{uid}/tokens`                  | **aucune lecture client**, écriture de soi uniquement                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `deviceTokens/{token}`                | lecture réservée aux Cloud Functions ; écriture de soi si `uid` **et** `orgId` correspondent ; `audienceKeys` et `disabledCategories` vides à la création puis figés — le serveur seul les écrit ; un changement de porteur n'est permis qu'en les remettant à vide, sinon le nouveau porteur hériterait des notifications de l'ancien ; le transfert reste **interne à l'organisation** — `orgId` ne peut pas être réécrit, sans quoi un parent pourrait franchir la frontière en reprenant le jeton d'un autre groupe |
| `posts/{id}/comments`                 | lecture si le post parent est lisible et `status == 'visible'` ; création si `isActive()` **et** que la publication parente est publiée et ouverte aux commentaires (`get()`) ; mise à jour : identité et compteurs figés par `unchanged()`                                                                                                                                                                                                                                                                             |
| `posts/{id}`                          | `get` : publié, auteur, ou `isModerator()` ; `list` : `status == 'published'` seulement. Création : `pinned` refusé hors modération, `authorRole` comparé au claim. Mise à jour en deux branches, `pinned`/`stats`/identité figés pour l'auteur, tout le contenu figé pour la modération                                                                                                                                                                                                                                |
| `channels/{id}/messages`              | même régime que les commentaires : l'auteur modifie son corps, `isModerator()` masque, `authorId`/`authorRole`/`reportCount` figés                                                                                                                                                                                                                                                                                                                                                                                      |
| `polls/{id}/votes/{uid}`              | **écriture uniquement si `uid == request.auth.uid`** → double vote impossible                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `reports/{id}`                        | lecture si `authorId == uid`, **ou** `isFcpe()` **et** `orgId` de l'organisation                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `reports/{id}/replies`                | lecture : `internal == false` pour l'auteur, tout pour la FCPE                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `schoolCouncils/{id}/items`           | lecture des `visibility == 'fcpe'` réservée à `isFcpe()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `moderationReports`                   | lecture et écriture : `isModerator()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `fcpeTasks/{id}`                      | frontière dure : lecture `isFcpe()` **et** `orgId` de l'organisation ; écriture si `request.resource.data.orgId == orgId()`                                                                                                                                                                                                                                                                                                                                                                                             |
| `adminLogs`                           | **création réservée au serveur**, aucune modification ni suppression, lecture `isAdmin()`                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `counters`, `highlights`              | écriture réservée au serveur, lecture `isActive()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `organizations`, `schools`, `classes` | lecture `isSignedIn()` (nécessaire au formulaire d'inscription), écriture `isAdmin()`                                                                                                                                                                                                                                                                                                                                                                                                                                   |

---

## 4. Storage Rules

Trois principes : format restreint, taille bornée, chemin non devinable.

```
match /orgs/{orgId}/posts/{postId}/{fileName} {
  allow read:  if isActive();
  allow write: if isFcpe()
               && request.resource.size < 2 * 1024 * 1024
               && request.resource.contentType in ['image/jpeg','image/png','image/webp'];
}

match /orgs/{orgId}/documents/{docId}/{fileName} {
  allow read:  if isActive();
  allow write: if isFcpe()
               && request.resource.size < 10 * 1024 * 1024
               && request.resource.contentType == 'application/pdf';
}

match /orgs/{orgId}/reports/{reportId}/{fileName} {
  allow read:  if isFcpe() || isAuthorOf(reportId);
  allow write: if isActive()
               && request.resource.size < 2 * 1024 * 1024
               && request.resource.contentType in ['image/jpeg','image/png','image/webp'];
}
```

**Formats autorisés en V1 : JPG, PNG, WEBP, PDF. Aucune vidéo.**

La compression est faite **côté client avant l'upload**
(`expo-image-manipulator`) : redimensionnement à 1600 px de côté maximum,
qualité 0,8. La règle Storage borne la taille, mais elle ne peut pas
compresser : sans compression côté client, une photo de 8 Mo serait rejetée
et l'utilisateur ne comprendrait pas pourquoi.

Les chemins contiennent l'identifiant de l'organisation et le propriétaire,
ce qui rend les règles simples et empêche de deviner l'emplacement d'un
fichier d'une autre organisation.

### L'URL de téléchargement n'est jamais stockée

`Attachment.storagePath` porte le **chemin** du fichier, jamais son URL. Une URL
de téléchargement Firebase contient un jeton qui rend le fichier lisible par
quiconque la possède, **sans repasser par les règles Storage**. L'écrire dans
Firestore reviendrait à publier la pièce jointe à tous ceux qui peuvent lire le
document — y compris ceux que le ciblage par audience exclut du fil. Le chemin
seul est durable ; l'URL est redemandée à l'affichage, et les règles Storage
s'appliquent à ce moment-là (`packages/firebase/src/storage.ts`).

---

## 5. App Check

**Recommandé, activé en production, désactivé sur les émulateurs.**

App Check vérifie que les requêtes proviennent bien de l'application
authentique (Play Integrity sur Android, App Attest sur iOS, reCAPTCHA v3 sur
le web). Il bloque les scripts qui utiliseraient la configuration publique
pour interroger Firestore.

- Phase 2 : activation en mode **surveillance** (les requêtes sont comptées
  mais pas bloquées) pour détecter les faux positifs.
- Phase 12 : passage en mode **application**.
- Les émulateurs locaux doivent être exemptés, sinon le développement devient
  impossible.

App Check **ne remplace pas** les Security Rules : il empêche un usage
détourné du SDK officiel, il n'autorise rien.

---

## 6. Anti-spam et limitation de débit

Firestore ne sait pas compter les écritures par utilisateur. Le rate limiting
est donc assuré par des Cloud Functions déclenchées à l'écriture :

```
users/{uid}/private/rateLimits   (document interne, non lisible par le client)
  ├── posts:          { windowStart, count }   max   5 / heure
  ├── comments:       { windowStart, count }   max  30 / heure
  ├── messages:       { windowStart, count }   max  10 / minute
  ├── reports:        { windowStart, count }   max   5 / jour
  └── moderationReports: { windowStart, count } max 20 / jour
```

Si la limite est dépassée, la Function **supprime le document** et écrit une
entrée dans `moderationReports`. Le contrevenant voit son message disparaître ;
un modérateur est informé. C'est simple, et suffisant pour un groupe scolaire.

Trois mesures complémentaires :

- **Compte `pending`** : ne peut rien écrire, ce qui élimine déjà la majorité
  des créations de comptes malveillantes.
- **Délai d'édition** de 30 minutes : au-delà, on ne peut plus modifier son
  message (mais on peut le signaler).
- **Vérification de contenu** : détection des liens en masse et des
  répétitions, qui déclenche un signalement automatique plutôt qu'un blocage
  (un faux positif qui bloque un parent est plus grave qu'un spam visible).

---

## 7. Protection des Cloud Functions

| Mesure                | Détail                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Type de fonction      | `onCall` pour les actions utilisateur, `onDocumentWritten` pour les déclencheurs. Jamais de fonction HTTP publique. |
| Vérification du jeton | `request.auth` contrôlé systématiquement, plus relecture de `users/{uid}.status` en base                            |
| Validation            | **le même schéma Zod** que le client, rejoué côté serveur                                                           |
| Rôle                  | vérifié via `hasPermission()` importé de `@fl/shared`, puis relu en base pour les actions critiques                 |
| Journalisation        | toute action sensible écrit dans `adminLogs` avec acteur, cible, avant/après                                        |
| Moindre privilège     | le compte de service des Functions n'a que les rôles nécessaires                                                    |

Point clé : **les Cloud Functions rejouent les mêmes schémas Zod que le
client.** Ce n'est pas de la duplication, c'est le point de contrôle réel. Un
appel direct à une Function avec un `title` de 50 000 caractères doit être
rejeté.

---

## 8. RGPD et minimisation

### Données collectées

| Donnée                          | Finalité                                            | Base légale          | Conservation                    |
| ------------------------------- | --------------------------------------------------- | -------------------- | ------------------------------- |
| Prénom, nom du parent           | identifier l'utilisateur, personnaliser l'affichage | exécution du service | jusqu'à suppression du compte   |
| E-mail                          | authentification, notifications                     | exécution du service | jusqu'à suppression du compte   |
| Téléphone (facultatif)          | contact d'urgence par la FCPE                       | consentement         | jusqu'à retrait du consentement |
| Niveau et classe de l'enfant    | cibler les informations utiles                      | intérêt légitime     | année scolaire + 1 an           |
| Prénom de l'enfant (facultatif) | affichage dans l'espace du parent                   | consentement         | jusqu'à suppression             |
| Jeton d'appareil                | notifications                                       | consentement         | 180 jours d'inactivité          |

### Ce qui n'est **jamais** collecté

- nom complet de l'enfant, date de naissance, identifiant d'élève ;
- adresse postale, situation familiale, profession ;
- données de santé, de religion, d'origine ;
- géolocalisation ;
- identifiants publicitaires.

### Droits garantis, et comment

| Droit         | Mise en œuvre                                                                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accès         | écran « Mes données » dans le profil : tout est affiché                                                                                                                                                                                           |
| Rectification | édition du profil                                                                                                                                                                                                                                 |
| Effacement    | bouton « Supprimer mon compte » → Cloud Function qui supprime le compte Auth, le profil, les enfants, les jetons, et **anonymise** les contributions (les messages deviennent « Ancien parent », l'auteur est remplacé par un identifiant opaque) |
| Portabilité   | export JSON généré par Cloud Function et téléchargé depuis l'application                                                                                                                                                                          |
| Opposition    | désactivation par catégorie de notification                                                                                                                                                                                                       |

### Anonymisation plutôt que suppression

Supprimer les messages d'un parent casserait la cohérence des discussions pour
les autres. On remplace donc :

```
authorName: 'Marie D.'  →  'Ancien parent'
authorId:   'uid-abc'   →  'deleted-user'
```

La ligne reste, la personne disparaît. C'est la pratique standard et cela
satisfait l'article 17 tout en préservant l'intégrité des échanges.

### Points d'attention

- **Aucune liste d'enfants n'est accessible publiquement**, ni par requête
  (la sous-collection `children` n'est lisible que par le parent et par
  l'administration), ni par les règles.
- **Aucun tracking publicitaire**, aucun SDK tiers de mesure. Analytics
  Firebase est utilisé en mode désactivé par défaut, activé après
  consentement, et **jamais** lié à un identifiant publicitaire.
- **Aucune donnée de production dans Git**, y compris pour les démonstrations :
  les jeux de test utilisent des noms manifestement fictifs.
- Une **politique de confidentialité** doit être rédigée avant la publication
  sur les stores. Elle devra refléter exactement ce tableau — pas un texte
  générique.

---

## 9. Récapitulatif des mesures par couche

| Couche           | Mesure                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| Dépôt            | `.gitignore` strict, `.env.example` sans valeur, aucun secret, Dependabot, CodeQL, secret scanning GitHub |
| Réseau           | HTTPS obligatoire, App Check en production                                                                |
| Authentification | e-mail vérifié, mot de passe ≥ 10 caractères, réinitialisation par e-mail                                 |
| Autorisation     | Custom Claims + Security Rules, échec fermé                                                               |
| Données          | validation Zod côté serveur, champs sensibles figés, tailles bornées                                      |
| Fichiers         | formats et tailles bornés, compression côté client, chemins cloisonnés par organisation                   |
| Serveur          | Cloud Functions revalidant tout, journal d'audit immuable                                                 |
| Anti-abus        | rate limiting, compte `pending`, délai d'édition                                                          |
| Vie privée       | minimisation, anonymisation, export, suppression                                                          |

---

## 10. Ce qui reste à décider

- **Vérification de l'e-mail à l'inscription.** Proposition : la validation
  par un administrateur suffit en V1 ; exiger en plus la vérification de
  l'e-mail ajouterait un frottement pour un gain limité. À réévaluer si des
  inscriptions frauduleuses apparaissent.
- **Purge automatique des signalements clos.** Proposition : 730 jours, avec
  un avertissement dans le README.
- **Domaine des liens universels.** Nécessaire pour que les notifications
  ouvrent l'application, à définir en Phase 5.
- **Audience `fcpe` — tranché : la promesse est retirée.** L'écran de
  publication annonçait qu'une information ciblée « Membres FCPE uniquement »
  « ne sera visible que par les membres de la FCPE », et les règles ne
  l'appliquaient pas : `allow get` sur `posts/{id}` ne regarde ni `audience` ni
  `audienceKeys`. Un parent qui connaît l'identifiant la lisait.
  **Décision : le libellé dit ce que le mécanisme fait réellement.** Le type
  d'audience s'appelle désormais « Membres FCPE » — sans « uniquement » — et la
  légende de l'écran de composition précise que ce sont les membres qui seront
  **notifiés**, la publication restant lisible par tout parent qui en connaît le
  lien. L'écart entre l'interface et les règles a disparu par le haut, pas par le
  bas : c'est l'interface qui était en avance sur les règles, et c'est elle qui a
  été corrigée.
  L'option « tenir la promesse » a été écartée parce qu'elle n'est pas une
  retouche de règle : il faudrait que la règle lise les clés du lecteur, donc un
  `get()` sur son profil, que Firestore ne sait pas démontrer à partir des
  contraintes d'une requête. Le fil devrait passer par une Cloud Function, ou les
  publications être réparties par audience — un changement de modèle de données.
  Le besoin d'un espace réellement interne a déjà son mécanisme, `visibility:
'fcpe'` (Phase 10), que les règles **vérifient**, elles.
  Le test `packages/testing` « limite assumée : un parent lit une publication
  réservée à la FCPE » reste, mais il ne décrit plus une question ouverte : c'est
  la trace de la limite. C'est lui qu'il faudra inverser quand la phase 10
  arrivera, et non supprimer.
- **Journal d'audit et frontière d'organisation.** `AdminLog` ne porte aucun
  `orgId`, et la règle se contente de `allow read: if isAdmin()` : un
  administrateur d'un groupe scolaire lirait donc le journal d'un autre. Sans
  conséquence tant qu'une seule organisation existe, mais la frontière
  d'organisation — la plus dure du reste du modèle — ne s'applique pas ici,
  alors qu'elle repose partout ailleurs sur la comparaison du champ `orgId` de
  la ressource avec l'organisation du lecteur. La corriger demande d'ajouter
  `orgId` au modèle, de l'écrire dans `writeAuditLog` et de le vérifier dans la
  règle, donc de traiter les entrées déjà écrites. Le champ n'existe aujourd'hui
  nulle part : ni dans le type, ni dans l'écrivain — seule la fixture de
  `firestore.rules.test.ts` en porte un, trace d'une intention jamais suivie.
  À trancher au moment où une seconde organisation devient possible, pas avant.
- **Rattachement des enfants : la branche de modération n'est pas cloisonnée.**
  `users/{uid}/children/{childId}` autorise `read` à `isActive() && isModerator()`
  sans comparer l'organisation, alors que le document ne porte **aucun `orgId`** —
  même situation que le journal d'audit, et donc même arbitrage. L'administration
  peut donc lire le rattachement d'un enfant d'une autre organisation, à
  condition de connaître l'identifiant du parent.
  Deux issues. **Ajouter `orgId` au rattachement** est cohérent avec le reste du
  modèle, et l'écriture est déjà faite par le parent à l'inscription — il faudrait
  donc aussi l'y valider, ou la déplacer côté serveur. **Passer par un `get()`
  sur le profil du parent** ferme la lecture unitaire sans toucher au modèle,
  mais rend toute lecture en liste impossible — Firestore ne sait pas démontrer
  un `get()` pour une requête — et coûte une lecture facturée par accès. À
  trancher au moment où un écran d'administration lira ce rattachement ; la
  fiche d'un compte, livrée en Phase 4, s'en passe délibérément et s'appuie sur
  les niveaux et classes recopiés sur le profil.
  **Le cas n'est pas isolé**, et c'est ce qui justifie de tout traiter d'un
  bloc. Trois autres sous-collections se contentent d'`isActive()` sans
  comparer l'organisation, alors que leurs documents ne portent pas davantage
  d'`orgId` : `collectiveIssues/{id}/supporters/{uid}`,
  `events/{id}/participants/{uid}` et `reports/{id}/replies/{id}`. Or la règle
  du parent ne protège pas l'enfant : Firestore évalue les règles d'une
  sous-collection **indépendamment** de celle de son parent, donc connaître
  l'identifiant du parent suffit à lire ce qu'il contient. La sortie est la
  même que ci-dessus — ajouter `orgId` aux documents, donc un changement de
  modèle — et elle vaut pour les quatre à la fois.
- **Compteurs et résumés : lecture entre organisations.** `counters/{counterId}`
  et `highlights/{highlightId}` se contentent d'`isActive()`. L'identifiant du
  document **est** l'identifiant d'organisation, donc la contrainte s'écrirait
  `counterId == orgId()` — une ligne par collection. Ce ne sont que des
  agrégats (nombre de comptes, de publications), sans donnée personnelle, d'où
  le classement après les deux points précédents. À corriger en même temps
  qu'eux, pas séparément.
- **Recherche d'un compte — et journalisation des consultations.** Firestore
  n'offre ni recherche insensible à la casse, ni recherche par sous-chaîne.
  Quatre issues, du moins coûteux au plus juste.

  Ce point en rejoint un second, qui n'a rien à voir avec Firestore.
  `docs/03-roles-permissions.md` affirmait que « chaque consultation est
  journalisée » : c'était faux, et le document est corrigé. Une consultation
  n'écrit rien, et ne **peut** rien écrire depuis le client — les règles
  réservent l'écriture de `adminLogs` au serveur, administrateur compris.
  Rendre la phrase vraie demande une Cloud Function appelée à chaque
  consultation, c'est-à-dire exactement la mécanique de la quatrième issue
  ci-dessous. Les deux décisions n'en font qu'une.
  **Chercher sur l'adresse exacte** ne demande presque rien : `email` existe et
  s'indexe déjà avec `orgId`. Mais un administrateur au téléphone avec un
  parent entend un nom, pas une adresse.
  **Chercher par préfixe sur `lastName` et `firstName`** couvre le besoin sans
  toucher au modèle : deux index composites suffisent. Le défaut apparaît au
  premier essai — la comparaison est sensible à la casse, donc « durand » ne
  trouve pas « Durand », et capitaliser l'entrée à la main casse sur les
  particules et les noms composés.
  **Ajouter un champ normalisé** — `searchName`, en minuscules, recopiant nom,
  prénom et adresse — rend la recherche correcte. Il faudrait l'écrire à
  l'inscription, donc le valider dans les règles ou le calculer côté serveur,
  et le recalculer quand un parent corrige son nom. Aucune donnée de
  production n'existe encore : c'est le moment le moins coûteux pour ce choix,
  et il ne le restera pas.
  **Chercher depuis une Cloud Function** est la quatrième issue, identifiée
  après coup et la plus complète. La fonction lit les comptes de
  l'organisation de l'appelant et normalise en mémoire : à l'échelle d'une
  FCPE — quelques centaines de familles — cela représente quelques centaines de
  lectures par recherche, un coût négligeable. Elle ne demande ni champ
  nouveau, ni règle nouvelle, ni index ; elle est insensible à la casse et aux
  accents, elle sait chercher par sous-chaîne et jusque dans l'adresse ; et
  elle est la **seule** à pouvoir journaliser la consultation.
  **Décision (16 septembre 2026) : reporter.** La file par statut suffit tant
  que l'organisation compte peu de comptes, et aucune donnée de production
  n'existe — le coût du report est donc nul aujourd'hui. Deux points à ne pas
  perdre au moment de rouvrir : la recherche et la journalisation des
  consultations se traiteront **ensemble** (les séparer ferait écrire deux fois
  la même mécanique, ou laisserait la promesse fausse), et la quatrième issue
  est celle qui les satisfait toutes les deux.
