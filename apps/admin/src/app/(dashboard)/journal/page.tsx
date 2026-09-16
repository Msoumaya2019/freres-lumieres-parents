import type { Metadata } from 'next';

import { AuditView } from '@/features/audit/audit-view';

export const metadata: Metadata = {
  title: 'Journal d’audit',
};

/**
 * Consultation du journal d'audit.
 *
 * Cette section a son propre dossier de route, et n'est donc pas servie par la
 * route générique `[section]` — voir `DEDICATED_ROUTE_SLUGS` dans
 * `lib/sections.ts`. Le segment y est déclaré en même temps que ce dossier, et
 * `sections.test.ts` refuse désormais tout écart entre la liste et les dossiers
 * réellement présents.
 */
export default function JournalPage(): React.JSX.Element {
  return <AuditView />;
}
