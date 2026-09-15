# Architecture des notifications

## Recommandation

FCM reste le transport. Les topics sont réservés aux audiences larges non sensibles : organisation, école et niveau. Les audiences de classe, FCPE, mises à jour de signalement et réponses personnelles utilisent des tokens sélectionnés côté serveur après vérification des permissions.

Exemples de topics :

- `organization_freres-lumieres`
- `school_elementary`
- `school_kindergarten`
- `level_ce1`

Un topic ne constitue jamais une barrière de confidentialité : le corps d’une notification ne doit contenir aucune donnée sensible. `fcpe_members` n’est donc pas un topic client auto‑inscriptible.

## Coûts

Le flux ne crée pas une notification Firestore par destinataire. Un document global peut être conservé uniquement si le centre de notifications en a besoin. Les notifications personnelles non lues pourront utiliser une boîte limitée, avec expiration et pagination.

## Tokens

Les tokens seront rattachés à l’utilisateur et à l’installation, renouvelés à chaque rotation, supprimés après erreur FCM permanente et désactivés à la déconnexion. Les préférences utilisateur sont vérifiées côté serveur avant envoi ciblé.

## Phase 1

La Function d’envoi admin accepte uniquement des topics publics conformes. L’automatisation post-publication est volontairement désactivée jusqu’à la Phase 5, lorsque permissions, préférences et configuration native auront des tests de bout en bout.
