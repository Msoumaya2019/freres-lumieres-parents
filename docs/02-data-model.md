# 02 — Modèle de données Firestore

> Phase 1 · Document de référence

## 1. Principes

Le modèle est conçu autour de trois contraintes, dans cet ordre :

1. **Coût de lecture minimal.** Firestore facture à la lecture de document.
   Chaque choix ci-dessous cherche à éviter une requête supplémentaire : les
   compteurs sont dénormalisés, les aperçus de messages sont recopiés dans le
   canal, les niveaux des enfants sont recopiés dans le profil du parent.
2. **Une seule requête pour le fil d'actualité.** Voir la section 4.
3. **Sécurité exprimable en règles déclaratives.** Un contenu qui ne peut pas
   être filtré par une règle Firestore est un contenu mal modélisé.

Deux règles d'hygiène complètent ces principes :

- **Aucune donnée nominative d'enfant.** On stocke un niveau, une classe, une
  année scolaire. Le prénom est facultatif et n'est jamais exposé.
- **Rien n'est public par défaut.** Un signalement est privé jusqu'à décision
  explicite de la FCPE.

---

## 2. Collections racine

```
organizations/{orgId}
schools/{schoolId}
classes/{classId}

users/{uid}
  └── children/{childId}
  └── tokens/{tokenId}          (jetons push — jamais lisibles par le client)

deviceTokens/{token}            (index d'envoi, lisible uniquement par les Functions)
pushTickets/{ticketId}          (pont ticket → jeton, le temps de relire les reçus)

posts/{postId}
  └── comments/{commentId}
      └── reactions/{uid}        (id = uid : double réaction impossible)

channels/{channelId}
  └── messages/{messageId}

channelDigests/{channelId}        (lot de messages en attente d'annonce — jamais lisible)

polls/{pollId}
  └── votes/{voterKey}          (id = uid, y compris pour un sondage anonyme — voir § 3)

reports/{reportId}
  └── replies/{replyId}

collectiveIssues/{issueId}
  └── supporters/{uid}

events/{eventId}
  └── participants/{uid}

documents/{docId}

schoolCouncils/{councilId}
  └── items/{itemId}

notifications/{notificationId}
moderationReports/{moderationReportId}
adminLogs/{logId}
fcpeTasks/{taskId}
counters/{orgId}
highlights/{orgId}
```

### Ce qui a été ajouté au modèle proposé dans le cahier des charges

