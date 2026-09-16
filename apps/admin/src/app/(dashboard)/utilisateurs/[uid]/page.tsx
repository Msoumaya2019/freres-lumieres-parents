import type { Metadata } from 'next';

import { UserDetailView } from '@/features/users/user-detail-view';

interface UserPageProps {
  params: Promise<{ uid: string }>;
}

export const metadata: Metadata = {
  title: 'Fiche d’un compte',
};

/**
 * Fiche détaillée d'un compte.
 *
 * Route **imbriquée** sous `utilisateurs/`, et non segment de premier niveau :
 * l'invariant de `sections.test.ts` compare les dossiers directement présents
 * sous `app/(dashboard)/` à `DEDICATED_ROUTE_SLUGS`, et `utilisateurs` y figure
 * déjà. Une fiche par compte n'est pas une section de plus — elle n'a pas sa
 * place dans la navigation latérale.
 */
export default async function UserPage({ params }: UserPageProps): Promise<React.JSX.Element> {
  const { uid } = await params;
  return <UserDetailView uid={uid} />;
}
