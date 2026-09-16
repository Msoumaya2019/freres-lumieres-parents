'use client';

/**
 * Garde d'accès de l'espace d'administration.
 *
 * Trois états traités explicitement :
 *  - configuration absente → écran explicatif, jamais une page blanche ;
 *  - non connecté → redirection vers la connexion ;
 *  - connecté sans les droits → message clair.
 *
 * Cette garde n'est pas une protection : elle évite simplement d'afficher une
 * interface inutilisable. Les Security Rules restent seules juges.
 */
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { AdminShell } from '@/components/admin-shell';
import { ConfigNotice } from '@/components/config-notice';
import { useAdminAuth } from '@/providers/auth-provider';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const { status, profileLoading } = useAdminAuth();
  const router = useRouter();

  useEffect(() => {
    // Deux cas ramènent à l'écran de connexion : plus de session, ou une
    // session sans les droits. Les deux passent par le même effet.
    //
    // La redirection est un effet de bord : l'appeler pendant le rendu la
    // ferait exécuter deux fois en StrictMode, et déclencherait
    // « Cannot update a component while rendering a different component »,
    // puisque la navigation met à jour l'état du routeur.
    if (status === 'signedOut' || status === 'forbidden') {
      router.replace('/sign-in');
    }
  }, [status, router]);

  if (status === 'unconfigured') {
    return <ConfigNotice />;
  }

  if (status === 'forbidden') {
    // Affichage transitoire : l'effet ci-dessus ramène à l'écran de connexion,
    // qui porte l'explication complète et la déconnexion.
    return <CenteredMessage message="Accès non autorisé." />;
  }

  if (status === 'initializing' || status === 'signedOut' || profileLoading) {
    return <CenteredMessage message="Chargement de votre espace…" />;
  }

  return <AdminShell>{children}</AdminShell>;
}

function CenteredMessage({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <p className="text-secondary" role="status">
        {message}
      </p>
    </div>
  );
}
