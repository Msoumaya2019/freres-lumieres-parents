# Sécurité, confidentialité et RGPD

- Aucun compte, email, nom d’enfant, adresse ou téléphone n’est requis pour l’usage public.
- Seuls `fcpe`, `moderator` et `admin` existent dans les Custom Claims.
- Les organisations d’inscription membre sont revalidées côté Function; un identifiant fourni par le client ne suffit jamais.
- Un profil `pending`, `suspended` ou `rejected` peut seulement relire son propre statut et ne franchit aucune règle FCPE.
- La création de profil membre est idempotente : une reprise après coupure reconstruit les claims depuis le profil serveur existant.
- Le client est hostile : masquage UI et helpers de permissions ne remplacent jamais Rules/Functions.
- Les contenus publics exigent `published=true` (ou `status=published`) et une audience non `fcpe`.
- `contactConversations`, `contactMessages`, `contactInternalNotes`, `pollResponses` et `contact/**` sont fermés à tout accès direct.
- Le futur chat exigera App Check, secret fort haché, limitation par installation/IP, délais, limites de longueur/fichiers et blocage serveur. Aucun secret ou message complet ne sera écrit dans les logs.
- Les notes internes utilisent une collection et un endpoint séparés; un test d’isolation est obligatoire avant activation.
- Les conversations fermées portent `retentionUntil`; la durée exacte sera validée avec la politique de confidentialité avant production, sans conservation infinie implicite.
- Aucun secret serveur, compte de service, certificat, provisioning profile ou token privé n’est versionné. Les clés Firebase client ne confèrent aucun privilège.

App Check sera documenté avec fournisseurs iOS/Android/Web, debug tokens locaux non commités et bypass émulateur. L’enforcement précédera l’activation du chat public. CodeQL, Dependabot et la CI restent configurés.
