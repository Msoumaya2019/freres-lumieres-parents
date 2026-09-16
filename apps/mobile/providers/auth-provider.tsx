import type { User as UserProfile } from '@flp/types';
import { useRouter, useSegments } from 'expo-router';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { auth, firestore } from '@/lib/firebase';

interface AuthState {
  firebaseUser: FirebaseUser | null;
  profile: UserProfile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const segments = useSegments();

  const refreshProfile = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) {
      setProfile(null);
      return;
    }
    const snapshot = await getDoc(doc(firestore, 'users', current.uid));
    setProfile(snapshot.exists() ? (snapshot.data() as UserProfile) : null);
  }, []);

  useEffect(
    () =>
      onAuthStateChanged(auth, (user) => {
        void (async () => {
          setFirebaseUser(user);
          if (user) {
            await refreshProfile().catch(() => setProfile(null));
          } else {
            setProfile(null);
          }
          setLoading(false);
        })();
      }),
    [refreshProfile],
  );

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === '(auth)';
    const onStatus = inAuthGroup && String(segments[1]) === 'status';
    if (!firebaseUser && !inAuthGroup) router.replace('/(auth)/login');
    else if (firebaseUser && profile?.status === 'active' && inAuthGroup)
      router.replace('/(tabs)');
    else if (
      firebaseUser &&
      profile &&
      profile.status !== 'active' &&
      !onStatus
    )
      router.replace('/(auth)/status');
  }, [firebaseUser, loading, profile, router, segments]);

  const value = useMemo(
    () => ({ firebaseUser, profile, loading, refreshProfile }),
    [firebaseUser, profile, loading, refreshProfile],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth doit être utilisé dans AuthProvider.');
  return value;
}
