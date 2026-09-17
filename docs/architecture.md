# Architecture de référence — Phase 2

Le produit conserve le monorepo pnpm, Expo SDK 57, Expo Router, Next.js 16, Firebase et les workflows GitHub existants. Il n’existe plus de compte public : le mobile ouvre directement `Accueil / Agenda / Cantine / Contact / Plus`. Firebase Authentication est réservé aux rôles `fcpe`, `moderator` et `admin`.

```text
apps/mobile              client public immédiat + futur espace membre
apps/admin               administration Next.js
packages/types           contrats partagés sans profil parent
packages/validation      validation Zod des entrées
packages/shared          permissions membres et topics publics
packages/firebase-config SDK client modulaire
functions                frontières serveur privilégiées
firebase                 Rules et index
```

## Décisions

- Les contenus explicitement publiés et d’audience non `fcpe` sont lisibles sans Auth. École, niveau et classe servent au classement/ciblage, pas à identifier une famille.
- Les profils authentifiés sont des `memberProfiles`. Le rôle par défaut d’une demande membre est `fcpe/pending`; seul un admin peut changer rôle ou statut via Function et Custom Claims.
- Les commentaires publics, profils enfants, forums parent-parent, votes liés à un UID et signalements propriétaires sont supprimés.
- Les conversations sans compte ne sont jamais accessibles directement via Firestore ou Storage, même à un client admin. Une couche Functions dédiée sera la seule frontière d’accès.
- Le design system existant (crème, vert profond, couleurs sémantiques) est conservé et appliqué aux nouveaux placeholders.
- CNG reste utilisé : `ios/` et `android/` sont générés, pas versionnés.

## Chat sans compte préparé pour la Phase 6

`createContactConversation` générera un `conversationId` opaque et un secret aléatoire d’au moins 256 bits. Le secret brut sera retourné une seule fois, conservé par `expo-secure-store` sur le téléphone, jamais journalisé ni placé dans une URL. Firestore ne conservera qu’un hash avec sel/pepper serveur. `sendContactMessage`, `getContactConversation` et `getContactMessages` exigeront le couple identifiant/secret, App Check, validation Zod, statut compatible et limites anti-abus.

Les pièces jointes utiliseront une autorisation serveur et une URL signée courte; `contact/**` est fermé par Storage Rules. Les `contactInternalNotes` seront servies par un endpoint membre séparé et ne pourront jamais être incluses dans une réponse publique. Les données privées seront paginées et les conversations fermées auront un `retentionUntil`.

## Parcours membre Phase 2

1. Firebase Auth crée une identité email/mot de passe uniquement depuis « Espace membres FCPE ».
2. `registerMemberProfile` revalide une organisation active, crée un profil `fcpe/pending` et pose les Custom Claims. L’opération est idempotente pour permettre une reprise après coupure réseau.
3. Un membre `pending`, `suspended` ou `rejected` peut relire uniquement son profil de statut; il ne peut lire aucun contenu FCPE.
4. Un administrateur actif approuve, suspend, refuse, réactive ou change le rôle via Functions.
5. Les Functions vérifient l’organisation, interdisent l’auto-modification de l’admin, reconstruisent les claims depuis le profil et journalisent l’action.
6. Seul un profil `active` avec rôle `fcpe`, `moderator` ou `admin` franchit la garde de l’espace privé mobile.

## Coûts et builds

Les lectures publiques utilisent des requêtes bornées et paginées. Les topics FCM évitent une écriture par destinataire. Aucune vidéo n’est prévue. Le workflow iOS reste sur `macos-26`, Xcode 26.4.1, CocoaPods 1.17.0, Expo 57.0.23 et produit une IPA `iphoneos` ARM64 non signée. Le modèle sans compte ne modifie ni le prebuild iOS ni Android.
