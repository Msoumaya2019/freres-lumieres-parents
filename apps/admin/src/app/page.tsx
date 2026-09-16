import { redirect } from 'next/navigation';

/**
 * Racine de l'administration : redirige vers le tableau de bord.
 *
 * On évite ainsi une page d'accueil séparée qui n'apporterait rien et
 * demanderait un clic supplémentaire à chaque ouverture.
 */
export default function RootPage(): never {
  redirect('/dashboard');
}
