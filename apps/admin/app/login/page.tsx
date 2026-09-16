'use client';

import { loginSchema } from '@flp/validation';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useState, type FormEvent } from 'react';
import { firebase } from '@/lib/firebase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Formulaire invalide.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const credential = await signInWithEmailAndPassword(
        firebase.auth,
        parsed.data.email,
        parsed.data.password,
      );
      const token = await credential.user.getIdTokenResult(true);
      if (token.claims.role !== 'admin' || token.claims.status !== 'active') {
        await firebase.auth.signOut();
        setError('Ce compte ne possède pas un accès administrateur actif.');
      }
    } catch {
      setError('Adresse email ou mot de passe incorrect.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <section className="login-card">
        <span className="pill">ESPACE SÉCURISÉ</span>
        <h1>Administration FCPE</h1>
        <p>Connectez-vous avec un compte administrateur actif.</p>
        <form onSubmit={(event) => void submit(event)}>
          <div className="field">
            <label htmlFor="email">Adresse email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Mot de passe</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="primary-button" disabled={loading} type="submit">
            {loading ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
      </section>
    </div>
  );
}
