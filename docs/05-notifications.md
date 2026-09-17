# 05 — Stratégie de notifications push

> Phase 1 · Document de référence · **contient une décision à valider**

## 1. La contrainte technique, énoncée franchement

Le cahier des charges demande Firebase Cloud Messaging. Il faut être précis
sur un point que la documentation officielle indique clairement :

> **Le SDK JavaScript Firebase ne prend pas en charge la messagerie (FCM) dans
> React Native.**

Le module `firebase/messaging` cible les navigateurs. Dans une application
React Native / Expo, deux chemins existent réellement :

|                                                   | Option A — Expo Notifications                           | Option B — `@react-native-firebase/messaging`                         |
| ------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| Installation                                      | `npx expo install expo-notifications`                   | plugin natif + `expo prebuild`                                        |
| Fonctionne en Expo Go                             | oui                                                     | non (dev build obligatoire)                                           |
| Configuration native                              | aucune                                                  | `google-services.json`, `GoogleService-Info.plist`, entitlements APNs |
| Transport réel                                    | Expo Push Service → **FCM (Android)** et **APNs (iOS)** | FCM direct                                                            |
| Topics FCM natifs                                 | non                                                     | oui                                                                   |
| Envoi serveur                                     | API Expo Push (`exp.host`)                              | Admin SDK (`messaging().send`)                                        |
| Coût                                              | gratuit                                                 | gratuit                                                               |
| Complexité de maintenance                         | faible                                                  | élevée                                                                |
| Risque de casse lors d'une montée de version Expo | faible                                                  | moyen                                                                 |

### Décision retenue : Option A, avec une porte de sortie

**Expo Notifications en V1.**

Raisons, dans l'ordre d'importance pour un projet maintenu par une personne :

1. **Le transport reste FCM sur Android.** Expo Push Service relaie vers FCM
   et APNs. L'exigence fonctionnelle — recevoir une notification sur Android
   et iOS — est satisfaite. Ce n'est pas un contournement, c'est une couche
   de relais.
2. **Aucun fichier de credentials dans le dépôt.** Pas de
   `google-services.json` à gérer, pas de clé APNs à faire tourner : EAS
   détient les identifiants. C'est exactement ce que le cahier des charges
   exige (section 37).
3. **Les builds fonctionnent sans Mac** et sans `prebuild`, ce qui préserve la
   simplicité du projet.
4. **L'absence de topics FCM est compensée.** Voir la section 3 : on obtient
   la même capacité de ciblage par une collection d'index, sans lire les
   profils utilisateurs.

### La porte de sortie est prévue dès maintenant

Le code d'envoi est isolé derrière une interface unique :

```ts
// packages/shared/src/push/dispatcher.ts
export interface PushDispatcher {
  sendToAudience(params: SendParams): Promise<SendResult>;
}
```

Deux implémentations sont prévues : `ExpoPushDispatcher` (V1) et
`FcmPushDispatcher` (V2, si un jour les topics natifs deviennent
nécessaires). Le reste de l'application ne connaît que l'interface. Passer de
l'une à l'autre ne touche **qu'un seul fichier**.

### Ce qu'il faudrait pour basculer en Option B

- `npx expo prebuild` et gestion des dossiers `ios/` et `android/` ;
- le plugin `@react-native-firebase/app` + `messaging` ;
- les identifiants de build dans EAS ;
- un dev build pour tous les développeurs.

C'est faisable, mais ce n'est pas le bon premier pas.

---

## 2. Enregistrement d'un appareil

```
1. L'application démarre et l'utilisateur est `active`
        │
2. Demande de permission (expo-notifications)
   └─ refus → on n'insiste pas, un écran explique comment l'activer plus tard
        │
3. Obtention du jeton Expo Push
        │
4. Écriture dans deviceTokens/{token} — par le client
   {
     uid,
     orgId,                  // doit être la sienne : les règles le vérifient
     token,                  // l'identifiant du document
     platform: 'ios' | 'android',
     audienceKeys: [],       // VIDE — le champ appartient au serveur
     disabledCategories: [], // VIDE — idem
     enabled: true,          // interrupteur de CET appareil
     createdAt, lastUsedAt
   }
        │
4 bis. onDeviceTokenCreated complète le document depuis le profil :
   `audienceKeys` (école, niveau, classe, appartenance FCPE) et
   `disabledCategories` (préférences de catégorie)
        │
5. Le jeton est rafraîchi à chaque ouverture de l'application
   (lastUsedAt mis à jour, au plus une fois par jour)
```

