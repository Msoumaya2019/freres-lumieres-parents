'use client';

/**
 * Coquille de l'interface d'administration.
 *
 * Responsive par construction :
 *  - à partir de 1024 px, navigation latérale fixe ;
 *  - en dessous, la navigation devient un tiroir ouvert par un bouton.
 *
 * C'est important : les membres de la FCPE consulteront souvent les
 * signalements depuis leur téléphone, dans la cour de l'école.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { hasPermission } from '@fl/shared';

import { IconClose, IconLogout, IconMenu, SECTION_ICONS } from '@/components/icons';
import { ADMIN_SECTIONS } from '@/lib/sections';
import { useAdminAuth } from '@/providers/auth-provider';

export function AdminShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const pathname = usePathname();
  const { profile, signOut } = useAdminAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Le tiroir se referme à chaque changement de page : sinon il resterait
  // ouvert par-dessus le contenu qu'on vient d'ouvrir.
  //
  // L'ajustement se fait pendant le rendu, pas dans un effet. C'est la forme
  // recommandée par React pour « adapter un état quand une valeur change » :
  // elle évite un premier rendu où le tiroir serait encore ouvert, donc un
  // scintillement.
  const [renderedPathname, setRenderedPathname] = useState(pathname);
  if (renderedPathname !== pathname) {
    setRenderedPathname(pathname);
    setDrawerOpen(false);
  }

  const visibleSections = ADMIN_SECTIONS.filter((section) =>
    hasPermission(profile?.role, section.permission),
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Navigation latérale — bureau */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface lg:flex lg:flex-col">
        <SidebarContent sections={visibleSections} pathname={pathname} />
      </aside>

      {/* Navigation latérale — tiroir mobile */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Fermer le menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative flex h-full w-72 max-w-[85%] flex-col border-r border-border bg-surface">
            <div className="flex justify-end p-3">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Fermer le menu"
                className="rounded-md p-2 text-secondary hover:bg-surface-muted"
              >
                <IconClose />
              </button>
            </div>
            <SidebarContent sections={visibleSections} pathname={pathname} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Ouvrir le menu"
            className="rounded-md p-2 text-secondary hover:bg-surface-muted lg:hidden"
          >
            <IconMenu />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">
              FCPE — Écoles Frères Lumières
            </p>
            <p className="truncate text-xs text-muted">Montmagny</p>
          </div>

          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium text-foreground">
              {profile ? `${profile.firstName} ${profile.lastName}` : ''}
            </p>
            <p className="text-xs text-muted">{profile?.role ?? ''}</p>
          </div>

          <button
            type="button"
            onClick={() => void signOut()}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-secondary hover:bg-surface-muted"
          >
            <IconLogout size={16} />
            <span className="hidden sm:inline">Déconnexion</span>
          </button>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

function SidebarContent({
  sections,
  pathname,
}: {
  sections: typeof ADMIN_SECTIONS;
  pathname: string;
}): React.JSX.Element {
  return (
    <nav
      className="flex flex-1 flex-col gap-1 overflow-y-auto p-3"
      aria-label="Navigation principale"
    >
      <div className="px-2 py-3">
        <p className="text-sm font-bold text-foreground">Administration</p>
        <p className="text-xs text-muted">Espace FCPE</p>
      </div>

      {sections.map((section) => {
        const Icon = SECTION_ICONS[section.slug];
        const href = `/${section.slug}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={section.slug}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={[
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-primary-soft font-semibold text-primary'
                : 'text-secondary hover:bg-surface-muted hover:text-foreground',
            ].join(' ')}
          >
            <span className="shrink-0">{Icon ? <Icon size={18} /> : null}</span>
            <span className="min-w-0 flex-1 truncate">{section.label}</span>
            {!section.implemented ? (
              <span
                className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-muted"
                title={`Prévu en ${section.phase}`}
              >
                {section.phase.replace('Phase ', 'P')}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
