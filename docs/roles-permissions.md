# Rôles, statuts et permissions

Le statut est évalué avant le rôle. Un compte qui n’est pas `active` ne reçoit aucune permission applicative, y compris s’il possède un rôle élevé.

| Permission                | Parent |       FCPE       | Modérateur | Admin |
| ------------------------- | :----: | :--------------: | :--------: | :---: |
| `readPublicContent`       |   ✓    |        ✓         |     ✓      |   ✓   |
| `createComment`           |   ✓    |        ✓         |     ✓      |   ✓   |
| `createDiscussionMessage` |   ✓    |        ✓         |     ✓      |   ✓   |
| `votePoll`                |   ✓    |        ✓         |     ✓      |   ✓   |
| `createReport`            |   ✓    |        ✓         |     ✓      |   ✓   |
| `createCouncilQuestion`   |   ✓    |        ✓         |     ✓      |   ✓   |
| `accessFcpeArea`          |        |        ✓         |     ✓      |   ✓   |
| `viewReports`             |        |     partagés     |     ✓      |   ✓   |
| `createPost`              |        | futur si délégué |            |   ✓   |
| `sendNotification`        |        |                  |            |   ✓   |
| `moderateContent`         |        |                  |     ✓      |   ✓   |
| `updateReports`           |        |                  |     ✓      |   ✓   |
| `manageUsers`             |        |                  |            |   ✓   |
| `manageRoles`             |        |                  |            |   ✓   |
| `manageSchools`           |        |                  |            |   ✓   |
| `manageSettings`          |        |                  |            |   ✓   |

La matrice exécutable se trouve dans `packages/shared`. Firestore et Storage traduisent les mêmes invariants indépendamment. Les droits FCPE optionnels seront représentés plus tard par des permissions déléguées explicitement, jamais par une confiance implicite dans l’interface.

## Custom Claims

```json
{
  "role": "parent",
  "status": "active",
  "organizationId": "freres-lumieres",
  "schoolIds": ["elementary"],
  "levelIds": ["ce1"],
  "classIds": ["ce1-a"]
}
```

Seules les Cloud Functions écrivent ces claims. Après une approbation ou un changement de rôle, le client doit forcer le rafraîchissement du token. Le document `users/{uid}` reste la source métier; les claims sont une projection d’autorisation compacte.

L’état `pending` est posé à l’inscription; `suspended` et `rejected` coupent immédiatement les permissions applicatives au prochain rafraîchissement du token. L’administration peut approuver, réactiver, suspendre ou refuser un autre compte de la même organisation. Un administrateur ne peut pas modifier son propre statut depuis cette Function.
