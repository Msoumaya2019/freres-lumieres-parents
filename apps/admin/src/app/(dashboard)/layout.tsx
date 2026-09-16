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
    if (status === 'signedOut') {
      router.replace('/sign-in');
    }
  }, [status, router]);

  if (status === 'unconfigured') {
    return <ConfigNotice />;
  }

  if (status === 'forbidden') {
    router.replace('/sign-in');
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
