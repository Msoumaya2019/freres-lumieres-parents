# Architecture — Phase 1

## Décision

Le produit est un monorepo pnpm composé de deux clients, de quatre packages partagés et d’un backend Firebase :

```text
apps/mobile       Expo SDK 57 + React Native + Expo Router
apps/admin        Next.js 16 App Router
packages/types    contrats TypeScript
packages/validation schémas Zod
packages/shared   permissions et logique pure partagée
packages/firebase-config initialisation modulaire du SDK client
functions         Cloud Functions Node.js 22
firebase          règles et index
```

Les besoins fonctionnels du cahier des charges sont conservés. Les phases suivantes les implémenteront sans remplacer les fondations de sécurité.

## Choix majeurs et impacts

| Sujet         | Décision                                                                    | Pourquoi / avantages                                                   | Inconvénients                                                 | Coûts                                     | Maintenance                         | Builds mobiles                                     |
| ------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------- | ----------------------------------- | -------------------------------------------------- |
| Mobile        | Expo SDK 57.0.23, React Native 0.86.3, Expo Router                          | Une base iOS/Android, CNG, écosystème stable                           | Les personnalisations natives doivent être des config plugins | Aucun coût Expo obligatoire               | Mises à niveau SDK planifiées       | `prebuild` génère iOS/Android, EAS reste optionnel |
| Backend       | Firebase modulaire, émulateurs par défaut                                   | Auth, règles, stockage et Functions cohérents, faible exploitation     | Verrouillage fournisseur et modélisation NoSQL                | Quotas gratuits puis paiement à l’usage   | Peu d’infrastructure                | Le SDK JS ne bloque ni Xcode ni Gradle             |
| Admin         | Next.js 16 sans Firebase Admin dans le navigateur                           | UI moderne, hébergement flexible, privilèges uniquement dans Functions | Une Function est nécessaire pour les mutations sensibles      | Statique/Node selon hébergeur             | App Router documenté et courant     | Aucun impact sur le natif                          |
| Monorepo      | pnpm workspaces, sans Turborepo                                             | Suffisant pour 2 apps, moins de configuration                          | Pas de cache distribué                                        | Gratuit                                   | Scripts explicites et simples       | Le workspace mobile est compilable isolément       |
| Autorisation  | Custom Claims + document utilisateur minimal                                | Les règles voient rôle, statut et audiences sans lecture additionnelle | Rafraîchissement du token après changement                    | Réduit les lectures de règles             | Synchronisation des claims à tester | Indépendant de la plateforme                       |
| Notifications | Topics non sensibles, ciblage serveur pour audiences privées                | Évite un document par utilisateur et protège FCPE/classes              | Gestion des tokens plus élaborée                              | FCM sans coût direct, Functions à l’usage | Nettoyage des tokens nécessaire     | Configuration native ajoutée en Phase 5            |
| Données       | Collections racines, audience embarquée, IDs de participation déterministes | Pagination globale et anti-doublon simples                             | Dénormalisation contrôlée                                     | Lectures prévisibles                      | Index et migrations documentés      | Aucun impact                                       |
| iOS unsigned  | CNG, `macos-26`, Xcode 26.4.1, CocoaPods 1.17.0                             | Versions réellement présentes et compatibles Expo 57                   | Image à mettre à jour lorsqu’elle sera retirée                | Runner public GitHub hébergé              | Workflow autonome et vérifiable     | Produit un bundle `iphoneos` ARM64 non signé       |

Les versions Node, pnpm et les actions GitHub sont également épinglées. Le tag de runner GitHub est nécessairement une image roulante ; les assertions sur le chemin et la version de Xcode, CocoaPods et l’architecture transforment toute dérive incompatible en échec lisible.

## Frontières de confiance

1. Les clients sont hostiles par principe.
2. `hasPermission` sert uniquement à adapter l’interface.
3. Firestore Rules et Storage Rules contrôlent chaque accès direct.
4. Les changements de rôle/statut, notifications et suppressions sensibles passent par Functions.
5. Les Functions reconstruisent les Custom Claims depuis le profil Firestore ; elles n’acceptent jamais les claims fournis par le client.
6. Aucun secret serveur n’est requis dans les apps.

## Environnements

- `demo-freres-lumieres` : identifiant réservé aux émulateurs.
- `freres-lumieres-dev` : futur projet Firebase de développement.
- `freres-lumieres-prod` : futur projet Firebase de production.

Le seed exige simultanément `FIREBASE_AUTH_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST` et un project ID commençant par `demo-`. Ces barrières empêchent toute écriture accidentelle dans Auth ou Firestore de production.

## Continuous Native Generation

`apps/mobile/ios` et `apps/mobile/android` sont ignorés par Git. Le code natif est généré à partir de `app.json` et des config plugins. Ce choix évite les diffs natifs obsolètes et garantit que GitHub Actions teste la génération réelle. Une personnalisation native future devra être déclarative ; si cela devient impraticable, une ADR pourra décider de versionner les dossiers.

## Évolutivité

Chaque ressource métier porte `organizationId`. Les audiences portent un type et une liste d’identifiants. La première organisation peut donc accueillir d’autres écoles, puis d’autres organisations, sans dupliquer les collections. Les listes présentes dans les Custom Claims doivent rester petites ; si le produit dépasse cette hypothèse, elles seront remplacées par des documents de membership et des Functions de lecture dédiées.
