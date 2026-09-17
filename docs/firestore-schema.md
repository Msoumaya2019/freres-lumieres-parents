# Modèle Firestore — Phase 3

| Collection                                      | Usage                              | Lecture client                   | Écriture client            |
| ----------------------------------------------- | ---------------------------------- | -------------------------------- | -------------------------- |
| `organizations`, `schools`, `levels`, `classes` | référentiels non personnels actifs | publique                         | aucune                     |
| `memberProfiles`                                | profils FCPE authentifiés          | soi/admin actif                  | champs personnels limités  |
| `posts`                                         | actualités et alertes              | publique si publiée et non FCPE  | admin seulement            |
| `events`                                        | agenda                             | publique si publiée et non FCPE  | admin seulement            |
| `canteenMenus`                                  | menus                              | publique si publié               | admin seulement            |
| `documents`                                     | bibliothèque                       | publique si publiée et non FCPE  | admin seulement            |
| `schoolCouncils`                                | conseils publics/privés            | selon publication/audience       | admin seulement            |
| `schoolCouncilPreparations`                     | notes et documents internes        | membres actifs                   | membres selon rôle         |
| `polls`                                         | sondages                           | publique si publié et non FCPE   | admin seulement            |
| `pollResponses`                                 | réponses anonymes best effort      | aucune directe                   | Function uniquement        |
| `contactConversations`                          | métadonnées privées du support     | aucune directe                   | Function uniquement        |
| `contactMessages`                               | messages visibles au parent        | aucune directe                   | Function uniquement        |
| `contactInternalNotes`                          | notes strictement FCPE             | aucune directe                   | Function membre uniquement |
| `fcpeChannels`, `fcpeMessages`                  | discussions membres                | membres actifs même organisation | membres selon rôle         |
| `notificationCampaigns`                         | envois push                        | admin                            | Function uniquement        |
| `adminLogs`, `moderationLogs`                   | audit minimal                      | rôles autorisés                  | serveur uniquement         |

Les listes publiques de la Phase 3 sont limitées et ordonnées; les index couvrent leur organisation, publication, audience et date. La pagination par curseur sera ajoutée lorsque les limites actuelles devront être dépassées. Les données publiques sont séparées par un booléen/statut de publication et une audience embarquée. Les préparations de conseil sont dans une collection distincte : les Rules refusent même un document public qui contiendrait par erreur un champ de note interne. Aucun document ne contient de profil enfant ni de commentaire public.

Les limites actuelles sont de 30 actualités, 40 événements, 12 menus, 40 documents et 20 conseils. Les chemins Storage autorisés sont `posts/{postId}`, `documents/{documentId}` et `canteen/{menuId}`; leur lecture dépend du document Firestore associé.