### Pourquoi `audienceKeys` et `disabledCategories` appartiennent au serveur

Les deux champs sont recopiés du profil par une Cloud Function, et les règles
Firestore les refusent au client : vides à la création, puis figés. Le client
ne peut plus écrire que `enabled` — l'interrupteur de **cet appareil** — et
`lastUsedAt`. Les raisons sont différentes, et il faut les distinguer.

**`audienceKeys` est une autorisation, pas une préférence.** Au moment de
l'envoi, le serveur sélectionne les destinataires par

```ts
.where('orgId', '==', orgId)
.where('audienceKeys', 'array-contains-any', audienceKeys)
```

Un client qui déclare librement ses clés choisit donc **qui il devient**. Les
règles peuvent vérifier `orgId` (comparé au claim) mais **pas** une clé
`class:` ou `level:` — elles ne savent pas lire les enfants de l'appelant. Un
parent pourrait s'abonner à l'audience de la FCPE, ou à la classe d'un autre.

**`disabledCategories` est une préférence — inoffensive en soi.** Elle ne fait
que réduire ce que l'appareil reçoit. Le champ est pourtant serveur, pour une
raison qui n'a rien à voir avec la sécurité : la préférence est posée par
**utilisateur** et recopiée par **appareil**. Un client ne peut atteindre que
l'appareil courant, donc les autres divergeraient. Un parent décochant
« discussions » sur son téléphone continuerait de les recevoir sur sa tablette,
alors que l'écran de préférences affiche l'inverse. C'est le serveur qui voit
tous les appareils d'un même compte, donc c'est lui qui recopie.

**Les deux replis ne vont pas dans le même sens**, et c'est délibéré :

- ne rien recevoir (`audienceKeys`) échoue **fermé** — compte non `active`,
  profil illisible, champ absent donnent un tableau vide. Une notification
  révèle son contenu dans le bandeau de l'écran de verrouillage ;
- la préférence (`disabledCategories`) échoue **ouvert** — des préférences
  illisibles sont traitées comme « rien de désactivé ». Rendre muet un parent
  dont le profil est incomplet serait pire que de lui envoyer une notification
  qu'il aurait pu vouloir ignorer.

**Un compte qui n'est plus `active` perd ses clés.** Les règles empêchent un
compte non actif de _créer_ un jeton, mais rien ne vidait un jeton déjà créé au
moment d'une suspension : le parent suspendu continuait de tout recevoir. Le
déclencheur de profil recale donc les jetons sur le statut, dans les deux sens.

L'identifiant du document **est** le jeton : l'enregistrement est idempotent.
Un même appareil partagé entre deux comptes met à jour `uid` plutôt que de
créer un doublon.

### Le cycle de vie d'un jeton

Trois moments obligent à recalculer les champs dérivés, et un quatrième n'est
pas encore couvert.

**À la création** — `onDeviceTokenCreated` lit le profil et remplit les deux
champs. Sans lui, le jeton resterait éternellement vide : les règles imposent au
client d'écrire `[]`, et rien ne remonterait jamais.

**Au changement de porteur** — un appareil partagé entre deux parents, ou
transmis. L'identifiant du document **est** le jeton, donc le second porteur
reprend la même entrée ; les règles exigent alors qu'il remette `audienceKeys`
et `disabledCategories` à vide, et `onDeviceTokenOwnerChanged` les recalcule
depuis **son** profil.

