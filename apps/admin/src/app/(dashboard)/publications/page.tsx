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
 * `lib/sections.ts`. Le segment `publications` y a été ajouté en même temps que
 * ce dossier : deux routes capables de répondre au même chemin produiraient un
 * avertissement de Next.js et un comportement dépendant de l'ordre de
 * résolution.
 */
export default function PublicationsPage(): React.JSX.Element {
  return <PostsView />;
}
