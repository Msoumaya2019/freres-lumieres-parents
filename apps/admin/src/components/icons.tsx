/**
 * Jeu d'icônes minimal.
 *
 * Dessiné à la main plutôt qu'importé d'une bibliothèque : une poignée
 * d'icônes suffit à toute l'interface d'administration, et éviter une
 * dépendance supplémentaire vaut mieux que trois cents kilo-octets de symboles
 * inutilisés.
 *
 * Toutes les icônes partagent les mêmes conventions : grille 24×24, contour
 * de 1,8 px, couleur héritée du texte parent (`currentColor`), donc
 * automatiquement correctes en mode clair comme en mode sombre.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconDashboard(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
    </Icon>
  );
}

export function IconMegaphone(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M4 10v4a1 1 0 0 0 1 1h2l5 3V6L7 9H5a1 1 0 0 0-1 1Z" />
      <path d="M16 9a4 4 0 0 1 0 6" />
      <path d="M19 6.5a8 8 0 0 1 0 11" />
    </Icon>
  );
}

export function IconBell(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9Z" />
      <path d="M10 18.5a2 2 0 0 0 4 0" />
    </Icon>
  );
}

export function IconUsers(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.6a3.2 3.2 0 0 1 0 6.3" />
      <path d="M17.5 14.4a5.5 5.5 0 0 1 3 5.1" />
    </Icon>
  );
}

export function IconShield(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M12 3 5 6v6c0 4.2 2.9 7.5 7 9 4.1-1.5 7-4.8 7-9V6l-7-3Z" />
      <path d="m9.5 12 1.8 1.8L15 10" />
    </Icon>
  );
}

export function IconAlert(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M10.3 4.3 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconChart(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <rect x="7.5" y="12" width="3" height="5" rx="1" />
      <rect x="12.5" y="8" width="3" height="9" rx="1" />
      <rect x="17" y="14" width="3" height="3" rx="1" />
    </Icon>
  );
}

export function IconCalendar(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17" />
      <path d="M8 3v4M16 3v4" />
    </Icon>
  );
}

export function IconStar(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="m12 4 2.4 5 5.6.7-4 3.9 1 5.4-5-2.7-5 2.7 1-5.4-4-3.9 5.6-.7L12 4Z" />
    </Icon>
  );
}

export function IconFile(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5.5-5.5Z" />
      <path d="M13.5 3.5V9H19" />
    </Icon>
  );
}

export function IconSchool(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="m12 3.5 9 4.5-9 4.5L3 8l9-4.5Z" />
      <path d="M7 10.5V16c0 1.7 2.2 3 5 3s5-1.3 5-3v-5.5" />
    </Icon>
  );
}

export function IconLock(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15.5" r="1.2" />
    </Icon>
  );
}

export function IconSettings(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M4 7h10M18 7h2" />
      <path d="M4 12h4M12 12h8" />
      <path d="M4 17h8M16 17h4" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="14" cy="17" r="2" />
    </Icon>
  );
}

export function IconHistory(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4.5V10H9" />
      <path d="M12 8v4.6l3 1.8" />
    </Icon>
  );
}

export function IconLogout(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M15 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3" />
      <path d="M10 8.5 6.5 12l3.5 3.5" />
      <path d="M6.5 12H15" />
    </Icon>
  );
}

export function IconMenu(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  );
}

export function IconClose(props: IconProps): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

/** Icône associée à chaque section de l'administration. */
export const SECTION_ICONS: Record<string, (props: IconProps) => React.JSX.Element> = {
  dashboard: IconDashboard,
  publications: IconMegaphone,
  notifications: IconBell,
  utilisateurs: IconUsers,
  moderation: IconShield,
  signalements: IconAlert,
  sondages: IconChart,
  agenda: IconCalendar,
  evenements: IconStar,
  documents: IconFile,
  'conseils-ecole': IconSchool,
  fcpe: IconLock,
  journal: IconHistory,
  parametres: IconSettings,
};
