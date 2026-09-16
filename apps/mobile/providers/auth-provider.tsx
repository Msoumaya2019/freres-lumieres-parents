import type { MemberProfile } from '@flp/types';
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
import { auth, firestore } from '../lib/firebase';

interface AuthState {
  firebaseUser: FirebaseUser | null;
  profile: MemberProfile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
}
const AuthContext = createContext<AuthState | null>(null);
export function AuthProvider({ children }: PropsWithChildren) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshProfile = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) {
      setProfile(null);
      return;
    }
    const snapshot = await getDoc(
      doc(firestore, 'memberProfiles', current.uid),
    );
    setProfile(snapshot.exists() ? (snapshot.data() as MemberProfile) : null);
  }, []);
  useEffect(
    () =>
      onAuthStateChanged(auth, (user) => {
        void (async () => {
          setFirebaseUser(user);
          if (user) await refreshProfile().catch(() => setProfile(null));
          else setProfile(null);
          setLoading(false);
        })();
      }),
    [refreshProfile],
  );
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