Sans cette remise à zéro, le nouveau porteur héritait des clés de l'ancien et
recevait ses notifications, indéfiniment : rien ne les recalculait, puisque ce
sont les clés du profil du nouveau porteur qui les déterminent, et que ce
profil-là n'a pas changé. L'appareil continuait de recevoir les informations
d'une classe qui n'était plus la sienne.

Interdire purement le transfert aurait été pire : un appareil partagé n'aurait
pu servir qu'un seul compte, sans que rien ne le signale — le second parent
aurait cru s'être enregistré, et n'aurait rien reçu.

Le transfert reste **interne à l'organisation** : les règles comparent aussi
l'organisation du document à celle de l'appelant. Sans cette clause, un parent
du groupe B reprenait un jeton du groupe A en réécrivant `orgId` — le document
franchissait la frontière, et l'appareil du groupe A cessait de recevoir ses
propres notifications. `orgId` est le seul champ qui rattache un jeton à un
groupe, et c'était le seul que le client pouvait réécrire.

Conséquence, aujourd'hui théorique : un compte dont l'organisation changerait
ne pourrait plus mettre à jour ses jetons — il les supprimerait et les
recréerait, la suppression ne dépendant volontairement pas de l'organisation.
Aucun chemin de code n'écrit aujourd'hui `orgId` sur un profil : les règles le
figent pour le client, et `adminSetUserRole` ne fait que le lire.

**À la suppression du profil** — les jetons sont effacés. Retirer les droits ne
suffit pas : le chemin d'envoi ne consulte jamais les Custom Claims, il
interroge `deviceTokens` par organisation et par clés d'audience. Un compte
supprimé continuerait donc de recevoir les notifications de sa classe. Le cas
se produit dès qu'un profil est supprimé autrement que par `adminDeleteUser`,
puisque c'est le seul appelant de `cleanupDeletedUser` — le déclencheur de
profil appelle donc le même nettoyage, qui est idempotent.

**À la déconnexion — non couvert.** Après une déconnexion, l'appareil continue
de recevoir les notifications du compte qui vient de partir. Le remède est
simple et appartient au client — écrire `enabled: false` sur son propre jeton,
la seule écriture que les règles lui laissent — mais il faut connaître le jeton,
donc l'enregistrement côté application, qui reste à écrire.

> Risque résiduel, assumé : un porteur qui connaîtrait le jeton d'un autre
> appareil peut le revendiquer et priver celui-ci de ses notifications. Le
> jeton est l'identifiant du document et n'est pas devinable ; l'effet est une
> gêne, pas une fuite — et les clés de l'ancien porteur sont effacées au
> passage.

### Ce qui déclenche un recalcul

Deux écritures, et deux seulement, recalculent les clés d'un parent :

| Écriture                         | Déclencheur             |
| -------------------------------- | ----------------------- |
| `users/{uid}`                    | `onUserProfileWritten`  |
| `users/{uid}/children/{childId}` | `onUserChildrenWritten` |

Le second manquait. `rebuildAudienceKeysForUser` lit la sous-collection
`children` — c'est la seule façon de construire `level:{école}:{niveau}` quand
une famille a des enfants dans deux écoles — mais **rien ne la surveillait**.
Le formulaire d'inscription masquait le défaut : il écrit l'enfant et le profil
d'un seul geste. Ajouter un enfant plus tard ne recalculait donc rien, le parent
ne voyait pas le fil de sa classe, et rien n'échouait.

Le filtre est volontairement étroit : seuls l'école, le niveau et la classe
comptent. Corriger l'orthographe d'un prénom ne doit pas coûter une lecture de
profil, une requête sur les enfants et une écriture.

Le recalcul se fait en deux passes, et c'est normal :
`rebuildAudienceKeysForUser` écrit le profil, ce qui retraverse
`onUserProfileWritten`. La seconde passe recalcule les mêmes valeurs, la
comparaison devient fausse, et la chaîne s'arrête. Deux lectures et deux
écritures pour un enfant ajouté — le prix de ne pas dupliquer la logique de
recalcul.

### Ce que la recopie ne couvre pas encore

L'interrupteur général (`notificationPrefs.enabled`) n'est **pas** recopié : il
n'a aujourd'hui aucun consommateur, puisque l'écran de préférences n'existe pas.

