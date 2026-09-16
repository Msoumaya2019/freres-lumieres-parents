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

**Non vérifiable sur la machine de développement :** `npm run rules:test`
exige Java 21 ; la machine ne dispose que de Java 8. Les tests sont donc
ignorés localement et exécutés en intégration continue, où le workflow installe
Java 21. C'est une limite d'environnement, pas un défaut du projet — mais elle
signifie que **la première exécution réelle des tests de règles aura lieu dans
la CI**, et qu'il faut la surveiller de près.

---

## Phase 2 — Firebase, authentification, inscription, validation

**Objectif :** un parent peut créer un compte, un administrateur peut le
valider, et un compte non validé ne voit rien.

- [ ] Configuration des deux projets Firebase (dev / prod) + émulateurs
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
- [ ] Tests des règles exécutés réellement — **réservé à la CI** (JDK 21 requis)

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

**Le critère de sortie de la phase est couvert, mais pas encore exécuté.** Les
tests de règles contiennent bien les cas qui comptent — un compte `pending` ne
peut ni lire une publication publiée ni lister le fil, un compte suspendu ou
refusé non plus, un visiteur anonyme non plus, et un compte `pending` peut
seulement lire son propre profil (sans quoi il ne saurait pas où en est sa
demande). Mais ces tests exigent l'émulateur Firestore, donc **JDK 21**, et
firebase-tools refuse toute version antérieure :

```
Error: firebase-tools no longer supports Java version before 21.
```

Seul Java 8 est présent sur le poste de développement. Ces 40 tests sont donc
**écrits mais jamais passés en local** : leur première exécution réelle aura
lieu en CI, où le job `rules` installe Temurin 21. C'est un angle mort assumé
et connu, pas un oubli — il est signalé ici pour qu'il ne soit pas pris pour
une couverture acquise.

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

- [ ] Fil d'actualité paginé (10 par page, scroll infini)
- [ ] Filtres par catégorie
- [ ] Épinglage en tête
- [ ] Détail d'une publication, pièces jointes, lien externe
- [ ] Commentaires, réponses à un commentaire, réactions
- [ ] Compression des images avant upload
- [ ] Écran admin : créer, modifier, épingler une publication
- [ ] Compteurs dénormalisés (`commentCount`, `reactionCount`)
- [ ] Tests : création de publication, ciblage d'audience, lecture filtrée

**Critère de sortie :** le fil se charge en une requête ; un parent ne voit
que les publications de son audience.

---

## Phase 4 — Interface Web Admin

- [ ] Coquille de tableau de bord responsive, navigation latérale
- [ ] Authentification admin (réservée aux rôles `moderator` et `admin`)
- [ ] Tableau de bord alimenté par `counters` et `highlights`
- [ ] Gestion des utilisateurs : recherche, filtres, détail, actions
- [ ] Journal d'audit (`adminLogs`) : consultation
- [ ] Paramètres de l'organisation

**Critère de sortie :** l'admin est utilisable sur téléphone, tablette et
ordinateur ; un parent qui tente d'y accéder est refusé.

---

## Phase 5 — Notifications push

- [ ] Enregistrement des jetons (`deviceTokens`)
- [ ] Écran de préférences par catégorie
- [ ] `ExpoPushDispatcher` derrière l'interface `PushDispatcher`
- [ ] Les 7 déclencheurs (publication, commentaire, réponse, message, sondage, signalement, rappel)
- [ ] Regroupement des messages (fenêtre de 5 minutes)
- [ ] Liens profonds vers le contenu concerné
- [ ] Écran admin : envoyer une notification ciblée, historique
- [ ] Alertes urgentes non désactivables
- [ ] Purge des jetons morts

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

- [ ] Création d'un sondage (options, durée, audience, anonymat)
- [ ] Vote avec unicité garantie par l'identifiant du document
- [ ] Résultats en temps réel selon la visibilité choisie
- [ ] Sondage anonyme (aucun `uid` stocké)
- [ ] Clôture manuelle et automatique
- [ ] Écran admin : créer, suivre, clôturer
- [ ] Tests : double vote refusé, anonymat respecté

**Critère de sortie :** un compte ne peut voter qu'une fois, y compris en
appelant Firestore directement.

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
- [ ] Rate limiting sur les actions sensibles
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
- [ ] Export RGPD vérifié de bout en bout
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
