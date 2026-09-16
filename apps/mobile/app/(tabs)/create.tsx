/**
 * Onglet « Créer » — écran technique.
 *
 * Ce fichier existe uniquement parce qu'expo-router exige une route pour
 * chaque onglet déclaré. Le bouton central intercepte l'appui et ouvre la
 * feuille modale `app/create.tsx` : cet écran n'est donc jamais affiché.
 *
 * Ne rien y ajouter. Si un jour le bouton central doit mener à un vrai écran,
 * c'est `app/create.tsx` qu'il faut modifier.
 */
export default function CreateTabPlaceholder(): null {
  return null;
}
