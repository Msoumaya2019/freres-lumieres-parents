# 06 — Maîtrise des coûts Firebase

> Phase 1 · Document de référence

## 1. Le plan Blaze est obligatoire, et la région n'y change rien

**Le projet ne peut pas rester sur le plan Spark**, pour deux raisons
indépendantes, toutes deux citées de la documentation officielle :

1. **Cloud Functions.** « _You can emulate functions in any Firebase project, but
   to deploy functions, your project must be on the Blaze pricing plan._ » C'est
   une condition **au niveau du projet**, sans exception géographique. Or
   l'application ne tient pas sans elles : ce sont elles qui posent les
   `customClaims`, qui créent chaque compte en `pending`, qui envoient les
   notifications, qui tiennent les compteurs et qui purgent les jetons morts.
2. **Cloud Storage.** « _Cloud Storage for Firebase (even default buckets) now
   requires projects to be on the pay-as-you-go Blaze pricing plan._ » Et la date
   est passée : « _This requirement went into effect starting
   February 03, 2026._ »

**Changer de région ne dispense donc de rien.** La région n'intervient qu'à un
seul endroit : le palier _Always Free_ de Google Cloud Storage n'existe que pour
`US-CENTRAL1`, `US-EAST1` et `US-WEST1`. C'est un **quota**, pas une condition
d'accès — et il ne nous servirait à rien : nous n'utilisons pas Storage, et
héberger les données de familles françaises aux États-Unis serait un choix à
défendre devant le RGPD, pas une économie.

**Blaze n'est pas un abonnement** : c'est du paiement à l'usage, doublé d'un
quota gratuit. Sous ce quota, la facture est de **0 €**. Le vrai garde-fou n'est
pas budgétaire, il est dans le code : `functions/src/index.ts` pose
`setGlobalOptions({ region: 'europe-west1', maxInstances: 10, concurrency: 40 })`
— une fonction ne peut donc pas s'emballer à l'infini, même en cas d'abus.

### Le quota, en ordre de grandeur

| Service                  | Quota gratuit                  | Consommation estimée du projet |
| ------------------------ | ------------------------------ | ------------------------------ |
| Firestore — lectures     | 50 000 / jour                  | ~20 400 / jour (**41 %**)      |
| Firestore — écritures    | 20 000 / jour                  | ~150 / jour                    |
| Firestore — suppressions | 20 000 / jour                  | négligeable                    |
| Functions                | 2 M d'invocations / mois       | ~55 000 / mois                 |
| Storage                  | **aucun palier en Europe**     | non utilisé aujourd'hui        |
| Auth                     | illimité (e-mail/mot de passe) | —                              |
| Hébergement (admin)      | 10 Go/mois                     | négligeable                    |

Deux chiffres de ce tableau méritent un mot, parce qu'ils ont été faux :

- **La ligne Storage.** Le « 5 Go stockés, 1 Go/jour » est le palier des anciens
  buckets `*.appspot.com`. Un bucket `*.firebasestorage.app` créé après septembre
  2024 suit la tarification Google Cloud Storage, dont le palier _Always Free_ ne
  couvre **que** trois régions américaines. En `europe-west1`, **tout octet est
  facturé** — c'est le seul poste où notre région coûte quelque chose, et il ne
  pèse rien tant que les pièces jointes (phase 6) ne sont pas livrées.
- **La ligne Firestore — lectures.** Elle annonçait « ~2 000 / jour », soit 4 %
  du quota, alors que l'estimation détaillée de la section 3 conclut à
  **20 400 / jour**, soit 41 %. Les deux ne pouvaient pas être vrais. C'est le
  chiffre détaillé qui reste, parce qu'il est décomposé action par action.

