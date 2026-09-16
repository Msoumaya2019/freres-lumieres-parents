import type { ChildProfile, RegistrationConfig } from '@flp/types';
import type { RegistrationInput } from '@flp/validation';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, firestore, functions } from '../lib/firebase';

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

export async function loadRegistrationConfig(
  organizationId: string,
): Promise<RegistrationConfig> {
  const snapshot = await getDoc(
    doc(firestore, 'registrationOptions', organizationId),
  );
  if (!snapshot.exists()) throw new Error('registration-options-unavailable');
  return snapshot.data() as RegistrationConfig;
}

export async function loadChildProfiles(uid: string): Promise<ChildProfile[]> {
  const snapshot = await getDocs(
    query(
      collection(firestore, 'childProfiles'),
      where('parentUserId', '==', uid),
    ),
  );
  return snapshot.docs.map((entry) => entry.data() as ChildProfile);
}

export async function registerParent(input: RegistrationInput) {
  const credential = await createUserWithEmailAndPassword(
    auth,
    input.email.trim(),
    input.password,
  );
  try {
    const registerProfile = httpsCallable(functions, 'registerParentProfile');
    await registerProfile({
      firstName: input.firstName,
      lastName: input.lastName,
      organizationId: input.organizationId,
      children: input.children,
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
  const messages: Record<string, string> = {
    'auth/email-already-in-use': 'Un compte utilise déjà cette adresse email.',
    'auth/invalid-credential': 'Adresse email ou mot de passe incorrect.',
    'auth/invalid-email': 'L’adresse email est invalide.',
    'auth/network-request-failed':
      'Connexion impossible. Vérifiez votre réseau.',
    'auth/too-many-requests': 'Trop de tentatives. Réessayez plus tard.',
    'functions/invalid-argument': 'Les informations transmises sont invalides.',
    'functions/failed-precondition': 'Les inscriptions sont indisponibles.',
  };
  return messages[code] ?? 'Une erreur est survenue. Réessayez.';
}
