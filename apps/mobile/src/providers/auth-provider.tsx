/**
 * Fournisseur d'authentification.
 *
 * Expose l'état de connexion et le profil de l'utilisateur à toute
 * l'application. Les écrans ne parlent jamais directement à Firebase Auth :
 * ils consomment ce contexte.
 *
 * ## Le cycle de vie d'un compte
 *
 * ```
 *   signedIn + profil absent                   → inscription à reprendre
 *   signedIn + profile.status = 'pending'      → écran d'attente de validation
 *   signedIn + profile.status = 'active'       → application complète
 *   signedIn + profile.status = 'suspended'    → écran de suspension
 *   signedIn + profile.status = 'rejected'     → écran de refus
 *   signedOut                                  → écran de connexion
 * ```
 *
 * La décision d'accès réelle reste prise par les Security Rules : ce contexte
 * ne fait qu'orienter l'interface. Un utilisateur `pending` qui contournerait
 * la navigation se heurterait de toute façon à un refus côté serveur.
 */
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
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

import {
  appError,
  createUserRepository,
  toAppError,
  type RegistrationInput,
  type UserRepository,
} from '@fl/firebase';
import type { AppError, UserProfile, UserStatus } from '@fl/types';

import { getFirebaseDb, initializeFirebase } from '@/lib/firebase';

/** État global d'authentification. */
export type AuthStatus = 'initializing' | 'unconfigured' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  readonly status: AuthStatus;
  /** Utilisateur Firebase Auth. */
  readonly firebaseUser: User | null;
  /** Profil Firestore, avec le rôle et le statut du compte. */
  readonly profile: UserProfile | null;
  /** Statut du compte, `null` tant que le profil n'est pas chargé. */
  readonly accountStatus: UserStatus | null;
  /** Vrai pendant le chargement du profil après connexion. */
  readonly profileLoading: boolean;
  /**
   * Vrai lorsque le profil a été **résolu** : il existe, ou il est absent.
   *
   * Cette distinction est indispensable au parcours d'inscription. Un compte
   * Firebase sans profil n'est pas une anomalie : c'est une inscription
   * interrompue entre la création du compte et l'écriture du profil, qu'il
   * faut pouvoir reprendre. Sans ce drapeau, `profile === null` serait ambigu
   * — « pas encore chargé » ou « réellement absent » — et l'application
   * enverrait l'utilisateur au mauvais endroit pendant le chargement.
   */
  readonly profileResolved: boolean;
  readonly error: AppError | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<User>;
  /**
   * Écrit le profil du parent qui vient de s'inscrire, avec le rattachement de
   * ses enfants.
   *
   * Exposé par ce contexte, et non consommé directement par l'écran : c'est le
   * seul endroit de l'application qui connaît l'utilisateur courant, et
   * l'opération n'a de sens que pour lui. Le profil ainsi créé est
   * immédiatement repris par l'abonnement temps réel, ce qui fait basculer
   * l'application vers l'écran d'attente de validation sans intervention.
   */
  completeRegistration: (input: RegistrationInput) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Force le rechargement du profil, par exemple après validation. */
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Erreur levée lorsqu'un écran agit alors que Firebase n'est pas configuré. */
function notConfigured(): AppError {
  return appError('failed-precondition', "Firebase n'est pas configuré sur cet appareil.");
}

