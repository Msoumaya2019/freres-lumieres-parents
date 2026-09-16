'use client';

/**
 * Journal d'audit.
 *
 * ## Ce que cet écran montre, et pourquoi il est en lecture seule
 *
 * Chaque action sensible — validation d'un compte, changement de rôle,
 * suspension, suppression — laisse une trace écrite par le serveur. Les règles
 * Firestore interdisent toute écriture cliente dans `adminLogs`, **même à un
 * administrateur** : un journal qu'on peut réécrire ne vaut rien en cas de
 * litige. Il n'y a donc ici aucun bouton de modification, et ce n'est pas un
 * oubli.
 *
 * ## Pourquoi le filtre n'a qu'une dimension
 *
 * Firestore exige un index composite pour chaque combinaison de critères. Un
 * filtre libre produirait une requête refusée, avec un message qui ne dit pas
 * quel index manque. Le repository n'expose donc que des variantes couvertes ;
 * ici, « tout » ou « un type d'action ».
 *
 * ## Pourquoi la liste se recharge au lieu de se mettre à jour localement
 *
 * Le journal est écrit par une Cloud Function, pas par cet écran. Après une
 * action d'administration, ce qui est affiché peut donc être périmé sans que
 * rien ne le signale. Le bouton « Actualiser » relit la première page : c'est
 * une requête sur une collection paginée, pas un abonnement permanent.
 */
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';

import {
  appendPage,
  createAdminLogRepository,
  userMessage,
  type AdminLogFilter,
} from '@fl/firebase';
import {
  ADMIN_ACTIONS,
  USER_ROLE_LABELS,
  adminActionLabel,
  formatDateTime,
  hasPermission,
} from '@fl/shared';
import type { AdminLog } from '@fl/types';

import { initializeFirebase } from '@/lib/firebase';
import { useAdminAuth } from '@/providers/auth-provider';

/** Une page du journal, rattachée au filtre qui l'a produite. */
interface JournalPage {
  /** Empreinte du filtre : une page chargée pour un autre filtre est ignorée. */
  readonly cle: string;
  readonly items: readonly AdminLog[];
  readonly cursor: QueryDocumentSnapshot | null;
  readonly hasMore: boolean;
}

/** Empreinte d'un filtre, utilisée pour apparier une page à sa demande. */
function fingerprint(filter: AdminLogFilter): string {
  return filter.kind === 'action' ? `action:${filter.action}` : 'all';
}

/**
 * Traduit la valeur brute d'un `<select>` en filtre.
 *
 * La valeur vient du DOM, donc d'une chaîne quelconque : on la confronte à la
 * liste des actions connues au lieu de la transtyper. Une valeur inattendue —
 * champ modifié à la main, version future de l'interface — retombe sur « tout
 * le journal » plutôt que de construire un filtre invalide.
 */
function toFilter(value: string): AdminLogFilter {
  const action = ADMIN_ACTIONS.find((candidate) => candidate === value);
  return action ? { kind: 'action', action } : { kind: 'all' };
}

