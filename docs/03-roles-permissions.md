# 03 — Rôles, permissions et authentification

> Phase 1 · Document de référence

## 1. Les quatre rôles

| Rôle        | Qui                                 | Peut                                                                                                                                   | Ne peut pas                                                       |
| ----------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `parent`    | Tout parent d'élève inscrit         | Lire le fil, commenter, discuter, voter, signaler, proposer une question au conseil, s'inscrire aux événements                         | Publier dans le fil, modérer, accéder à l'espace FCPE             |
| `fcpe`      | Membre élu de la FCPE               | Publier, créer des sondages, traiter les signalements, gérer l'agenda, les documents et les conseils d'école, accéder à l'espace privé | Gérer les comptes, modifier les rôles, supprimer un compte        |
| `moderator` | Membre FCPE chargé de la modération | Tout ce que fait `fcpe`, plus : masquer un contenu, traiter la file de modération, suspendre un compte                                 | Modifier un rôle, supprimer un compte, accéder au journal d'audit |
| `admin`     | Responsable technique               | Tout, y compris la gestion des comptes, des rôles, des paramètres et le journal d'audit                                                | —                                                                 |

**Choix de conception :** les rôles ne sont **pas hiérarchiques** au sens où un
rôle supérieur hériterait automatiquement. La matrice déclare explicitement
chaque permission pour chaque rôle. C'est plus verbeux, mais cela évite le
piège classique : le jour où l'on ajoute une permission « sensible » à `fcpe`,
elle se retrouve accordée à `moderator` et `admin` par héritage implicite,
sans que personne ne l'ait décidé.

La matrice vit dans `packages/shared/src/permissions.ts`. Elle contient
**59 permissions** réparties en 11 domaines.

---

## 2. Le cycle de vie d'un compte

```
                 ┌──────────────────────┐
   inscription   │       pending        │  aucune lecture possible
   ─────────────►│  en attente FCPE     │  sauf son propre profil
                 └──────────┬───────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
       approbation      rejet        (silence)
              │             │
              ▼             ▼
     ┌──────────────┐  ┌───────────┐
     │    active    │  │ rejected  │
     └──────┬───────┘  └───────────┘
            │
      suspension
            │
            ▼
     ┌──────────────┐
     │  suspended   │
     └──────┬───────┘
            │  réactivation
            └──────────► active
```

### Un compte `pending` ne voit rien

C'est la contrainte la plus importante du cahier des charges. Elle est
appliquée par les Security Rules, sur le **claim `status`** :

```
function isActive() {
  return isSignedIn() && request.auth.token.status == 'active';
}
```

Un utilisateur `pending` peut uniquement :

- lire et modifier son propre document `users/{uid}` (compléter son profil) ;
- lire la liste des écoles et des classes (nécessaire au formulaire) ;
- supprimer son propre compte.

Il ne peut lire aucune publication, aucun canal, aucun message. Même en
appelant Firestore directement avec un script, il n'obtient rien.

### Ce que voit l'utilisateur en attente

Un écran dédié, chaleureux, qui explique : « Votre inscription a bien été
reçue. Un membre de la FCPE va la valider, en général sous 24 à 48 h. »
Accompagné de ce qu'il peut déjà faire (compléter son profil, ajouter un
second enfant) et d'un bouton de contact.

---

## 3. Custom Claims : la stratégie

### Le problème

Les règles Firestore peuvent lire un document :
`get(/databases/$(db)/documents/users/$(uid)).data.role`.

Mais **cette lecture est facturée** à chaque évaluation de règle. Sur une
application qui évalue plusieurs règles par requête, la facture devient
significative, et la latence augmente.

### La solution

Les Custom Claims sont embarqués dans le jeton d'authentification. Les règles
les lisent gratuitement et instantanément.

```json
{
  "role": "fcpe",
  "status": "active",
  "orgId": "fcpe-montmagny",
  "orgIds": ["fcpe-montmagny"]
}
```

### Ce qui est volontairement absent des claims

- **`schoolIds`, `levels`, `classIds`** : non nécessaires aux règles. Les
  règles vérifient l'appartenance à l'organisation, pas le ciblage. Les
  inclure ferait grossir le jeton à chaque ajout d'enfant, pour aucun gain.
- **Toute donnée personnelle** : les claims sont lisibles par le client qui
  les détient et peuvent fuiter dans des journaux. Nom, e-mail, âge des
  enfants n'y ont rien à faire.

Les claims restent sous **200 octets**. La limite est de 1000.

### Quand les claims sont-ils mis à jour ?

| Événement           | Déclencheur                        | Effet                                           |
| ------------------- | ---------------------------------- | ----------------------------------------------- |
| Création du compte  | `onDocumentCreated('users/{uid}')` | `role: parent`, `status: pending`               |
| Approbation / rejet | action admin → Cloud Function      | `status: active` / `rejected`                   |
| Suspension          | action admin → Cloud Function      | `status: suspended` + **révocation des jetons** |
| Changement de rôle  | action admin → Cloud Function      | nouveau `role`                                  |
| Suppression         | `onDelete` Auth                    | suppression des données associées               |