**Conclusion : le projet doit rester sous le quota gratuit, dans le plan Blaze.**
Avec 300 familles et un usage normal, on est à environ 41 % des quotas de lecture
dans le scénario pessimiste — celui où chaque parent ouvre l'application trois
fois par jour. Les décisions ci-dessous visent à garantir que cela reste vrai même
en cas de pic d'activité, et surtout à éviter les erreurs de conception qui
feraient exploser la facture.

La tâche planifiée qui relit les reçus Expo tourne **une fois par heure**, soit
720 invocations par mois, presque toujours à vide : la requête ne ramène que les
envois dont les reçus sont mûrs. Un passage toutes les cinq minutes aurait
coûté douze fois plus pour le même résultat — les reçus restent lisibles
vingt-quatre heures.

La tâche qui annonce les lots de discussion tourne **toutes les cinq minutes**,
soit 43 200 invocations par mois, et c'est l'arbitrage **inverse** — délibérément.
Ici la cadence n'est pas un confort : la fenêtre de regroupement est de cinq
minutes, donc un lot ne peut pas être annoncé avant, et un passage plus espacé
retarderait la notification d'autant. Elle aussi tourne presque toujours à vide,
la requête ne ramenant que les lots échus — un groupe scolaire dont les canaux
sont calmes n'en produit aucun.

**La leçon n'est donc pas « cinq minutes coûtent cher », mais « cinq minutes
doivent acheter quelque chose ».** Pour les reçus, elles n'achetaient rien : le
résultat est identique à quelques minutes près, sur une information qui reste
lisible vingt-quatre heures. Pour un lot, elles achètent le délai lui-même, et
c'est la seule cadence qui corresponde à la promesse faite au parent.

---

## 2. Les cinq pièges qui coûtent cher

### Piège 1 — Écouter une collection entière en temps réel

```ts
// ❌ 300 documents lus à chaque ouverture, puis à chaque modification
onSnapshot(collection(db, 'posts'), (snap) => setPosts(snap.docs.map(...)));
```

Un listener Firestore facture **la lecture initiale puis chaque changement**.
Sur une collection qui grossit, c'est la principale cause de factures
inattendues.

**Règle du projet : un seul listener temps réel autorisé**, celui des messages
du canal de discussion actuellement ouvert (limité à 30 messages). Partout
ailleurs, on utilise `getDocs` avec pagination.

```ts
// ✅ 10 lectures, puis 10 de plus au scroll
const q = query(
  collection(db, 'posts'),
  where('audienceKeys', 'array-contains-any', userKeys),
  orderBy('publishedAt', 'desc'),
  limit(10),
);
```

### Piège 2 — Lire des documents pour afficher un compteur

Afficher « 37 parents concernés » en lisant 37 documents coûte 37 lectures.

**Solution :** les compteurs sont dénormalisés et maintenus par Cloud
Functions. Un document `collectiveIssues/{id}` contient `supportersCount`, lu
une seule fois.

### Piège 3 — Télécharger une image à chaque affichage