export function AuditView(): React.JSX.Element {
  const { profile } = useAdminAuth();
  const role = profile?.role;

  // `initializeFirebase()` est idempotent : l'appeler ici ne crée pas une
  // seconde application Firebase.
  const [ready] = useState(() => initializeFirebase());
  const repository = useMemo(() => (ready ? createAdminLogRepository(ready.db) : null), [ready]);

  const [filter, setFilter] = useState<AdminLogFilter>({ kind: 'all' });
  const [page, setPage] = useState<JournalPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Incrémenté pour forcer la relecture de la première page.
  const [reloadToken, setReloadToken] = useState(0);

  const cle = fingerprint(filter);

  // Le rôle est vérifié avant de lancer la requête, et pas seulement avant
  // l'affichage : sans cela, un membre de la FCPE qui ouvre `/journal`
  // déclencherait une lecture que les règles refusent — une requête perdue et
  // une erreur de permission dans la console, pour un écran qui n'affichera
  // jamais rien d'autre que le panneau ci-dessous.
  const canRead = hasPermission(role, 'audit.read');

  useEffect(() => {
    if (!repository || !canRead) return;

    let cancelled = false;
    // L'empreinte est calculée ici, à partir de `filter` : l'effet ne dépend
    // alors que de valeurs stables, et aucune règle de lint n'a besoin d'être
    // désactivée.
    const pageCle = fingerprint(filter);

    void repository
      .list(filter)
      .then((result) => {
        if (cancelled) return;
        setLoadError(null);
        setPage({
          cle: pageCle,
          items: result.items,
          cursor: result.nextCursor,
          hasMore: result.hasMore,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(userMessage(error));
      });

    return () => {
      cancelled = true;
    };
  }, [repository, canRead, filter, reloadToken]);

  /**
   * La page affichée est celle du filtre courant.
   *
   * Une page chargée pour un autre filtre est ignorée : c'est ce qui permet de
   * dériver « en cours de chargement » sans le stocker, donc sans le pousser
   * depuis un effet.
   */
  const current = page?.cle === cle ? page : null;
  const items = current?.items ?? [];
  const loading = Boolean(repository) && current === null && loadError === null;

  function changeFilter(next: AdminLogFilter): void {
    if (fingerprint(next) === cle) return;
    setFilter(next);
    setLoadError(null);
  }

  function reload(): void {
    setLoadError(null);
    setPage(null);
    setReloadToken((value) => value + 1);
  }

  async function loadMore(): Promise<void> {
    if (!repository || !current?.cursor) return;

    setLoadingMore(true);
    try {
      const next = await repository.list(filter, current.cursor);
      setPage((previous) =>
        previous && previous.cle === cle
          ? {
              ...previous,
              // Le journal est en ajout seul : un doublon reste possible si une
              // entrée est écrite pendant la pagination.
              items: appendPage(previous.items, next),
              cursor: next.nextCursor,
              hasMore: next.hasMore,
            }
          : previous,
      );
    } catch (error) {
      setLoadError(userMessage(error));
    } finally {
      setLoadingMore(false);
    }
  }

  // Le menu masque déjà la section aux rôles sans `audit.read`, mais une
  // adresse saisie à la main y mène quand même. Mieux vaut une phrase qu'un
  // écran vide, ou qu'une erreur de permission brute.
  if (!canRead) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6">
        <h1 className="text-lg font-semibold text-foreground">Journal réservé</h1>
        <p className="mt-2 text-secondary">
          Le journal d’audit récapitule les actions sensibles et les changements de rôle. Il est
          réservé aux administrateurs.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">Journal d’audit</h1>
        <p className="text-secondary">
          Les actions sensibles, de la plus récente à la plus ancienne. Chaque entrée est écrite par
          le serveur et ne peut plus être modifiée.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-1 flex-col gap-2">
          <label htmlFor="action-filter" className="text-sm font-semibold text-foreground">
            Type d’action
          </label>
          <select
            id="action-filter"
            value={filter.kind === 'action' ? filter.action : ''}
            onChange={(event) => changeFilter(toFilter(event.target.value))}
            className="min-h-11 rounded-md border border-border bg-surface-muted px-3 text-foreground"
          >
            <option value="">Toutes les actions</option>
            {/* L'ordre suit `ADMIN_ACTIONS`, groupé par domaine — comptes,
                publications, contenus… — plutôt que l'ordre alphabétique des
                clés, qui mélangerait les domaines. */}
            {ADMIN_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {adminActionLabel(action)}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={reload}
          className="min-h-11 rounded-md border border-border px-4 text-sm text-secondary hover:bg-surface-muted"
        >
          Actualiser
        </button>
      </div>

      {loading ? (
        <p className="text-muted" role="status">
          Chargement du journal…
        </p>
      ) : null}

      {loadError ? (
        <div className="flex flex-col items-start gap-3 rounded-md bg-danger-soft p-4" role="alert">
          <p className="text-danger">{loadError}</p>
          <button
            type="button"
            onClick={reload}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-secondary hover:bg-surface-muted"
          >
            Réessayer
          </button>
        </div>
      ) : null}

      {!loading && !loadError && items.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="font-semibold text-foreground">Aucune entrée</p>
          <p className="mt-2 text-secondary">
            {filter.kind === 'action'
              ? 'Aucune action de ce type n’a été enregistrée.'
              : 'Le journal est vide. Les prochaines actions d’administration y apparaîtront.'}
          </p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <ol className="flex flex-col gap-3">
          {items.map((entry) => (
            <li key={entry.id}>
              <AuditRow entry={entry} />
            </li>
          ))}
        </ol>
      ) : null}

      {current?.hasMore ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="self-start rounded-md border border-border bg-surface px-4 py-2 text-sm text-secondary hover:bg-surface-muted disabled:opacity-50"
        >
          {loadingMore ? 'Chargement…' : 'Charger la suite'}
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entrée
// ---------------------------------------------------------------------------

function AuditRow({ entry }: { entry: AdminLog }): React.JSX.Element {
  const metadata = Object.entries(entry.metadata);

  return (
    <article className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-foreground">{adminActionLabel(entry.action)}</p>
        <p className="text-xs text-muted">{formatDateTime(entry.at)}</p>
      </div>

      <p className="text-sm text-secondary">
        Par <span className="font-medium text-foreground">{entry.actorName}</span> (
        {USER_ROLE_LABELS[entry.actorRole]})
      </p>

      <p className="break-all text-xs text-muted">
        {entry.targetType} · {entry.targetId}
      </p>

      {metadata.length > 0 ? (
        <dl className="mt-1 flex flex-col gap-1 rounded-md bg-surface-muted p-3 text-xs">
          {metadata.map(([key, value]) => (
            <div key={key} className="flex flex-wrap gap-x-2">
              <dt className="text-muted">{key}</dt>
              <dd className="text-foreground">{describeValue(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  );
}

/**
 * Rend une valeur de contexte lisible.
 *
 * Les changements de rôle sont enregistrés sous la forme
 * `{ avant: …, après: … }` : les afficher tels quels donnerait
 * `[object Object]`, ce qui rendrait le journal inutilisable précisément là où
 * il compte le plus.
 */
function describeValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('before' in record || 'after' in record) {
      return `${renderScalar(record.before)} → ${renderScalar(record.after)}`;
    }
    if (Array.isArray(value)) return value.map(renderScalar).join(', ');
    return Object.entries(record)
      .map(([key, inner]) => `${key} : ${renderScalar(inner)}`)
      .join(', ');
  }

  return String(value);
}

function renderScalar(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return Array.isArray(value) ? value.join(', ') : 'objet';
  return String(value);
}
