import type { Metadata } from 'next';

import { NotificationsView } from '@/features/notifications/notifications-view';

export const metadata: Metadata = {
  title: 'Notifications',
};

/**
 * Envoi d'une annonce et historique des envois de l'organisation.
 *
 * Cette section a son propre dossier de route, et n'est donc plus servie par la
 * route générique `[section]` — voir `DEDICATED_ROUTE_SLUGS` dans
 * `lib/sections.ts`. Le segment `notifications` a été ajouté à cette liste dans
 * le même changement que ce fichier ; `sections.test.ts` compare la liste aux
 * dossiers réellement présents, donc l'un sans l'autre ne compilerait pas vert.
 */
export default function NotificationsPage(): React.JSX.Element {
  return <NotificationsView />;
}
