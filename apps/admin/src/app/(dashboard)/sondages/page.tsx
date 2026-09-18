import type { Metadata } from 'next';

import { PollsView } from '@/features/polls/polls-view';

export const metadata: Metadata = {
  title: 'Sondages',
};

/**
 * Création d'un sondage.
 *
 * Cette section a son propre dossier de route, et n'est donc plus servie par
 * la route générique `[section]` — voir `DEDICATED_ROUTE_SLUGS` dans
 * `lib/sections.ts`. Le jour où une section est développée, il suffit de créer
 * ce dossier : la route générique continue de servir les autres.
 */
export default function PollsPage(): React.JSX.Element {
  return <PollsView />;
}
