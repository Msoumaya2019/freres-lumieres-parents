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

| Collection                            | Règle clé                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users/{uid}`                         | lecture de soi, ou `user.read.any` ; `role`/`status`/`audienceKeys` non modifiables par l'utilisateur                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `users/{uid}/tokens`                  | **aucune lecture client**, écriture de soi uniquement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `deviceTokens/{token}`                | lecture réservée aux Cloud Functions ; écriture de soi si `uid` **et** `orgId` correspondent ; `audienceKeys` et `disabledCategories` vides à la création puis figés — le serveur seul les écrit ; un changement de porteur n'est permis qu'en les remettant à vide, sinon le nouveau porteur hériterait des notifications de l'ancien ; le transfert reste **interne à l'organisation** — `orgId` ne peut pas être réécrit, sans quoi un parent pourrait franchir la frontière en reprenant le jeton d'un autre groupe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pushTickets/{id}`                    | **aucun accès client, dans les deux sens.** Le document associe un identifiant de ticket à un jeton d'appareil, le temps que les reçus Expo soient lisibles. C'est la raison pour laquelle ces jetons ne sont pas rangés dans `notifications`, que la FCPE lit : la porte de service aurait remplacé la porte d'entrée                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `posts/{id}/comments`                 | lecture si le post parent est lisible et `status == 'visible'` ; création si `isActive()` **et** que la publication parente est publiée et ouverte aux commentaires (`get()`) ; mise à jour : identité et compteurs figés par `unchanged()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `posts/{id}`                          | `get` : publié, auteur, ou `isModerator()` ; `list` : `status == 'published'` seulement. Création : `pinned` refusé hors modération, `authorRole` comparé au claim. Mise à jour en deux branches, `pinned`/`stats`/identité figés pour l'auteur, tout le contenu figé pour la modération                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `channels/{id}/messages`              | même régime que les commentaires : l'auteur modifie son corps, `isModerator()` masque, `authorId`/`authorRole`/`reportCount` figés                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `polls/{id}`                          | lecture en **deux branches**, et elles ne disent pas la même chose : la FCPE lit les sondages de son organisation **quel que soit leur statut** — brouillon compris, sans quoi elle ne pourrait pas ouvrir ce qu'elle vient d'enregistrer —, et un parent ne lit que `open` et `closed`, avec `isActive()` et `orgId`. Ce n'est pas qu'une clause de lecture : c'est aussi ce qui rend une **requête** possible, puisque les règles ne filtrent pas — l'administration liste donc en ne contraignant que `orgId`, là où un écran de parent devra contraindre le statut. Création et mise à jour `isFcpe()`, `orgId` figé à la mise à jour. Les deux clauses sont **séparées**, et ce n'est pas du style : `unchanged()` lit `resource.data`, qui n'existe pas sur une création — fusionnées, elles refusaient toute création de sondage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `polls/{id}/votes/{uid}`              | **écriture uniquement si `uid == request.auth.uid`** → double vote impossible. Le reste se lit **dans le sondage**, par un `get()` de règle : le sondage doit être `open` et appartenir à l'organisation du votant — la lecture était cloisonnée, l'écriture ne l'était pas ; `allowMultiple` décide si plusieurs réponses sont permises et `allowChangeVote` si la mise à jour l'est ; un sondage `anonymous` refuse tout champ `uid`, un sondage nominatif l'exige ; les doublons de réponse sont refusés (`toSet()`). Un `exists()` précède le `get()` : sans lui, un sondage inexistant ferait échouer l'évaluation au lieu de rendre `false` — un refus dans les deux cas, mais par accident. Les trois champs que les règles lisent dans le sondage (`allowMultiple`, `anonymous`, `allowChangeVote`) passent par des accesseurs à **repli fermé** : un champ absent vaut `false`, et non une erreur d'évaluation — sinon un sondage écrit sans eux serait invotable sans que rien ne le dise                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `pollResults/{id}`                    | lecture : `orgId` de l'organisation **et** (`isFcpe()`, ou `isActive()` **et** la visibilité du sondage, lue par un `get()` de règle). Échelle **emboîtée** — `always` ⊃ `after_vote` ⊃ `after_end` : `always` publie dès la mise en ligne ; `after_vote` à partir du vote de l'appelant (`exists()` sur son propre vote), **et** pour tous une fois le sondage clos ; `after_end` à la clôture seulement. Un brouillon ne publie rien, même en `always`, et la FCPE lit toujours. Le repli, quand `resultsVisibility` est absent, est **fermé** (`after_end`) — plus restrictif que le défaut du schéma, parce qu'une permission ne s'ouvre pas par omission. Un document **inexistant** est lisible et se lit comme absent : le client ne l'écrit jamais, il n'apparaît qu'au premier vote, et sans cette branche `resource.data` serait lu sur un document qui n'existe pas — ce qui **lève**, et rendrait l'absence indistinguable d'un refus. **Écriture refusée à tout le monde**, FCPE comprise : la Cloud Function est le seul écrivain, ce qui rend le décompte infalsifiable. Ce document existe parce qu'une règle de lecture ne filtre pas des champs : les totaux vivaient sur `polls/{id}`, que tout parent lit — ils étaient donc publics en permanence. La garde du vote est **conditionnée** par `after_vote` — `(visibilite() == 'after_vote' && aVote())` — et c'est ce qui fait tenir l'emboîtement : écrite en ` |     | aVote()`, elle ouvrait aussi `after_end`à qui avait voté, si bien que les deux dernières valeurs ne se distinguaient plus que pour un non-votant, et que le réglage « À la clôture seulement » ne voulait plus rien dire. Le défaut était **invisible** : la fixture`after_end`n'avait aucun vote, donc elle mesurait le refus d'un non-votant, que la clause n'affectait pas. Côté client, la même décision est portée par`canReadPollResults` (`@fl/shared`), et un test lit ce fichier pour tenir l'accord entre les deux sources |
| `reports/{id}`                        | lecture si `authorId == uid`, **ou** `isFcpe()` **et** `orgId` de l'organisation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `reports/{id}/replies`                | lecture : `internal == false` pour l'auteur, tout pour la FCPE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `schoolCouncils/{id}/items`           | lecture des `visibility == 'fcpe'` réservée à `isFcpe()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `moderationReports`                   | lecture et écriture : `isModerator()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `fcpeTasks/{id}`                      | frontière dure : lecture `isFcpe()` **et** `orgId` de l'organisation ; écriture si `request.resource.data.orgId == orgId()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `adminLogs`                           | **création réservée au serveur**, aucune modification ni suppression, lecture `isAdmin()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `counters`, `highlights`              | écriture réservée au serveur, lecture `isActive()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `organizations`, `schools`, `classes` | lecture `isSignedIn()` (nécessaire au formulaire d'inscription), écriture `isAdmin()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

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

> **Cette section décrit ce qui n'est pas encore écrit.** Le rate limiting, le
> délai d'édition et la vérification de contenu sont **conçus mais absents** :
> `RATE_LIMITS` et `EDIT_WINDOW_MINUTES` sont déclarés dans `@fl/shared` sans
> aucun consommateur, `paths.userRateLimits()` n'est appelé par personne, le mot
> `request.time` n'apparaît **nulle part** dans `firebase/firestore.rules`, et
> aucune Cloud Function ne supprime un contenu au titre d'une limite de débit.
> Le manque est porté par la phase 12 de `docs/08-roadmap.md`.
>
> Ce paragraphe d'avertissement existe parce que la version précédente
> décrivait ces mesures au présent, comme si elles protégeaient le service.
> Un document de sécurité qui promet une protection inexistante est plus
> dangereux qu'un document muet : il décourage de vérifier.

**Ce qui protège réellement le service aujourd'hui**, et suffit à un groupe
scolaire au lancement :

- **Le statut `pending`.** `isActive()` exige `claims().status == 'active'`, et
  toutes les règles de création de contenu le traversent. Un compte non validé
  ne peut donc **rien** écrire — ce qui élimine la majorité des créations de
  comptes malveillantes, sans qu'aucun compteur n'ait à intervenir.
- **Les règles Firestore** : cloisonnement par organisation, propriété des
  champs serveur, refus par défaut.
- **La modération manuelle**, qui traite le reste.

**Ce qui est conçu, et le restera jusqu'à la phase 12** — à lire comme un plan,
jamais comme une description :

Firestore ne sait pas compter les écritures par utilisateur. Le rate limiting
sera donc assuré par des Cloud Functions déclenchées à l'écriture :

```
users/{uid}/private/rateLimits   (document interne, non lisible par le client)
  ├── posts:          { windowStart, count }   max   5 / heure
  ├── comments:       { windowStart, count }   max  30 / heure
  ├── messages:       { windowStart, count }   max  10 / minute
  ├── reports:        { windowStart, count }   max   5 / jour
  └── moderationReports: { windowStart, count } max 20 / jour
