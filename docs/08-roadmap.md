# 08 — Feuille de route par phases

> Phase 1 · Document de référence

## Règles de travail, valables à chaque phase

1. **Le projet compile** avant de passer à la suite. Jamais de phase laissée
   en état intermédiaire cassé.
2. **Les fonctionnalités existantes continuent de fonctionner.** Une phase
   ajoute, elle ne casse pas.
3. **Le README est mis à jour** dans le même commit que le code.
4. **Aucune dépendance inutile.** Toute nouvelle bibliothèque doit répondre à
   une question : « que se passe-t-il si je ne l'installe pas ? »
5. **La CI doit être verte** avant de fusionner.
6. **Un écran = un fichier court.** Au-delà de ~250 lignes, on découpe.

---

## Phase 1 — Analyse et fondations ✅ _(cette phase)_

**Livrables :**

- [x] Architecture technique recommandée (`docs/01-architecture.md`)
- [x] Arborescence du monorepo
- [x] Modèle de données Firestore complet (`docs/02-data-model.md`)
- [x] Rôles et permissions — 59 permissions, 11 domaines (`docs/03-roles-permissions.md`)
- [x] Stratégie Authentication / Custom Claims (`docs/03-roles-permissions.md` § 3)
- [x] Stratégie de notifications (`docs/05-notifications.md`)
- [x] Stratégie de sécurité (`docs/04-security.md`)
- [x] Stratégie de coûts (`docs/06-couts.md`)
- [x] Contraintes GitHub public, CI/CD, releases (`docs/07-github.md`)
- [x] Squelette du monorepo, packages partagés, applications
- [x] `firestore.rules`, `storage.rules`, `firestore.indexes.json`
- [x] Harnais de tests des règles, `packages/testing` — 37 tests écrits
- [x] Workflows GitHub Actions, Dependabot, CodeQL
- [x] `README.md`, `.env.example`, `.gitignore` strict, `.gitattributes`

**Critère de sortie :** `npm run typecheck`, `npm run lint`, `npm run test` et
le build de l'admin passent ; l'application Expo démarre.

**Vérifié le 16 septembre 2026 :**

