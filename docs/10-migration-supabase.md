# 10 — Migration vers Supabase

> Décision prise · Document de travail

## 1. La décision, et ce qu'elle règle

Le backend passe de Firebase à **Supabase** (Postgres, Auth, RLS, Realtime,
Storage), et les **notifications push** restent chez **FCM**.

Ce n'est pas un compromis : **c'est la seule combinaison qui évite le plan
Blaze.** Le plan Blaze n'était exigé que par deux services — Cloud Functions et
Cloud Storage. En déplaçant la logique serveur vers Postgres et les fichiers vers
Supabase Storage, il ne reste à Firebase que **FCM**, qui est gratuit sur _les
deux_ plans. La question de départ — « comment ne pas payer ? » — reçoit donc une
réponse, et c'est celle-ci.

Coût cible : **0 €/mois**.

### Les deux réserves, énoncées une fois

Elles ne sont pas rédhibitoires, mais elles doivent être connues :

1. **Le plan gratuit Supabase met un projet en pause après sept jours de faible
   activité**, et la reprise est **manuelle** (tableau de bord → « Resume
   project »). Pour une association dont l'usage se fait par pics — septembre
   intense, été quasi nul — c'est une panne qui peut tomber au pire moment.
   L'atténuation : un projet actif au quotidien ne se met pas en pause, et le
   passage à Pro (25 $/mois) reste possible plus tard, sans migration.
2. **Aucune sauvegarde sur le plan gratuit.** Le plan Pro en donne sept jours.
   D'ici là, la seule protection est une exportation manuelle — à scripter, et à
   ranger hors du dépôt.

---

## 2. Ce qu'il y a à transposer, mesuré

| Élément                    | Volume                                                          |
| -------------------------- | --------------------------------------------------------------- |
| Cloud Functions exportées  | **32**                                                          |
| Règles de sécurité         | **1 501** lignes de `firestore.rules`, plus le banc             |
| Couche d'accès             | **17** fichiers dans `packages/firebase`                        |
| Modèle partagé             | **31** fichiers dans `packages/shared` (à conserver)            |
| Tests                      | **50** fichiers de test                                         |
| Fichiers touchant Firebase | **68**, hors tests                                              |
| Variables d'environnement  | **9** `EXPO_PUBLIC_FIREBASE_*` → **2** `EXPO_PUBLIC_SUPABASE_*` |

**Ce qui ne change pas :** `packages/types`, `packages/shared` (les schémas zod
restent la source de vérité), les écrans, la navigation, les liens profonds,
l'administration. La migration touche le socle, pas l'interface.

**Bonne nouvelle sur les 32 fonctions :** la grande majorité ne fait que tenir un
compteur ou un aperçu — ce sont des déclencheurs de ligne en SQL. Elles cessent
d'être des fonctions déployées pour devenir du SQL transactionnel : moins cher,
plus rapide, sans démarrage à froid, et sans facturation à l'invocation. Il ne
reste comme fonctions _edge_ que ce qui doit parler au monde extérieur.

---

## 3. Contraintes de la machine, vérifiées

| Outil        | État                 | Conséquence                                         |
| ------------ | -------------------- | --------------------------------------------------- |
| Docker       | **absent**           | pas de pile Supabase locale (`supabase start`)      |
| `psql`       | **absent**           | les tests ne passeront pas par la ligne de commande |
| Supabase CLI | **2.117.0**, présent | migrations et liaison au projet distant possibles   |

**Comment on teste sans Docker.** C'est le point qui décide de la viabilité du
projet, puisque la discipline de ce dépôt est de tout vérifier avant de pousser.
La réponse tient en deux couches.

**Couche 1 — en local, sur un Postgres compilé en WebAssembly.**
`@electric-sql/pglite` est un Postgres complet qui tourne dans Node : rôles,
`GRANT`, `ENABLE ROW LEVEL SECURITY`, politiques, transactions. Aucune
installation système, aucun service. Le jeton se simule par une variable de
session :

```sql
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"…","org_id":"…","app_role":"admin"}';
  -- assertions
rollback;
```

Trois conséquences, toutes mesurées :

- **Aucun serveur d'authentification n'est nécessaire** pour éprouver une
  politique : `request.jwt.claims` est une variable de session que l'on pose
  soi-même. Les tests restent donc rapides et déterministes.
- **Rien n'est écrit durablement** : la transaction est annulée, donc un seul
  projet suffit pour production _et_ tests.
- **La sonde est concluante** : 10 cas sur 10, y compris le refus quand la
  revendication manque et quand elle est nulle.

**Couche 2 — contre le projet distant, avant de s'y fier.** PGlite ne fournit ni
`auth.users`, ni les droits par défaut de Supabase, ni les extensions `pg_net` et
`pg_cron`, et Realtime n'est pas du SQL. Il prouve la **logique** des politiques ;
il ne dispense pas d'un essai réel. La méthode complète et les pièges sont dans
la skill `eprouver-des-politiques-rls-supabase-sans-docker`.

