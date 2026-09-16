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
// packages/firebase/src/push/dispatcher.ts
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
4. Écriture dans deviceTokens/{token}
   {
     uid, orgId,
     token,
     platform: 'ios' | 'android',
     audienceKeys: [...],        // recopiées depuis le profil
     enabled: true,
     createdAt, lastUsedAt
   }
        │
5. Le jeton est rafraîchi à chaque ouverture de l'application
   (lastUsedAt mis à jour, au plus une fois par jour)
```

L'identifiant du document **est** le jeton : l'enregistrement est idempotent.
Un même appareil partagé entre deux comptes met à jour `uid` plutôt que de
créer un doublon.

### Cycle de vie

| Événement                        | Action                                                                     |
| -------------------------------- | -------------------------------------------------------------------------- |
| Connexion                        | enregistrement du jeton                                                    |
| Déconnexion                      | `enabled = false` (on ne supprime pas : l'utilisateur peut se reconnecter) |
| Changement d'enfants / de classe | recalcul de `audienceKeys` par Cloud Function                              |
| Modification des préférences     | recalcul de `audienceKeys`                                                 |
| Erreur `DeviceNotRegistered`     | suppression du jeton                                                       |
| 180 jours sans activité          | purge par tâche planifiée                                                  |

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
const tokens = await db
  .collection('deviceTokens')
  .where('orgId', '==', orgId)
  .where('enabled', '==', true)
  .where('audienceKeys', 'array-contains-any', audienceKeys)
  .limit(100)
  .get();
```

**Une seule requête, aucun accès à `users`.** Les clés sont recopiées dans le
jeton d'appareil précisément pour cela.

> Coût typique : 300 parents → 3 lots de 100 jetons → 3 requêtes Firestore et
> 3 appels HTTP. Négligeable.

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

`users/{uid}.notificationPrefs.disabledCategories` est recopié par Cloud
Function dans le champ `enabled` et `audienceKeys` du jeton… **Non :** ce
serait insuffisant, car une même catégorie peut viser plusieurs audiences.

La solution retenue est un filtre serveur explicite :

```ts
const tokens = await queryByAudience(orgId, audienceKeys);
const recipients = tokens.filter((t) => !t.disabledCategories.includes(category));
```

`disabledCategories` est donc **recopié dans `deviceTokens`** (dénormalisé,
maintenu par Cloud Function). Cela évite de lire les profils utilisateurs au
moment de l'envoi, tout en permettant un filtrage par catégorie.

> Pour la catégorie `urgent`, le filtre n'est jamais appliqué, et les
> préférences ne peuvent pas la désactiver côté interface.

### Cas particulier : les alertes urgentes

Une publication de catégorie `urgent` :

- apparaît **en tête du fil**, avec un bandeau rouge et une icône dédiée ;
- génère une notification à **tous** les appareils de l'audience, quelles que
  soient les préférences ;
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

---

## 7. Envoi : où et comment

| Envoi               | Déclencheur                            | Fonction                                    |
| ------------------- | -------------------------------------- | ------------------------------------------- |
| À la publication    | case « notifier » cochée à la création | `onPostPublished`                           |
| Nouveau commentaire | `onDocumentCreated('comments/{id}')`   | `notifyCommentAuthor`                       |
| Réponse             | idem, avec `parentId`                  | `notifyCommentAuthor`                       |
| Nouveau message     | `onDocumentCreated('messages/{id}')`   | `notifyChannelAudience` (avec regroupement) |
| Nouveau sondage     | `onDocumentCreated('polls/{id}')`      | `notifyPollAudience`                        |
| Signalement         | `onDocumentUpdated('reports/{id}')`    | `notifyReportAuthor`                        |
| Rappel d'événement  | tâche planifiée horaire                | `sendEventReminders`                        |
| Manuel              | depuis l'admin                         | `sendManualNotification` (callable)         |

Chaque envoi écrit un document dans `notifications/{id}` avec les compteurs
`deliveredCount` et `failedCount`. L'administration dispose ainsi d'un
historique complet : qui a envoyé quoi, à qui, quand.

### Gestion des erreurs

| Erreur Expo/FCM       | Action                                                                                |
| --------------------- | ------------------------------------------------------------------------------------- |
| `DeviceNotRegistered` | suppression du jeton                                                                  |
| `MessageTooBig`       | troncature et nouvel essai                                                            |
| `MessageRateExceeded` | attente exponentielle, nouvel essai                                                   |
| `InvalidCredentials`  | **alerte immédiate** dans `adminLogs` : le jeton d'accès Expo est probablement expiré |

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
