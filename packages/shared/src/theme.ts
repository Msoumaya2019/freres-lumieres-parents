/**
 * Jetons de design — source de vérité visuelle du projet.
 *
 * Ce fichier ne dépend d'aucune bibliothèque : il est consommé par le mobile
 * (StyleSheet), par l'admin (variables CSS générées) et par les tests.
 *
 * Objectifs de conception :
 *  - **chaleureux et familial** : bleu confiance + accent orange chaleureux,
 *    fonds légèrement teintés plutôt que blanc pur ;
 *  - **lisible par tous** : contrastes ≥ 4,5:1 sur le texte courant ;
 *  - **gros boutons** : toute cible tactile fait au moins 48 points ;
 *  - **accessible** : les tailles sont exprimées en unités logiques et
 *    destinées à être mises à l'échelle par le système (Dynamic Type sur iOS,
 *    taille de police sur Android). Ne jamais désactiver `allowFontScaling`.
 */

export interface ThemeColors {
  /** Fond général de l'écran. */
  background: string;
  /** Fond des cartes et panneaux. */
  surface: string;
  /** Fond secondaire (champs de saisie au repos, zones désactivées). */
  surfaceMuted: string;
  /** Fond élevé (modales, menus). */
  surfaceElevated: string;
  border: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  /** Texte sur fond de couleur primaire. */
  textOnPrimary: string;
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  accent: string;
  accentSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  /** Bandeau d'alerte urgente. */
  urgent: string;
  urgentSoft: string;
  /** Voile de fond des modales. */
  scrim: string;
  shadow: string;
}

export interface ThemeTypography {
  readonly size: {
    readonly xs: number;
    readonly sm: number;
    readonly md: number;
    readonly lg: number;
    readonly xl: number;
    readonly xxl: number;
    readonly display: number;
  };
  readonly lineHeight: {
    readonly tight: number;
    readonly normal: number;
    readonly relaxed: number;
  };
  readonly weight: {
    readonly regular: '400';
    readonly medium: '500';
    readonly semibold: '600';
    readonly bold: '700';
  };
}

export interface ThemeSpacing {
  readonly none: number;
  readonly xs: number;
  readonly sm: number;
  readonly md: number;
  readonly lg: number;
  readonly xl: number;
  readonly xxl: number;
  readonly xxxl: number;
}

export interface ThemeRadii {
  readonly sm: number;
  readonly md: number;
  readonly lg: number;
  readonly xl: number;
  readonly pill: number;
}

export interface ThemeTokens {
  readonly name: 'light' | 'dark';
  readonly colors: ThemeColors;
  readonly typography: ThemeTypography;
  readonly spacing: ThemeSpacing;
  readonly radii: ThemeRadii;
  /** Hauteur minimale d'une cible tactile. */
  readonly touchTarget: number;
  /** Largeur maximale du contenu sur grand écran / tablette. */
  readonly maxContentWidth: number;
  /** Durées d'animation, en millisecondes. */
  readonly motion: {
    readonly fast: number;
    readonly normal: number;
  };
}

const typography: ThemeTypography = {
  size: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, xxl: 28, display: 34 },
  lineHeight: { tight: 1.25, normal: 1.5, relaxed: 1.7 },
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
};

const spacing: ThemeSpacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

const radii: ThemeRadii = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 };

export const lightTheme: ThemeTokens = {
  name: 'light',
  colors: {
    background: '#F6F7FB',
    surface: '#FFFFFF',
    surfaceMuted: '#F1F3F9',
    surfaceElevated: '#FFFFFF',
    border: '#E2E6EF',
    borderStrong: '#C8CFDC',
    textPrimary: '#161A22',
    textSecondary: '#48505E',
    textMuted: '#6F7889',
    textOnPrimary: '#FFFFFF',
    primary: '#2554D6',
    primaryPressed: '#1B41AD',
    primarySoft: '#E8EEFD',
    accent: '#D9662A',
    accentSoft: '#FDEDE3',
    success: '#12854A',
    successSoft: '#E3F6EC',
    warning: '#9A6100',
    warningSoft: '#FDF2DC',
    danger: '#C0281F',
    dangerSoft: '#FCE9E7',
    info: '#0B628F',
    infoSoft: '#E2F1F9',
    urgent: '#C0281F',
    urgentSoft: '#FCE9E7',
    scrim: 'rgba(15, 18, 24, 0.45)',
    shadow: 'rgba(22, 26, 34, 0.10)',
  },
  typography,
  spacing,
  radii,
  touchTarget: 48,
  maxContentWidth: 720,
  motion: { fast: 120, normal: 220 },
};