**Un piège mesuré, à retenir avant d'écrire la première politique.**
`current_setting('request.jwt.claims', true)` rend une **chaîne vide**, pas
`NULL`, quand la revendication est absente — et `''::jsonb` **lève** au lieu de
rendre `NULL`. Une politique écrite naïvement ne refuse donc pas : elle **casse
la requête**. C'est la raison pour laquelle le `auth.jwt()` de Supabase s'enveloppe
lui-même d'un `nullif(…, '')`. La fonction du projet doit porter **deux** gardes :

```sql
select nullif(
  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'org_id',
  ''
)::uuid
```

`psql` reste absent, mais il n'est plus nécessaire : le pilote `pg` de Node, et
PGlite pour la couche locale, couvrent le besoin.

---

## 4. Architecture cible

### 4.1 Table par table

Les sous-collections Firestore deviennent des tables avec clé étrangère.

| Firestore                          | Postgres                                        |
| ---------------------------------- | ----------------------------------------------- |
| `organizations/{id}`               | `organizations`                                 |
| `schools/{id}`, `classes/{id}`     | `schools`, `classes`                            |
| `users/{uid}`                      | `users` (id = `auth.users.id`)                  |
| `users/{uid}/children/{id}`        | `children`                                      |
| `users/{uid}/tokens/{id}`          | fusionné dans `device_tokens`                   |
| `deviceTokens/{token}`             | `device_tokens` (une seule table)               |
| `pushTickets/{id}`                 | `push_tickets`                                  |
| `posts/{id}`                       | `posts`                                         |
| `posts/{id}/comments/{id}`         | `comments`                                      |
| `comments/{id}/reactions/{uid}`    | `reactions` — PK `(comment_id, user_id)`        |
| `channels/{id}`, `messages/{id}`   | `channels`, `messages`                          |
| `channelDigests/{channelId}`       | `channel_digests`                               |
| `polls/{id}`, `votes/{voterKey}`   | `polls`, `poll_votes` — PK `(poll_id, user_id)` |
| `reports/{id}/replies/{id}`        | `reports`, `report_replies`                     |
| `collectiveIssues/{id}/supporters` | `collective_issues`, `issue_supporters`         |
| `events/{id}/participants/{uid}`   | `events`, `event_participants`                  |
| `documents/{id}`                   | `documents`                                     |
| `schoolCouncils/{id}/items/{id}`   | `school_councils`, `council_items`              |
| `notifications/{id}`               | `notifications`                                 |
| `moderationReports/{id}`           | `moderation_reports`                            |
| `adminLogs/{id}`                   | `admin_logs`                                    |
| `fcpeTasks/{id}`                   | `fcpe_tasks`                                    |
| `counters/{orgId}`                 | `counters`                                      |
| `highlights/{orgId}`               | `highlights`                                    |

### 4.2 Six décisions de conception

**1. `snake_case` en base, `camelCase` en TypeScript.** Le passage se fait dans la
couche d'accès, en un seul endroit. C'est le choix durable : des identifiants
camelCase en SQL obligeraient à les citer partout, et un oubli de guillemet ne
produit pas une erreur mais un repli silencieux en minuscules.

**2. La clé primaire composite remplace la garantie Firestore.** Un double vote
était impossible parce que l'identifiant du document était l'UID. En Postgres,
c'est la clé primaire `(poll_id, user_id)` qui le rend impossible — même garantie,
mieux placée.

**3. Les revendications passent par un _hook_ de jeton.** Firebase portait `role`,
`status` et `orgId` dans les _custom claims_. L'équivalent Supabase est le
**Custom Access Token Hook** : une fonction Postgres qui lit `users` et injecte
les trois valeurs dans le JWT à l'émission. Repli **fermé** — une revendication
absente vaut le rôle le plus bas, jamais le plus haut.

**4. Les privilèges par colonne remplacent `unchanged()`.** Firestore obligeait à
écrire `unchangedOptional()` pour empêcher un client de réécrire un champ que le
serveur lit. En Postgres, `grant update (enabled) on device_tokens to
authenticated` dit exactement la même chose — **en une ligne, et sans exception à
gérer**. C'est un gain réel : la règle la plus fragile du projet disparaît.

**5. La frontière d'organisation reste une fonction unique.** `auth_org_id()`
remplace `orgId()`, et chaque table lisible porte `org_id = auth_org_id()`. Le
contrôle `rules-coverage.test.ts` devient `rls-coverage.test.ts` : **toute table
de `public` doit avoir RLS activée et au moins une politique**, sinon le test
échoue. Le principe ne change pas — une table sans politique n'est pas
« ouverte », elle est **fermée** par défaut, et c'est le test qui garantit qu'on
ne l'a pas oubliée.

