import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Administration | Parents Frères Lumières',
  description: 'Interface d’administration FCPE',
};

const navigation = [
  ['/dashboard', 'Tableau de bord'],
  ['/publications', 'Publications'],
  ['/users', 'Utilisateurs'],
  ['/moderation', 'Modération'],
  ['/reports', 'Signalements'],
  ['/polls', 'Sondages'],
  ['/events', 'Événements'],
  ['/documents', 'Documents'],
  ['/school-councils', 'Conseils d’école'],
  ['/settings', 'Paramètres'],
];

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <div className="brand">
              <strong>Parents Frères Lumières</strong>
              <span>Administration FCPE</span>
            </div>
            <nav className="nav" aria-label="Navigation principale">
              {navigation.map(([href, label]) => (
                <Link href={href ?? '/dashboard'} key={href}>
                  {label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
