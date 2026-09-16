# Design QA — Phase 2 mobile

## Références comparées

- Maquette source : `C:\Users\mchik\Desktop\Image Codex 16 sept. 2026, 09_38_21.png`
- Implémentation contrôlée : `http://localhost:8082/login` et `http://localhost:8082/register`
- Capture d’implémentation : capture directe du navigateur intégré, viewport mobile 371 × 478 px, le 16 septembre 2026.

La maquette représente le futur écran d’actualités alors que les écrans contrôlés appartiennent au parcours d’identité de Phase 2. La comparaison porte donc sur la direction visuelle et le système de composants, pas sur une reproduction écran pour écran.

## Résultat

Statut : **PASS**

- Fond crème, vert profond, surfaces chaudes et états sémantiques cohérents avec la référence.
- Hiérarchie lisible : sourcil, titre fort, texte d’aide, carte de formulaire et action principale.
- Rayons, bordures douces, espacements et ombres proviennent des tokens partagés.
- Le formulaire reste lisible au format mobile et défile sans débordement horizontal.
- Les champs exposent leurs libellés, les actions sont accessibles et l’ajout d’un second enfant fonctionne.
- Les états chargement et erreur restent explicites et visuellement cohérents.

## Écarts intentionnels

- L’illustration d’école, les cartes d’actualités par catégorie et la navigation finale de la maquette ne sont pas recopiées dans les écrans d’authentification. Elles seront appliquées aux écrans métier concernés, sans anticiper la Phase 3.
- La typographie utilise les polices système en Phase 2 afin de ne pas ajouter une dépendance et du poids natif uniquement pour la maquette.

## Contrôles techniques

- Données d’inscription chargées depuis Firebase Emulator.
- Navigation Connexion → Inscription vérifiée.
- Ajout dynamique d’un second enfant vérifié.
- Aucun changement de logique métier ou de règle de sécurité n’a été introduit pour le rendu.
