'use client';

/**
 * Connexion à l'interface d'administration.
 *
 * Réservée aux rôles `fcpe`, `moderator` et `admin`. Un parent qui se connecte
 * ici se voit refuser l'accès, avec une explication — sans quoi il se
 * retrouverait dans une interface vide dont chaque action échouerait.
 *
 * Il n'est pas déconnecté d'office : la session Firebase reste ouverte, et
 * c'est cet écran qui propose la déconnexion. Sans elle, le formulaire ne
 * réapparaîtrait jamais et le compte resterait bloqué.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { userMessage } from '@fl/firebase';
import { loginSchema } from '@fl/shared';

import { ConfigNotice } from '@/components/config-notice';
import { useAdminAuth } from '@/providers/auth-provider';

export default function SignInPage(): React.JSX.Element {
  const { status, error, signIn, signOut } = useAdminAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'signedIn') router.replace('/dashboard');
  }, [status, router]);

  if (status === 'unconfigured') {
    return <ConfigNotice />;
  }

  if (status === 'forbidden') {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-8">
        <h1 className="text-2xl font-bold text-foreground">Accès non autorisé</h1>
        <p className="text-secondary">
          Votre compte ne dispose pas des droits nécessaires pour accéder à l’interface
          d’administration. Celle-ci est réservée aux membres de la FCPE, aux modérateurs et aux
          administrateurs.
        </p>
        <p className="text-secondary">
          Si vous êtes parent d’élève, utilisez l’application mobile.
        </p>
        {/* Seule issue possible : le compte est toujours connecté auprès de
            Firebase, donc le formulaire de connexion ne se réaffichera pas de
            lui-même. Sans ce bouton, il faudrait vider le stockage du
            navigateur pour essayer un autre compte. */}
        <button
          type="button"
          onClick={() => void signOut()}
          className="min-h-11 self-start rounded-md border border-border px-4 font-semibold text-secondary hover:bg-surface-muted"
        >
          Se déconnecter
        </button>
      </div>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLocalError(null);

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setLocalError(parsed.error.issues[0]?.message ?? 'Identifiants invalides.');
      return;
    }

    setSubmitting(true);
    try {
      await signIn(parsed.data.email, parsed.data.password);
    } catch (submitError) {
      setLocalError(userMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  const message = localError ?? (error ? userMessage(error) : null);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">Administration FCPE</h1>
        <p className="text-secondary">
          Écoles maternelle et élémentaire Frères Lumières — Montmagny
        </p>
      </header>

      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-6"
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="email" className="text-sm font-semibold text-foreground">
            Adresse e-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="min-h-11 rounded-md border border-border bg-surface-muted px-3 text-foreground"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="text-sm font-semibold text-foreground">
            Mot de passe
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="min-h-11 rounded-md border border-border bg-surface-muted px-3 text-foreground"
          />
        </div>

        {message ? (
          <p role="alert" className="rounded-md bg-danger-soft p-3 text-sm text-danger">
            {message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="min-h-11 rounded-md bg-primary px-4 font-semibold text-on-primary disabled:opacity-50"
        >
          {submitting ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>

      <p className="text-sm text-muted">
        Cet espace est réservé aux membres de la FCPE. Les parents d’élèves utilisent l’application
        mobile.
      </p>
    </div>
  );
}