**6. Le temps réel est déjà limité à un seul écouteur.** Le projet n'autorise
qu'un `onSnapshot`, celui du canal ouvert. Supabase Realtime remplace cela
directement, et Realtime **respecte les politiques RLS** : la garantie suit.

### 4.3 Les notifications

`expo-notifications` fournit le jeton natif (`getDevicePushTokenAsync()`) : APNs
sur iOS, FCM sur Android. Il est rangé dans `device_tokens` avec sa plateforme.

Une fonction _edge_ `send-push` dispatche :

- **iOS → APNs** en HTTP/2, signé par une clé `.p8` (ES256). Pas de SDK Firebase
  dans l'application.
- **Android → FCM HTTP v1**, avec un compte de service.

Deux points à savoir :

- **Les notifications iOS exigent un compte Apple développeur payant.** La
  capacité _Push Notifications_ n'existe pas sur un compte gratuit. L'application
  s'installera sans ; c'est la notification qui manquera. Ce n'est donc pas un
  bloqueur pour l'IPA.
- **Android demande `google-services.json`**, qui est déjà ignoré par le dépôt.

### 4.4 Ce qui devient _edge function_

Seulement ce qui doit sortir de la base :

| Fonction                   | Rôle                                      |
| -------------------------- | ----------------------------------------- |
| `send-push`                | APNs et FCM                               |
| `admin-users`              | création, suppression, changement de rôle |
| `send-manual-notification` | annonce manuelle, avec audience           |
| `purge-dead-tokens`        | appelée par `pg_cron`                     |

Tout le reste — compteurs, aperçus, statistiques, lots de discussion, transitions
de statut — devient du **SQL déclenché**.

---

## 5. Les phases

Chaque phase se termine par quelque chose de **vérifiable**, et le dépôt reste
vert à la fin de chacune.

| #   | Phase              | Contenu                                                                | Preuve de fin                                   |
| --- | ------------------ | ---------------------------------------------------------------------- | ----------------------------------------------- |
| 0   | **Vous**           | créer le projet Supabase (voir § 6)                                    | URL, clés et chaîne de connexion en main        |
| 0b  | **Vous + moi**     | répétition de la chaîne d'installation (§ 7)                           | un IPA s'installe sur l'iPhone                  |
| 1   | Le schéma ✅       | `supabase/migrations/*.sql` : tables, types, index, index uniques      | la migration s'applique, les tables existent    |
| 2   | Les politiques     | RLS sur chaque table, `auth_org_id()`, le _hook_ de jeton              | `rls-coverage` vert, et chaque refus éprouvé    |
| 3   | La couche d'accès  | `packages/supabase` avec **les mêmes interfaces** de dépôt             | les tests de dépôt passent contre la vraie base |
| 4   | La logique serveur | déclencheurs SQL, `pg_cron`, les quatre fonctions _edge_               | chaque déclencheur a son test                   |
| 5   | Les applications   | mobile (auth, données, temps réel) et administration (`@supabase/ssr`) | l'application tourne contre Supabase            |
| 6   | Les scripts        | `seed-reference-data`, `bootstrap-admin` en Node + `pg`                | base amorcée, premier administrateur créé       |
| 7   | **L'IPA**          | nouvelles variables, compilation, installation                         | l'application installée et fonctionnelle        |

**L'ordre n'est pas négociable sur un point :** la phase 2 vient avant la 3. Une
couche d'accès écrite avant les politiques ferait passer des tests sur une base
ouverte, et l'on ne saurait plus, ensuite, si un refus vient de la politique ou
du client.

### 5.1 La phase 1 est faite — et son contrôle

`supabase/migrations/0001_socle.sql` pose les six tables du socle : `organizations`,
`schools`, `classes`, `users`, `children`, `device_tokens`, avec leurs types
énumérés, leurs index et leurs contraintes d'unicité. Aucune politique, par
construction.

Le contrôle est `npm run schema:check`, et il tourne dans `ci.yml` à côté de
`workflows:check`. Il fait deux choses :

1. **il applique les migrations**, sur un Postgres en WebAssembly, sans Docker ni
   projet distant — et nomme le fichier fautif si l'une échoue ;
2. **il compare chaque énumération Postgres à son homologue TypeScript.**

Le second est celui qui compte. `packages/types/src/enums.ts` et le SQL
s'ignorent : ajouter une valeur d'un côté sans l'autre produit du code qui
**compile** et une écriture **refusée à l'exécution**. Aucun compilateur ne peut
voir cette couture, parce que les deux sources ne se lisent pas.

