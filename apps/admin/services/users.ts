import type { MemberProfile, UserRole, UserStatus } from '@flp/types';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { firebase } from '@/lib/firebase';

export async function listOrganizationMembers(
  organizationId: string,
): Promise<MemberProfile[]> {
  const snapshot = await getDocs(
    query(
      collection(firebase.firestore, 'memberProfiles'),
      where('organizationId', '==', organizationId),
    ),
  );
  return snapshot.docs
    .map((entry) => entry.data() as MemberProfile)
    .sort((left, right) => left.lastName.localeCompare(right.lastName, 'fr'));
}

export async function changeMemberStatus(uid: string, status: UserStatus) {
  const callable = httpsCallable(
    firebase.functions,
    status === 'active' ? 'approveMember' : 'setMemberStatus',
  );
  await callable(status === 'active' ? { uid } : { uid, status });
}

export async function changeMemberRole(uid: string, role: UserRole) {
  await httpsCallable(firebase.functions, 'setMemberRole')({ uid, role });
}
