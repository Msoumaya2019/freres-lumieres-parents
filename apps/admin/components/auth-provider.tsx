'use client';

import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import type { UserRole, UserStatus } from '@flp/types';
import { firebase } from '@/lib/firebase';

interface AdminAuthState {
  user: User | null;
  role: UserRole | null;
  status: UserStatus | null;
  organizationId: string | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AdminAuthState | null>(null);

export function AdminAuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<Omit<AdminAuthState, 'logout'>>({
    user: null,
    role: null,
    status: null,
    organizationId: null,
    loading: true,
  });

  useEffect(
    () =>
      onAuthStateChanged(firebase.auth, (user) => {
        void (async () => {
          if (!user) {
            setState({
              user: null,
              role: null,
              status: null,
              organizationId: null,
              loading: false,
            });
            return;
          }
          const token = await user.getIdTokenResult(true);
          setState({
            user,
            role:
              typeof token.claims.role === 'string'
                ? (token.claims.role as UserRole)
                : null,
            status:
              typeof token.claims.status === 'string'
                ? (token.claims.status as UserStatus)
                : null,
            organizationId:
              typeof token.claims.organizationId === 'string'
                ? token.claims.organizationId
                : null,
            loading: false,
          });
        })();
      }),
    [],
  );

  const value = useMemo(
    () => ({ ...state, logout: () => signOut(firebase.auth) }),
    [state],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAdminAuth() {
  const value = useContext(AuthContext);
  if (!value)
    throw new Error('useAdminAuth doit être utilisé dans AdminAuthProvider.');
  return value;
}