| Ajout                   | Raison                                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organizations`         | racine multi-tenant ; sans elle, les valeurs d'école finissent codées en dur                                                                                    |
| `deviceTokens`          | index d'envoi séparé : permet de cibler une audience sans lire les profils utilisateurs                                                                         |
| `pushTickets`           | temporaire par construction : un reçu Expo désigne un ticket et non un jeton, donc sans cette table on saurait qu'un appareil est mort sans pouvoir dire lequel |
| `counters/{orgId}`      | tableau de bord sans requête d'agrégation                                                                                                                       |
| `highlights/{orgId}`    | prochain événement, dernier sondage : 1 lecture au lieu de 3                                                                                                    |
| `users/{uid}/children`  | les enfants n'ont pas à être une collection racine : ils ne sont jamais interrogés globalement                                                                  |
| `users/{uid}/tokens`    | les jetons push sont sensibles ; les isoler permet de les interdire en lecture                                                                                  |
| `channels` + `messages` | structure forum, sans messagerie privée                                                                                                                         |
| `channelDigests`        | état du regroupement : un lot de messages en attente d'annonce, et l'instant où il part — état de service, jamais lisible par le client                         |
| `collectiveIssues`      | sujets suivis publiquement, distincts des signalements privés                                                                                                   |
| `fcpeTasks`             | espace de travail interne de la FCPE                                                                                                                            |

### Ce qui n'a **pas** été retenu

- **`feeds/{uid}` (fan-out)** : coûte une écriture par destinataire et par
  publication. Sur 300 parents et 3 publications par semaine, c'est
  900 écritures hebdomadaires inutiles. Les clés d'audience coûtent zéro.
- **`childrenProfiles` en collection racine** : aucune requête globale sur les
  enfants n'est légitime. Les exposer au niveau racine multiplierait les
  risques de fuite sans aucun bénéfice fonctionnel.
- **`pollVotes` en collection racine** : les votes sont toujours lus dans le
  contexte d'un sondage. En sous-collection, l'identifiant du document peut
  être l'UID, ce qui rend le double vote **structurellement impossible**.

---

## 3. Champs détaillés

### `organizations/{orgId}`

| Champ                               | Type    | Note                                   |
| ----------------------------------- | ------- | -------------------------------------- |
| `name`                              | string  | « FCPE Montmagny »                     |
| `slug`                              | string  | identifiant lisible, unique            |
| `city`                              | string  |                                        |
| `settings.reportRetentionDays`      | number  | RGPD : durée de conservation           |
| `settings.collectiveIssueThreshold` | number  | seuil de regroupement des signalements |
| `active`                            | boolean |                                        |

### `schools/{schoolId}`

| Champ         | Type                                        | Note                                             |
| ------------- | ------------------------------------------- | ------------------------------------------------ |
| `orgId`       | string                                      | rattachement                                     |
| `name`        | string                                      | « École élémentaire Frères Lumières »            |
| `level`       | `maternelle` \| `elementaire` \| `primaire` |                                                  |
| `classLevels` | string[]                                    | niveaux proposés, pour alimenter les formulaires |
| `address`     | string?                                     |                                                  |
| `active`      | boolean                                     |                                                  |

### `classes/{classId}`

| Champ               | Type         | Note          |
| ------------------- | ------------ | ------------- |
| `orgId`, `schoolId` | string       |               |
| `name`              | string       | « CE1 A »     |
| `level`             | `ClassLevel` |               |
| `academicYear`      | string       | « 2026-2027 » |

> Aucun nom d'enseignant n'est stocké : donnée personnelle sans nécessité
> fonctionnelle.

### `users/{uid}`

| Champ                      | Type                                               | Note                                             |
| -------------------------- | -------------------------------------------------- | ------------------------------------------------ |
| `firstName`, `lastName`    | string                                             |                                                  |
| `email`                    | string                                             | dupliqué depuis Auth pour la recherche admin     |
| `phone`                    | string?                                            | facultatif                                       |
| `role`                     | `parent` \| `fcpe` \| `moderator` \| `admin`       | **miroir** des Custom Claims                     |
| `status`                   | `pending` \| `active` \| `suspended` \| `rejected` | **miroir** des Custom Claims                     |
| `orgIds`                   | string[]                                           |                                                  |
| `schoolIds`                | string[]                                           |                                                  |
| `levels`                   | `ClassLevel[]`                                     | dénormalisé depuis `children`                    |
| `classIds`                 | string[]                                           | dénormalisé depuis `children`                    |
| `audienceKeys`             | string[]                                           | **calculé** — cœur du fil d'actualité            |
| `notificationPrefs`        | map                                                | `{ enabled, disabledCategories[] }`              |
| `consents`                 | map                                                | `{ privacyPolicy, communityRules, fcpeContact }` |
| `lastSeenAt`               | timestamp?                                         | au plus une écriture par jour                    |
| `approvedAt`, `approvedBy` | timestamp?, string?                                | traçabilité                                      |
| `statusReason`             | string?                                            | motif de suspension, visible admin seulement     |
| `privacyPolicyVersion`     | string?                                            | version acceptée                                 |

> **Pourquoi dupliquer `role` et `status` dans les claims ET dans le document ?**
> Les claims servent aux règles de sécurité (gratuit, aucun lecture facturée).
> Le document sert à l'affichage et à la recherche côté admin. Les deux sont
> écrits par la même Cloud Function, dans la même transaction logique : ils ne
> peuvent pas diverger sans qu'un test le détecte.

### `users/{uid}/children/{childId}`

`firstName?`, `schoolId`, `level`, `classId?`, `academicYear`.
Cinq champs, dont un seul facultatif. C'est le strict nécessaire pour cibler
une information ou une notification.

### `deviceTokens/{token}`

| Champ                  | Type                        | Note                                                      |
| ---------------------- | --------------------------- | --------------------------------------------------------- |
| `uid`, `orgId`         | string                      |                                                           |
| `token`                | string                      | jeton Expo / FCM                                          |
| `platform`             | `ios` \| `android` \| `web` |                                                           |
| `audienceKeys`         | string[]                    | **serveur** — recopie du profil, pour cibler sans lecture |
| `disabledCategories`   | string[]                    | **serveur** — recopie des préférences de catégorie        |
| `enabled`              | boolean                     | **client** — interrupteur de cet appareil                 |
| `locale`, `appVersion` | string?                     | diagnostic des envois                                     |
| `createdAt`            | timestamp                   |                                                           |
| `lastUsedAt`           | timestamp                   | purge des jetons morts                                    |

L'identifiant du document **est** le jeton : l'enregistrement est donc
idempotent (un même appareil ne crée jamais deux entrées). Un appareil partagé
entre deux comptes met à jour `uid` au lieu de créer un doublon — mais les
règles exigent alors que `audienceKeys` et `disabledCategories` soient **remis
à vide**, sans quoi le nouveau porteur recevrait les notifications de l'ancien.
Une Cloud Function les recalcule depuis le profil du nouveau porteur.

Un jeton ne change pas d'organisation : `orgId` est figé à l'enregistrement, et
les règles refusent toute mise à jour qui le réécrirait. Le cas d'un compte
rattaché à un autre groupe scolaire est aujourd'hui théorique — aucun chemin de
code n'écrit `orgId` sur un profil —, mais la suppression d'un jeton ne dépend
volontairement pas de l'organisation, précisément pour que ce cas resterait
résoluble par le client.

Un profil supprimé emporte ses jetons : le chemin d'envoi ne consulte pas les
Custom Claims, donc retirer les droits ne suffit pas à faire taire un appareil.

Deux champs sont écrits par une Cloud Function, et les règles Firestore les
refusent au client : vides à la création, puis figés. Le client ne peut plus
écrire que `enabled` et `lastUsedAt`.

- `audienceKeys` est une **autorisation** : le serveur sélectionne les
  destinataires d'un envoi en le lisant. Les règles ne peuvent pas vérifier une
  clé `class:` ou `level:` — elles ne lisent pas les enfants de l'appelant.
- `disabledCategories` est une **préférence**, donc inoffensive en soi, mais
  elle est posée par utilisateur et recopiée par appareil. Le client ne peut
  atteindre que l'appareil courant : propriétaire du champ, il laisserait
  diverger les autres.

`audienceKeys` est vide tant que le compte n'est pas `active` : un appareil dont
on ne sait rien ne doit rien recevoir.

### `posts/{postId}`

| Champ                                  | Type            | Note                                                            |
| -------------------------------------- | --------------- | --------------------------------------------------------------- |
| `orgId`, `schoolId?`                   | string          |                                                                 |
| `title`, `body`                        | string          |                                                                 |
| `category`                             | `PostCategory`  | 11 catégories                                                   |
| `audience`                             | map             | `{ type, schoolId?, level?, classId? }`                         |
| `audienceKeys`                         | string[]        | **requêté** — voir § 4                                          |
| `attachments`                          | map[]           | `{ storagePath, contentType, fileName, size, width?, height? }` |
| `linkUrl`                              | string?         |                                                                 |
| `authorId`, `authorName`, `authorRole` |                 | dénormalisé pour éviter une lecture par publication             |
| `commentsEnabled`                      | boolean         |                                                                 |
| `pinned`                               | boolean         |                                                                 |
| `pinnedUntil`                          | timestamp?      | fin d'épinglage automatique                                     |
| `status`                               | `ContentStatus` | `draft` \| `published` \| `hidden` \| `deleted` \| `archived`   |
| `publishedAt`                          | timestamp       | **clé de tri du fil**                                           |
| `stats`                                | map             | `{ commentCount, reactionCount, notifiedCount? }`               |
| `notifiedAt`                           | timestamp?      | garde-fou anti-doublon d'envoi                                  |

> Les pièces jointes ne stockent **jamais** d'URL signée : une URL signée
> expire, et la stocker oblige à réécrire le document. On stocke le chemin,
> et le client génère l'URL à la demande (avec mise en cache locale).

### `posts/{postId}/comments/{commentId}`

`authorId`, `authorName`, `authorRole`, `body`, `parentId?`, `replyCount`,
`reactions` (map emoji → compteur), `status`, `reportCount`, `createdAt`.

`status` est un `ModeratedStatus` — `visible` | `hidden` | `deleted` — et non un
`ContentStatus` : un commentaire ne connaît ni le brouillon ni l'archivage, et
son état normal s'appelle `visible`. C'est aussi la valeur que filtrent la règle
de lecture et `fetchComments` ; seul cet état compte donc dans
`posts.stats.commentCount` (voir `functions/src/triggers/counters.ts`).

En sous-collection : les commentaires ne sont jamais lus hors du contexte
d'une publication, et la règle d'accès hérite naturellement de celle du post.

#### `posts/{postId}/comments/{commentId}/reactions/{uid}`

`uid`, `postId`, `commentId`, `emoji`, `createdAt`.

L'identifiant du document est l'UID du réacteur : une double réaction est donc
impossible par construction, comme pour `votes/{uid}`. Chacun ne lit et ne
supprime que la sienne — c'est ce qui suffit à afficher l'état du bouton.

> La map `reactions` du commentaire est un **décompte dénormalisé**, pas la
> source de vérité : c'est la sous-collection. Elle est entretenue par une Cloud
> Function, et non par le client, pour une raison de fond autant que de forme.
> Le commentaire n'est modifiable que par son auteur et les modérateurs, donc un
> autre membre ne peut pas y écrire ; et laisser le client fixer un décompte
> reviendrait à le laisser mentir. C'est le même partage que `stats.commentCount`
> sur la publication.

### `channels/{channelId}`

| Champ                      | Type                                                  | Note                                                                         |
| -------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| `orgId`, `schoolId?`       | string                                                |                                                                              |
| `name`, `description?`     | string                                                |                                                                              |
| `type`                     | `general` \| `school` \| `level` \| `theme` \| `fcpe` |                                                                              |
| `level`                    | `ClassLevel?`                                         |                                                                              |
| `audience`, `audienceKeys` |                                                       | un canal `fcpe` n'est visible que des membres                                |
| `order`                    | number                                                | ordre d'affichage                                                            |
| `readOnly`                 | boolean                                               | canaux d'archives                                                            |
| `stats`                    | map                                                   | `{ messageCount, lastMessageAt, lastMessagePreview, lastMessageAuthorName }` |

> `stats` évite une requête par canal pour afficher l'aperçu du dernier
> message. Sur 13 canaux, c'est 13 lectures économisées à chaque ouverture
> de l'écran Discussions.

#### `channels/{channelId}/messages/{messageId}`

`channelId`, `authorId`, `authorName`, `authorRole`, `body`, `attachments`,
`replyToId?`, `replyToPreview?`, `reactions`, `status`, `reportCount`, `createdAt`.

`status` est un `ModeratedStatus` — `visible` | `hidden` | `deleted` — comme pour
un commentaire : seule la valeur `visible` est lisible. La mise à jour suit le
même régime à deux branches que les commentaires : l'auteur modifie son corps,
`isModerator()` masque, et l'identité comme les compteurs sont figés par
`unchanged()` (voir `04-security.md`).

### `polls/{pollId}` et `polls/{pollId}/votes/{voterKey}`

Le point délicat est le **vote unique par compte**.

- L'identifiant du document de vote est **l'UID de l'utilisateur**. Un
  utilisateur ne peut donc pas voter deux fois : la contrainte est portée par
  le schéma, pas par du code applicatif.
- Pour un sondage **anonyme**, le champ `uid` n'est pas écrit. Personne, y
  compris un administrateur, ne peut relier un vote à une personne depuis
  l'application.
- La clé `voterKey` reste l'UID dans les deux cas : c'est ce qui garantit
  l'unicité du vote, sans jamais l'exposer dans une réponse d'API.
- Les compteurs `options[].votes` et `totalVoters` sont mis à jour par une
  **Cloud Function transactionnelle**, jamais par le client. Un client qui
  écrirait directement dans le compteur fausserait les résultats.

### `reports/{reportId}` — signalements

`title`, `description`, `category`, `attachments[]`, `authorId`, `authorName`,
`status`, `visibility`, `timeline[]`, `assignedTo?`, `replyCount`,
`lastReplyAt?`, `linkedIssueId?`, `similarCount`.

`timeline` est un tableau de
`{ status, at, byId?, byName, note? }` : c'est exactement ce qu'affiche la
timeline du parent (Reçu → Pris en charge → Transmis → Résolu), sans requête
supplémentaire.

`visibility` vaut `private` par défaut. Le passage à `collective` est une
**décision explicite** de la FCPE, journalisée dans `adminLogs`.

### `collectiveIssues/{issueId}` et `supporters/{uid}`

`title`, `summary`, `category`, `status`, `supportTarget?`, `supportersCount`,
`concernedCount`, `published`, `linkedReportCount`, `lastUpdateAt?`,
`lastUpdateNote?`.

`supporters/{uid}` avec `{ value: concerned | for | against, comment? }`.
L'identifiant du document est l'UID : un parent ne peut s'exprimer qu'une fois
par sujet, et peut changer d'avis (mise à jour du même document).

### `events/{eventId}` et `participants/{uid}`

`title`, `description?`, `type`, `audience`, `audienceKeys`, `allDay`,
`startAt`, `endAt?`, `location?`, `registrationEnabled`, `requiresAnswer`,
`capacity?`, `volunteerSlotsNeeded`, `volunteerSlotsFilled`,
`reminderHoursBefore`, `reminderSentAt?`, `participantCount`, `attachments[]`,
`status`.

`participants/{uid}` : `{ attendance, volunteer, guests, note? }`.
Le compteur `participantCount` est tenu par Cloud Function.

### `documents/{docId}`

`title`, `description?`, `category`, `year`, `tags[]`, `audience`,
`audienceKeys`, `attachment`, `uploadedBy`, `uploadedByName`, `internal`,
`downloadCount`, `status`.

Le classement demandé (catégorie / année / établissement) est assuré par
`category`, `year` et `orgId`+`schoolId`.

### `schoolCouncils/{councilId}` et `items/{itemId}`

Séance : `title`, `type`, `status`, `date`, `location?`, `agenda[]`,
`minutesDocumentId?`, `minutesSummary?`, `questionCount`, `isNext`.

Point : `kind` (`question` d'un parent / `topic` de la FCPE), `title`, `body`,
`visibility` (`public` \| `fcpe`), `authorId`, `authorName`, `supportCount`,
`status`, `schoolAnswer?`, `cityAnswer?`, `fcpeAnswer?`, `plannedAction?`.

Chaque `CouncilAnswer` porte `{ body, answeredAt, source, reportedBy? }` :
c'est ce qui permet d'afficher séparément « réponse de l'école » et
« réponse de la mairie », comme demandé.

> `visibility: 'fcpe'` est ce qui rend l'espace de préparation privé **au
> niveau de la donnée**, et non au niveau de l'interface.

### `notifications/{notificationId}`

Journal d'envoi : `type`, `category`, `title`, `body`, `audience`,
`audienceKeys`, `sourceType?`, `sourceId?`, `deeplink?`, `sentBy`,
`sentByName`, `sentAt`, `delivery`, puis le compte rendu en deux temps :
`recipientCount`, `acceptedCount`, `deliveredCount`, `failedCount`,
`pendingCount`, `ticketIds[]`, `receiptsChecked`.

Les quatre compteurs ne mesurent pas la même chose, et les confondre est
l'erreur que cette collection a d'abord commise :

| Champ            | Ce qu'il compte                                                   |
| ---------------- | ----------------------------------------------------------------- |
| `recipientCount` | Appareils visés, après filtrage des préférences                   |
| `acceptedCount`  | Messages **acceptés** par le service (ticket `ok`)                |
| `deliveredCount` | Messages **remis à FCM ou APNs** (reçu `ok`) — `null` si non relu |
| `failedCount`    | Refusés, à l'envoi **ou** à la relecture des reçus                |
| `pendingCount`   | Reçus pas encore disponibles à la relecture                       |

Aucun ne compte de parents : le service ne sait pas qui a lu une notification,
et savoir qui l'a **reçue** sur son téléphone n'existe pas. Un écran qui
intitulerait `deliveredCount` « reçues » resterait faux — c'est « remises au
transport ».

`deliveredCount` vaut `null` tant que les reçus n'ont pas été relus, et `0`
quand il n'y avait rien à relire. La distinction est volontaire : `0` affirme
qu'aucun message n'est parti, `null` dit qu'on ne sait pas encore.
`receiptsChecked` est le drapeau qui commande la relecture.

### `pushTickets/{ticketId}`

`orgId`, `notificationId`, `token`, `sentAt`. **Invisible au client**, dans les
deux sens, et supprimé dès que les reçus de son envoi ont été relus.

Un reçu Expo désigne un **ticket**, jamais un jeton : la réponse de
`/push/getReceipts` ne dit pas à quel appareil elle correspond. Ce document est
le seul endroit où les deux se rencontrent, et sans lui, apprendre qu'un
appareil est mort ne dirait pas lequel — le reçu serait lu, compté, et sans
effet.

Il ne vit pas dans `notifications` parce qu'il contient des jetons d'appareil,
et que `notifications` est lisible par la FCPE : la porte de service aurait
remplacé la porte d'entrée.

### `channelDigests/{channelId}`

`orgId`, `channelId`, `messageIds`, `flushAt`. **Invisible au client**, dans les
deux sens.

Un canal actif ne doit pas produire une notification par message : les messages
sont regroupés sur une fenêtre de cinq minutes, et une seule notification annonce
le lot. Ce document est l'état de cette fenêtre — et l'identifiant est celui du
canal, donc un canal a **au plus un lot ouvert**.

`messageIds` est une **liste dédoublonnée**, et non un compteur. Un compteur
incrémenté à chaque message dérive dès qu'un événement est livré deux fois — les
déclencheurs Firestore s'exécutent « au moins une fois » —, tandis que la liste ne
peut pas compter deux fois le même message. Elle donne en plus au passage
d'annonce de quoi relire les messages : le compte annoncé est celui des messages
**encore visibles**, pas celui des messages arrivés.

`flushAt` est fixé à l'ouverture du lot et **n'est plus repoussé** tant que la
fenêtre court. Le repousser à chaque message ferait qu'un canal bavard ne serait
jamais annoncé : la fenêtre glisserait indéfiniment.

Le document ne porte ni le nom du canal, ni son audience, ni le texte des
messages : tout cela est relu au moment de l'annonce, pour qu'un canal renommé ou
un message masqué dans l'intervalle soient annoncés sous leur état réel.

### `moderationReports/{moderationReportId}`

`targetType`, `targetId`, `targetPath`, `targetAuthorId`, `targetAuthorName`,
`targetExcerpt` (figé au moment du signalement), `reason`, `details?`,
`reporterId`, `reporterName`, `status`, `handledBy?`, `handledAt?`, `action?`,
`actionNote?`.

`targetPath` permet à un modérateur de traiter n'importe quel type de contenu
avec le même code.

### `adminLogs/{logId}`

`actorId`, `actorName`, `actorRole`, `action`, `targetType`, `targetId`,
`metadata`, `at`.

**Immuable** : création autorisée côté serveur uniquement, aucune mise à jour
ni suppression, même pour un administrateur. C'est la condition pour que le
journal ait une valeur en cas de litige.

### `fcpeTasks/{taskId}`

`title`, `description?`, `status`, `priority`, `assigneeId?`, `assigneeName?`,
`dueAt?`, `relatedType?`, `relatedId?`, `doneAt?`.

### `counters/{orgId}` et `highlights/{orgId}`

Documents uniques maintenus par Cloud Functions. Ils alimentent le tableau de
bord de l'administration sans aucune requête d'agrégation :

```ts
counters: {
  users:    { total, pending, active, suspended, rejected, activeLast7Days },
  content:  { postsPublished, postsLast7Days, commentsTotal, messagesTotal },
  moderation:{ reportsOpen, reportsInProgress, moderationQueueOpen },
  engagement:{ openPolls, openCollectiveIssues, upcomingEvents, pendingCouncilQuestions }
}
```

---

## 4. Le fil d'actualité en une requête

C'est la décision la plus importante du modèle.

### Le problème

Un parent doit voir les publications qui le concernent : celles destinées à
tous, à son école, à son niveau, à sa classe, ou à la FCPE s'il en est membre.
Firestore ne sait pas faire un `OR` entre des combinaisons de champs
différents. Une requête naïve obligerait à 5 requêtes puis une fusion côté
client — 5 fois le coût, et une pagination fausse.

### La solution

Chaque contenu porte un tableau `audienceKeys`, chaque utilisateur possède le
tableau des clés auxquelles il a droit, et la requête devient :

```ts
query(
  collection(db, 'posts'),
  where('orgId', '==', orgId),
  where('status', '==', 'published'),
  where('audienceKeys', 'array-contains-any', userKeys),
  orderBy('publishedAt', 'desc'),
  limit(10),
);
```

Avec, pour un parent ayant un enfant en CE1 à l'élémentaire :

```ts
userKeys = ['org:fcpe-montmagny', 'school:elem', 'level:elem:CE1'];
```

**Résultat : une seule requête, une seule page de 10 documents, un index
composite.** La pagination par curseur fonctionne nativement.

### Limite à connaître

`array-contains-any` accepte au maximum **30 valeurs**. Un utilisateur typique
en possède 3 à 6. La fonction `chunkAudienceKeys()` de `@fl/shared` découpe
proprement au-delà, et le cas est couvert par un test.

### La même mécanique partout

`audienceKeys` est également présent sur `channels`, `polls`, `events`,
`documents` et `notifications`. Un seul concept, appliqué uniformément, pour
le fil, les sondages, l'agenda et les envois ciblés.

### Les clés servent aussi de topics de notification

`audienceKeyToTopic('level:elem:CE1')` → `level_elem_ce1`. Le client et le
serveur calculent le même topic sans se parler. Une seule source de vérité
pour le ciblage du contenu **et** des notifications.

---

## 5. Index composites requis

`firebase/firestore.indexes.json` contient :

| Collection          | Champs                                                         | Usage                               |
| ------------------- | -------------------------------------------------------------- | ----------------------------------- |
| `posts`             | `orgId` ↑, `status` ↑, `audienceKeys` (array), `publishedAt` ↓ | fil d'actualité                     |
| `posts`             | `orgId` ↑, `pinned` ↑, `publishedAt` ↓                         | épinglés en tête                    |
| `posts`             | `authorId` ↑, `publishedAt` ↓                                  | « mes publications »                |
| `channels`          | `orgId` ↑, `status` ↑, `order` ↑                               | liste des canaux                    |
| `channels`          | `orgId` ↑, `audienceKeys` (array), `order` ↑                   | canaux visibles                     |
| `messages`          | `status` ↑, `createdAt` ↓                                      | fil de discussion (sous-collection) |
| `polls`             | `orgId` ↑, `status` ↑, `endsAt` ↓                              | sondages ouverts                    |
| `polls`             | `orgId` ↑, `audienceKeys` (array), `startsAt` ↓                | sondages visibles                   |
| `reports`           | `orgId` ↑, `status` ↑, `createdAt` ↓                           | file de traitement FCPE             |
| `reports`           | `authorId` ↑, `createdAt` ↓                                    | « mes signalements »                |
| `collectiveIssues`  | `orgId` ↑, `published` ↑, `status` ↑, `lastUpdateAt` ↓         | sujets en cours                     |
| `events`            | `orgId` ↑, `startAt` ↑                                         | agenda à venir                      |
| `events`            | `orgId` ↑, `audienceKeys` (array), `startAt` ↑                 | agenda visible                      |
| `documents`         | `orgId` ↑, `category` ↑, `year` ↓                              | bibliothèque                        |
| `documents`         | `orgId` ↑, `audienceKeys` (array), `uploadedAt` ↓              | documents visibles                  |
| `schoolCouncils`    | `orgId` ↑, `date` ↓                                            | historique des conseils             |
| `councilItems`      | `councilId` ↑, `visibility` ↑, `supportCount` ↓                | préparation                         |
| `moderationReports` | `orgId` ↑, `status` ↑, `createdAt` ↑                           | file de modération (FIFO)           |
| `notifications`     | `orgId` ↑, `sentAt` ↓                                          | historique des envois               |
| `notifications`     | `receiptsChecked` ↑, `sentAt` ↑                                | envois dont les reçus sont à relire |
| `deviceTokens`      | `orgId` ↑, `audienceKeys` (array)                              | ciblage d'envoi                     |
| `adminLogs`         | `actorId` ↑, `at` ↓                                            | audit par acteur                    |
| `adminLogs`         | `action` ↑, `at` ↓                                             | audit par type d'action             |
| `fcpeTasks`         | `orgId` ↑, `status` ↑, `dueAt` ↑                               | tâches internes                     |
| `users`             | `orgId` principal, `status` ↑, `createdAt` ↓                   | file de validation                  |
| `users`             | `email` ↑                                                      | recherche admin                     |
| `users`             | `schoolIds` (array), `levels` (array)                          | filtres admin                       |

> `users.orgIds` est un tableau : Firestore ne sait pas trier sur un tableau.
> On stocke donc aussi `orgId` (organisation principale) à plat sur le
> document, ce qui permet `where('orgId','==',x).where('status','==','pending')`
> — la requête exacte de la file de validation.

---

## 6. Champs de date : le choix `Timestamp`

Tous les champs de date sont des `Timestamp` Firestore, jamais des chaînes.

- les règles **pourront** comparer et valider (`request.time`) — capacité réelle
  du langage, mais **employée nulle part aujourd'hui** : c'est le manque que
  porte `04-security.md` § 6 ;
- le tri est natif ;
- `serverTimestamp()` garantit une horloge serveur, non falsifiable par le
  client.

Les dates « civiles » (date d'un conseil d'école, sans heure) sont des chaînes
`YYYY-MM-DD`, volontairement : convertir une date sans heure en `Timestamp`
introduit systématiquement des décalages de fuseau horaire.

---

## 7. Ce qui reste à décider en Phase 2

- Valeur exacte de `reportRetentionDays` (proposition : 730 jours, soit deux
  années scolaires).
- Politique de purge des `deviceTokens` inactifs (proposition : 180 jours).
- Faut-il archiver les publications de l'année précédente ou les conserver en
  base avec un filtre d'année ? **Proposition : conserver et filtrer.**