**Solution :** `expo-image` avec cache disque persistant, et génération des
URL de téléchargement à la demande avec mise en cache mémoire (une URL signée
est valide une heure — inutile d'en générer une à chaque rendu).

### Piège 4 — Le tableau de bord de l'administration

Afficher « 312 parents actifs » nécessite normalement une requête
d'agrégation — facturée par millier d'index lus.

**Solution :** `counters/{orgId}` et `highlights/{orgId}`, maintenus par Cloud
Functions. Le tableau de bord coûte **2 lectures**.

### Piège 5 — Les images non compressées

Une photo de téléphone pèse 4 à 8 Mo. 300 photos par an = 1,5 Go de Storage
et autant de transfert.

**Solution :** compression côté client avant upload — redimensionnement à
1600 px, qualité 0,8 → environ 250 Ko. **Divisé par 20.**

---

## 3. Les décisions du modèle qui économisent des lectures

| Décision                                        | Économie                                                     |
| ----------------------------------------------- | ------------------------------------------------------------ |
| `audienceKeys` + `array-contains-any`           | 1 requête au lieu de 5, et une pagination correcte           |
| `channels.stats` (aperçu du dernier message)    | 13 lectures par ouverture de l'écran Discussions             |
| `users.levels` et `users.classIds` dénormalisés | 1 lecture par utilisateur ciblé                              |
| `deviceTokens.audienceKeys`                     | évite de lire les profils pour cibler un envoi               |
| `posts.authorName` recopié                      | 1 lecture par publication affichée                           |
| `posts.stats.commentCount`                      | évite de compter les commentaires                            |
| Commentaires : `reactions` (map emoji → nombre) | évite de lire la sous-collection à chaque affichage          |
| `counters/{orgId}`                              | évite les requêtes d'agrégation                              |
| `highlights/{orgId}`                            | 1 lecture au lieu de 3 (prochain événement, dernier sondage) |
| `pollResults` séparé de `polls`                 | un sondage écouté n'est plus réécrit à chaque vote           |
| `reports.timeline[]` intégré                    | évite une sous-collection d'historique                       |
| Commentaires et messages en sous-collections    | pagination naturelle, pas de requête globale                 |

**Coût des déclencheurs de compteurs.** Chacun lit le document parent avant
d'écrire, pour ne pas créer de document fantôme si le parent a été supprimé
entre-temps. Un commentaire coûte donc, côté serveur, une lecture et une
écriture de plus que le commentaire lui-même. À l'échelle visée (quelques
commentaires par jour) c'est négligeable, et la contrepartie est une garantie
d'intégrité. Un recomptage à la place de l'incrément coûterait, lui, une
lecture **par réaction affichée et par réaction posée** — c'est précisément ce
que le décompte dénormalisé évite.

**Coût d'une règle qui lit son parent.** Créer un commentaire déclenche une
lecture supplémentaire : `parentAcceptsComments()` interroge la publication
parente avec `get()` pour vérifier qu'elle est publiée et ouverte aux
commentaires. Sans cette lecture, fermer les commentaires ne serait qu'une
convention d'affichage — un client hostile écrirait sans passer par
l'application. Une lecture par commentaire écrit est le prix de cette
garantie, et les commentaires sont rares.

**Coût d'un vote.** Un vote coûte plus que le document qu'il écrit.

- l'écriture du vote : une écriture ;
- la règle d'écriture, qui interroge le sondage parent pour vérifier qu'il est
  ouvert, dans la bonne organisation, et que le choix est permis — une lecture
  de règle, `exists()` et `get()` sur le même chemin étant mis en cache
  ensemble. Sans elle, un identifiant de sondage suffirait à voter sur un
  brouillon, sur un sondage clos, ou dans le groupe scolaire voisin ;
- `onPollVoteWritten` : une transaction qui lit **deux** documents — le sondage,
  qui fait autorité sur la liste des options, et `pollResults`, qui porte les
  comptes — et en écrit un. Soit deux lectures et une écriture.

**Coût d'une lecture de résultats.** Une lecture, plus celles de la règle : le
sondage, pour son statut et sa visibilité, et en `after_vote` l'existence du vote
de l'appelant. Une règle de lecture ne peut pas filtrer des champs : la
visibilité se paie donc en lectures de règle. C'est le prix de la garantie, et il
n'est payé que par qui a le droit de demander.

Le tout est modeste — un parent vote une fois par sondage, et ne relit les
résultats qu'une poignée de fois. Le point qui a **changé** est ailleurs, et
c'est une bonne nouvelle : le document de sondage n'est plus réécrit à chaque
vote. Il n'était pas seulement coûteux : tout déclencheur posé sur
`polls/{pollId}` aurait été invoqué une fois par votant. C'est `pollResults` qui
est désormais chaud, et personne ne l'écoute.

