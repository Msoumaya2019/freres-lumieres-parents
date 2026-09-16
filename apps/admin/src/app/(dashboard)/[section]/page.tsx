import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ComingSoon } from '@/components/coming-soon';
import { DashboardView } from '@/features/dashboard/dashboard-view';
import {
  ADMIN_SECTIONS,
  ADMIN_SECTION_SLUGS,
  DEDICATED_ROUTE_SLUGS,
  findSection,
} from '@/lib/sections';

interface SectionPageProps {
  params: Promise<{ section: string }>;
}

/**
 * Les sections de l'administration non encore développées partagent une seule
 * route.
 *
 * Justification : tant qu'une section n'est pas implémentée, sa page est
 * identique — un écran qui explique ce qu'elle fera et quand. Créer une
 * douzaine de fichiers vides aujourd'hui reviendrait à une douzaine
 * d'endroits à maintenir pour aucun contenu.
 *
 * Dès qu'une section est développée, elle reçoit son propre dossier de route
 * (par exemple `app/(dashboard)/utilisateurs/page.tsx`) et son segment est
 * ajouté à `DEDICATED_ROUTE_SLUGS`. Aucune autre modification n'est
 * nécessaire.
 */
export function generateStaticParams(): { section: string }[] {
  return ADMIN_SECTION_SLUGS.filter((slug) => !DEDICATED_ROUTE_SLUGS.includes(slug)).map(
    (section) => ({ section }),
  );
}

export async function generateMetadata({ params }: SectionPageProps): Promise<Metadata> {
  const { section } = await params;
  const definition = findSection(section);
  return { title: definition?.label ?? 'Section inconnue' };
}

export default async function SectionPage({
  params,
}: SectionPageProps): Promise<React.JSX.Element> {
  const { section } = await params;
  const definition = findSection(section);

  if (!definition) {
    notFound();
  }

  if (definition.slug === 'dashboard') {
    return <DashboardView />;
  }

  return <ComingSoon section={definition} />;
}

/** Exporté pour que Next.js connaisse les routes valides à la compilation. */
export const dynamicParams = false;

/** Rappel de la liste complète, utile lors de la relecture de ce fichier. */
export const SECTION_COUNT = ADMIN_SECTIONS.length;