Sa portée, en revanche, est **tranchée** : il ne coupera pas les alertes
`urgent`. C'est déjà la règle appliquée à `deviceTokens.enabled`, l'interrupteur
de l'appareil, que `filterRecipients` fait passer outre pour les catégories
obligatoires. Le jour où ce champ sera recopié, il devra lire
`MANDATORY_NOTIFICATION_CATEGORIES`, et non comparer à la chaîne `'urgent'`.

**Conséquence à ne pas oublier :** `deviceTokens.enabled` porte aujourd'hui
**deux sens** — « j'ai coupé les notifications » et, à terme, « je me suis
déconnecté ». La décision tranchée porte sur le premier. Un appareil déconnecté
dont le jeton serait simplement désactivé recevrait donc encore les alertes
urgentes. Voir la note du cycle de vie ci-dessous.

### Cycle de vie

| Événement                        | Action                                              |
| -------------------------------- | --------------------------------------------------- |
| Connexion                        | enregistrement du jeton                             |
| Déconnexion                      | **rien, pour l'instant** — voir la note ci-dessous  |
| Changement d'enfants / de classe | recalcul de `audienceKeys` par Cloud Function       |
| Modification des préférences     | recalcul de `disabledCategories` par Cloud Function |
| Erreur `DeviceNotRegistered`     | suppression du jeton                                |
| 180 jours sans activité          | purge par tâche planifiée — **à écrire** (phase 5)  |

> **La déconnexion ne désactive pas le jeton, et c'est un manque connu.** Le
> code le dit à l'endroit où il faudrait agir (`signOut`, dans
> `apps/mobile/src/providers/auth-provider.tsx`) : après une déconnexion,
> l'appareil continue de recevoir les notifications du compte qui vient de
> partir. La ligne du tableau annonçait une Cloud Function déclenchée sur la
> déconnexion — elle n'existe pas, et Firebase Functions v2 n'offre aucun
> déclencheur de ce genre. Le remède appartient au client, qui peut écrire
> `enabled` sur son propre jeton ; il lui faut pour cela connaître le jeton,
> donc l'enregistrement côté application, encore à écrire.
>
> **Ce qu'il faudra trancher à ce moment-là :** `enabled` ne doit pas porter
> deux sens. « J'ai coupé les notifications » laisse passer les alertes
> urgentes — c'est la décision prise. « Je me suis déconnecté » ne le devrait
> pas : l'appareil n'est plus celui d'un membre de l'audience. Supprimer le
> jeton à la déconnexion plutôt que le désactiver sépare les deux cas, la
> reconnexion le réenregistrant.

---

## 3. Ciblage : les clés d'audience remplacent les topics

C'est le point élégant du modèle : **les mêmes clés qui filtrent le fil
d'actualité servent à cibler les notifications.**

```
Clé d'audience                Topic équivalent
────────────────────────────  ────────────────────────
org:fcpe-montmagny            org_fcpe-montmagny
school:elem                   school_elem
level:elem:CE1                level_elem_ce1
class:ce1a                    class_ce1a
fcpe:fcpe-montmagny           fcpe_fcpe-montmagny
```

La fonction `audienceKeyToTopic()` de `@fl/shared` est **déterministe** : le
client et le serveur calculent le même identifiant sans se parler.

### Envoi ciblé, sans lire les profils

```ts
// Cloud Function
// Cloud Function — `queryTokensByAudience`, dans
// functions/src/notifications/send.ts
const tokens = await db
  .collection('deviceTokens')
  .where('orgId', '==', orgId)
  .where('audienceKeys', 'array-contains-any', lot) // au plus 30 clés par lot
  .get();
```

**Une seule requête, aucun accès à `users`.** Les clés sont recopiées dans le
jeton d'appareil précisément pour cela.

> `enabled` **n'est pas dans la requête**, et c'est délibéré : une contrainte à
> cet endroit écarterait un appareil éteint avant que le filtre ne le voie, donc
> lui ferait manquer les alertes urgentes. C'est `filterRecipients` qui décide,
> à un seul endroit. Voir § 4.

