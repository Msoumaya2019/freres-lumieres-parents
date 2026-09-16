import { USER_STATUS_LABELS } from '@fl/shared';
import type { UserStatus } from '@fl/types';

/**
 * Pastille de statut d'un compte.
 *
 * Extraite de la file de validation le jour où la fiche d'un compte a eu
 * besoin de la même information : deux copies d'une table de styles
 * divergent toujours, et la seconde est celle qu'on oublie de mettre à jour.
 *
 * Les couleurs viennent des jetons de thème, jamais de valeurs écrites en
 * dur : c'est ce qui permet à la pastille de rester lisible dans les deux
 * thèmes.
 */
const TONES: Record<UserStatus, string> = {
  pending: 'bg-warning-soft text-warning',
  active: 'bg-success-soft text-success',
  suspended: 'bg-danger-soft text-danger',
  rejected: 'bg-surface-muted text-muted',
};

export function UserStatusBadge({ status }: { status: UserStatus }): React.JSX.Element {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${TONES[status]}`}>
      {USER_STATUS_LABELS[status]}
    </span>
  );
}
