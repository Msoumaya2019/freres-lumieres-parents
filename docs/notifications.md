# Notifications sans compte

Les préférences seront stockées localement par installation. Le token Expo/FCM sera associé côté serveur à des topics publics sans donnée personnelle :

- `all_public`
- `school_maternelle`
- `school_elementaire`
- `canteen`
- `events`
- `school_councils`

L’abonnement/désabonnement sera validé par une Function avec App Check. Un topic n’est jamais une barrière de confidentialité; aucune donnée privée n’est placée dans le titre, le corps ou le nom du topic. La rotation et les erreurs permanentes de token seront gérées sans créer une écriture Firestore par notification/destinataire.

Les réponses au chat utiliseront le token rattaché à la conversation côté serveur et ouvriront localement la conversation si son secret existe encore. Une IPA unsigned compile le code push mais APNs ne fonctionne sur iPhone qu’après signature avec les entitlements Apple adéquats.