### Le délai de propagation, et comment il est traité

Un Custom Claim est appliqué au **prochain rafraîchissement du jeton**. Un
jeton d'identification Firebase est valide **une heure**. Sans précaution, un
utilisateur suspendu pourrait donc conserver un accès jusqu'à une heure.

Traitement en trois couches :

1. **Révocation immédiate.** La suspension appelle
   `revokeRefreshTokens(uid)`. Le SDK client détecte l'échec de
   rafraîchissement, déconnecte l'utilisateur et le renvoie à l'écran de
   connexion. En pratique, l'effet est quasi immédiat sur une application
   active.
2. **Claims à jour au prochain rafraîchissement** (≤ 1 h), y compris si
   l'utilisateur était hors ligne pendant la suspension.
3. **Défense en profondeur côté serveur.** Toute action sensible passe par une
   Cloud Function qui **relit** `users/{uid}.status` dans Firestore avant
   d'agir. Elle ne se contente jamais du claim. Même avec un jeton périmé,
   aucune action sensible n'aboutit.

Cette fenêtre d'une heure est **assumée et documentée** : elle ne concerne que
la lecture de contenus non sensibles, jamais les actions. C'est le compromis
standard de Firebase, et il est correctement couvert.

### Le miroir en base

`users/{uid}` contient aussi `role` et `status`. Ce n'est **pas** une
duplication subie :

- l'administration a besoin de **requêter** (« tous les comptes en attente »),
  ce qu'un claim ne permet pas ;
- l'affichage a besoin du rôle sans dépendre du jeton ;
- un test vérifie que les deux sources concordent après chaque écriture.

---

## 4. Permissions : trois niveaux, un seul juge

```
Niveau 1 — Interface       hasPermission(role, 'post.create')
           Masque le bouton « Publier ». Confort, pas sécurité.

Niveau 2 — Couche services  Vérification avant l'appel réseau.
           Échoue vite, message clair. Confort, pas sécurité.

Niveau 3 — SECURITY RULES   Le seul juge.
           Et Cloud Functions pour les actions privilégiées.
```

### La règle non négociable

> **Masquer un bouton n'est pas une mesure de sécurité.**

Le mobile et l'admin partagent le même SDK Firebase. N'importe qui peut
extraire la configuration client (elle est publique par nature) et appeler
Firestore directement avec `curl` ou un script Node. Les seules barrières qui
comptent sont les Security Rules et les Cloud Functions.

C'est pourquoi la CI contient un test qui vérifie que la matrice TypeScript et
`firestore.rules` restent synchronisées : si quelqu'un ouvre une permission
dans les règles sans la déclarer, la CI échoue.

### Les actions qui ne passent jamais par une écriture client

Certaines opérations ne peuvent pas être sécurisées par une simple règle
Firestore. Elles passent obligatoirement par une Cloud Function, qui
revalide tout :

| Action                                           | Pourquoi une Function                                   |
| ------------------------------------------------ | ------------------------------------------------------- |
| Approuver / rejeter / suspendre un compte        | modifier un Custom Claim est réservé à l'Admin SDK      |
| Changer un rôle                                  | idem                                                    |
| Envoyer une notification ciblée                  | l'API d'envoi détient une clé privée                    |
| Incrémenter les compteurs d'un sondage           | le client ne doit pas pouvoir écrire un résultat        |
| Supprimer un compte (RGPD)                       | opération multi-collections + suppression Auth          |
| Exporter les données d'un utilisateur            | nécessite l'Admin SDK — **pas encore écrit**            |
| Journaliser une action sensible dans `adminLogs` | le journal doit être non falsifiable                    |
| Écrire dans `counters`                           | sinon les chiffres du tableau de bord sont manipulables |

---

## 5. Permissions par domaine

Extrait de la matrice (`packages/shared/src/permissions.ts`) :

### Publications

| Permission        | parent | fcpe | moderator | admin |
| ----------------- | :----: | :--: | :-------: | :---: |
| `post.create`     |   ✗    |  ✓   |     ✓     |   ✓   |
| `post.update.own` |   ✗    |  ✓   |     ✓     |   ✓   |
| `post.update.any` |   ✗    |  ✗   |     ✓     |   ✓   |
| `post.delete.own` |   ✗    |  ✓   |     ✗     |   ✓   |
| `post.delete.any` |   ✗    |  ✗   |     ✗     |   ✓   |
| `post.pin`        |   ✗    |  ✗   |     ✓     |   ✓   |

