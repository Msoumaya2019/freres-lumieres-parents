import type { Metadata } from 'next';
import './globals.css';
import { AdminAuthProvider } from '@/components/auth-provider';
import { AdminShell } from '@/components/admin-shell';

export const metadata: Metadata = {
  title: 'Administration | Parents Frères Lumières',
  description: 'Interface d’administration FCPE',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>
        <AdminAuthProvider>
          <AdminShell>{children}</AdminShell>
        </AdminAuthProvider>
      </body>
    </html>
  );
}