**Coût d'un commentaire écrit depuis l'application.** Le client recharge la
publication et la première page de commentaires après une écriture réussie
(une vingtaine de lectures). C'est ce qui permet d'afficher un décompte exact :
`stats.commentCount` est écrit par une Cloud Function **après** la création,
donc le client ne peut pas l'incrémenter lui-même sans mentir. Une insertion
locale aurait affiché un compteur faux pendant quelques secondes.

### Estimation chiffrée

Hypothèses : 300 parents, 3 ouvertures par jour et par parent, 2 publications
par semaine, 40 messages par jour.

| Action                                    | Lectures | Fréquence  | Lectures/jour      |
| ----------------------------------------- | -------- | ---------- | ------------------ |
| Ouverture de l'app (fil, 10 publications) | 12       | 900 / jour | 10 800             |
| Écran Discussions (13 canaux)             | 14       | 300 / jour | 4 200              |
| Ouverture d'un canal (30 messages)        | 30       | 150 / jour | 4 500              |
| Profil                                    | 3        | 300 / jour | 900                |
| **Total estimé**                          |          |            | **~20 400 / jour** |

**41 % du quota gratuit.** Et ce scénario est pessimiste : il suppose que
chaque parent ouvre l'application trois fois par jour.

### Optimisations complémentaires prévues

- **Cache local des listes** : le fil d'actualité est conservé en mémoire et
  en `AsyncStorage`, avec une durée de validité de 5 minutes. Une réouverture
  dans cet intervalle ne coûte **aucune lecture**.
- **Pagination par 10** sur le fil, 20 sur les commentaires, 30 sur les
  messages. Aucune page n'est chargée avant d'être visible.
- **`getDocs` plutôt que `onSnapshot`** partout sauf la messagerie active.
- **Images en `expo-image`** avec `cachePolicy="memory-disk"`.
- **Documents PDF non préchargés** : téléchargement à la demande explicite.

---

## 4. Ce qui pourrait faire déraper la facture

| Risque                                                    | Signal                     | Mesure préventive                                                                        |
| --------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------- |
| Un listener oublié sur `posts`                            | lectures × 50              | revue de code : tout `onSnapshot` doit être justifié en commentaire                      |
| Un écran d'administration qui liste tous les utilisateurs | 300 lectures par ouverture | pagination obligatoire (25 par page)                                                     |
| Une Cloud Function déclenchée en cascade                  | invocations × 10           | pas de Function qui écrit dans une collection écoutée par une autre Function             |
| Les jetons morts qui s'accumulent                         | envois inutiles            | purge sur le ticket à l'envoi, sur le reçu à la relecture ; 180 jours en dernier recours |
| Une boucle d'erreur qui retente indéfiniment              | invocations × 100          | attente exponentielle plafonnée à 3 tentatives                                           |

### Budget d'alerte — qui avertit, mais ne plafonne rien

À configurer dans Google Cloud Console (facturation) :

- **Alerte à 50 %** du budget : information.
- **Alerte à 80 %** : à investiguer.
- **Alerte à 100 %** : à traiter le jour même.

> **Une alerte budgétaire n'arrête pas la dépense.** Ce paragraphe annonçait un
> « budget mensuel plafonné à 5 € » et un « garde-fou absolu » : c'était faux.
> Google Cloud n'interrompt rien à l'atteinte d'un budget — il envoie un e-mail.
> Un plafond réel demanderait de brancher le budget sur un sujet Pub/Sub et une
> fonction qui coupe la facturation, c'est-à-dire une chaîne de plus à maintenir.
>
> Les vrais plafonds sont donc ailleurs, et ils sont **déjà en place** :
> `maxInstances: 10` et `concurrency: 40` dans `functions/src/index.ts`, et les
> quotas du plan Blaze, qui se traduisent en refus (`429`) plutôt qu'en facture.
> Une alerte reste utile — mais elle informe, elle ne protège pas.

---

## 5. Coût des builds et des services annexes

