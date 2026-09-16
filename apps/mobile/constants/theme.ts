import { Platform } from 'react-native';

export const colors = {
  background: '#FBF8F1',
  surface: '#FFFFFF',
  surfaceWarm: '#FFFDF8',
  primary: '#0D7155',
  primaryDark: '#093F39',
  primarySoft: '#E4F2E9',
  text: '#103F3A',
  muted: '#64736F',
  border: '#E2E8E2',
  urgent: '#D83D50',
  urgentSoft: '#FDE8E9',
  accent: '#E2A410',
  accentSoft: '#FFF2CC',
  peach: '#F7D8C4',
  peachSoft: '#FFF1E9',
  infoSoft: '#EAF6EF',
  white: '#FFFFFF',
};

export const typography = {
  display: {
    fontSize: 36,
    fontWeight: '900' as const,
    lineHeight: 42,
    letterSpacing: -1,
  },
  title: {
    fontSize: 30,
    fontWeight: '900' as const,
    lineHeight: 36,
    letterSpacing: -0.5,
  },
  heading: { fontSize: 21, fontWeight: '800' as const, lineHeight: 27 },
  body: { fontSize: 16, lineHeight: 23 },
  small: { fontSize: 13, lineHeight: 18 },
};

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 22,
  xl: 30,
  xxl: 40,
} as const;
export const radii = { sm: 12, md: 16, lg: 22, pill: 999 } as const;

export const categoryColors = {
  urgent: { foreground: colors.urgent, background: colors.urgentSoft },
  information: { foreground: colors.primary, background: colors.infoSoft },
  event: { foreground: '#9A6800', background: colors.accentSoft },
} as const;

export const shadow = Platform.select({
  ios: {
    shadowColor: colors.primaryDark,
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 7 },
  },
  android: { elevation: 2 },
  default: {},
});
