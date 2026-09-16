import type { Metadata, Viewport } from 'next';

import { themeToCssBlock } from '@fl/shared';

import { AdminAuthProvider } from '@/providers/auth-provider';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Administration FCPE — Frères Lumières',
    template: '%s · Administration FCPE',
  },
  description:
    'Interface d’administration de la FCPE des écoles maternelle et élémentaire Frères Lumières, Montmagny.',
  // L'interface d'administration ne doit jamais être indexée par un moteur
  // de recherche : elle expose des données concernant des familles.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2554D6',
};

/**
 * Layout racine.
 *
 * Les variables CSS sont générées à partir des jetons de `@fl/shared` :
 * la palette est donc strictement identique à celle de l'application mobile,
 * sans duplication de valeurs.
 *
 * Le style est injecté côté serveur, ce qui évite tout clignotement au
 * chargement (le « flash of unstyled content » classique des thèmes
 * appliqués en JavaScript).
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return (
    <html lang="fr">
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeToCssBlock('fl') }} />
      </head>
      <body className="antialiased">
        <AdminAuthProvider>{children}</AdminAuthProvider>
      </body>
    </html>
  );
}
