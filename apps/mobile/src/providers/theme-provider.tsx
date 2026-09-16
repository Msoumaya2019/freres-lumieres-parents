/**
 * Fournisseur de thème.
 *
 * Trois modes : `system` (suit les réglages du téléphone, par défaut),
 * `light` et `dark`. Le choix est conservé sur l'appareil.
 *
 * Les jetons viennent de `@fl/shared` : ce sont exactement les mêmes valeurs
 * que celles utilisées par l'interface d'administration. Une couleur modifiée
 * dans le package partagé se propage aux deux applications.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkTheme, getTheme, lightTheme, type ThemeMode, type ThemeTokens } from '@fl/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';

const STORAGE_KEY = 'fl.theme.preference';

/** Préférence d'apparence choisie par l'utilisateur. */
export type ThemePreference = 'system' | ThemeMode;

interface ThemeContextValue {
  /** Jetons à utiliser pour le rendu. */
  readonly theme: ThemeTokens;
  /** Mode réellement appliqué après résolution de la préférence. */
  readonly mode: ThemeMode;
  /** Préférence déclarée par l'utilisateur. */
  readonly preference: ThemePreference;
  /** Change la préférence et la conserve sur l'appareil. */
  setPreference: (preference: ThemePreference) => void;
  /** Vrai si le mode sombre est actif. */
  readonly isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  // Restauration de la préférence au démarrage.
  useEffect(() => {
    let cancelled = false;

    void AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled) return;
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setPreferenceState(stored);
        }
      })
      .catch(() => {
        // Une préférence illisible ne doit jamais empêcher l'application de
        // démarrer : on garde simplement la valeur par défaut.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const mode: ThemeMode =
    preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: mode === 'dark' ? darkTheme : lightTheme,
      mode,
      preference,
      setPreference,
      isDark: mode === 'dark',
    }),
    [mode, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Accès au thème depuis n'importe quel composant. */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme doit être utilisé à l’intérieur de <ThemeProvider>.');
  }
  return context;
}

/** Raccourci : récupère directement les jetons. */
export function useThemeTokens(): ThemeTokens {
  return useTheme().theme;
}

/** Variante tolérante, utile dans les composants rendus hors du fournisseur. */
export function useOptionalTheme(): ThemeContextValue {
  return (
    useContext(ThemeContext) ?? {
      theme: getTheme('light'),
      mode: 'light',
      preference: 'system',
      setPreference: () => undefined,
      isDark: false,
    }
  );
}
