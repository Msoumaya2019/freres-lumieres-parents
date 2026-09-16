import type { MemberRegistrationInput } from '@flp/validation';
import {
  createUserWithEmailAndPassword,
  deleteUser,
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
  await credential.user.getIdToken(true);
}
export async function logout() {
  await signOut(auth);
}
export async function resetPassword(email: string) {
  await sendPasswordResetEmail(auth, email.trim());
}
export async function registerMember(input: MemberRegistrationInput) {
  const credential = await createUserWithEmailAndPassword(
    auth,
    input.email.trim(),
    input.password,
  );
  try {
    await httpsCallable(
      functions,
      'registerMemberProfile',
    )({
      firstName: input.firstName,
      lastName: input.lastName,
      organizationId: input.organizationId,
      declaredFunction: input.declaredFunction,
    });
    await credential.user.getIdToken(true);
  } catch (error) {
    await deleteUser(credential.user).catch(() => undefined);
    throw error;
  }
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
      } as Record<string, string>
    )[code] ?? 'Une erreur est survenue. Réessayez.'
  );
}
