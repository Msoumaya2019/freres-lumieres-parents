import type { User, UserRole, UserStatus } from '@flp/types';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { firebase } from '@/lib/firebase';

export async function listOrganizationUsers(
  organizationId: string,
): Promise<User[]> {
  const snapshot = await getDocs(
    query(
      collection(firebase.firestore, 'users'),
      where('organizationId', '==', organizationId),
    ),
  );
  return snapshot.docs
    .map((entry) => entry.data() as User)
    .sort((left, right) => left.lastName.localeCompare(right.lastName, 'fr'));
}

export async function changeStatus(uid: string, status: UserStatus) {
  const callable = httpsCallable(
    firebase.functions,
    status === 'active' ? 'approveUser' : 'setUserStatus',
  );
  await callable(status === 'active' ? { uid } : { uid, status });
}

export async function changeRole(uid: string, role: UserRole) {
  await httpsCallable(firebase.functions, 'setUserRole')({ uid, role });
}
