'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type PropsWithChildren } from 'react';
import { useAdminAuth } from './auth-provider';

const navigation = [
  ['/dashboard', 'Tableau de bord'],
  ['/publications', 'Publications'],
  ['/notifications', 'Notifications'],
  ['/contact', 'Demandes parents'],
  ['/members', 'Membres FCPE'],
  ['/fcpe', 'Espace FCPE'],
  ['/polls', 'Sondages'],
  ['/events', 'Événements'],
  ['/canteen', 'Cantine'],
  ['/documents', 'Documents'],
  ['/school-councils', 'Conseils d’école'],
  ['/logs', 'Journaux'],
  ['/settings', 'Paramètres'],
] as const;

export function AdminShell({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAdminAuth();
  const isLogin = pathname === '/login';
  const authorized = auth.role === 'admin' && auth.status === 'active';

  useEffect(() => {
    if (!auth.loading && !auth.user && !isLogin) router.replace('/login');
    if (!auth.loading && authorized && isLogin) router.replace('/dashboard');
  }, [auth.loading, auth.user, authorized, isLogin, router]);

  if (isLogin) return children;
  if (auth.loading || !auth.user)
    return (
      <main className="center-page" aria-live="polite">
        Vérification de votre session…
      </main>
    );
  if (!authorized)
    return (
      <main className="center-page">
        <section className="card access-card">
          <span className="pill">ACCÈS REFUSÉ</span>
          <h1>Compte administrateur requis</h1>
          <p>Cette interface est réservée aux administrateurs actifs.</p>
          <button className="primary-button" onClick={() => void auth.logout()}>
            Se déconnecter
          </button>
        </section>
      </main>
    );

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>Parents Frères Lumières</strong>
          <span>Administration FCPE</span>
        </div>
        <nav className="nav" aria-label="Navigation principale">
          {navigation.map(([href, label]) => (
            <Link
              aria-current={pathname === href ? 'page' : undefined}
              href={href}
              key={href}
            >
              {label}
            </Link>
          ))}
        </nav>
        <button className="logout-button" onClick={() => void auth.logout()}>
          Se déconnecter
        </button>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