**Il a été falsifié avant d'être cru** : ajouter `tresorier` à `user_role` seul
donne « en trop en base : tresorier » et le code 1 ; retirer un point-virgule
donne « `0001_socle.sql` ne s'applique pas : syntax error at or near "create" ».
La restauration a été vérifiée par empreinte SHA-256, identique à l'octet près.

---

## 6. Ce que vous devez faire (phase 0)

1. **Créer un compte** sur <https://supabase.com> — l'inscription peut se faire
   avec GitHub, ce qui évite un mot de passe de plus.
2. **Créer une organisation**, puis un **projet**. Nom libre ; **région :
   `eu-west-3` (Paris)** — les données de familles françaises restent en France,
   et c'est plus proche que Francfort.
3. **Mot de passe de la base** : générez-en un solide et **conservez-le**. Il
   n'est affiché qu'une fois, et il sert à la chaîne de connexion.
4. **Relever quatre valeurs** dans _Project Settings_ :

| Où                              | Quoi                    | Pour qui                       |
| ------------------------------- | ----------------------- | ------------------------------ |
| _Data API_ → Project URL        | `https://….supabase.co` | application (publique)         |
| _Data API_ → `anon` public key  | la clé publique         | application (publique)         |
| _Data API_ → `service_role` key | la clé serveur          | scripts et fonctions (secrète) |
| _Database_ → Connection string  | `postgresql://…`        | tests et migrations (secrète)  |

> **`anon` est publique par nature**, comme l'était la configuration Firebase :
> elle finit dans le binaire. **`service_role` contourne toutes les politiques
> RLS** — elle ne doit jamais entrer dans le dépôt ni dans l'application. C'est
> l'équivalent exact de la clé de compte de service Firebase.

5. **Ne pas activer le fournisseur e-mail « confirmation »** pour l'instant : il
   ralentit les essais. À remettre en place avant l'ouverture aux familles.

---

## 7. La répétition de la chaîne d'installation (phase 0b)

L'installation sur l'iPhone ne dépend **pas** du backend. La valider tôt évite de
découvrir trois problèmes à la fois le jour de la livraison.

La méthode la moins chère : compiler un IPA **depuis le code actuel**, avec un
**projet Firebase jetable sur le plan Spark** — Auth et Firestore sont gratuits
et n'exigent aucun paiement. Cet IPA ne servira à rien fonctionnellement : il sert
à prouver que Sideloadly signe, que l'iPhone accepte, et que le mode développeur
s'active. Il sera jeté ensuite.

Si cette répétition vous semble une perte de temps, elle est facultative — mais
c'est la seule étape dont l'échec ne se répare pas par du code.

---

## 8. Ce qui ne se transpose pas tel quel

Il faut le dire avant, pas après.

- **Les 1 501 lignes de règles ne deviennent pas 1 501 lignes de politiques.**
  Beaucoup d'entre elles disparaissent, remplacées par un privilège de colonne ou
  par une clé étrangère. D'autres doivent être **repensées** : Firestore ne sait
  pas joindre deux collections dans une règle, Postgres le fait en une
  sous-requête. Le compte sera différent, dans les deux sens.
- **Le banc de règles Firestore et `FauxFirestore` disparaissent.** Ils sont
  remplacés par le banc RLS décrit au § 3. Les tests qui s'appuyaient sur
  `FauxFirestore` pour éprouver un **comportement de dépôt** deviennent des tests
  contre la vraie base, en transaction annulée.
- **Les émulateurs Firebase disparaissent**, et avec eux le mode de développement
  hors ligne. Le développement se fera contre le projet distant.
- **Les 180 jours de purge, l'audit et le regroupement** ne sont pas concernés :
  ce sont des règles métier, elles se transposent telles quelles.

---

## 9. Ce qui reste ouvert

Trois décisions que je ne prends pas seul :

1. **Le nom du paquet.** `packages/firebase` devient `packages/supabase`, ou
   `packages/data` — le second nom vieillira mieux si un troisième fournisseur
   apparaît un jour.
2. **Le sort de `packages/firebase`.** Supprimé à la fin de la phase 5, ou
   conservé quelque temps pour revenir en arrière ? Le conserver a un coût :
   deux socles à tenir verts.
3. **La réserve de sauvegarde.** Accepter l'absence de sauvegarde sur le plan
   gratuit, ou scripter une exportation hebdomadaire vers un fichier local dès la
   phase 1 ? Je recommande la seconde, et je peux l'écrire en une demi-heure.

---

## Voir aussi

- `docs/02-data-model.md` — le modèle actuel, dont la transposition découle.
- `docs/04-security.md` — les principes de sécurité, qui ne changent pas.
- `docs/06-couts.md` § 6 — pourquoi Supabase seul ne suffisait pas.
- `docs/09-mise-en-service.md` — le pas-à-pas Firebase, qui devient l'annexe de
  la phase 0b.
