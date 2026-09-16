import type { Metadata } from 'next';

import { PostsView } from '@/features/posts/posts-view';

export const metadata: Metadata = {
  title: 'Publications',
};

/**
 * Rédaction et épinglage des publications du fil d'actualité.
 *
 * Cette section a son propre dossier de route, et n'est donc plus servie par la
 * route générique `[section]` — voir `DEDICATED_ROUTE_SLUGS` dans
 * `lib/sections.ts`. Le segment `publications` y avait été oublié à la création
 * de ce dossier : Next.js n'a rien signalé, et `/publications` était prérendu
 * deux fois, dont un écran « bientôt disponible » jamais servi. L'oubli est
 * désormais impossible — `sections.test.ts` compare la liste aux dossiers
 * réellement présents.
 */
export default function PublicationsPage(): React.JSX.Element {
  return <PostsView />;
}
