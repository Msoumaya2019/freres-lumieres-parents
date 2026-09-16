/**
 * Avertissement affiché lorsque la configuration Firebase est absente.
 *
 * Le build de production doit fonctionner sans variables d'environnement :
 * c'est ce qui permet à la CI de compiler l'administration sans secret. Cet
 * encart explique alors à l'utilisateur ce qu'il doit faire.
 */
import { missingConfigMessage } from '@/lib/env';

export function ConfigNotice(): React.JSX.Element {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configuration requise</h1>
        <p className="mt-2 text-secondary">
          L’interface d’administration ne peut pas démarrer : les variables d’environnement Firebase
          sont absentes.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">À exécuter</h2>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-foreground">
          <li>
            Copiez <code className="rounded bg-surface-muted px-1.5 py-0.5">.env.example</code> en{' '}
            <code className="rounded bg-surface-muted px-1.5 py-0.5">apps/admin/.env.local</code>
          </li>
          <li>Remplissez les variables ci-dessous</li>
          <li>
            Relancez avec{' '}
            <code className="rounded bg-surface-muted px-1.5 py-0.5">npm run dev:admin</code>
          </li>
        </ol>
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Variables manquantes
        </h2>
        <pre className="mt-3 overflow-x-auto text-sm text-foreground">{missingConfigMessage}</pre>
      </div>

      <p className="text-sm text-muted">
        Ces valeurs ne sont pas des secrets : elles finissent de toute façon dans le navigateur. La
        sécurité repose sur les règles Firestore et les Cloud Functions.
      </p>
    </div>
  );
}
