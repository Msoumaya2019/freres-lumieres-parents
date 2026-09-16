import type { Metadata } from 'next';

import { UsersView } from '@/features/users/users-view';

export const metadata: Metadata = {
  title: 'Utilisateurs',
};

/**
 * File de validation des comptes.
 *
 * Cette section a son propre dossier de route, et n'est donc plus servie par
 * la route générique `[section]` — voir `DEDICATED_ROUTE_SLUGS` dans
 * `lib/sections.ts`. Le jour où une section est développée, il suffit de créer
 * ce dossier : la route générique continue de servir les autres.
 */
export default function UsersPage(): React.JSX.Element {
  return <UsersView />;
}
