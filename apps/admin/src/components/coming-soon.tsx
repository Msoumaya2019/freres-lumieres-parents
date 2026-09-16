/**
 * Écran affiché pour une section dont le développement est planifié.
 *
 * Plutôt qu'une page blanche, on explique ce que la section fera et quand
 * elle arrive. C'est plus honnête et cela documente l'avancement sans avoir
 * à ouvrir un fichier.
 */
import type { AdminSection } from '@/lib/sections';
import { SECTION_ICONS } from '@/components/icons';

export function ComingSoon({ section }: { section: AdminSection }): React.JSX.Element {
  const Icon = SECTION_ICONS[section.slug];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-foreground">{section.label}</h1>
        <p className="mt-1 text-secondary">{section.description}</p>
      </header>

      <div className="flex max-w-2xl items-start gap-4 rounded-lg border border-border bg-surface p-6">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
          {Icon ? <Icon size={22} /> : null}
        </div>
        <div className="flex flex-col gap-2">
          <p className="font-semibold text-foreground">Section planifiée — {section.phase}</p>
          <p className="text-secondary">
            La navigation, les jetons de design et la connexion à Firestore sont déjà en place. Le
            contenu fonctionnel de cette section est développé à la {section.phase} du plan.
          </p>
          <p className="text-sm text-muted">
            Permission requise :{' '}
            <code className="rounded bg-surface-muted px-1.5 py-0.5">{section.permission}</code>
          </p>
        </div>
      </div>
    </div>
  );
}
