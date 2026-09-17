# 06 — Maîtrise des coûts Firebase

> Phase 1 · Document de référence

## 1. Le plan gratuit, en ordre de grandeur

| Service                  | Quota gratuit quotidien           | Consommation estimée du projet |
| ------------------------ | --------------------------------- | ------------------------------ |
| Firestore — lectures     | 50 000 / jour                     | ~2 000 / jour                  |
| Firestore — écritures    | 20 000 / jour                     | ~150 / jour                    |
| Firestore — suppressions | 20 000 / jour                     | négligeable                    |
| Storage                  | 5 Go stockés, 1 Go/jour transféré | < 200 Mo                       |
| Functions                | 2 M d'invocations / mois          | ~55 000 / mois                 |
| Auth                     | illimité (e-mail/mot de passe)    | —                              |
| Hébergement (admin)      | 10 Go/mois                        | négligeable                    |

**Conclusion : le projet doit rester dans le plan gratuit.** Avec 300 familles
et un usage normal, on est à environ 4 % des quotas de lecture. Les décisions
ci-dessous visent à garantir que cela reste vrai même en cas de pic
d'activité — et surtout à éviter les erreurs de conception qui feraient
exploser la facture.

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

### Budget d'alerte

À configurer dans Google Cloud Console (facturation) :

- **Alerte à 50 %** du quota : information.
- **Alerte à 80 %** : à investiguer.
- **Budget mensuel plafonné à 5 €** : garde-fou absolu, avec alerte par
  e-mail. Le projet ne doit jamais dépasser ce montant.

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
