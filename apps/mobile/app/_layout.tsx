/**
 * Layout racine de l'application.
 *
 * Trois responsabilités :
 *  1. installer les fournisseurs globaux (thème, authentification) ;
 *  2. attendre que la session soit restaurée avant d'afficher quoi que ce soit
 *     — sinon l'utilisateur verrait un écran de connexion clignoter à chaque
 *     lancement alors qu'il est déjà connecté ;
 *  3. rediriger vers le bon espace selon l'état du compte.
 *
 * La navigation est déclarative : chaque groupe de routes correspond à un état
 * du compte, et la redirection est centralisée ici plutôt que dispersée dans
 * les écrans.
 */
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider, useAuth } from '@/providers/auth-provider';
import { ThemeProvider, useTheme } from '@/providers/theme-provider';

// L'écran de lancement reste affiché jusqu'à ce que la session soit connue.
void SplashScreen.preventAutoHideAsync();

/**
 * Routes de détail ouvertes par-dessus les onglets.
 *
 * La redirection ci-dessous renvoie vers `(tabs)` tout ce qui n'est pas un
 * onglet. Sans cette exception, ouvrir une publication la refermerait aussitôt.
 * La liste est explicite plutôt que déduite d'un préfixe : une route oubliée
 * ici se voit tout de suite, alors qu'une exception trop large laisserait
 * passer n'importe quelle route ajoutée plus tard.
 */
const DETAIL_ROUTES: readonly string[] = ['post'];

export default function RootLayout(): React.JSX.Element {
  return (
    <ThemeProvider>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </ThemeProvider>
  );
}

function RootNavigator(): React.JSX.Element {
  const { theme, isDark } = useTheme();
  const { status, accountStatus, profileResolved } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useAuthRedirect({ status, accountStatus, profileResolved, segments, router });

  useEffect(() => {
    if (status !== 'initializing') {
      void SplashScreen.hideAsync();
    }
  }, [status]);

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(pending)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="configuration" options={{ headerShown: false }} />
        <Stack.Screen
          name="create"
          options={{
            // Le bouton central « + » ouvre une feuille modale : l'utilisateur
            // garde le contexte de l'écran d'où il vient.
            presentation: 'modal',
            headerShown: true,
            title: 'Créer',
            headerStyle: { backgroundColor: theme.colors.surface },
            headerTintColor: theme.colors.textPrimary,
          }}
        />
        <Stack.Screen
          name="post/[id]"
          options={{
            // En-tête natif : il apporte la flèche de retour et le geste de
            // retour, sans qu'aucun écran ait à les réimplémenter.
            headerShown: true,
            title: 'Publication',
            headerStyle: { backgroundColor: theme.colors.surface },
            headerTintColor: theme.colors.textPrimary,
          }}
        />
        <Stack.Screen name="+not-found" />
      </Stack>
    </>
  );
}

/**
 * Redirection selon l'état du compte.
 *
 * Volontairement centralisée : si chaque écran décidait de sa propre
 * redirection, il suffirait d'un oubli pour qu'un compte en attente accède à
 * un écran qui ne lui est pas destiné. Et même si cela arrivait, les Security
 * Rules refuseraient la lecture des données — cette redirection est un
 * confort, pas une protection.
 */
function useAuthRedirect({
  status,
  accountStatus,
  profileResolved,
  segments,
  router,
}: {
  status: ReturnType<typeof useAuth>['status'];
  accountStatus: ReturnType<typeof useAuth>['accountStatus'];
  profileResolved: ReturnType<typeof useAuth>['profileResolved'];
  segments: string[];
  router: ReturnType<typeof useRouter>;
}): void {
  useEffect(() => {
    if (status === 'initializing') return;

    const currentGroup = segments[0];
    const inAuthGroup = currentGroup === '(auth)';
    // `includes` plutôt qu'un index : la forme exacte des segments dépend de
    // la profondeur de la route, et un index figé se casserait au premier
    // sous-écran ajouté.
    const onSignUpScreen = segments.includes('sign-up');
    const inPendingGroup = currentGroup === '(pending)';
    const inTabsGroup = currentGroup === '(tabs)';
    const onConfigurationScreen = currentGroup === 'configuration';
    const onDetailScreen = DETAIL_ROUTES.includes(currentGroup ?? '');

    if (status === 'unconfigured') {
      if (!onConfigurationScreen) router.replace('/configuration');
      return;
    }

    if (status === 'signedOut') {
      if (!inAuthGroup) router.replace('/(auth)/sign-in');
      return;
    }

    // À ce stade, l'utilisateur est connecté. Tant que le profil n'est pas
    // résolu, on ne redirige pas : on éviterait sinon une oscillation entre
    // deux écrans pendant quelques centaines de millisecondes. C'est
    // exactement ce que distingue `profileResolved` de `profile === null`.
    if (!profileResolved) return;

    // Compte Firebase sans profil : l'inscription a été interrompue entre la
    // création du compte et l'écriture du profil. Sans cette branche,
    // l'utilisateur resterait bloqué sans explication — `accountStatus` vaut
    // `null`, donc aucune des conditions ci-dessous ne s'applique. On le
    // renvoie vers le parcours d'inscription, qui sait reprendre là où il
    // s'est arrêté.
    if (accountStatus === null) {
      if (!onSignUpScreen) router.replace('/(auth)/sign-up');
      return;
    }

    if (accountStatus !== 'active') {
      if (!inPendingGroup) router.replace('/(pending)');
      return;
    }

    if (!inTabsGroup && !onDetailScreen) router.replace('/(tabs)');
  }, [status, accountStatus, profileResolved, segments, router]);
}