> Note : `post.delete.own` est accordé à `fcpe` mais pas à `moderator`. Un
> membre FCPE peut retirer sa propre publication ; un modérateur qui n'est pas
> l'auteur ne peut que la **masquer**, pas la supprimer. C'est volontaire :
> masquer est réversible et traçable, supprimer ne l'est pas.

### Signalements

| Permission              | parent | fcpe | moderator | admin |
| ----------------------- | :----: | :--: | :-------: | :---: |
| `report.create`         |   ✓    |  ✓   |     ✓     |   ✓   |
| `report.read.own`       |   ✓    |  ✓   |     ✓     |   ✓   |
| `report.read.any`       |   ✗    |  ✓   |     ✓     |   ✓   |
| `report.update.status`  |   ✗    |  ✓   |     ✓     |   ✓   |
| `report.reply.public`   |   ✗    |  ✓   |     ✓     |   ✓   |
| `report.reply.internal` |   ✗    |  ✓   |     ✓     |   ✓   |

Un parent ne voit **que ses propres signalements**. La règle Firestore filtre
sur `authorId == request.auth.uid`, ce qui rend la fuite impossible même en
interrogeant la collection entière.

### Administration

| Permission         | parent | fcpe | moderator | admin |
| ------------------ | :----: | :--: | :-------: | :---: |
| `user.read.any`    |   ✗    |  ✓   |     ✓     |   ✓   |
| `user.approve`     |   ✗    |  ✗   |     ✗     |   ✓   |
| `user.suspend`     |   ✗    |  ✗   |     ✓     |   ✓   |
| `user.role.change` |   ✗    |  ✗   |     ✗     |   ✓   |
| `user.delete`      |   ✗    |  ✗   |     ✗     |   ✓   |
| `settings.update`  |   ✗    |  ✗   |     ✗     |   ✓   |
| `audit.read`       |   ✗    |  ✗   |     ✗     |   ✓   |

`user.read.any` est accordé à `fcpe` : un membre de la FCPE doit pouvoir
retrouver un parent qui l'a contacté. Mais il ne voit pas les comptes
suspendus en détail, et la lecture reste cloisonnée à son organisation.

**La journalisation des consultations n'existe pas.** Une version antérieure de
ce paragraphe affirmait que « chaque consultation est journalisée ». C'était
faux : `writeAuditLog` n'est appelé que par **deux** fichiers —
`functions/src/callable/admin-users.ts`, dont trois appels produisent les six
actions de compte, et `functions/src/callable/send-notification.ts`, dont deux
appels produisent `notification.send` — soit **sept actions**, la liste
`AUDITED_ACTIONS`. Consulter une fiche n'écrit rien. Elle ne _peut_ rien écrire
depuis le client, puisque les règles réservent l'écriture de `adminLogs` au
serveur, administrateur compris. Rendre la phrase vraie demande une Cloud
Function appelée à chaque consultation : la décision est portée avec celle de
la recherche d'un compte, dans `docs/04-security.md` § 10, parce que les deux
n'en font qu'une.

---

## 6. Création du premier administrateur

Problème classique de l'amorçage : les Custom Claims ne peuvent être écrits
que par l'Admin SDK, donc par une Cloud Function, qui exige elle-même un
administrateur.

**Procédure retenue** — un script local, jamais exposé par une API :

```bash
# 1. Créer le compte depuis l'application mobile (inscription normale)
# 2. Récupérer l'UID dans la console Firebase > Authentication
# 3. Élever le compte :

node scripts/bootstrap-admin.mjs --email administrateur@exemple.fr

# Le script :
#   - refuse de s'exécuter si le projet cible n'est pas explicitement nommé
#   - écrit role=admin, status=active dans Firestore ET dans les claims
#   - n'écrit **pas** dans adminLogs, contrairement à ce que ce paragraphe
#     affirmait : l'Admin SDK contourne les règles, donc il le pourrait, mais
#     l'amorçage n'a aucun acteur à nommer — c'est la seule action
#     d'administration dans ce cas. À trancher, pas à oublier.
#   - affiche un rappel : « supprimez ce script ou protégez-le »
```

Ce script utilise un fichier de compte de service **jamais commité**
(`GOOGLE_APPLICATION_CREDENTIALS`). Il est documenté dans le README et
volontairement absent de toute API HTTP.

Une fois le premier administrateur créé, tous les suivants le sont depuis
l'interface d'administration.

---

## 7. Ce qui reste à décider

- **Un `fcpe` peut-il publier sans validation ?** Proposition : oui, avec
  journalisation et possibilité de masquage a posteriori par un modérateur.
  Un flux de validation préalable serait plus sûr mais ajouterait une friction
  importante pour un bureau de bénévoles.
- **Faut-il un rôle `teacher` ou `city` ?** Non retenu en V1. Les informations
  de la mairie passent par la FCPE, ce qui évite de gérer des comptes
  institutionnels et clarifie la responsabilité éditoriale.