/** Erreur levée lorsqu'une action exige une session qui n'existe plus. */
function notSignedIn(): AppError {
  return appError('unauthenticated', 'Vous devez être connecté pour effectuer cette action.');
}

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  /**
   * Initialisation faite **pendant le premier rendu**, et non dans un effet.
   *
   * C'est délibéré. `initializeFirebase()` est idempotent : l'appeler ici
   * garantit que l'état initial est exact. Dans un effet, le tout premier
   * rendu verrait un SDK non initialisé et conclurait `unconfigured` — le
   * garde de navigation renverrait alors l'utilisateur vers l'écran de
   * configuration à chaque lancement, le temps qu'un effet s'exécute.
   */
  const [firebase] = useState(() => initializeFirebase());

  const [status, setStatus] = useState<AuthStatus>(firebase ? 'initializing' : 'unconfigured');
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  /**
   * Profil, mémorisé **avec l'identifiant auquel il se rapporte**.
   *
   * Ce couplage est ce qui permet de dériver « en cours de chargement » au
   * lieu de le stocker. Un simple booléen `loading` serait faux pendant le
   * rendu qui suit la connexion — avant que l'effet n'ait pu le passer à
   * `true` — et une redirection décidée sur cette valeur erronée enverrait
   * l'utilisateur au mauvais endroit.
   *
   * Bénéfice secondaire : après une déconnexion suivie d'une reconnexion, le
   * profil mémorisé est réutilisé immédiatement, sans écran de chargement.
   */
  const [profileState, setProfileState] = useState<{
    uid: string;
    value: UserProfile | null;
  } | null>(null);

  // `useMemo` et non `useRef` : l'identité du dépôt doit être stable, sinon
  // l'effet d'abonnement au profil se réexécute à chaque rendu.
  const repository = useMemo<UserRepository | null>(
    () => (firebase ? createUserRepository(firebase.db) : null),
    [firebase],
  );

  const uid = firebaseUser?.uid ?? null;

  // --- Session -------------------------------------------------------------

  useEffect(() => {
    if (!firebase) return;

    return onAuthStateChanged(
      firebase.auth,
      (user) => {
        setFirebaseUser(user);
        setStatus(user ? 'signedIn' : 'signedOut');
      },
      (authError) => {
        setError(toAppError(authError));
        setStatus('signedOut');
      },
    );
  }, [firebase]);

  // --- Profil --------------------------------------------------------------
  //
  // Un seul listener temps réel sur toute l'application en dehors de la
  // messagerie. Il est indispensable : lorsqu'un administrateur valide un
  // compte, l'utilisateur passe de l'écran d'attente à l'application sans
  // avoir à redémarrer quoi que ce soit.

  useEffect(() => {
    if (!repository || !uid) return;

    return repository.watch(
      uid,
      (nextProfile) => setProfileState({ uid, value: nextProfile }),
      (watchError) => setError(toAppError(watchError)),
    );
  }, [repository, uid]);

  // --- État dérivé ---------------------------------------------------------

  const currentProfile =
    profileState && uid !== null && profileState.uid === uid ? profileState : null;
  const profile = currentProfile ? currentProfile.value : null;
  const profileResolved = currentProfile !== null;
  const profileLoading = uid !== null && !profileResolved;
  const accountStatus = profile?.status ?? null;

  /**
   * Rafraîchissement du jeton à chaque changement de statut.
   *
   * Les Custom Claims (`role`, `status`) sont posés par une Cloud Function, et
   * un jeton déjà émis ne les contient pas. Sans ce rafraîchissement, un
   * compte tout juste validé afficherait l'application complète mais se
   * heurterait à un refus de lecture sur chaque contenu, jusqu'à l'expiration
   * naturelle du jeton — soit une heure. Le parent conclurait que
   * l'application est cassée. Symétriquement, c'est ce qui rend une
   * suspension immédiatement effective.
   */
  useEffect(() => {
    if (!firebase || !accountStatus) return;
    void firebase.auth.currentUser?.getIdToken(true).catch(() => undefined);
  }, [firebase, accountStatus]);

  // --- Actions -------------------------------------------------------------

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!firebase) throw notConfigured();
      setError(null);
      try {
        await signInWithEmailAndPassword(firebase.auth, email.trim().toLowerCase(), password);
      } catch (signInError) {
        const appErr = toAppError(signInError);
        setError(appErr);
        throw appErr;
      }
    },
    [firebase],
  );

  const signUp = useCallback(
    async (email: string, password: string) => {
      if (!firebase) throw notConfigured();
      setError(null);
      try {
        const credential = await createUserWithEmailAndPassword(
          firebase.auth,
          email.trim().toLowerCase(),
          password,
        );
        return credential.user;
      } catch (signUpError) {
        const appErr = toAppError(signUpError);
        setError(appErr);
        throw appErr;
      }
    },
    [firebase],
  );

  const completeRegistration = useCallback(
    async (input: RegistrationInput) => {
      if (!repository || !uid) throw notSignedIn();
      // Les erreurs du dépôt remontent telles quelles : elles sont déjà
      // normalisées, et l'écran sait les présenter en français.
      await repository.createAccount(uid, input);
    },
    [repository, uid],
  );

  const sendPasswordReset = useCallback(
    async (email: string) => {
      if (!firebase) throw notConfigured();
      setError(null);
      try {
        await sendPasswordResetEmail(firebase.auth, email.trim().toLowerCase());
      } catch (resetError) {
        const appErr = toAppError(resetError);
        setError(appErr);
        throw appErr;
      }
    },
    [firebase],
  );

  const signOut = useCallback(async () => {
    if (!firebase) return;
    setError(null);
    try {
      // **Le jeton de notification de cet appareil n'est pas désactivé ici.**
      //
      // C'est un manque connu, et il se voit : après une déconnexion,
      // l'appareil continue de recevoir les notifications du compte qui vient
      // de partir. Le commentaire précédent annonçait une Cloud Function
      // déclenchée sur la déconnexion — elle n'existe pas, et Firebase
      // Functions v2 n'a aucun déclencheur de ce genre.
      //
      // Le remède appartient à ce fichier : le client peut écrire `enabled`
      // sur son propre jeton, les règles l'y autorisent, et c'est la seule
      // écriture qui lui reste. Il faut pour cela connaître le jeton, donc
      // l'enregistrement côté application, qui n'est pas encore écrit. Voir
      // `docs/05-notifications.md` § 2.
      await firebaseSignOut(firebase.auth);
    } catch (signOutError) {
      setError(toAppError(signOutError));
    }
  }, [firebase]);

  const refreshProfile = useCallback(async () => {
    if (!repository || !uid) return;
    const fresh = await repository.get(uid);
    setProfileState({ uid, value: fresh });
  }, [repository, uid]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      firebaseUser,
      profile,
      accountStatus,
      profileLoading,
      profileResolved,
      error,
      signIn,
      signUp,
      completeRegistration,
      sendPasswordReset,
      signOut,
      refreshProfile,
    }),
    [
      status,
      firebaseUser,
      profile,
      accountStatus,
      profileLoading,
      profileResolved,
      error,
      signIn,
      signUp,
      completeRegistration,
      sendPasswordReset,
      signOut,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth doit être utilisé à l’intérieur de <AuthProvider>.');
  }
  return context;
}

/**
 * Accès à la base Firestore depuis un hook.
 * Évite de répéter l'appel à `getFirebaseDb()` dans chaque écran.
 */
export function useFirestore() {
  return getFirebaseDb();
}
