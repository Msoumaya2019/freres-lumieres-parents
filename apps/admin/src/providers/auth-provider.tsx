'use client';

/**
 * Contexte d'authentification de l'interface d'administration.
 *
 * Différence importante avec le mobile : l'accès est **restreint aux rôles
 * `fcpe`, `moderator` et `admin`**. Un parent qui se connecte ici passe en
 * `forbidden` : il n'est **pas** déconnecté d'office — la session Firebase
 * reste ouverte — mais l'écran de connexion lui explique le refus et lui
 * propose de se déconnecter.
 *
 * Cette vérification n'est pas une mesure de sécurité : elle évite simplement
 * de laisser un parent dans une interface vide où chaque action échouerait.
 * Les Security Rules refusent de toute façon toute lecture.
 */
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { createUserRepository, toAppError } from '@fl/firebase';
import { hasPermission } from '@fl/shared';
import type { AppError, UserProfile } from '@fl/types';

import { canInitialize, initializeFirebase, isFirebaseReady } from '@/lib/firebase';

export type AdminAuthStatus =
  'initializing' | 'unconfigured' | 'signedOut' | 'signedIn' | 'forbidden';

interface AdminAuthContextValue {
  readonly status: AdminAuthStatus;
  readonly profile: UserProfile | null;
  readonly profileLoading: boolean;
  readonly error: AppError | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  // Firebase est initialisé une seule fois, pendant le premier rendu client.
  //
  // `initializeFirebase()` est idempotent et renvoie `null` quand `window`
  // n'existe pas (rendu serveur) ou quand la configuration est absente : il ne
  // produit donc aucun effet de bord côté serveur, et un double appel
  // (StrictMode) est sans conséquence. L'initialiser ici plutôt que dans un
  // effet évite d'avoir à recopier l'instance dans un état — ce qui
  // déclencherait un rendu en cascade au montage.
  const [ready] = useState(() => initializeFirebase());

  // `useMemo` est indispensable : sans lui, le dépôt changerait d'identité à
  // chaque rendu et l'effet de chargement du profil se relancerait sans fin.
  const repository = useMemo(() => (ready ? createUserRepository(ready.db) : null), [ready]);

  const [status, setStatus] = useState<AdminAuthStatus>('initializing');
  // Le profil est mémorisé avec l'identifiant auquel il appartient : lors d'un
  // changement de compte, l'interface ne montre jamais le nom de la personne
  // précédemment connectée pendant le chargement.
  const [profileState, setProfileState] = useState<{
    uid: string;
    value: UserProfile | null;
  } | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [uid, setUid] = useState<string | null>(null);

  // Abonnement à l'état d'authentification. Aucun `setState` n'est appelé
  // directement dans le corps de l'effet : tout passe par les rappels de
  // `onAuthStateChanged`, ce qui évite un rendu en cascade.
  useEffect(() => {
    if (!ready) return;

    return onAuthStateChanged(
      ready.auth,
      (user) => {
        if (!user) {
          setUid(null);
          setProfileState(null);
          setStatus('signedOut');
          return;
        }
        setUid(user.uid);
        setStatus('signedIn');
      },
      (authError) => {
        setError(toAppError(authError));
        setStatus('signedOut');
      },
    );
  }, [ready]);

  // Chargement du profil, puis contrôle du rôle.
  useEffect(() => {
    if (!repository || !uid) return;

    let cancelled = false;

    void repository
      .get(uid)
      .then((loaded) => {
        if (cancelled) return;
        setProfileState({ uid, value: loaded });

        if (!loaded || !hasPermission(loaded.role, 'fcpe.access')) {
          setStatus('forbidden');
        }
      })
      .catch((loadError) => {
        if (cancelled) return;
        // Un échec est enregistré comme un résultat vide : le chargement
        // s'arrête, l'erreur est affichée, et l'interface ne reste pas
        // suspendue à une requête qui n'aboutira pas.
        setProfileState({ uid, value: null });
        setError(toAppError(loadError));
      });

    return () => {
      cancelled = true;
    };
  }, [repository, uid]);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    if (!isFirebaseReady()) {
      const ready = initializeFirebase();
      if (!ready) {
        setStatus('unconfigured');
        return;
      }
    }

    const ready = initializeFirebase();
    if (!ready) return;

    try {
      await signInWithEmailAndPassword(ready.auth, email.trim().toLowerCase(), password);
    } catch (signInError) {
      const appErr = toAppError(signInError);
      setError(appErr);
      throw appErr;
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!isFirebaseReady()) return;
    try {
      await firebaseSignOut(initializeFirebase()!.auth);
    } catch (signOutError) {
      setError(toAppError(signOutError));
    }
  }, []);

  // Deux valeurs sont **dérivées** au rendu plutôt que poussées depuis un
  // effet :
  //  - « non configuré » ne dépend que des variables d'environnement, connues
  //    dès le premier rendu : le serveur et le client calculent donc la même
  //    chose, sans risque de désaccord d'hydratation ;
  //  - le profil affiché est celui de l'utilisateur courant, et d'aucun autre.
  const effectiveStatus: AdminAuthStatus = canInitialize() ? status : 'unconfigured';
  const effectiveProfile = profileState && profileState.uid === uid ? profileState.value : null;
  // « En cours de chargement » se déduit : un utilisateur est connecté, mais
  // aucun profil ne lui correspond encore.
  const effectiveProfileLoading = Boolean(uid) && profileState?.uid !== uid;

  const value = useMemo<AdminAuthContextValue>(
    () => ({
      status: effectiveStatus,
      profile: effectiveProfile,
      profileLoading: effectiveProfileLoading,
      error,
      signIn,
      signOut,
    }),
    [effectiveStatus, effectiveProfile, effectiveProfileLoading, error, signIn, signOut],
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthContextValue {
  const context = useContext(AdminAuthContext);
  if (!context) {
    throw new Error('useAdminAuth doit être utilisé à l’intérieur de <AdminAuthProvider>.');
  }
  return context;
}
