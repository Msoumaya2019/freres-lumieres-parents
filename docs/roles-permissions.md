# Rôles et permissions

L’utilisateur public n’est pas un rôle Firebase : il n’a ni compte, ni Custom Claims, ni profil. Il peut seulement lire les ressources explicitement publiques et utiliser plus tard les endpoints App Check du contact/sondage.

| Capacité                                        | FCPE | Modérateur | Admin |
| ----------------------------------------------- | :--: | :--------: | :---: |
| Espace privé et discussions FCPE                |  ✓   |     ✓      |   ✓   |
| Lire/répondre aux demandes parents selon droits |  ✓   |     ✓      |   ✓   |
| Documents internes                              |  ✓   |     ✓      |   ✓   |
| Assigner/modérer des demandes                   |      |     ✓      |   ✓   |
| Publications, événements, cantine, documents    |      |            |   ✓   |
| Notifications massives                          |      |            |   ✓   |
| Valider les membres et modifier les rôles       |      |            |   ✓   |
| Paramètres et journaux admin                    |      |            |   ✓   |

Les statuts sont `pending`, `active`, `suspended`, `rejected`. Seul `active` ouvre les permissions. Les élévations passent par Cloud Functions et reconstruisent les Custom Claims depuis `memberProfiles`.