> Coût typique : ~300 appareils → une requête Firestore par lot de 30 clés
> d'audience (il y en a une vingtaine au total), puis 3 appels HTTP, l'API Expo
> acceptant 100 jetons par appel. Négligeable.

### Comparaison honnête avec les topics FCM

|                             | Topics FCM (Option B)           | `deviceTokens` + `array-contains-any` (Option A) |
| --------------------------- | ------------------------------- | ------------------------------------------------ |
| Coût serveur                | zéro lecture                    | ~1 lecture par appareil ciblé                    |
| Latence                     | diffusion immédiate             | quelques centaines de ms                         |
| Désabonnement par catégorie | côté client uniquement          | **côté serveur et côté client**                  |
| Audit                       | impossible de savoir qui a reçu | journal complet dans `notifications`             |
| Ciblage « tous sauf X »     | impossible                      | possible                                         |
| Coût à 300 parents          | 0                               | ~300 lectures par envoi (négligeable)            |

Pour un groupe scolaire, l'écart de coût est négligeable, et l'auditabilité
est un vrai gain : on sait combien de personnes ont reçu une information.

---

## 4. Catégories et préférences

Sept catégories, dont une non désactivable :

| Catégorie      | Désactivable | Contenu                                         |
| -------------- | :----------: | ----------------------------------------------- |
| `urgent`       |   **non**    | alertes critiques (fermeture d'école, sécurité) |
| `publications` |     oui      | nouvelles publications                          |
| `discussions`  |     oui      | nouveaux messages, réponses                     |
| `sondages`     |     oui      | nouveaux sondages                               |
| `signalements` |     oui      | évolution de **vos** signalements               |
| `agenda`       |     oui      | rappels d'événements                            |
| `vie_fcpe`     |     oui      | comptes rendus, réunions                        |

### Comment la préférence est appliquée

Deux niveaux, et un seul endroit qui décide :

- **Par catégorie** — `users/{uid}.notificationPrefs.disabledCategories` est
  recopié par Cloud Function dans `deviceTokens.disabledCategories`
  (dénormalisé). Cela évite de lire les profils au moment de l'envoi, tout en
  permettant un filtrage par catégorie.
- **Général** — `deviceTokens.enabled` est l'interrupteur de **cet appareil**.
  Le client l'écrit, et les règles Firestore le lui laissent : il ne concerne
  que son propre téléphone.

La requête qui lit les jetons — `queryTokensByAudience`, dans
`functions/src/notifications/send.ts` — ne contraint **pas** `enabled`. C'est
délibéré : une contrainte à cet endroit écarterait un appareil éteint **avant**
`filterRecipients`, qui ne pourrait plus rien pour lui. La décision se prend
donc dans le filtre, à un seul endroit :

```ts
const tokens = await queryTokensByAudience(orgId, audienceKeys);
const recipients = filterRecipients(tokens, category);
```

Le prix est de lire les appareils éteints de l'audience pour les écarter juste
après. À l'échelle d'un groupe scolaire, il est très inférieur au coût d'une
fermeture d'école non reçue.

> Pour la catégorie `urgent`, le filtre n'est jamais appliqué : ni les
> préférences par catégorie, ni l'interrupteur général ne la coupent. Couper le
> bruit n'est pas couper les alertes.

### Où l'exception `urgent` est appliquée

Quatre endroits, et ils lisent tous la même liste —
`MANDATORY_NOTIFICATION_CATEGORIES`, dans `packages/shared/src/constants.ts` :

| Endroit                            | Ce qu'il fait                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| `notificationPrefsSchema`          | **refuse** `urgent` dans `disabledCategories`, avec un message explicite               |
| `filterRecipients` (le dispatcher) | ne filtre **jamais** une catégorie obligatoire, ni par catégorie ni par l'interrupteur |
| `OPTIONAL_NOTIFICATION_CATEGORIES` | liste dérivée : la seule source des interrupteurs de l'écran de préférences            |
| `queryTokensByAudience`            | ne contraint **pas** `enabled`, pour que le filtre reste le seul juge                  |

**Le refus côté schéma n'est pas la garantie.** Les règles Firestore ne valident
pas `notificationPrefs` : un document en base peut donc porter `urgent`, écrit
par une version antérieure ou par un client qui contourne le schéma. La
garantie, c'est le filtre d'envoi, qui l'ignore. Le refus du schéma sert à autre
chose : ne pas **promettre** à l'utilisateur une préférence sans effet, et
empêcher l'écran de préférences de la proposer par inadvertance.

Les quatre lectures étant dérivées de la même constante, rendre demain une autre
catégorie obligatoire suffit : le schéma la refuse, le filtre l'ignore, et la
liste des interrupteurs la retire. Aucun des quatre n'a à être modifié.

### Cas particulier : les alertes urgentes

Une publication de catégorie `urgent` :

- apparaît **en tête du fil**, avec un bandeau rouge et une icône dédiée ;
- génère une notification à **tous** les appareils de l'audience, quelles que
  soient les préférences **et même si l'appareil a coupé les notifications** ;
- utilise un canal Android à importance maximale
  (`expo-notifications` → `AndroidNotificationPriority.MAX`) ;
- sur iOS, utilise une interruption critique **uniquement si** l'application
  a obtenu l'entitlement correspondant auprès d'Apple (démarche séparée,
  à décider en Phase 5).

---

## 5. Les sept déclencheurs

| #   | Déclencheur                   | Catégorie                  | Cible                                             |
| --- | ----------------------------- | -------------------------- | ------------------------------------------------- |
| 1   | Publication publiée           | `publications` ou `urgent` | audience de la publication                        |
| 2   | Nouveau commentaire           | `discussions`              | auteur de la publication                          |
| 3   | Réponse à un commentaire      | `discussions`              | auteur du commentaire parent                      |
| 4   | Nouveau message dans un canal | `discussions`              | audience du canal (résumé groupé)                 |
| 5   | Nouveau sondage               | `sondages`                 | audience du sondage                               |
| 6   | Mise à jour d'un signalement  | `signalements`             | **auteur du signalement uniquement**              |
| 7   | Rappel d'événement            | `agenda`                   | participants inscrits, ou audience de l'événement |

Deux règles de bon sens appliquées partout :

- **On ne se notifie jamais soi-même.** L'auteur d'un commentaire ne reçoit
  pas de notification pour son propre commentaire.
- **On regroupe.** Un canal actif ne génère pas 40 notifications : une fenêtre
  de 5 minutes regroupe les messages (« 3 nouveaux messages dans CE1 »).

**État : le déclencheur 1 est branché** (`onPostPublished`), les six autres ne
le sont pas. Les règles ci-dessus sont donc, à ce jour, tenues par le seul
déclencheur qui existe ; les déclencheurs 2 à 7 devront les appliquer à leur
tour — le regroupement en particulier n'a encore aucune implémentation.

---

## 6. Anatomie d'une notification

```ts
{
  title:  'Cantine — menus de la semaine',
  body:   'Les menus du 21 au 25 septembre sont disponibles.',
  data: {
    type:      'post_published',
    category:  'cantine',
    orgId:     'fcpe-montmagny',
    sourceId:  'post-abc123',
    deeplink:  'frereslumieres://post/post-abc123',
  },
  channelId: 'publications',        // Android : canal de notification
  priority:  'default' | 'max',     // max pour urgent
}
```

Le `deeplink` ouvre **directement le contenu concerné**, jamais l'écran
d'accueil. C'est la différence entre une notification utile et une
notification qu'on ignore.

Cette phrase a longtemps été fausse. Le serveur écrivait bien le lien, mais
l'application ne le lisait nulle part : un tap ouvrait l'écran d'accueil, et
rien ne le signalait — pas d'erreur, pas d'écran vide, juste le mauvais écran.
Les deux moitiés existent maintenant : `buildDeeplink` côté serveur,
`parseDeeplink` et `routeForDeeplink` côté application, et le layout racine
ouvre la route une fois le compte actif.

**Vrai pour les publications**, qui sont le seul déclencheur branché à ce jour.
Les quatre autres types de cible sont reconnus par l'analyse mais n'ont pas
encore d'écran ; ils sont déclarés comme tels, avec leur raison, dans
`TYPES_SANS_ROUTE` — et un test refuse un type qui ne serait ni ouvrable ni
excusé. Un lien dont le type n'a pas d'écran n'ouvre rien : l'application reste
où elle est, plutôt que d'aller sur un écran « introuvable ».

---

## 7. Envoi : où et comment

| Envoi               | Déclencheur                           | Fonction                                    | État    |
| ------------------- | ------------------------------------- | ------------------------------------------- | ------- |
| À la publication    | `onDocumentWritten('posts/{postId}')` | `onPostPublished`                           | fait    |
| Nouveau commentaire | `onDocumentCreated('comments/{id}')`  | `notifyCommentAuthor`                       | à faire |
| Réponse             | idem, avec `parentId`                 | `notifyCommentAuthor`                       | à faire |
| Nouveau message     | `onDocumentCreated('messages/{id}')`  | `notifyChannelAudience` (avec regroupement) | à faire |
| Nouveau sondage     | `onDocumentCreated('polls/{id}')`     | `notifyPollAudience`                        | à faire |
| Signalement         | `onDocumentUpdated('reports/{id}')`   | `notifyReportAuthor`                        | à faire |
| Rappel d'événement  | tâche planifiée horaire               | `sendEventReminders`                        | à faire |
| Manuel              | depuis l'admin                        | `sendManualNotification` (callable)         | à faire |

Chaque envoi écrit un document dans `notifications/{id}` avec les compteurs
`deliveredCount` et `failedCount`. L'administration dispose ainsi d'un
historique complet : qui a envoyé quoi, à qui, quand.

### Le chemin d'un envoi, tel qu'il est écrit

Le déclencheur ne décide de rien : il lit, appelle, et marque. La décision est
une fonction pure, testable sans émulateur.

```
posts/{postId} écrit
   │
   ├─ postNotificationPlan(postId, before, after)   → plan | null   (fonctions/src/notifications/post-plan.ts)
   │     aucune écriture si : pas de « after » · statut ≠ published ·
   │     déjà publié avant · notifiedAt déjà posé · champ requis manquant ·
   │     audience vide
   │
   ├─ selectRecipients(documents)                   → { recipients, rejected }   (…/recipients.ts)
   │     chaque rejet est nommé avec sa raison : une exclusion silencieuse est
   │     indiscernable d'un parent qui ne s'est jamais inscrit
   │
   ├─ sendToAudience({ message, journal })          → SendOutcome   (…/send.ts)
   │     requête par lots de 30 clés, dédoublonnage par identifiant de document,
   │     envoi, purge des jetons morts, journal
   │
   └─ update posts/{postId} : notifiedAt, stats.notifiedCount
```

Trois points de ce chemin sont des décisions, pas des détails :

- **`onDocumentWritten`, pas `onDocumentCreated`.** Une publication peut naître
  `published` ou le devenir plus tard ; les deux cas doivent notifier. Le rejeu
  est fermé par `notifiedAt`, écrit **après** l'envoi — marquer d'abord perdrait
  la notification si l'envoi échouait, et personne ne le verrait.
- **Dédoublonnage par identifiant de document.** `array-contains-any` plafonne
  à 30 valeurs, donc les clés d'un même appareil peuvent s'étaler sur deux
  lots. Sans dédoublonnage, cet appareil recevrait la notification deux fois.
- **Deux replis opposés, et c'est délibéré.** `audienceKeys` illisible → liste
  vide : un appareil qui ne reçoit rien plutôt qu'une notification qui dévoile
  son contenu sur l'écran verrouillé. `disabledCategories` illisible → rien de
  désactivé : une fermeture d'école manquée ne se rattrape pas.

### Gestion des erreurs

Le service Expo Push rend **deux** réponses distinctes, et les confondre fait
écrire des règles fausses :

- le **ticket**, renvoyé par `/push/send` : « j'ai accepté ton message ». C'est
  la seule réponse que ce code lit aujourd'hui ;
- le **reçu**, obtenu plus tard par `/push/getReceipts` : « je l'ai remis à FCM
  ou APNs, et voici ce qui s'est passé ». **Ce code ne le lit pas.**

| Erreur                | Réponse où elle apparaît | Action prévue                                                                                | État                                                             |
| --------------------- | ------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `DeviceNotRegistered` | ticket **et** reçu       | suppression du jeton                                                                         | fait, sur le ticket                                              |
| `MessageRateExceeded` | ticket                   | attente exponentielle, nouvel essai                                                          | fait — au niveau HTTP : trois tentatives sur `429`, puis abandon |
| Réponse incomplète    | ticket                   | les jetons sans ticket comptent en **échec**, jamais en livraison, et l'écart est journalisé | fait                                                             |
| `MessageTooBig`       | **reçu** seulement       | troncature et nouvel essai                                                                   | **sans objet** — voir ci-dessous                                 |
| `InvalidCredentials`  | HTTP `401`               | alerte immédiate : le jeton d'accès Expo est expiré                                          | **à faire** — un `401` est journalisé comme un échec ordinaire   |

**`MessageTooBig` est sans objet, et c'est mesuré.** La limite du service est de
**4096 octets** pour la charge utile totale d'un message. Au pire cas autorisé,
la charge utile réelle pèse **590 octets** : titre borné à 140 caractères par
les règles Firestore (`isNonEmptyString(d.title, 140)`), corps tronqué à 180 par
`extraitNotification`, `data` réduit à quatre champs bornés. La marge est donc
de l'ordre de sept fois, et elle est tenue par deux choses vérifiées séparément
— une règle et un test — plutôt que par une intention.

Le manque à retenir n'est donc pas la troncature, c'est le **reçu** : sans lui,
`deliveredCount` compte des messages **acceptés**, jamais des messages reçus. Un
appareil éteint depuis trois semaines compte comme livré. C'est écrit là où le
champ est défini (`PushResult`, dans `packages/shared/src/push/dispatcher.ts`),
et suivi dans la phase 5 du roadmap.

`InvalidCredentials` reste le manque le plus coûteux : un jeton d'accès Expo
expiré fait échouer **tous** les envois en silence, et rien ne le distingue d'un
incident réseau passager dans le journal.

L'abandon après trois tentatives est délibéré : une boucle de retrait infinie
est la façon la plus rapide d'épuiser le quota d'invocations, et le budget de
cette association ne le supporte pas.

---

## 8. Développement local

Les notifications ne fonctionnent **pas** sur émulateur :

- l'émulateur Firebase ne peut pas joindre Expo Push Service ;
- Android Emulator ne reçoit pas de vrai FCM sans Play Services configurés.

Stratégie :

1. en développement, `EXPO_PUBLIC_USE_FIREBASE_EMULATORS=true` désactive
   l'enregistrement des jetons et journalise les envois dans la console ;
2. un script `npm run push:preview` permet d'envoyer une notification de test
   vers un appareil réel depuis la machine de développement ;
3. les tests automatisés vérifient **le ciblage** (quels jetons sont
   sélectionnés), pas la livraison réelle — c'est la partie qu'on peut
   tester de manière fiable.

---

## 9. À valider

| #   | Question                                                                         | Proposition                                                            |
| --- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| N1  | Expo Notifications (Option A) ou `@react-native-firebase/messaging` (Option B) ? | **Option A**, pour la simplicité de maintenance                        |
| N2  | Interruption critique iOS pour les alertes urgentes ?                            | à décider en Phase 5 — nécessite une demande spécifique auprès d'Apple |
| N3  | Fenêtre de regroupement des messages de discussion                               | 5 minutes                                                              |
| N4  | Faut-il notifier les parents à la validation de leur compte ?                    | oui, c'est un bon moment pour les accueillir                           |