| Commande                             | Résultat                                                       |
| ------------------------------------ | -------------------------------------------------------------- |
| `npm run format:check`               | 52 fichiers reformatés, puis conforme                          |
| `npm run lint`                       | 7 workspaces, aucune erreur                                    |
| `npm run typecheck`                  | 7 workspaces, aucune erreur                                    |
| `npm run test`                       | 27 tests passent, 37 tests de règles ignorés (pas d'émulateur) |
| `npm run build -w @fl/admin`         | 18 pages générées                                              |
| `npm run build -w @fl/functions`     | Compilation sans erreur                                        |
| `npx expo export --platform android` | Bundle de 5,6 Mo produit                                       |

**Les tests de règles ont d'abord été exécutés en CI seulement.** Le poste de
développement ne disposait alors que de Java 8, et `firebase-tools` refuse toute
version antérieure à 21 ; les tests étaient donc ignorés localement et exécutés
par le workflow, qui installe Java 21. C'était une limite d'environnement, pas un
défaut du projet, mais elle imposait de surveiller la première exécution réelle
en intégration continue.

**Correction ultérieure (17 septembre 2026) :** un JRE Temurin 21 isolé a été
installé (`~/.workbuddy-ai/binaries/java/jre21`) et la porte de vérification
locale le met en tête de `PATH`. `npm run rules:test` tourne donc désormais aussi
sur le poste, et la couverture des règles n'est plus tributaire de la CI. Le
`java` du `PATH` global reste `1.8.0_441`, ce qui explique que la limite ait pu
sembler durable.

---

## Phase 2 — Firebase, authentification, inscription, validation

**Objectif :** un parent peut créer un compte, un administrateur peut le
valider, et un compte non validé ne voit rien.

- [ ] Configuration des deux projets Firebase (dev / prod) + émulateurs — les
      alias sont déclarés (`.firebaserc`) et les émulateurs vérifiés ; **les deux
      projets restent à créer dans la console Firebase** (authentification requise)
- [x] `packages/firebase` : initialisation, chemins, converters, repositories `users`
- [x] Écran de connexion, d'inscription multi-étapes, de mot de passe oublié
- [x] Formulaire d'inscription : identité, e-mail, mot de passe, enfants (école, classe)
- [x] Écran « en attente de validation »
- [x] Claims `pending` + `parent` à la création du profil — `onUserProfileCreated`
- [x] `syncUserClaims` (rôle, statut, organisation)
- [x] Recalcul des clés d'audience — `rebuildAudienceKeysForUser`, appelé par les triggers de profil
- [x] Script `bootstrap-admin.mjs`
- [x] Interface admin : file de validation, approuver / refuser / suspendre
- [x] Client typé des fonctions d'administration (`@fl/firebase/functions/admin`)
- [x] Tests : matrice de permissions, audiences, formatage, contrat des schémas
- [x] Tests : Custom Claims (forme du jeton, replis d'échec fermé)
- [x] Tests des règles exécutés réellement — **55 tests verts en CI**, émulateur
      Firestore, 4 s (exécution `35109556293`)
- [x] Garde de couverture des règles de lecture — `packages/testing/src/rules-coverage.test.ts` exige que **chaque collection de premier niveau dotée d'une règle de lecture** compare l'organisation du document à celle du lecteur, ou figure dans une table d'exceptions avec sa raison écrite. Elle lit le fichier de règles au lieu d'interroger l'émulateur, précisément parce que les défauts qu'elle prévient se trouvaient dans des collections sans fixture. Son utilité a été vérifiée en réintroduisant la règle fautive de `users` : le test échoue et la nomme. Sans elle, la frontière d'organisation reposait sur la vigilance — quatre défauts ont survécu à trois phases de cette façon (`users`, `reports`, `moderationReports`, `fcpeTasks`).

**Critère de sortie :** un compte `pending` reçoit `permission-denied` sur
toute lecture de publication, y compris via un script direct.

### Notes d'implémentation

**L'ordre du parcours d'inscription est imposé par les règles, pas par
l'ergonomie.** Les règles n'autorisent la lecture des écoles et des classes
qu'aux utilisateurs connectés (`isSignedIn()`), ce qui est nécessaire — le
formulaire doit les afficher alors que le compte est encore `pending` — mais
suffisant pour contraindre le déroulé : le compte Firebase doit être créé
**avant** l'étape « enfants », et le profil écrit **après**. Un compte sans
profil est donc un état transitoire normal, que le garde de navigation
reconnaît pour renvoyer vers la reprise d'inscription plutôt que de laisser
l'utilisateur dans une impasse.

**Le niveau et l'année scolaire ne sont pas demandés au parent.** Ils se
déduisent de la classe choisie. Trois réponses à faire concorder finissent
toujours par se contredire ; en n'en demandant qu'une, l'incohérence devient
structurellement impossible. C'est aussi ce qui a conduit à rendre
`SchoolClass.schoolId` obligatoire.

**Deux défauts de la Phase 1 corrigés au passage**, tous deux sur le chemin de
l'inscription :

1. `isFirebaseReady()` était faux au tout premier rendu, donc l'état
   d'authentification démarrait à `unconfigured` et le garde de navigation
   renvoyait vers l'écran de configuration à chaque lancement, le temps qu'un
   effet s'exécute. L'initialisation se fait désormais pendant le premier
   rendu (`useState(() => initializeFirebase())`), ce qui rend l'état initial
   exact.
2. Le profil était chargé sans mémoriser l'utilisateur auquel il se rapporte :
   `profile === null` était ambigu — « pas encore chargé » ou « réellement
   absent ». Le contexte expose désormais `profileResolved`, sans lequel la
   reprise d'inscription aurait redirigé pendant le chargement.

**Rafraîchissement du jeton au changement de statut.** Les Custom Claims sont
posés par une Cloud Function, et un jeton déjà émis ne les contient pas. Sans
rafraîchissement forcé, un compte tout juste validé afficherait l'application
complète mais se heurterait à un refus de lecture sur chaque contenu pendant
une heure. Symétriquement, c'est ce qui rend une suspension immédiatement
effective.

**Le déclencheur de création est Firestore, pas Auth.** La feuille de route
prévoyait un `onUserCreated` sur le compte Firebase Auth. C'était incompatible
avec le parcours en deux étapes : le compte Auth naît à l'étape 1, alors que le
profil — donc `orgId`, sans lequel aucun claim n'est calculable — n'arrive qu'à
l'étape 2. Un déclencheur Auth poserait des claims sur un compte dont on ne
sait encore rien. `onUserProfileCreated` observe donc `users/{uid}` : il se
déclenche au moment exact où les informations nécessaires existent.

**La file de validation ne touche jamais Firestore en écriture.** Approuver un
compte modifie les Custom Claims, que seul l'Admin SDK peut écrire. L'écran
appelle donc `adminSetUserStatus` et rien d'autre. Le bénéfice dépasse la
contrainte : toutes les décisions d'autorisation vivent dans une seule fonction
auditable, qui relit le rôle de l'appelant **en base** plutôt que dans son jeton
(un administrateur rétrogradé ne peut pas agir pendant l'heure de validité de
son ancien jeton).

**Les appels de fonctions passent par un client typé.** Les noms de fonctions
sont des chaînes de caractères : une faute de frappe devient une erreur
d'exécution, et un renommage côté serveur passe inaperçu côté client. La région
`europe-west1` doit de plus correspondre au déploiement, faute de quoi l'appel
échoue sur un « not found » que rien dans le code n'explique. Les deux sont donc
déclarés une seule fois, dans `@fl/firebase`.

**Défaut corrigé — `claimsNeedUpdate` était toujours vrai.** Dans
`onUserProfileWritten`, la condition se terminait par
`!claimsMatchProfile(undefined, source)`. Comme la fonction retourne `false` sur
un premier argument absent, ce terme valait toujours `true` et neutralisait les
trois comparaisons qui le précédaient : chaque modification anodine d'un profil
— un prénom, des préférences de notification — déclenchait un appel à l'API
Admin, exactement ce que le commentaire voisin annonçait éviter. Aucun test ne
pouvait le voir : le code était correctement typé, et `undefined` est une valeur
légitime pour ce paramètre. La condition se limite désormais aux trois champs
qui comptent, et `claimsMatchProfile` — dont le seul appel était ce défaut — a
été retiré plutôt que laissé en place, pour ne pas inviter à le réintroduire.

**Contrat implicite des schémas d'administration, désormais explicite.** Les
trois schémas `userStatusUpdateSchema`, `userRoleUpdateSchema` et
`contentStatusUpdateSchema` sont les seuls du fichier à ne pas être `.strict()`.
Ce n'est pas un oubli : la cible (`uid`) voyage dans le même `request.data` que
la décision, et le serveur la lit hors du résultat du parse. Les passer en mode
strict ferait échouer les trois fonctions d'administration à l'exécution, avec
pour seul message « Demande invalide » — sans erreur de compilation. Le motif
est commenté sur place et verrouillé par `packages/shared/src/validation.test.ts`.

**Garantie retirée — la concordance matrice / règles n'est pas automatisée.**
Le commentaire d'en-tête de `packages/shared/src/permissions.ts` affirmait qu'un
test `permissions.rules.test.ts` échouait en CI si la matrice de permissions et
`firestore.rules` divergeaient. Ce fichier n'existe pas, et les tests de règles
ne référencent ni `PERMISSION_MATRIX` ni `hasPermission` : ils vérifient le
comportement réel des règles, pas leur concordance avec la table. Une garantie
annoncée mais absente est pire que pas de garantie — elle dissuade de vérifier
à la main. Le commentaire dit maintenant l'état réel : la synchronisation est
manuelle, et le restera tant que les règles ne seront pas générées depuis la
matrice.

**Le critère de sortie de la phase est couvert, et exécuté.** Les
tests de règles contiennent bien les cas qui comptent — un compte `pending` ne
peut ni lire une publication publiée ni lister le fil, un compte suspendu ou
refusé non plus, un visiteur anonyme non plus, et un compte `pending` peut
seulement lire son propre profil (sans quoi il ne saurait pas où en est sa
demande). Mais ces tests exigent l'émulateur Firestore, donc **JDK 21**, et
firebase-tools refuse toute version antérieure :

```
Error: firebase-tools no longer supports Java version before 21.
```

L'exécution a d'abord eu lieu en CI uniquement, où le job `rules` installe
Temurin 21 : le poste ne disposait alors que de Java 8. L'angle mort a payé — la
première exécution a révélé un bug de règle qui rendait impossible toute
publication sans lien externe, la seconde a validé sa correction, et la troisième
a confirmé la fermeture d'une faille de réécriture des commentaires.

**Correction ultérieure (17 septembre 2026) :** un JRE Temurin 21 isolé est
désormais installé sur le poste et la porte locale le met en tête de `PATH` —
`npm run rules:test` s'y exécute donc aussi, et cette couverture n'est plus
tributaire de la CI.

**Les tests de claims sont purs, et c'est délibéré.** Ils vivent dans
`functions/src/auth/claims.test.ts` plutôt que dans `@fl/testing`, qui porte les
tests exigeant l'émulateur. La raison est la même que ci-dessus : la propriété
d'échec fermé des claims est trop importante pour ne s'exécuter que là où
l'émulateur peut démarrer. `functions/tsconfig.json` excluait déjà
`src/**/*.test.ts` du build — l'emplacement était prévu, les tests manquaient.

**`toClaimsSource` déplacé et exporté sous le nom `claimsSourceFromProfile`.**
Cette fonction porte la logique de repli qui _est_ l'échec fermé : `role`
absent → `parent` (le rôle le moins permissif), `status` absent → `pending` (qui
ne donne accès à rien), `orgId` absent → `null`, donc aucun claim appliqué
plutôt qu'un rattachement inventé, qui pourrait ouvrir les données d'une autre
FCPE. Elle était privée, dans un module de déclencheur qu'on ne peut pas
importer sans enregistrer des fonctions : la propriété la plus critique du
système était la moins testable. Elle vit maintenant auprès de `buildClaims`,
et 13 tests la couvrent.

**`functions` vérifie désormais les types de ses tests.** Le script
`typecheck` pointait sur `tsconfig.json`, qui exclut `src/**/*.test.ts` : un
fichier de test aurait échappé au contrôle de types et n'aurait été vu que par
vitest. Il pointe maintenant sur un `tsconfig.test.json`, comme `@fl/shared`.

---

## Phase 3 — Accueil, publications, commentaires

- [x] Fil d'actualité paginé (10 par page, scroll infini)
      `useFeed` porte l'empreinte de la demande — organisation, catégorie, clés
      d'audience — et un numéro de génération : changer deux fois de catégorie
      en une seconde ne peut pas afficher la réponse de la première.
      **Correction ultérieure.** La pagination ne fonctionnait pas : `paginate`
      transmettait le curseur à `buildQuery`, et aucun des quatre appelants —
      fil, liste d'administration, commentaires, file des comptes — ne
      l'appliquait à la requête. « Charger la suite » relançait donc la première
      page, que la déduplication réaffichait comme un ajout vide : la liste
      cessait de grandir, sans erreur ni message. `paginate` applique désormais
      `startAfter` lui-même, ce qui rend l'oubli impossible, et
      `packages/testing` le prouve en parcourant réellement une collection page
      après page.
- [x] Filtres par catégorie
      Le filtre est appliqué **par la requête**, pas sur la page chargée : un
      filtre client annoncerait « aucune publication en cantine » alors que la
      page suivante en contient. Cela impose l'index composite
      `orgId, status, category, audienceKeys, publishedAt` — les champs
      d'égalité d'abord, le champ tableau ensuite, le tri en dernier.
- [x] Épinglage en tête
      Requête séparée, **non filtrée par catégorie** : une information épinglée
      doit rester visible même quand le parent consulte une rubrique précise.
      Les épinglés sont retirés du fil chronologique, sinon ils apparaîtraient
      deux fois sur le même écran.
- [x] Détail d'une publication, pièces jointes, lien externe
      Les pièces jointes s'ouvrent via une URL de téléchargement demandée **au
      moment du toucher** et jamais stockée (voir `docs/04-security.md`). Seuls
      les liens `http`/`https` sont ouverts, même si le schéma les valide déjà.
- [x] Commentaires, réponses à un commentaire, réactions
      Lecture, écriture et réactions. Limite assumée : les réponses sont
      indentées dans la liste chronologique au lieu d'être rattachées à leur
      parent — la page ne contient pas forcément le parent, et l'afficher sans
      lui serait pire. La constitution de fils viendra avec le chargement des
      réponses.
      Fermer les commentaires est **une règle**, pas un masquage du champ de
      saisie : la règle de création lit la publication parente et exige qu'elle
      soit publiée et ouverte aux commentaires. Un test vérifie aussi qu'une
      publication sans cette décision est refusée à la création.
      Le décompte des réactions est tenu par une Cloud Function ; l'application
      l'estime localement le temps de la réponse, puis le remplace au
      rechargement suivant — sans quoi le bouton semblerait ne rien faire.
- [x] Compression des images avant upload
      Les photos sont réduites **avant** de quitter le téléphone :
      1600 px de côté au maximum, JPEG qualité 0,8 — les valeurs de
      `UPLOAD_LIMITS`, donc les mêmes que celles que les Storage Rules
      vérifient. La géométrie vit dans `@fl/shared` (`fitWithin`) et non dans
      l'écran : l'administration compressera les mêmes images un jour, et deux
      calculs de ratio divergeraient au premier cas limite. Le redimensionnement
      lui-même passe par `expo-image-manipulator`, seule partie qui ne peut pas
      être partagée.
      **L'ordre des opérations est imposé par les règles.** Le chemin d'une
      pièce jointe contient l'identifiant de la publication
      (`orgs/{orgId}/posts/{postId}/…`), donc rien ne peut être envoyé avant que
      cet identifiant existe ; mais `publishedAt` est figé à la création, donc
      un brouillon publié après l'envoi porterait la date du brouillon. La
      sortie est de **pré-générer l'identifiant** (`newPostId()`, qui n'écrit
      rien et ne lit rien), d'envoyer les photos à leur place définitive, puis
      de créer la publication complète du premier coup. Aucun état
      intermédiaire n'est visible, et le document n'est jamais écrit deux fois.
      Les fichiers d'une publication dont la création échoue sont supprimés :
      les règles Storage ne vérifient pas que le document existe, donc ils
      seraient facturés sans être référencés par personne — et plus
      supprimables. Un nettoyage raté ne masque pas l'erreur d'origine.
      Limite assumée : l'éditeur d'administration accepte un tableau de pièces
      jointes mais n'en envoie jamais. Un texte publié depuis le web n'a donc
      pas de photo, et c'est le seul chemin qui existe pour l'instant.
- [x] Écran admin : créer, modifier, épingler une publication
      **Le trou de règle annoncé ici est fermé.** La question laissée ouverte —
      _un membre de la FCPE peut-il épingler la publication d'un autre ?_ —
      était déjà tranchée par la matrice de permissions : `post.pin` est réservé
      à `moderator` et `admin`. Un membre publie, mais n'épingle pas, pas même
      son propre texte. `allow update` est dédoublé comme pour les commentaires :
      la branche « auteur » corrige son texte, son identité, ses compteurs et son
      épinglage étant figés ; la branche « modération » ne touche qu'à `pinned`,
      `pinnedUntil` et `status`, tout le contenu figé — un modérateur masque, il
      ne réécrit pas. Deux restrictions qui ne vivaient que dans l'interface sont
      tombées au passage : `allow create` acceptait `pinned: true` d'un simple
      membre, et `authorRole` était libre alors que le fil en affiche un badge.
      La lecture est scindée en `get` (publié, auteur, ou modération) et `list`
      (borné à `published`), parce qu'une règle de requête doit être démontrable
      à partir des contraintes : **aucune liste ne peut donc remonter un
      brouillon**. L'éditeur n'offre ni brouillon, ni épinglage, ni notification
      — ce dernier point parce que `notify` n'est lu par personne. Enfin l'écran
      liste les publications **toutes audiences confondues**, ce que le fil
      mobile ne peut pas faire puisqu'il filtre sur les clés de celui qui
      regarde : nouvelle requête, donc nouvel index `orgId, status, publishedAt`.
- [x] Compteurs dénormalisés (`commentCount`, réactions d'un commentaire)
      **Trois déclencheurs** dans `functions/src/triggers/counters.ts` :
      signalements, `commentCount` d'une publication, décompte des réactions
      d'un commentaire. Le client n'écrit plus aucun compteur : `posts/{postId}`
      n'est modifiable que par la FCPE, donc l'écriture d'un parent était
      refusée juste après un commentaire pourtant créé — l'interface annonçait un
      échec pour une action réussie.
      **Trois champs déclarés et jamais alimentés**, à trancher :
      `PostStats.reactionCount` (les réactions vivent sur les commentaires, il
      n'existe aucune sous-collection de réactions sur une publication),
      `Comment.replyCount` (les réponses existent, mais aucun écran ne les
      compte) et `notify` dans `postInputSchema` (accepté par le schéma,
      `create()` ne l'écrit pas dans Firestore, rien ne le lit). Tous trois sont
      écrits ou acceptés sans être lus — les retirer ou les tenir est une
      décision de modèle, pas un oubli de plomberie.
- [x] Tests : création de publication, ciblage d'audience, lecture filtrée
      **Création.** Un parent ne publie pas ; un membre de la FCPE si ; une
      publication ne peut être attribuée à quelqu'un d'autre, se déclarer un
      autre rôle, naître épinglée, ni se passer de décision sur les
      commentaires. Les clés d'audience sont désormais couvertes aussi — liste
      non vide, de type liste, cinq clés au plus — **avec leur pendant positif** :
      une publication ciblée sur un niveau est acceptée. Sans ce pendant, une
      règle qui refuserait toute publication ciblée passerait pour correcte.
      **Ciblage.** `buildAudienceKeys`, `buildUserAudienceKeys`,
      `isVisibleForUserKeys` et `validateAudience` sont couverts dans
      `@fl/shared`, y compris la limite de `array-contains-any` et le cas d'une
      audience incomplète, qui ne produit aucune clé plutôt qu'une clé fausse.
      **Lecture filtrée.** La requête du fil, telle que `fetchFeed` la
      construit, rend la publication du niveau du lecteur, écarte celle d'un
      autre niveau, et un membre de la FCPE reçoit en plus celle qui lui est
      réservée — le tout en **une seule requête**, quel que soit le nombre de
      ciblages. C'est le bénéfice des clés dénormalisées : quatre ciblages
      tiennent dans un `array-contains-any`, là où une lecture par ciblage
      coûterait quatre fois plus.
      **Ce que ces tests ont mis au jour, et qui n'était écrit nulle part.**
      Les règles ne lisent **jamais** `audienceKeys` : `allow get` exige
      l'organisation, un compte actif et un statut publié ; `allow list` exige en
      plus que la requête contraigne `orgId` et `status`. Le ciblage est donc
      appliqué par la requête du client, pas par la règle — une contrainte
      structurelle, puisque « les clés du lecteur recoupent celles du document »
      ne se démontre pas à partir des contraintes d'une requête.
      Deux tests de limite rendent ce fait visible au lieu de le laisser croire
      fermé, et ils sont volontairement écrits comme des **constats**, pas comme
      des intentions : un parent lit par identifiant une publication destinée à
      un autre niveau, et — c'est le point gênant — un parent lit une publication
      réservée à la FCPE, alors que l'écran annonce « Cette publication ne sera
      visible que par les membres de la FCPE ». La question est portée dans
      `docs/04-security.md` § 10 : retirer la promesse, ou la tenir.

**Critère de sortie :** le fil se charge en une requête ; un parent ne voit
que les publications de son audience.

---

## Phase 4 — Interface Web Admin

- [x] Coquille de tableau de bord responsive, navigation latérale — navigation fixe à partir de 1024 px, tiroir en dessous (`admin-shell.tsx`). Les sections sont déclarées une seule fois dans `lib/sections.ts`, si bien qu'un lien du menu ne peut pas mener nulle part.
- [x] Authentification admin — la garde n'exige pas un rôle nommé mais la permission `fcpe.access`, qui couvre `fcpe`, `moderator` et `admin` et refuse un parent. Le libellé d'origine (« réservée aux rôles `moderator` et `admin` ») était plus étroit que l'intention : les membres de la FCPE doivent pouvoir publier. Un parent qui se connecte passe en `forbidden`, reçoit l'explication, et dispose d'une déconnexion — sans quoi il serait resté bloqué, sa session Firebase demeurant ouverte.
- [x] Tableau de bord alimenté par `counters` — une seule lecture de `counters/{orgId}`, jamais de requête d'agrégation. Le document absent est signalé explicitement plutôt qu'affiché en zéros.
- [ ] Tableau de bord alimenté par `highlights` — reporté volontairement. `OrganizationHighlights` est déclaré et `paths.highlight()` existe, mais **rien ne l'écrit** : les fonctionnalités qu'il résume (prochain événement, dernier sondage, prochain conseil) relèvent des phases 8 à 10. Le lire aujourd'hui afficherait une section vide en permanence.
- [x] Gestion des utilisateurs : filtres et actions — file par statut, pagination, actions filtrées par permission, motif obligatoire pour un refus ou une suspension, et passage exclusif par une Cloud Function puisqu'approuver modifie les Custom Claims.
      **Correction ultérieure.** La règle de lecture de `users` ne référençait aucun champ du document : Firestore la satisfaisait donc pour **n'importe quelle** requête, et un membre de la FCPE pouvait lister la collection entière — les noms, adresses et numéros des parents de toutes les organisations. Les lectures unitaires ne pouvaient pas le révéler, une règle trop large y répondant correctement. Le cloisonnement par organisation, présent sur onze autres collections, manquait ici ; il est désormais `resource.data.orgId == orgId()`, et trois tests le tiennent — dont un qui exige le refus d'une lecture sans filtre.
- [x] Gestion des utilisateurs : fiche d'un compte — route imbriquée `utilisateurs/[uid]`, atteignable en cliquant le nom depuis la file. Elle montre l'identité, le rattachement déclaré, les consentements et l'historique du compte, lu dans `adminLogs` par `targetType + targetId` : le second des trois index composites, jusqu'ici déclaré sans consommateur. **En lecture seule** — les décisions d'autorisation restent dans la file, qui les présente avec leur motif obligatoire ; les dupliquer ici donnerait deux implémentations d'une même règle.
- [ ] Gestion des utilisateurs : recherche — la file se parcourt par statut. Chercher par nom ou par adresse demande de choisir un mécanisme, Firestore n'offrant ni recherche insensible à la casse ni recherche par sous-chaîne : voir `docs/04-security.md` § 10.
- [x] Journal d'audit (`adminLogs`) : consultation — lecture seule, filtre par type d'action, pagination. Les règles réservent la lecture à `isAdmin()` et refusent toute écriture cliente, administrateur compris : l'écran n'offre donc aucune modification, et ce n'est pas un oubli. Le filtre n'a qu'une dimension parce que Firestore exige un index composite par combinaison — `actorId` et `targetType + targetId` sont prêts pour les fiches de détail.
- [ ] Paramètres de l'organisation — **reporté sur décision**, pour la raison exacte qui a fait reporter `highlights` : `reportRetentionDays` et `collectiveIssueThreshold` ne sont lus par **aucun** code — les seules occurrences sont le type, le script d'amorçage et le `dist` compilé. Les rendre éditables afficherait « durée de conservation : 365 jours » comme une garantie RGPD alors que rien ne purge : la promesse serait fausse, de la même famille que celle de l'audience `fcpe`. À construire quand chaque réglage aura son consommateur, en phase 7.
      **`urgentAlwaysNotifies` a été retiré**, et non construit : la question qu'il posait — les alertes urgentes peuvent-elles être coupées ? — a reçu une réponse négative en phase 5, donc un booléen qui n'accepte qu'une valeur aurait laissé croire qu'un administrateur pouvait affaiblir l'exception. Elle vit dans `MANDATORY_NOTIFICATION_CATEGORIES`, dans le code. La section reste déclarée dans `lib/sections.ts` avec `implemented: false`, donc le menu dit déjà la vérité.

**Critère de sortie :** l'admin est utilisable sur téléphone, tablette et
ordinateur ; un parent qui tente d'y accéder est refusé.

---

## Phase 5 — Notifications push

- [ ] Enregistrement des jetons (`deviceTokens`) — **la frontière est posée, et
      la recopie est branchée**.
      Les règles vérifient que `orgId` est celui de l'appelant, et que
      `audienceKeys` **et** `disabledCategories` sont vides à la création puis
      figés. Ni l'un ni l'autre n'est anodin. Le serveur choisit les
      destinataires d'une notification en lisant `audienceKeys` : un client qui
      le déclare librement choisit qui il devient. Trois défauts d'écriture ont
      été **prouvés par test avant correction** — un parent pouvait enregistrer
      un appareil au nom d'une autre organisation, s'abonner à l'audience de la
      FCPE, ou réécrire les clés de son propre appareil. Les règles ne peuvent
      pas vérifier une clé `class:` ou `level:` — elles ne lisent pas les
      enfants de l'appelant —, d'où le choix de retirer le champ au client
      plutôt que de tenter de le valider.
      `disabledCategories` est serveur pour une tout autre raison, qui n'a rien
      de sécuritaire : la préférence est posée par **utilisateur** et recopiée
      par **appareil**, et un client ne peut atteindre que l'appareil courant.
      Propriétaire du champ, il laisserait diverger les autres — un parent
      décochant « discussions » sur son téléphone continuerait de les recevoir
      sur sa tablette, alors que l'écran affiche l'inverse.
      La recopie est faite par `onDeviceTokenCreated` (à la création) et par
      `onUserProfileWritten` (statut ou préférences modifiés). Elle était
      **écrite mais appelée par personne** : `rebuildAudienceKeysForTokens`
      n'avait aucun appelant, donc les jetons seraient restés avec
      `audienceKeys: []` — l'état que les règles imposent — et **aucun parent
      n'aurait jamais reçu la moindre notification**. Aucun test de règles ne
      pouvait le voir : les règles, elles, étaient satisfaites.
      Corrigé au passage : `audienceChanged` ne comparait que les
      rattachements, donc un parent promu au rôle `fcpe` n'obtenait jamais sa
      clé `fcpe:` et ne voyait aucun contenu de la FCPE. Le rôle et les
      organisations font maintenant partie de la comparaison.
      **Le cycle de vie du jeton est fermé sur trois chemins, et pas sur un
      quatrième.** Un appareil peut **changer de porteur** — partagé entre deux
      parents, ou transmis : il reprend la même entrée, puisque l'identifiant du
      document est le jeton. Les règles exigent alors la remise à zéro des deux
      champs serveur, et `onDeviceTokenOwnerChanged` les recalcule depuis le
      profil du nouveau. Sans cela, le nouveau porteur héritait des clés de
      l'ancien et recevait **ses** notifications, indéfiniment : rien ne les
      recalculait, puisque ce sont les clés du profil du nouveau porteur qui les
      déterminent, et que ce profil-là n'a pas changé. Interdire le transfert
      aurait été pire — un appareil partagé n'aurait pu servir qu'un seul
      compte, sans que rien ne le signale.
      Le transfert reste **interne à l'organisation** : les règles comparent
      aussi l'organisation du document à celle de l'appelant. Sans cette clause,
      un parent du groupe B reprenait un jeton du groupe A en réécrivant
      `orgId`, et l'appareil du groupe A cessait de recevoir ses propres
      notifications. Un compte dont l'organisation changerait ne pourrait donc
      plus mettre à jour ses jetons : il les supprimerait et les recréerait. Le
      cas est aujourd'hui théorique — aucun chemin de code n'écrit `orgId` sur
      un profil —, et c'est écrit comme tel dans les documents.
      **Les trois clauses ont été éprouvées séparément**, chacune retirée seule :
      la branche de transfert entière fait tomber deux tests, la clause
      d'organisation un seul, celle des préférences un seul. Retirer le bloc ne
      prouvait pas ses sous-clauses — une clause voisine refusait l'écriture à
      leur place, et l'écart annoncé (trois échecs attendus, deux obtenus) est
      ce qui l'a montré.
      Un **profil supprimé** emporte désormais ses jetons. Le chemin d'envoi ne
      consulte pas les Custom Claims, donc retirer les droits ne fait pas taire
      un appareil. Le cas se produit dès qu'un profil est supprimé autrement que
      par `adminDeleteUser`, seul appelant de `cleanupDeletedUser` : le
      déclencheur de profil appelle donc le même nettoyage, qui est idempotent.
      **La déconnexion n'est pas couverte** : l'appareil continue de recevoir
      les notifications du compte qui vient de partir. Le remède est client —
      écrire `enabled: false` sur son propre jeton, la seule écriture que les
      règles laissent — mais il exige de connaître le jeton, donc
      l'enregistrement côté application.
      **Restent à faire :** l'enregistrement côté application (demande de
      permission, obtention du jeton Expo, écriture du document) — bloqué par
      `extra.eas.projectId`, **vide** dans `app.json`, sans lequel
      `getExpoPushTokenAsync` ne peut rien obtenir ; et la désactivation du jeton
      à la déconnexion.
      **Le déclencheur sur `users/{uid}/children` est fait** :
      `onUserChildrenWritten` recalcule les clés du parent quand son école, son
      niveau ou sa classe change. Il manquait, et le formulaire d'inscription
      masquait le défaut — il écrit l'enfant et le profil d'un seul geste, si
      bien qu'ajouter un enfant plus tard ne faisait rien : le parent ne voyait
      pas le fil de sa classe, et rien n'échouait.
- [ ] Écran de préférences par catégorie — les interrupteurs se construisent sur
      `OPTIONAL_NOTIFICATION_CATEGORIES`, jamais sur `NOTIFICATION_CATEGORIES` :
      proposer `urgent` afficherait un interrupteur sans effet, que le schéma
      refuserait de toute façon à l'enregistrement.
- [x] `ExpoPushDispatcher` derrière l'interface `PushDispatcher` — écrit dans
      `packages/shared/src/push/expo.ts` et exporté par `@fl/shared`. Il est
      **appelé** depuis l'item « premier envoi de bout en bout », ci-dessous.
      Ses fonctions sont couvertes — 32 tests dans `packages/shared/src/push/`,
      dont le filtrage, le découpage en lots et le compte rendu d'un envoi. Ces
      tests ont trouvé un défaut : une réponse **plus courte que la demande**
      était comptée comme une livraison partielle réussie, alors que les jetons
      sans ticket n'ont pas été confirmés. `delivered + failed` pouvait donc
      être inférieur au nombre de destinataires, et l'administration annoncer un
      envoi complet.
      **Le module a changé de paquet, et ce n'était pas cosmétique.** Il vivait
      dans `@fl/firebase`, qui importe le SDK Firebase **client** ; or il
      n'importe aucun SDK — seulement `@fl/shared`, `@fl/types` et des
      primitives universelles (`fetch`, `AbortController`, `setTimeout`). Son
      unique consommateur réel est `functions/`, qui ne peut pas dépendre de
      `@fl/firebase` : c'est la raison pour laquelle `paths.ts` duplique les noms
      de collections au lieu de créer cette arête. Le module était donc rangé
      dans le seul paquet que son consommateur ne peut pas atteindre.
      **Une garantie structurelle a été déplacée, pas perdue.** `@fl/shared`
      compilait avec `"types": []`, ce qui interdisait _par construction_
      `process.env` ou `node:fs` — le paquet restait sûr pour React Native.
      Accueillir le module d'envoi a exigé `"types": ["node"]`. La garantie est
      désormais tenue par `portability.test.ts`, qui lit la source du paquet et
      refuse trente modules intégrés de Node et cinq globales propres à Node.
- [x] Premier envoi de bout en bout : `onPostPublished` — le module d'envoi
      n'était appelé par **aucune** Cloud Function, et `queryByAudience`, nommé
      dans `docs/05-notifications.md`, **n'existait pas**. Le chemin est
      maintenant complet : `posts/{postId}` publié → `postNotificationPlan`
      (décision pure) → `selectRecipients` (conversion défensive) →
      `sendToAudience` (requête, envoi, purge, journal) → `notifiedAt` et
      `stats.notifiedCount` écrits **après** l'envoi, jamais avant : marquer
      d'abord perdrait silencieusement la notification si l'envoi échouait.
      `onDocumentWritten` et non `onDocumentCreated`, parce qu'une publication
      peut naître `published` **ou** le devenir ; le rejeu est fermé par
      `notifiedAt`. Les deux replis opposés sont appliqués ici et sont
      délibérés : `audienceKeys` illisible → liste vide (un appareil qui ne
      reçoit rien plutôt qu'une notification qui dévoile son contenu sur
      l'écran verrouillé), `disabledCategories` illisible → rien de désactivé
      (une fermeture d'école manquée ne se rattrape pas). Un jeton dont les clés
      s'étalent sur deux lots est **dédoublonné par identifiant de document** :
      sans cela il recevrait la notification deux fois.
      Sept clauses prouvées par mutation, chacune tombant seule. La mutation de
      `after.status !== 'published'` n'a fait tomber **aucun** test : la garde
      était masquée par celle du dessus, et le cas qu'elle protège vraiment — un
      brouillon retiré avant publication — n'avait pas de test. Le test manquant
      a été écrit.
- [x] Notification d'un commentaire : `notifyCommentAuthor` — il couvre **deux**
      des sept déclencheurs, le nouveau commentaire et la réponse, parce que la
      seule chose qui les sépare est la règle qui désigne la cible : l'auteur de
      la publication, ou celui du commentaire auquel on répond.
      **Une personne, pas une audience.** C'est la différence de fond avec
      l'envoi d'une publication : `queryTokensByAudience` recoupe des clés,
      `queryTokensByUid` joint les appareils d'un porteur. Les deux se rejoignent
      dans `deliverToTokens` — écrire la plomberie deux fois aurait produit deux
      comportements qui divergent à la première modification, l'un oubliant de
      purger les jetons morts.
      **`audience` devient facultative** dans `NotificationJournalEntry` comme
      dans `NotificationLog`, et le champ est **omis** plutôt qu'écrit à
      `undefined`, que l'Admin SDK refuse. Recopier l'audience de la publication
      ferait afficher à l'administration « envoyé à toute l'école » pour un envoi
      à un seul parent. L'écran de l'historique lisait `entry.audience.type` : il
      aurait **levé** sur le premier commentaire reçu.
      **`onDocumentCreated`, pas `onDocumentWritten`** : un commentaire naît
      `visible`, les règles l'imposent, donc il n'y a pas deux chemins à ramener
      à une seule règle ; et une réaction écrit dans le commentaire, donc un
      déclencheur d'écriture serait réveillé à chaque réaction posée.
      **Rien n'est marqué sur le commentaire.** Le déclencheur de publication
      écrit `notifiedAt` dans le document qu'il écoute, et c'est cette écriture
      qu'une seconde garde arrête. Ici, rien n'est écrit : pas de boucle. Les
      reprises ne sont pas activées par défaut et aucune fonction ne les active,
      donc pas de rejeu ; une garde lue dans la charge de l'événement ne verrait
      de toute façon pas un marquage, et seule une relecture en base
      fonctionnerait — une lecture sur le déclencheur le plus fréquent du projet,
      refusée sciemment.
      **Un commentaire parent disparu ne fait pas taire la réponse** : la cible
      retombe sur l'auteur de la publication, l'autre partie légitime du fil. Un
      silence ne se distingue pas d'une panne.
      `corpsDeLaFonction` a dû apprendre la forme d'un déclencheur : aucune des
      cinq fonctions de `triggers/` ne finit par `\n});`, donc aucun test ne
      pouvait lire leur corps. Les deux fins possibles sont désormais essayées,
      et c'est la plus proche qui l'emporte.
- [x] Notification d'un canal : `notifyChannelAudience` — il couvre le quatrième
      déclencheur, et c'est le seul qui exige un **regroupement** : les messages
      sont accumulés sur une fenêtre de cinq minutes, puis annoncés en une fois.
      **Un déclencheur accumule, une tâche planifiée annonce.** C'est cette
      séparation qui rend le regroupement possible — un déclencheur ne peut pas
      attendre, et une fonction qui dort coûte pendant qu'elle dort. Le lot vit
      dans `channelDigests/{channelId}`, et `onChannelDigestsDue`
      (`every 5 minutes`, la **seconde** fonction planifiée du projet) l'annonce.
      **La fenêtre ne glisse pas.** `flushAt` est fixé à l'ouverture du lot et
      n'est plus repoussé tant qu'elle court : le repousser à chaque message
      ferait qu'un canal bavard ne serait **jamais** annoncé, la fenêtre glissant
      indéfiniment. Le lot part donc au plus tard cinq minutes après son premier
      message.
      **Le lot ne stocke que des identifiants**, jamais le texte, et le compte
      annoncé est celui des messages **relus** au moment de l'annonce : un message
      masqué pendant la fenêtre ne compte plus, et si plus rien n'est visible le
      lot disparaît sans un mot. Un compteur incrémenté à chaque message aurait
      dérivé dès la première livraison dupliquée — les déclencheurs Firestore
      s'exécutent « au moins une fois ».
      **« On ne se notifie jamais soi-même » change de forme ici.** Les deux
      déclencheurs précédents **renoncent à envoyer** quand la cible désignée est
      l'auteur du contenu. Un lot ne le peut pas : il peut n'avoir qu'un auteur,
      et renoncer éteindrait la notification **pour tout le monde** — le demandeur
      n'obtiendrait aucune réponse parce qu'il a posé sa question. La règle devient
      une exclusion de destinataires (`excludeOwners`, appliqué **après** la
      requête : Firestore ne sait pas exprimer « sauf ceux-ci »). Contrepartie
      assumée : un seul envoi porte un seul texte, donc un seul compte, et dans un
      lot mixte l'auteur lit un total qui inclut ses propres messages.
      **L'envoi précède la suppression du lot.** Un passage interrompu entre les
      deux réannoncera le lot au suivant — un doublon, visible dans l'historique —
      plutôt que de perdre la notification en silence : une notification perdue ne
      se distingue pas d'un canal calme. Un envoi qui échoue laisse donc le lot en
      place.
      **Le déclencheur écrit dans une transaction** : deux messages simultanés dans
      un canal actif liraient sinon le même lot, et l'un écraserait l'autre — trois
      messages annoncés comme deux, sans aucune erreur.
      **Aucun lien profond**, contrairement aux deux autres. `channel` est un type
      de cible connu, mais `TYPES_SANS_ROUTE` l'excuse : l'écran des discussions
      n'existe pas. Un lien de ce type serait reconnu par l'analyse puis refusé à
      l'ouverture, et le tap laisserait l'application où elle est — une promesse
      que rien n'honore, ce que la règle 6 interdit.
      `channelDigests` est **inaccessible au client** (`allow read, write: if
false`) : c'est le seul endroit où « ce qui a déjà été annoncé » est écrit,
      et le rendre modifiable permettrait d'annoncer un lot qui n'existe pas, ou de
      faire taire celui qui existe en repoussant sa fenêtre.
- [x] Les 7 déclencheurs — **5 sur 7** : publication, commentaire et réponse,
      message de canal, et **sondage**. Restent le signalement et le rappel.
- [x] **Notification d'un sondage** — `notifyPollAudience`, branché sur les
      **écritures** de `polls/{pollId}` et non sur la création. Un sondage peut
      naître `open` — publié d'un seul geste — ou le devenir : un brouillon
      préparé la veille pour le lendemain, que la FCPE ouvre plus tard. Un
      déclencheur de création aurait raté le second chemin, un déclencheur de
      mise à jour le premier. `pollNotificationPlan` ramène les deux à une seule
      règle : le statut **devient** `open`, et le sondage n'a **jamais** été
      notifié. La seconde garde n'est pas un confort : elle couvre le rejeu du
      même événement, que Firestore peut produire seul, **et** la réouverture
      (`closed` puis `open`), qui franchit la première sans y être arrêtée — un
      aller-retour de statut renverrait sinon la même notification à toute
      l'audience.
      La **clôture ne notifie pas**, et ce n'est pas un oubli : `new_poll` est le
      seul type qu'un sondage produise — `NotificationType` n'en prévoit pas
      d'autre — et annoncer une clôture sous ce type ferait mentir l'historique
      des envois, la collection même que l'administration lit pour savoir ce qui
      est réellement parti.
      Le **nom de l'auteur** n'est pas sur le document (`createPoll` a refusé d'y
      recopier un nom qu'aucune règle ne vérifie) et le journal l'exige : le
      déclencheur le lit sur le profil, par `nomDuProfil` — le format unique que
      l'administration et le serveur partagent déjà — et **ne renonce pas** si ce
      profil a disparu : le sondage est celui de l'association, et le repli est
      « La FCPE ». La lecture est conditionnée au seul statut `open`, ce qui
      évite une lecture de profil sur les écritures qui ne peuvent pas notifier —
      et elles sont les plus nombreuses, le balayage planifié inscrivant la
      clôture des sondages échus toutes les cinq minutes.
      **Le défaut trouvé en écrivant le test de création** : `notifiedAt` était
      figé par `unchangedOptional('notifiedAt')`, ce qui ne dit **rien** d'une
      création — il n'y a pas de `resource` à comparer, donc rien à figer, et le
      client peut poser la valeur qu'il veut. Un membre de la FCPE pouvait donc
      écrire le champ sur le document qu'il venait de créer et **faire taire la
      notification de son propre sondage**. Le champ est désormais fermé des deux
      côtés — `absent()` à la création, `unchangedOptional()` ensuite — et le
      banc des sondages porte une mutation pour chacune des deux clauses : 33 au
      total.
      Au passage, **deux affirmations fausses** ont été corrigées, toutes deux
      trouvées en écrivant ce déclencheur : le commentaire de `close()` annonçait
      une renotification de l'audience à la clôture — impossible, le plan ne part
      que **vers** `open` — et il présentait le refus de clore un brouillon comme
      tenu par les règles, alors qu'elles ne l'interdisent pas : `draft` → `open`
      est déjà permis au même acteur, publier un brouillon étant un pouvoir de la
      FCPE par conception. Ce refus nomme une méprise, il ne ferme pas une porte.
      `docs/05-notifications.md` disait de son côté « on ne se notifie jamais
      soi-même » tenue par les trois premiers déclencheurs : `onPostPublished` ne
      l'applique pas du tout, et le document dit maintenant lequel, comment, et
      pourquoi la question reste ouverte.
- [ ] **Trancher « on ne se notifie jamais soi-même » pour un envoi de masse.**
      La règle est tenue par `notifyCommentAuthor` — qui **renonce à envoyer** —
      et par `notifyChannelAudience`, où elle devient une **exclusion de
      destinataires** parce qu'un lot peut n'avoir qu'un auteur. Elle n'est
      appliquée ni par `onPostPublished` ni par `notifyPollAudience` : tous deux
      visent une **audience**, jamais une personne désignée, et l'auteur reçoit
      donc la notification de son propre contenu. La corriger suppose de décider
      si un membre de la FCPE qui publie ou qui ouvre un sondage doit être
      prévenu de sa propre action — décision produit, pas correction de code.
      `docs/05-notifications.md` l'écrit comme ouverte plutôt que de l'affirmer.
- [x] Liens profonds vers le contenu concerné — **faits pour les publications,
      les commentaires et les sondages**, les déclencheurs branchés : un
      commentaire s'ouvre dans le fil de sa publication, seul écran où il se lit,
      et un sondage s'ouvre sur son écran de vote. Les deux
      moitiés
      existent maintenant : `buildDeeplink` côté serveur, `parseDeeplink` et
      `routeForDeeplink` côté application, avec la table des routes vérifiée
      contre `apps/mobile/app/` par un test — renommer `app/post/[id].tsx`
      sans toucher à la table fait échouer la suite, au lieu de produire un tap
      qui n'ouvre rien. C'était faux jusqu'ici : la notification portait un lien
      que **personne ne lisait**, donc un tap ouvrait l'écran d'accueil, et rien
      ne le signalait.
      **Reste :** les trois autres types de cible (`channel`, `event`, `report`)
      sont reconnus mais sans écran ; ils sont déclarés dans `TYPES_SANS_ROUTE`
      avec leur raison, et le test refuse un type qui ne serait ni ouvrable ni
      excusé. `poll` n'y figure plus, et c'est la ligne d'excuse qui a dû
      disparaître le jour où l'écran est arrivé — le lien est désormais écrit
      **et** honoré, et le test de couverture l'exige des deux côtés.
      **La notification de canal n'emporte donc aucun lien**, et non un lien
      refusé : mettre dans la charge une promesse que rien n'honore serait pire
      que de n'en mettre aucune. Le jour où l'écran des discussions existera, il
      faudra retirer la ligne d'excuse **et** écrire le lien.
- [x] Écran admin : envoyer une notification ciblée, historique — le formulaire,
      la fonction appelable et la lecture de l'historique sont faits.
      **Le type ne dit pas l'urgence.** Une annonce urgente reste
      `manual_announcement` et porte `category: 'urgent'` : le type répond à
      « qu'est-ce qui a produit cet envoi » — une main —, la catégorie à
      « l'utilisateur peut-il la désactiver ». Emprunter `urgent_alert` ferait
      écrire dans l'historique qu'une publication a été créée alors que personne
      n'a publié, et l'écran ne saurait plus distinguer une annonce du bureau
      d'un fil de classe.
      **L'organisation n'est jamais transmise.** `notificationSendSchema` ne
      porte aucun `orgId` : elle est lue dans le profil de l'appelant, relu **en
      base** par la fonction. Le schéma est `.strict()`, donc un client qui
      l'ajouterait « au cas où » verrait son appel refusé — et ce serait mérité,
      une organisation fournie par le client étant une organisation qu'on peut
      choisir.
      **Le lien profond est refusé quand il n'ouvre rien.** La validation porte
      sur `routeForDeeplink`, pas sur la forme : `parseDeeplink` reconnaît cinq
      types de cible dont quatre sans écran (phases 6 à 9), et un tel lien
      passerait la validation pour échouer en silence sur le téléphone. Le jour
      où un écran apparaît, la condition s'élargit d'elle-même.
      **Le journal d'audit est écrit dans les deux issues**, y compris quand
      l'envoi est interrompu par un `401` : sans cette écriture, une tentative
      d'annonce urgente à huit cents téléphones ne laisserait aucune trace
      attribuable. `targetId` porte l'organisation, qui existe avant comme
      après ; désigner le document d'historique serait plus précis, mais il
      n'existe pas encore à l'instant où l'envoi échoue. C'est la contrepartie
      assumée de laisser tout détenteur de `notification.send` — `fcpe`,
      `moderator`, `admin`, exactement l'ensemble qui peut déjà publier une
      information urgente — envoyer une alerte : un envoi de masse est
      attribuable, pas anonyme.
      **`deliveredCount: null` s'affiche « pas encore connu ».** À l'envoi, on
      sait ce que le service a **accepté** ; les remises n'existent qu'après la
      relecture des reçus. Afficher « 0 remis » avant cette relecture
      affirmerait qu'aucun message n'est arrivé — l'inverse de la vérité, qui
      est « on ne sait pas encore ».
      **La requête de l'historique est tenue par un test, et c'est le point le
      moins visible.** Elle contraint `orgId` — les règles ne sont pas des
      filtres, un `list` non contraint est refusé — et trie sur `sentAt`
      décroissant, ce que l'écran promet en toutes lettres. Ni l'une ni l'autre
      ne se voit à la lecture : sans `orderBy`, Firestore rend un ordre par
      identifiant de document, sans erreur ni message. Et une requête non
      couverte par un index composite est refusée **à l'exécution**, avec un
      message qui ne dit pas lequel manque — donc au premier affichage de
      l'écran, en production, au moment où quelqu'un cherche à prévenir huit
      cents familles. `notifications-index.test.ts` lit donc la source du dépôt
      **et** `firestore.indexes.json`, et exige un index
      `notifications(orgId ↑, sentAt ↓)`.
      Quatorze mutations éprouvées, chacune sur son ensemble **exact** de tests
      tombés — deux d'entre elles en font tomber deux, et l'écart a été constaté
      avant d'être inscrit : l'organisation voyage jusqu'à la charge utile du
      message, et l'assertion d'index relit les champs extraits par les deux
      autres.
- [x] Alertes urgentes non désactivables — l'exception `urgent` est appliquée
      par `filterRecipients`, **refusée** par `notificationPrefsSchema`, et
      `OPTIONAL_NOTIFICATION_CATEGORIES` donne à l'écran de préférences la seule
      liste d'interrupteurs à proposer. Les trois lisent
      `MANDATORY_NOTIFICATION_CATEGORIES`, donc elles ne peuvent pas diverger.
      Le refus côté schéma n'est pas la garantie — les règles Firestore ne
      valident pas `notificationPrefs` — c'est le filtre d'envoi qui l'est ;
      le refus sert à ne pas promettre une préférence sans effet.
      **Complété :** l'exception couvre désormais l'**interrupteur général**, et
      pas seulement les préférences par catégorie. `queryTokensByAudience`
      contraignait `enabled == true` sans exception, donc un appareil éteint
      était écarté **avant** `filterRecipients` : un parent ayant coupé les
      notifications de son téléphone ne recevait plus aucune alerte urgente. La
      contrainte a été retirée de la requête, `PushRecipient` porte `enabled`, et
      la décision se prend à un seul endroit. Prix assumé : lire les appareils
      éteints de l'audience pour les écarter juste après.
      `settings.urgentAlwaysNotifies` a été **retiré** : il n'était lu par aucun
      code, et l'exception étant absolue, un booléen qui n'accepte qu'une valeur
      aurait laissé croire qu'un administrateur pouvait l'affaiblir.
- [x] **Lire les reçus Expo** (`/push/getReceipts`) — c'était le manque le plus
      important qui restait, et il n'était pas visible : le code n'appelait que
      `/push/send`, donc `deliveredCount` comptait des messages **acceptés** par
      le service, jamais des messages **remis**. Un appareil éteint depuis trois
      semaines comptait comme livré, et un écran qui aurait intitulé ce nombre
      « reçues » aurait menti sans qu'aucun test ne tombe.
      **Complété :** le champ s'appelle `acceptedCount`, `deliveredCount` vaut
      `null` tant que les reçus n'ont pas été relus, et une tâche planifiée
      horaire les relit — une heure, parce qu'un reçu reste lisible vingt-quatre
      heures et qu'un passage toutes les cinq minutes coûterait douze fois plus
      pour le même résultat. Le délai de quinze minutes recommandé par le service
      est respecté par la requête, et le document est marqué « relu » **en
      dernier**, ce qui rend le passage rejouable.
      Le détail qui a failli être manqué : **un reçu ne porte pas de jeton**, il
      désigne un ticket. Savoir qu'un appareil est mort ne disait donc pas
      lequel, et la purge aurait été impossible — le reçu aurait été lu, compté,
      et sans effet. C'est la table `pushTickets`, écrite à l'envoi, qui fait le
      pont ; elle est supprimée dès que les reçus de son envoi sont relus, et
      aucun client ne la lit, parce qu'elle contient des jetons.
- [x] Purge des jetons morts — **faite aux deux étages.** Le ticket à l'envoi,
      le reçu à la relecture. Les deux passent par `purgeDeviceTokens`, une seule
      implémentation : écrire la suppression deux fois aurait produit deux
      comportements qui divergent à la première modification.
- [x] Rendre `InvalidCredentials` visible — un jeton d'accès Expo expiré fait
      échouer **tous** les envois, et rien ne le distinguait d'un incident réseau
      passager : un `401` était journalisé comme un échec ordinaire. C'était le
      manque le plus coûteux de la phase, parce qu'il est silencieux et global.
      **Complété :** le `401` devient une `PushCredentialsError`, reconnue au
      plus près du statut HTTP. Le passage des reçus s'interrompt lui aussi sur
      ce refus, au lieu de reproduire la même erreur à chaque heure. Pour
      l'envoi, trois conséquences — il **s'interrompt** au premier refus,
      puisque le jeton est refusé pour tous les lots et qu'insister ne
      produirait que N appels identiques ; `sendToAudience` journalise à un
      niveau `error` une phrase qui dit quoi faire, puis **relance** l'erreur ;
      et rien n'est écrit, ni document d'historique ni `notifiedAt`. C'est la
      troisième qui compte : un `failedCount` de 412 aurait présenté une
      configuration cassée comme une audience injoignable — faux dans le sens
      qui rassure, puisqu'il désigne les parents au lieu du secret. La
      publication n'est donc pas marquée notifiée, ce qui est exact : rien n'est
      parti.
- [x] `MessageTooBig` — **sans objet, et mesuré.** La limite du service est de
      4096 octets par message ; au pire cas autorisé, la charge utile pèse
      **590 octets**. Le titre est borné à 140 caractères par les règles
      Firestore, le corps tronqué à 180 par `extraitNotification`, et `data`
      réduit à quatre champs bornés. Rien à implémenter : il fallait le vérifier
      au lieu de le supposer, parce qu'une troncature qui ne se déclenche jamais
      est du code mort — et ce projet en a déjà trouvé plusieurs.

**Critère de sortie :** une publication notifiée atteint les bonnes personnes
et uniquement celles-là ; les préférences sont respectées, sauf pour `urgent`.

---

## Phase 6 — Discussions

- [ ] Liste des canaux avec aperçu du dernier message
- [ ] Fil de discussion paginé (30 messages)
- [ ] Envoi de message, réponse, réaction, pièce jointe
- [ ] Signalement d'un message
- [ ] Création des 13 canaux par défaut (script d'amorçage)
- [ ] Canaux en lecture seule
- [ ] Modération : masquer un message

**Critère de sortie :** un seul listener temps réel dans toute l'application,
celui du canal ouvert.

---

## Phase 7 — Signalements

- [ ] Formulaire « Signaler un problème » (8 catégories, photos facultatives)
- [ ] Liste « mes signalements » avec statut
- [ ] Timeline visuelle du parcours
- [ ] Fil de réponses FCPE, notes internes invisibles au parent
- [ ] Écran admin : file de traitement, changement de statut, assignation
- [ ] Sujets collectifs : « Je suis concerné », compteur, mise à jour publique
- [ ] Proposition automatique de regroupement au-delà du seuil
- [ ] Tests : un parent ne lit que ses propres signalements

**Critère de sortie :** aucun signalement n'est visible publiquement sans
décision explicite de la FCPE.

---

## Phase 8 — Sondages

- [x] Le **socle de données** : `createPoll` (validation, clés d'audience, statut
      initial déduit de `notify`), `getPoll`, et les règles de lecture d'un
      sondage. C'est en écrivant ce socle qu'un défaut est apparu, et il était
      bloquant : la règle `allow create, update` fusionnait les deux cas en
      portant `unchanged('orgId')`, qui lit `resource.data` — inexistant sur une
      **création**. Aucun sondage ne pouvait donc être créé, et rien ne le
      signalait : les deux seuls tests qui s'en approchaient attendaient un
      **refus**, qu'ils obtenaient pour la mauvaise raison. La règle est
      désormais scindée, et un test qui **réussit** tient le rôle de témoin.
- [x] Création d'un sondage (options, durée, audience, anonymat) : l'écran
      d'administration (`apps/admin/src/features/polls/`) compose le formulaire
      et appelle `createPoll`. Deux points ont demandé une décision plutôt
      qu'une traduction. **`notify` n'est pas une case parmi d'autres** : c'est
      le choix du statut initial, et l'écran le présente pour ce qu'il est —
      publier maintenant, ou enregistrer en brouillon. **Les identifiants des
      réponses** (`option-1`…) sont fabriqués à la soumission, à partir de la
      position : le schéma les exige, mais rien ne les référence avant
      l'écriture, et les tenir dans l'état serait un état de plus à maintenir
      pour rien.
- [x] **Écran mobile du sondage** — `apps/mobile/app/sondage/[id].tsx` montre la
      question, permet de voter (choix unique ou multiple selon le sondage) et
      affiche les résultats **quand l'écran y a droit**. Le lien profond `poll`
      est donc ouvrable : `DEEPLINK_ROUTES` le déclare, l'excuse « l'écran des
      sondages n'existe pas encore » a disparu, et le test de couverture l'exige
      des deux côtés — une route déclarée sans dossier d'écran fait échouer la
      suite. La sélection en cours est **dérivée** (`brouillon ?? monVote`) et non
      recopiée dans un état, ce qui évite le rendu vide qu'un effet de
      synchronisation produirait. Reste ouvert : par où un parent **arrive** sur
      un sondage. L'écran n'est atteignable aujourd'hui que par une notification,
      et aucun onglet ne liste les sondages.
- [x] Le **vote** : `vote()` côté client, compteur transactionnel côté Cloud
      Function, et les règles complétées. L'unicité était déjà tenue par
      l'identifiant du document ; ce qui manquait, c'est **ce qu'un vote a le
      droit d'être**, et les règles ne le lisaient pas. Rien n'empêchait de
      voter sur un brouillon ou sur un sondage clos, ni depuis le groupe
      scolaire voisin, et `allowMultiple` comme `allowChangeVote` étaient
      déclarés dans le modèle sans être lus nulle part. Chaque clause ajoutée
      se lit dans le document parent, par un `get()` de règle. Le banc a montré
      au passage que lire un champ **absent** dans une règle lève au lieu de
      rendre `false` : deux sondages de test en étaient invotables, et deux
      tests de refus étaient verts pour cette raison-là. Les accesseurs
      replient désormais l'absence sur `false`.
- [x] Sondage anonyme (aucun `uid` stocké) — et vérifié **par les règles**, non
      par le client : un sondage `anonymous` refuse tout champ `uid`, un sondage
      nominatif l'exige.
- [x] Résultats selon la visibilité choisie — `resultsVisibility` existait, était
      validé, était stocké, et n'était lu par **personne**. Les totaux vivaient
      sur `polls/{pollId}`, que tout parent de l'organisation peut lire : les
      résultats étaient donc publics en permanence, et la promesse « les
      résultats apparaissent après le vote » était invivable. Une règle de
      lecture ne filtre pas des champs, elle ouvre ou ferme un **document
      entier** — le seul correctif possible était de **déplacer** les totaux dans
      `pollResults/{pollId}`, dont la Cloud Function est le seul écrivain, ce qui
      les rend infalsifiables. L'échelle est **emboîtée** (`always` ⊃
      `after_vote` ⊃ `after_end`), la clôture publie à tout le monde, la FCPE lit
      toujours, et le repli sur un champ absent est **fermé**. Effet de bord
      bienvenu : le document de sondage cesse d'être réécrit à chaque vote, donc
      `notifyPollAudience` n'a plus à se défendre des votes.
- [x] **Un brouillon est lisible par la FCPE** — le défaut a été trouvé en
      cherchant à écrire l'écran d'administration, et pas par un test : `allow
read` exigeait `status in ['open', 'closed']` pour **tout le monde**, si
      bien qu'un brouillon était illisible par son auteur lui-même. Trois
      endroits annonçaient pourtant le contraire — `createPoll` (« l'administration
      l'ouvrira plus tard »), le déclencheur de notification, qui n'existe que
      pour rattraper un brouillon ouvert après coup, et `docs/02-data-model.md`,
      qui écrivait déjà « un brouillon n'est lisible que par elle ». Rien ne
      comparait la règle à ce qu'elle promettait. La lecture se scinde donc en
      deux branches : la FCPE lit tous les statuts, un parent seulement les
      sondages publiés. C'est aussi ce qui rend les **requêtes** possibles, les
      règles ne filtrant pas — l'administration liste en ne contraignant que
      `orgId`, là où un écran de parent devra contraindre le statut.
- [x] **L'échelle de visibilité ne tenait pas sa troisième valeur** — trouvé en
      écrivant l'écran mobile, et pas par un test. `resultatsVisibles()` lisait
      `(visibilite() == 'always' || s.status == 'closed' || aVote())` : `aVote()`
      était un `||` **inconditionnel**, donc sous `after_end` un parent qui avait
      voté lisait le décompte en cours, alors que trois endroits disent le
      contraire — le tableau de `docs/02-data-model.md` (« lisible par la FCPE
      seule »), le commentaire de la règle, et le libellé « À la clôture
      seulement » que l'écran d'administration fait choisir. `after_end` et
      `after_vote` ne différaient plus que pour un non-votant, si bien que la
      troisième option ne voulait rien dire pour qui avait voté. Le défaut allait
      dans le sens **permissif**, et il était invisible : le seul sondage
      `after_end` ouvert n'avait **aucun vote**, donc la fixture mesurait le refus
      d'un non-votant, que la clause n'affectait pas. La garde est désormais
      `(visibilite() == 'after_vote' && aVote())`, la fixture porte un vote, et
      une mutation remet le défaut pour prouver que le test le voit.
- [x] **Les résultats à l'écran, selon la visibilité** — la lecture n'est posée
      que lorsque l'écran sait qu'il y a droit, et cette décision est prise
      **avant** l'appel : une règle de lecture ne filtre pas des champs, donc une
      lecture refusée lève, et un écran ne s'en remet pas tout seul. La décision
      vit dans `canReadPollResults` (`@fl/shared`), qui reproduit
      `resultatsVisibles()`, et un test **lit le fichier de règles** pour tenir
      l'accord : les deux sources ne peuvent pas se lire au moment de l'exécution,
      et c'est le seul endroit où elles se rencontrent. Le prédicat est plus
      strict que la règle quand le rôle est inconnu, jamais plus large — une
      divergence n'est acceptable que dans le sens qui referme.
      **Écart assumé** : une **lecture ponctuelle**, et non l'abonnement
      qu'annonçait ce point. Aucun écran de l'application n'utilise `onSnapshot` ;
      le décompte ne bouge qu'au vote d'un autre parent, il est rafraîchissable à
      la main, et un abonnement vivant rouvrirait un document chaud — exactement
      ce que le déplacement des totaux hors du sondage avait fait disparaître. Le
      suivi en direct reste utile à l'administration, pas au parent qui répond.
- [x] **Clôture manuelle et automatique** — et la décision centrale est que ce
      n'est **pas** le planificateur qui ferme le vote : c'est la **règle**.
      L'écran mobile affiche « Clôture prévue le … » et promet « Les résultats
      seront publiés à la clôture du sondage » ; un sondage encore votable quatre
      minutes après l'heure annoncée, parce que le cron n'est pas passé, serait
      donc un mensonge affiché. `echeancePassee()` compare `endsAt` à
      `request.time`, et les **deux moitiés** de la promesse en dépendent :
      `sondageOuvert()` refuse le vote après l'heure, `resultatsVisibles()`
      publie le décompte. Si l'échéance fermait le vote sans publier, l'écran
      dirait « ce sondage est clos » en annonçant des résultats à venir.
      La tâche planifiée (`onPollsDue`, toutes les cinq minutes) n'**enregistre**
      que la clôture — `status: 'closed'` et `closedAt` — pour l'affichage et pour
      que le déclencheur de notification raisonne sur une **transition de statut** ;
      une horloge ne produit pas de transition, donc ne notifie rien. Elle est
      pour cela **non critique** : le pire défaut possible est un sondage affiché
      « ouvert » qui refuse les votes — visible, et réparable à la main — alors que
      le défaut inverse changerait le résultat lui-même. La borne de vingt sondages
      par passage n'est pas qu'une question de facture : c'est elle qui rend deux
      passages chevauchants impossibles, et donc l'écriture **idempotente sans
      transaction**.
      Un sondage **sans** échéance n'est jamais ramené par la requête — une
      inégalité Firestore écarte les documents qui ne portent pas le champ — ce qui
      réserve sa clôture à la FCPE. `FauxFirestore` reproduit cette règle du
      service au lieu de l'approximer, et un test l'exige : un faux plus permissif
      que le service ne prouverait rien.
      Deux gardes tiennent l'ensemble, et chacune a sa raison. Le **type** d'`endsAt`
      est vérifié à l'écriture (`validPoll()`) parce que comparer un type inattendu
      lève, et qu'un refus par erreur ne nomme aucune clause. `echeancePassee()` lit
      `'endsAt' in s` **avant** de comparer, parce que lire un champ absent lève
      aussi — sans quoi tout sondage sans échéance, c'est-à-dire presque tous,
      deviendrait invotable et opaque, FCPE comprise.
      L'index `polls(status ↑, endsAt ↑)` est le **seul** du modèle sans `orgId` :
      le planificateur balaie toutes les organisations en un passage, et l'égalité
      précède l'inégalité, ce qui fixe l'ordre des champs. Un test lit la requête
      dans `close-due.ts` et l'index dans `firestore.indexes.json` — deux fichiers,
      deux formats, et rien entre les deux — parce que Firestore refuse une requête
      non couverte en renvoyant vers la console, sans dire lequel manque.
- [x] Écran admin : suivre et clôturer (la création est faite plus haut) —
      `apps/admin/src/features/polls/poll-list.tsx` et `poll-row.tsx`, montés
      sous le formulaire de création. La liste montre **tous** les statuts, du
      plus récent au plus ancien, et c'est une décision à deux titres : la FCPE
      suit un brouillon comme un sondage ouvert — c'est elle qui l'ouvrira — et
      un filtre de statut n'aurait rien démontré de plus, puisqu'une règle de
      requête s'évalue à partir des **seules contraintes de la requête**. La
      branche FCPE de `allow read` exige `orgId`, et `fetchForAdmin` ne
      contraint que cela. L'index `polls(orgId ↑, startsAt ↓)` est requis, et
      il est **distinct** de celui de l'écran mobile : Firestore ne sert qu'un
      **préfixe** des champs d'un index, donc `polls(orgId, status,
audienceKeys, startsAt)` ne couvre pas `where orgId orderBy startsAt` —
      `status` s'intercale. Un test tient l'accord entre la requête et sa
      déclaration, et il a été **falsifié** : index retiré, **un seul** test
      tombe (226 − 1), fichier restauré à l'octet près, empreinte vérifiée.
      Le décompte est lu **par ligne**, et seulement si le rôle y a droit : la
      branche `isFcpe()` ne dépend ni du statut ni de `resultsVisibility`, mais
      `getResults()` **lève** un refus au lieu de rendre `null` — parce que
      `null` veut dire « aucune voix », pas « je n'ai pas le droit ». La ligne
      reproduit donc `isFcpeRole(role)` avant de demander, sans en faire une
      protection : les règles restent seules juges.
      **Un fait, deux sources, une seule écrite** — c'est le défaut trouvé en
      écrivant cet écran, et il n'était pas dans l'écran neuf. Un sondage dont
      l'échéance est passée est clos **par la règle**, mais le document porte
      encore `status: 'open'` jusqu'au passage du planificateur. L'écran mobile
      affichait donc « Ouvert » dans son badge et « Ce sondage est clos. » dans
      sa phrase, à trois lignes d'écart. La dérivation est remontée dans
      `@fl/shared` (`pollEffectiveStatus`), le badge lit désormais l'état
      **effectif** et non le statut enregistré, et deux gardes la tiennent :
      l'**accord** avec `isPollOpen`, vérifié sur le produit des quatre statuts
      et des trois régimes d'échéance, et le cas du **brouillon**, qu'un repli
      trop large déclarerait clos — donc publié, alors que la règle de lecture
      n'ouvre aux parents que `open` et `closed`. Les deux ont été **falsifiées
      séparément**, et la seconde le prouve : une règle d'échéance appliquée à
      tous les statuts laisse l'accord vert et fait tomber la seule garde du
      brouillon — l'accord seul n'aurait donc pas suffi.
      Le **bouton**, lui, lit le statut **enregistré**, et les deux lectures
      répondent à deux questions différentes : on n'inscrit une clôture que sur
      un document qui porte encore `open`.
      Enfin, la clôture n'est pas présentée d'une seule façon, parce qu'elle ne
      fait pas la même chose selon le cas. **Échéance passée**, le vote est déjà
      fermé et le décompte déjà publié : le bouton ne fait qu'**inscrire** un
      fait accompli, et la confirmation le dit. **Échéance à venir ou absente**,
      la clôture **ferme le vote maintenant** — et la date annoncée aux familles
      ne sera pas honorée ; la confirmation le dit aussi, faute de quoi l'écran
      promettrait le contraire de ce que la règle applique. Une clôture déjà
      inscrite ne se réécrit pas (`close()` refuse un second appel), et **rien
      dans cet écran ne rouvre un sondage clos** : c'est une limite assumée, à
      signaler le jour où elle gênera.
- [ ] Écran admin : ouvrir un brouillon — la règle de mise à jour l'autorise
      (`allow update` n'exige pas `unchanged('status')`), le dépôt n'a pas la
      méthode, et un brouillon enregistré n'a aujourd'hui **aucun** chemin vers
      `open` depuis l'interface. C'est le pendant manquant du bouton de clôture.
- [x] Tests : double vote refusé, brouillon illisible, cloisonnement
      d'organisation, création refusée à un parent, et le vote — dont, pour
      chaque refus, **un témoin qui réussit**. Les trois visibilités ont leurs
      tests, et leurs témoins sont le **même document** lu par la FCPE, ou un
      second parent qui a voté. **Trente et une** mutations couvrent l'ensemble des
      règles de sondage ; **une** d'entre elles a un ensemble attendu vide — la
      mutation de diagnostic qui retire `exists()`, dont on veut vérifier qu'elle
      ne fait rien tomber — et c'est consigné : voir l'en-tête du banc. **Cinq**
      visent l'échéance, et leur jeu témoin **est** le sujet : chacune doit tomber
      sans qu'un cron soit passé, sinon la preuve porterait sur le planificateur au
      lieu de la règle.

**Critère de sortie :** un compte ne peut voter qu'une fois, y compris en
appelant Firestore directement.

**Deux écarts entre le modèle et les règles, constatés et non corrigés :**

- `POLL_STATUSES` déclare quatre statuts, les règles n'en acceptent que trois
  (`draft`, `open`, `closed`). `archived` n'est donc atteignable que par le
  serveur, qui contourne les règles. Un test fige cette décision ;
- l'anonymat d'un sondage est **vis-à-vis de l'application**, pas de la base :
  l'identifiant du document de vote est l'UID de l'électeur, et non une
  empreinte. C'est ce qui rend le double vote impossible, et les deux garanties
  s'excluent — une empreinte calculée par le client ne peut pas être vérifiée
  par les règles, donc un électeur déterminé voterait autant de fois qu'il
  écrirait d'empreintes. Le champ `anonymous` promet donc ce qu'il tient
  vraiment, et l'écran devra le dire ainsi.

---

## Phase 9 — Agenda et événements

- [ ] Vue calendrier (mois et liste)
- [ ] Détail d'un événement
- [ ] « Je participe » / « Je ne participe pas », nombre de participants
- [ ] Bénévoles : « Nous recherchons 5 parents bénévoles »
- [ ] Rappels automatiques configurables
- [ ] Ajout au calendrier du téléphone (ICS)
- [ ] Écran admin : créer et modifier un événement

---

## Phase 10 — Conseils d'école et espace privé FCPE

- [ ] Liste des conseils, prochaine séance mise en avant
- [ ] Ordre du jour, documents associés, compte rendu
- [ ] Proposition de question par un parent
- [ ] Espace privé FCPE : préparation, réponses, statuts
- [ ] Réponses séparées école / mairie / FCPE, action prévue
- [ ] Discussions internes, tâches, documents internes
- [ ] Tests : un parent ne lit aucune donnée `visibility: 'fcpe'`

**Critère de sortie :** la fuite d'une donnée interne FCPE est impossible,
même par requête directe.

---

## Phase 11 — Documents

- [ ] Bibliothèque classée par catégorie, année, établissement
- [ ] Upload PDF et images, avec compression
- [ ] Recherche et filtres
- [ ] Téléchargement à la demande (pas de préchargement)
- [ ] Compteur de téléchargements
- [ ] Documents internes FCPE
- [ ] Écran admin : gestion complète

---

## Phase 12 — Modération, sécurité, tests

- [ ] File de modération (`moderationReports`)
- [ ] Actions : masquer, supprimer, avertir, suspendre
- [ ] Rate limiting sur les actions sensibles — **trois mesures sont
      aujourd'hui déclarées sans être appliquées**, et `docs/04-security.md` § 6
      le dit désormais explicitement. `RATE_LIMITS` et `EDIT_WINDOW_MINUTES`
      sont déclarés dans `@fl/shared` sans aucun consommateur,
      `paths.userRateLimits()` n'est appelé par personne, `request.time`
      n'apparaît nulle part dans les règles, et aucune Function ne supprime un
      contenu au titre d'une limite. Restent à écrire : les compteurs
      `users/{uid}/private/rateLimits` et la Function qui les tient, la fenêtre
      d'édition de 30 minutes (une clause `request.time`, qui n'existe encore
      dans aucune règle du projet), et la détection de liens en masse.
      Ce qui protège réellement le service en attendant est écrit au même
      endroit : le statut `pending`, les règles Firestore, la modération
      manuelle.
- [ ] App Check : passage en mode application
- [ ] Couverture de tests complète des Security Rules
- [ ] Tests d'intégration sur émulateur
- [ ] Vérification : aucune permission accordée sans être déclarée
- [ ] Déploiement automatisé des règles et des Functions

**Critère de sortie :** la matrice TypeScript et `firestore.rules` sont
vérifiées comme concordantes par un test.

---

## Phase 13 — Finitions et préparation des stores

- [ ] Revue d'accessibilité : VoiceOver, TalkBack, contrastes, Dynamic Type
- [ ] Mode sombre vérifié sur tous les écrans
- [ ] États de chargement, vides et d'erreur sur chaque écran
- [ ] Écrans d'accueil et captures d'écran pour les stores
- [ ] Politique de confidentialité rédigée
- [ ] Textes de la fiche App Store et Play Store
- [ ] Icône, écran de lancement, nom affiché
- [ ] Écran « Mes données » : accès, export JSON, et bouton « Supprimer mon
      compte » — les trois sont annoncés à l'utilisateur, aucun n'est construit.
      L'écran de profil porte lui-même la mention « Phase 2 », et
      `docs/04-security.md` § 8 les marque désormais « non appliqué » : la
      suppression se fait aujourd'hui **sur demande à la FCPE**.
- [ ] Export RGPD vérifié de bout en bout — `user.export` et
      `user.export_data` sont déclarés, et **aucune fonction ne produit
      d'export**. C'est le droit à la portabilité, et il n'est pas exerçable.
- [ ] Anonymisation complète à la suppression d'un compte — les
      **publications** le sont, et le sont toutes depuis que la boucle reprend
      tant que la requête rend quelque chose. Les commentaires
      (`posts/{id}/comments`) et les messages (`channels/{id}/messages`)
      gardent en revanche le nom de l'intéressé, alors que le bloc de
      documentation de `cleanupDeletedUser` l'annonçait depuis le début. Une
      requête de groupe de collections est nécessaire, donc un index de groupe
      à déclarer.
- [ ] Test sur appareils réels, iOS et Android
- [ ] Première release `v1.0.0`

---

## Ordre de priorité si le temps manque

Si le projet devait être réduit, voici ce qui apporte le plus de valeur :

1. **Phase 2** — sans authentification et validation, rien n'existe.
2. **Phase 3** — le fil d'actualité est le cœur de l'application.
3. **Phase 5** — les notifications sont ce qui fait revenir les parents.
4. **Phase 4** — l'admin est indispensable à la FCPE, mais peut rester
   sommaire au début.
5. **Phase 7** — les signalements sont la raison d'être d'une association de
   parents.

Les phases 9 à 11 sont importantes mais peuvent arriver après une première
mise en service : une application qui diffuse bien les informations et permet
de signaler un problème rend déjà un immense service.