| Poste                               | Coût                                                |
| ----------------------------------- | --------------------------------------------------- |
| EAS Build — plan gratuit            | 30 builds/mois, file d'attente standard. Suffisant. |
| EAS Build — builds iOS              | inclus dans le quota                                |
| Firebase Hosting (admin)            | gratuit jusqu'à 10 Go/mois                          |
| App Store (Apple Developer Program) | 99 €/an — **obligatoire pour publier sur iOS**      |
| Google Play                         | 25 $ une fois                                       |
| Domaine personnalisé                | ~12 €/an                                            |
| **Total annuel récurrent**          | **~136 €/an**, essentiellement les frais Apple      |

Ce point mérite d'être dit clairement : **la publication sur l'App Store est
le seul coût incompressible du projet.** Il n'existe pas de moyen légal de
publier une application iOS sans le programme développeur Apple.

---

## 6. Pourquoi pas Supabase ?

La question se pose, puisque Supabase annonce un plan gratuit. Elle mérite des
chiffres plutôt qu'une préférence.

|                            | Firebase, plan Blaze, notre usage | Supabase Free           | Supabase Pro       |
| -------------------------- | --------------------------------- | ----------------------- | ------------------ |
| Coût mensuel               | **0 €** sous le quota             | 0 €                     | **dès 25 $/mois**  |
| Mise en veille             | jamais                            | **pause après 7 jours** | jamais             |
| Sauvegardes                | automatiques, 7 jours             | **aucune**              | 7 jours            |
| Base de données            | 1 Gio, 50 k lectures/jour         | 500 Mo                  | 8 Go               |
| Plafond de dépense         | quotas + `maxInstances`           | —                       | plafond par défaut |
| Utilisateurs actifs inclus | illimité en e-mail/mot de passe   | 50 000                  | 100 000            |

Deux arguments, dans cet ordre.

**1. Le plan gratuit Supabase ne convient pas à cette application.** Un projet
gratuit est **mis en pause automatiquement après sept jours de faible activité**
— c'est la documentation Supabase elle-même, « Project Pausing » — et la reprise
est **manuelle** : il faut ouvrir le tableau de bord et cliquer « Resume
project ». Pour une association de parents, dont l'usage se fait par pics —
intense en septembre, quasi nul pendant les vacances d'été — c'est un mode de
panne particulièrement vicieux : l'application fonctionnait, puis elle ne
fonctionne plus, et le rétablissement demande un accès à un tableau de bord que
personne n'a sous la main un 15 août. S'y ajoute que le plan gratuit ne comprend
**aucune sauvegarde**, ni automatique ni à un instant précis.

Le palier qui tiendrait ces promesses est **Pro, à partir de 25 $/mois**, soit
environ **276 $/an** — à comparer aux **0 €** de Firebase à notre volume. Le plan
gratuit Supabase n'est donc pas une alternative moins chère : c'est une
alternative moins chère **qui ne tient pas ses promesses**, et la version qui les
tient coûte plus cher que ce que nous avons déjà.

**2. La migration coûterait le délai, pas l'argent.** Tout ce projet repose sur
Firestore : les règles de sécurité et le banc qui les éprouve, les déclencheurs
de `functions/`, la couche d'accès de `packages/firebase`, les sous-collections
de commentaires et de messages, la piste d'audit, les liens profonds, et la suite
de tests qui couvre l'ensemble. Passer à Supabase signifie réécrire ce socle en
SQL, en politiques RLS et en fonctions _edge_ — c'est-à-dire précisément la partie
qui est aujourd'hui **mesurée et prouvée**. Ce n'est pas un changement de
fournisseur, c'est une réécriture, et elle arriverait au pire moment.

**Conclusion : rester sur Firebase.** Non par attachement, mais parce que le plan
Blaze coûte 0 € à notre volume, que le garde-fou de dépense est déjà dans le code,
et que l'alternative gratuite s'arrête toute seule.
