import { Platform } from 'react-native';

export const colors = {
  background: '#F7F4EE',
  surface: '#FFFFFF',
  primary: '#1C6758',
  primarySoft: '#DDEDE8',
  text: '#19332D',
  muted: '#61716D',
  border: '#DCE4E1',
  urgent: '#B83A3A',
  urgentSoft: '#FCE8E6',
  accent: '#E9A23B',
  white: '#FFFFFF',
};

export const typography = {
  title: { fontSize: 28, fontWeight: '800' as const, lineHeight: 34 },
  heading: { fontSize: 20, fontWeight: '700' as const, lineHeight: 26 },
  body: { fontSize: 16, lineHeight: 23 },
  small: { fontSize: 13, lineHeight: 18 },
};

export const shadow = Platform.select({
  ios: {
    shadowColor: '#19332D',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  android: { elevation: 2 },
  default: {},
});
