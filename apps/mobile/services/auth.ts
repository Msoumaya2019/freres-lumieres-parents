import type { UserStatus } from '@flp/types';
import type { MemberRegistrationInput } from '@flp/validation';
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../lib/firebase';

export async function login(email: string, password: string) {
  const credential = await signInWithEmailAndPassword(
    auth,
    email.trim(),
    password,
  );
  const token = await credential.user.getIdTokenResult(true);
  return {
    status:
      typeof token.claims.status === 'string'
        ? (token.claims.status as UserStatus)
        : null,
  };
}
export async function logout() {
  await signOut(auth);
}
export async function resetPassword(email: string) {
  await sendPasswordResetEmail(auth, email.trim());
}
export async function registerMember(input: MemberRegistrationInput) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const user =
    auth.currentUser?.email?.toLowerCase() === normalizedEmail
      ? auth.currentUser
      : (
          await createUserWithEmailAndPassword(
            auth,
            normalizedEmail,
            input.password,
          )
        ).user;
  const result = await httpsCallable(
    functions,
    'registerMemberProfile',
  )({
    firstName: input.firstName,
    lastName: input.lastName,
    organizationId: input.organizationId,
    declaredFunction: input.declaredFunction,
  });
  await user.getIdToken(true);
  return result.data;
}
export function authErrorMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error && 'code' in error
      ? String(error.code)
      : '';
  return (
    (
      {
        'auth/email-already-in-use':
          'Un compte utilise déjà cette adresse email.',
        'auth/invalid-credential': 'Adresse email ou mot de passe incorrect.',
        'auth/invalid-email': 'L’adresse email est invalide.',
        'auth/network-request-failed':
          'Connexion impossible. Vérifiez votre réseau.',
        'auth/too-many-requests': 'Trop de tentatives. Réessayez plus tard.',
        'functions/invalid-argument':
          'Les informations transmises sont invalides.',
        'functions/failed-precondition':
          'La demande ne peut pas être traitée pour le moment.',
      } as Record<string, string>
    )[code] ?? 'Une erreur est survenue. Réessayez.'
  );
}