export const darkTheme: ThemeTokens = {
  name: 'dark',
  colors: {
    background: '#0F1218',
    surface: '#171B23',
    surfaceMuted: '#1F242E',
    surfaceElevated: '#212733',
    border: '#2A303B',
    borderStrong: '#3A424F',
    textPrimary: '#F2F4F8',
    textSecondary: '#C4CAD5',
    textMuted: '#8E97A6',
    textOnPrimary: '#0B1220',
    primary: '#8FADFF',
    primaryPressed: '#B0C6FF',
    primarySoft: '#1B2740',
    accent: '#FFA76B',
    accentSoft: '#33231A',
    success: '#5DD39E',
    successSoft: '#12291F',
    warning: '#FFC46B',
    warningSoft: '#2C2415',
    danger: '#FF8A80',
    dangerSoft: '#33191A',
    info: '#6FC3E8',
    infoSoft: '#122730',
    urgent: '#FF8A80',
    urgentSoft: '#33191A',
    scrim: 'rgba(0, 0, 0, 0.6)',
    shadow: 'rgba(0, 0, 0, 0.4)',
  },
  typography,
  spacing,
  radii,
  touchTarget: 48,
  maxContentWidth: 720,
  motion: { fast: 120, normal: 220 },
};

export type ThemeMode = 'light' | 'dark';

export function getTheme(mode: ThemeMode): ThemeTokens {
  return mode === 'dark' ? darkTheme : lightTheme;
}

/**
 * Convertit un thème en variables CSS.
 *
 * Utilisé par l'interface d'administration Next.js : les mêmes jetons
 * alimentent le web et le mobile, ce qui garantit une identité visuelle
 * cohérente sans dupliquer les valeurs dans deux fichiers de configuration.
 *
 * @param theme  Jetons à convertir.
 * @param prefix Préfixe des variables. `fl` par défaut, ce qui produit
 *               `--fl-primary`. Tailwind v4 fait ensuite le lien entre ses
 *               propres variables `--color-*` et celles-ci (voir
 *               `apps/admin/src/app/globals.css`).
 */
export function themeToCssVariables(theme: ThemeTokens, prefix = 'fl'): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(theme.colors)) {
    lines.push(`  --${prefix}-${camelToKebab(key)}: ${value};`);
  }
  for (const [key, value] of Object.entries(theme.spacing)) {
    lines.push(`  --${prefix}-space-${key}: ${value}px;`);
  }
  for (const [key, value] of Object.entries(theme.radii)) {
    lines.push(`  --${prefix}-radius-${key}: ${value}px;`);
  }
  for (const [key, value] of Object.entries(theme.typography.size)) {
    lines.push(`  --${prefix}-font-${key}: ${value}px;`);
  }
  lines.push(`  --${prefix}-touch-target: ${theme.touchTarget}px;`);
  lines.push(`  --${prefix}-max-content-width: ${theme.maxContentWidth}px;`);
  return lines.join('\n');
}

/**
 * Produit la feuille de style complète (mode clair + mode sombre).
 *
 * Le mode sombre est appliqué à la fois par la préférence système
 * (`prefers-color-scheme`) et par une classe explicite `.dark`, ce qui permet
 * à l'administration d'offrir un sélecteur manuel plus tard sans retoucher
 * la feuille de style.
 */
export function themeToCssBlock(prefix = 'fl'): string {
  return [
    ':root {',
    themeToCssVariables(lightTheme, prefix),
    '}',
    '',
    '@media (prefers-color-scheme: dark) {',
    '  :root:not(.light) {',
    themeToCssVariables(darkTheme, prefix).replace(/^ {2}/gm, '    '),
    '  }',
    '}',
    '',
    '.dark {',
    themeToCssVariables(darkTheme, prefix),
    '}',
  ].join('\n');
}

function camelToKebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
