# Modèle Firestore

## Principes

- Collections racines pour les flux paginés et les vues d’administration.
- `organizationId` obligatoire sur toute donnée cloisonnée.
- `audience: { type, ids }` sur les contenus ciblés.
- `Timestamp` Firestore en stockage ; formatage français uniquement dans l’UI.
- Compteurs dénormalisés (`participantCount`, `supporterCount`) mis à jour de façon transactionnelle côté serveur.
- Aucun nom complet d’enfant : `ChildProfile.label` est facultatif et non nécessaire au fonctionnement.

## Collections

| Collection                  | Rôle                                     | Accès principal                                       | Pagination/index                    |
| --------------------------- | ---------------------------------------- | ----------------------------------------------------- | ----------------------------------- |
| `users`                     | profil, rôle miroir, statut, préférences | soi-même; admin en lecture; mutation sensible serveur | statut + date                       |
| `organizations`             | tenant                                   | membres actifs                                        | slug                                |
| `schools`                   | établissements                           | membres de l’organisation                             | organisation                        |
| `classes`                   | classes/année scolaire                   | membres de l’organisation                             | école + année                       |
| `childProfiles`             | rattachements scolaires minimaux         | parent propriétaire, admin                            | parentUserId                        |
| `posts`                     | actualités                               | audience                                              | organisation + statut + publishedAt |
| `comments`                  | commentaires de publication              | audience du post                                      | postId + createdAt                  |
| `discussionChannels`        | canaux                                   | audience                                              | organisation + nom                  |
| `messages`                  | messages                                 | audience du canal                                     | channelId + createdAt               |
| `polls`                     | sondages                                 | audience                                              | organisation + endsAt               |
| `pollVotes`                 | un vote par parent/sondage               | serveur/admin; création propriétaire                  | ID `${pollId}_${uid}`               |
| `reports`                   | signalements individuels                 | auteur; FCPE si partagé; modération                   | organisation + statut + updatedAt   |
| `collectiveIssues`          | sujets collectifs                        | audience                                              | organisation + statut               |
| `collectiveIssueSupporters` | « je suis concerné »                     | serveur/modération                                    | ID `${issueId}_${uid}`              |
| `events`                    | agenda/événements                        | audience                                              | organisation + startsAt             |
| `documents`                 | métadonnées Storage                      | audience                                              | organisation + année                |
| `schoolCouncils`            | conseils et ordre du jour                | audience                                              | école + scheduledAt                 |
| `notifications`             | centre de notifications optionnel        | audience                                              | createdAt                           |
| `fcpeContent`               | espace interne                           | FCPE, modérateur, admin                               | organisation + type                 |
| `moderationReports`         | file de modération                       | modérateur, admin                                     | statut + createdAt                  |
| `adminLogs`                 | journal append-only serveur              | admin en lecture                                      | organisation + createdAt            |

## Audiences

```ts
type Audience =
  | { type: 'all'; ids: [] }
  | { type: 'school'; ids: string[] }
  | { type: 'level'; ids: string[] }
  | { type: 'class'; ids: string[] }
  | { type: 'fcpe'; ids: [] };
```

Les requêtes clientes doivent inclure les contraintes compatibles avec les règles. Firestore ne filtre pas après coup : une requête potentiellement capable de retourner un document interdit est rejetée.

## Pagination

Les fils utilisent `orderBy`, `limit` et `startAfter`. Aucun écran ne doit créer un listener global. Un listener temps réel est réservé à une vue ouverte où le bénéfice est concret, par exemple un canal de discussion visible; il est détaché à la sortie.

## Pièces jointes

Firestore stocke uniquement métadonnées, type MIME, taille et chemin Storage. Images : JPG/PNG/WEBP, 5 Mio maximum après compression. Documents : PDF ou image, 10 Mio maximum. Aucune vidéo en V1.