```

Si la limite est dépassée, la Function **supprimera le document** et écrira une
entrée dans `moderationReports`. Le contrevenant verra son message disparaître ;
un modérateur sera informé. C'est simple, et suffisant pour un groupe scolaire.

Trois mesures complémentaires, dans le même état :

- **Compte `pending`** — _appliqué_, voir ci-dessus.
- **Délai d'édition de 30 minutes** — _non appliqué_. Au-delà du délai, on ne
  pourra plus modifier son message (mais on pourra le signaler). La constante
  `EDIT_WINDOW_MINUTES` existe, aucune règle ne la lit : une fenêtre d'édition
  s'écrit avec `request.time`, qui n'est employé nulle part.
- **Vérification de contenu** — _non appliquée_. La détection des liens en masse
  et des répétitions déclenchera un signalement automatique plutôt qu'un
  blocage : un faux positif qui bloque un parent est plus grave qu'un spam
  visible.

---

## 7. Protection des Cloud Functions

| Mesure                | Détail                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Type de fonction      | `onCall` pour les actions utilisateur, `onDocumentWritten` pour les déclencheurs. Jamais de fonction HTTP publique. |
| Vérification du jeton | `request.auth` contrôlé systématiquement, plus relecture de `users/{uid}.status` en base                            |
| Validation            | **le même schéma Zod** que le client, rejoué côté serveur                                                           |
| Rôle                  | vérifié via `hasPermission()` importé de `@fl/shared`, puis relu en base pour les actions critiques                 |
| Journalisation        | **seules les actions auditées** (`AUDITED_ACTIONS`) écrivent dans `adminLogs`, avec acteur, cible, avant/après      |
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

| Droit         | Mise en œuvre                                                                                                 | État                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Accès         | écran « Mes données » dans le profil : tout est affiché                                                       | **non appliqué** — l'écran porte lui-même la mention « Phase 2 »                                     |
| Rectification | édition du profil                                                                                             | **appliqué**                                                                                         |
| Effacement    | Cloud Function qui supprime le compte Auth, le profil, les enfants, les jetons, et anonymise les publications | **partiel** — voir ci-dessous                                                                        |
| Portabilité   | export JSON généré par Cloud Function et téléchargé depuis l'application                                      | **non appliqué** — `user.export` et `user.export_data` sont déclarés, aucune fonction ne les produit |
| Opposition    | désactivation par catégorie de notification                                                                   | **partiel** — le filtre est appliqué à l'envoi, l'écran de préférences n'existe pas encore (phase 5) |

**Le droit d'effacement est le seul exercé aujourd'hui, et il l'est
partiellement.** `adminDeleteUser` supprime le compte Auth, puis
`cleanupDeletedUser` efface les jetons et anonymise les publications de
l'intéressé. Une limite subsiste, écrite ici parce qu'elle est silencieuse :

- les **commentaires et les messages** ne sont pas anonymisés — le bloc de
  documentation de la fonction les annonçait, le code ne les traite pas. Les
  atteindre demande une requête de groupe de collections, donc un index de
  groupe à déclarer ; le manque est porté par `docs/08-roadmap.md`.

Une seconde limite a été **corrigée**, et elle mérite d'être notée parce qu'elle
était invisible de l'extérieur : l'anonymisation s'arrêtait au premier lot de
500, sans le dire. Un parent qui avait publié davantage gardait son nom sur le
reste, et rien ne le signalait. Plus grave, cette anonymisation partageait sa
transaction avec la suppression des jetons : passé 500 écritures, Firestore
refusait le lot **entier** et rien n'était écrit — pas même la suppression des
jetons, qui n'a pourtant rien à voir avec les publications. La requête est
désormais relancée tant qu'elle rend quelque chose ; chaque passage remplaçant
`authorId`, l'ensemble rétrécit à chaque tour, et la terminaison ne dépend
d'aucune borne arbitraire.

Le bouton « Supprimer mon compte » n'existe pas dans l'application : la
suppression se fait donc **sur demande à la FCPE**, ce qui satisfait
l'article 17 mais pas la promesse d'un droit exerçable seul. Le manque est
porté par `docs/08-roadmap.md`.

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

La colonne « État » n'est pas décorative : ce document est la référence, et une
ligne qui n'est pas marquée **appliqué** ne décrit rien de ce qui protège le
service aujourd'hui.

| Couche           | Mesure                                                                                                    | État                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Dépôt            | `.gitignore` strict, `.env.example` sans valeur, aucun secret, Dependabot, CodeQL, secret scanning GitHub | appliqué                                                                     |
| Dépendances      | avis npm mesurés en CI, seuil haut, et tri par artefact réellement livré                                  | partiel — un avis modéré joignable dans le paquet mobile, garde posée (§ 11) |
| Réseau           | HTTPS obligatoire, App Check en production                                                                | partiel — App Check n'est pas activé (phase 12, § 5)                         |
| Authentification | e-mail vérifié, mot de passe ≥ 10 caractères, réinitialisation par e-mail                                 | partiel — la vérification de l'e-mail est à trancher (§ 10)                  |
| Autorisation     | Custom Claims + Security Rules, échec fermé                                                               | appliqué                                                                     |
| Données          | validation Zod côté serveur, champs sensibles figés, tailles bornées                                      | appliqué                                                                     |
| Fichiers         | formats et tailles bornés, compression côté client, chemins cloisonnés par organisation                   | appliqué                                                                     |
| Serveur          | Cloud Functions revalidant tout, journal d'audit immuable                                                 | appliqué                                                                     |
| Anti-abus        | rate limiting, compte `pending`, délai d'édition                                                          | partiel — seul `pending` est appliqué (§ 6)                                  |
| Vie privée       | minimisation, anonymisation, export, suppression                                                          | partiel — export et suppression autonome absents (§ 8)                       |

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

---

## 11. Les dépendances livrées

Le paquet mobile et l'administration embarquent du code écrit par d'autres. Ce
qui y est joignable est une surface d'attaque, au même titre qu'une règle.

### Une alerte GitHub ne dit pas ce qui est joignable

Les alertes de sécurité GitHub portent sur les fichiers de verrou **présents
dans le dépôt**. Elles portent sur `pnpm-lock.yaml` — le verrou de l'**autre
implémentation**, sur `main`, qui n'est pas celle-ci. Cette branche est en
npm-workspaces et ne porte que `package-lock.json` : ces alertes concernent
donc `main`, et non le code livré ici.

C'est une mesure, pas une propriété : une alerte se relit. Mais la leçon est
générale — **une alerte dit ce qui est déclaré dans un fichier, pas ce qui est
joignable dans un binaire.** Les deux questions sont différentes, et seule la
seconde décide.

### Ce qui est joignable, trié par artefact livré

`npm audit` sur cette branche rend **22 avis modérés**, dont 15 comptés « en
production » — un comptage qui ne distingue pas un outil de construction d'une
bibliothèque embarquée. Le tri se fait donc en remontant l'arbre
(`npm ls --json --all`) jusqu'à ce qui part sur un appareil :

| Avis                                                                                     | Chemin                                          | Livré ?                           |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------- |
| `decode-uri-component@0.2.2`                                                             | `@fl/mobile` → `expo-router` → `query-string@7` | **oui — paquet mobile**           |
| `gaxios`, `uuid`                                                                         | runtime des Cloud Functions                     | oui, mais avis non joignable      |
| `firebase-tools`, `vitest`, `esbuild`, `@expo/cli`, `xcode`, `csv-parse`, `stream-json`… | outillage de construction et de CI              | non — ne quitte jamais la machine |

`gaxios` et `uuid` sont joignables comme paquets, mais l'avis ne l'est pas :
`GHSA-w5hq-g745-h8pq` décrit un débordement de tampon en v3/v5/v6 **quand `buf`
est fourni**, et les seuls appels sont des `v4()` sans tampon —
`gaxios.js:417` et `pbxProject.js:90`. Un avis sur un paquet n'est pas un avis
sur un chemin d'exécution.

### L'avis joignable : un lien profond qui fige l'application

`decode-uri-component@0.2.2` a un repli dont le coût grimpe avec le nombre de
séquences `%XX` qui ne forment pas d'UTF-8 valide. Mesuré sur le chemin réel —
`query-string.parse`, celui qu'appelle `expo-router` — pour une valeur de `%C3`
répété :

| séquences | longueur de la requête | durée    |
| --------- | ---------------------- | -------- |
| 32        | 98 caractères          | 47 ms    |
| 64        | 194 caractères         | 246 ms   |
| 128       | 386 caractères         | 1 124 ms |
| 256       | 770 caractères         | 7 308 ms |

C'est `GHSA-vcc3-ghjq-m6fr` (CVE-2026-45822, CVSS 6.6) : vecteur réseau, sans
privilège ni interaction, impact **disponibilité** seul — ni divulgation, ni
exécution de code.

Le chemin d'exécution est une **URL entrante** : `getStateFromPath` →
`parseQueryParams` → `queryString.parse(query)`. Un lien forgé de quelques
centaines de caractères suffit donc à figer l'application. Rien n'est divulgué,
rien n'est compromis, et la récupération consiste à la fermer.

**La correction amont n'est pas installable, et c'est mesuré.**
`decode-uri-component@0.5.0` est un module ESM à export par défaut, et
`query-string@7` en fait un `require` nu : la surcharge rendrait
`{__esModule, default}` au lieu d'une fonction, donc un décodage cassé. `npm
audit fix` ne propose de son côté que des rétrogradations majeures
(`expo-router` 57 → 5.1.11).

### La garde, et pourquoi elle ne coûte rien

`parseQueryParams` n'appelle `queryString.parse` que si le chemin contient un
`?`, et il le fait sur le chemin **brut** — un `%3F` encodé ne devient jamais
une requête. Fermer la requête retire donc le décodeur vulnérable du chemin,
entièrement.

C'est ce que fait `apps/mobile/app/+native-intent.ts`, branché sur
`redirectSystemPath` : le seul point qui précède l'analyse, et dont un retour
falsy **annule** la navigation. La règle est dans
`apps/mobile/src/lib/incoming-url.ts`, et son raisonnement est celui du lien
profond — `parseDeeplink` n'accepte déjà aucune requête, donc aucun lien que
l'application écrit n'en porte. La garde n'est pas un plafond arbitraire :
c'est la grammaire du lien appliquée un cran plus tôt.

Ce qu'elle ne peut pas casser : elle n'est appelée que pour une URL **venue du
système**. La navigation interne ne passe pas par là.

**Ce qui reste accepté.** Un avis modéré, de disponibilité seule, sur le chemin
d'un lien forgé. Ce qui ferait changer la décision : un avis touchant la
confidentialité ou l'intégrité, ou une version corrigée de `query-string`
rendant la surcharge possible — auquel cas la garde devient inutile. Elle ne
gêne pas, mais elle se retire.

### La porte, en CI

Le travail `quality` exécute `npm audit --audit-level=high`, et l'échec est
bloquant. Vert au moment de l'écrire — les 22 avis sont modérés. Une exception
se justifie par écrit, comme `TYPES_SANS_ROUTE` le fait pour les types sans
écran.

Le seuil est haut parce que les avis modérés de cet arbre sont, pour l'essentiel,
de l'outillage. Mais **la porte ne remplace pas la lecture** : l'avis le plus
grave trouvé ici était modéré. Un seuil ne dit pas ce qui est joignable.

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
