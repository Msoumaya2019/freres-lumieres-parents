'use client';

/**
 * File de validation des comptes.
 *
 * ## Ce que cet écran fait, et ce qu'il ne fait pas
 *
 * Il lit les profils d'une organisation par statut, et appelle une Cloud
 * Function pour changer ce statut. Il n'écrit **jamais** Firestore
 * directement : approuver un compte modifie les Custom Claims, que seul
 * l'Admin SDK peut écrire. Passer par une fonction place toutes les décisions
 * d'autorisation au même endroit, avec une seule implémentation à auditer.
 *
 * ## Pourquoi les actions sont filtrées par permission
 *
 * `user.approve` est réservé aux administrateurs, `user.suspend` l'est aux
 * modérateurs et administrateurs. Ne pas proposer une action non autorisée
 * évite un bouton qui échoue systématiquement. Ce n'est **pas** une
 * protection : la fonction relit le rôle de l'appelant en base, et les
 * Security Rules restent seules juges.
 *
 * ## Pourquoi la liste est rechargée après chaque action
 *
 * Un compte qui change de statut quitte la file courante — ou y entre. Le
 * retirer localement donnerait une liste juste jusqu'à la prochaine
 * ouverture ; le rechargement coûte une requête sur une collection de quelques
 * dizaines de documents et garantit que ce qui est affiché existe vraiment.
 */
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';

import {
  appendPage,
  createAdminFunctionsClient,
  createUserRepository,
  userMessage,
} from '@fl/firebase';
import { CLASS_LEVEL_LABELS, USER_STATUS_LABELS, formatDateTime, hasPermission } from '@fl/shared';
import type { UserProfile, UserStatus } from '@fl/types';

import { initializeFirebase } from '@/lib/firebase';
import { useAdminAuth } from '@/providers/auth-provider';

/** Statuts proposés comme filtres, dans l'ordre du cycle de vie d'un compte. */
const FILTERS: readonly UserStatus[] = ['pending', 'active', 'suspended', 'rejected'];

/** Style de la pastille de statut, aligné sur les jetons de thème. */
const STATUS_TONES: Record<UserStatus, string> = {
  pending: 'bg-warning-soft text-warning',
  active: 'bg-success-soft text-success',
  suspended: 'bg-danger-soft text-danger',
  rejected: 'bg-surface-muted text-muted',
};

/** Une page de la file, rattachée au filtre qui l'a produite. */
interface QueuePage {
  readonly filter: UserStatus;
  readonly items: readonly UserProfile[];
  readonly cursor: QueryDocumentSnapshot | null;
  readonly hasMore: boolean;
}

/** Action en attente de confirmation. */
interface PendingAction {
  readonly user: UserProfile;
  /** Statut à appliquer. */
  readonly status: UserStatus;
  readonly label: string;
  readonly tone: 'primary' | 'danger';
  /** Le motif est-il obligatoire ? */
  readonly requiresReason: boolean;
  readonly explanation: string;
}

/**
 * Actions disponibles pour un compte, selon son statut courant.
 *
 * Les entrées sont filtrées par permission à l'affichage. Le motif est exigé
 * pour un refus et une suspension : dans les deux cas, la personne concernée
 * voit la raison dans l'application, et un refus sans explication est
 * impossible à contester utilement.
 */
function actionsFor(user: UserProfile): readonly PendingAction[] {
  switch (user.status) {
    case 'pending':
      return [
        {
          user,
          status: 'active',
          label: 'Approuver',
          tone: 'primary',
          requiresReason: false,
          explanation:
            'Le compte sera activé immédiatement et la personne recevra une notification. Elle accédera aux informations de son école.',
        },
        {
          user,
          status: 'rejected',
          label: 'Refuser',
          tone: 'danger',
          requiresReason: true,
          explanation:
            'La demande sera refusée. La personne verra le motif ci-dessous, et pourra déposer une nouvelle demande plus tard.',
        },
      ];
    case 'active':
      return [
        {
          user,
          status: 'suspended',
          label: 'Suspendre',
          tone: 'danger',
          requiresReason: true,
          explanation:
            'L’accès sera coupé immédiatement : les jetons de session sont révoqués, la personne est déconnectée sans attendre. Le motif lui sera affiché.',
        },
      ];
    case 'suspended':
      return [
        {
          user,
          status: 'active',
          label: 'Réactiver',
          tone: 'primary',
          requiresReason: false,
          explanation: 'L’accès sera rétabli immédiatement, avec les droits du rôle actuel.',
        },
      ];
    case 'rejected':
      return [
        {
          user,
          status: 'active',
          label: 'Approuver finalement',
          tone: 'primary',
          requiresReason: false,
          explanation:
            'La demande initialement refusée sera acceptée. Le compte sera activé et la personne notifiée.',
        },
      ];
  }
}

/** Permission exigée par le serveur pour un changement de statut donné. */
function permissionFor(status: UserStatus): 'user.approve' | 'user.suspend' {
  return status === 'suspended' ? 'user.suspend' : 'user.approve';
}

export function UsersView(): React.JSX.Element {
  const { profile } = useAdminAuth();
  const orgId = profile?.orgId ?? null;
  const role = profile?.role;

  // `initializeFirebase()` est idempotent : l'appeler ici ne crée pas une
  // seconde application Firebase.
  const [ready] = useState(() => initializeFirebase());
  const repository = useMemo(() => (ready ? createUserRepository(ready.db) : null), [ready]);
  const adminFunctions = useMemo(
    () => (ready ? createAdminFunctionsClient(ready.functions) : null),
    [ready],
  );

  const [filter, setFilter] = useState<UserStatus>('pending');
  const [page, setPage] = useState<QueuePage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Incrémenté pour forcer un rechargement de la première page. `page` n'est
  // volontairement pas une dépendance de l'effet.
  const [reloadToken, setReloadToken] = useState(0);

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!repository || !orgId) return;

    let cancelled = false;

    void repository
      .listByStatus(orgId, filter)
      .then((result) => {
        if (cancelled) return;
        setLoadError(null);
        setPage({
          filter,
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
  }, [repository, orgId, filter, reloadToken]);

  /**
   * La page affichée est celle du filtre courant.
   *
   * Une page chargée pour un autre filtre est ignorée : c'est ce qui permet de
   * dériver « en cours de chargement » sans le stocker, donc sans le pousser
   * depuis un effet.
   */
  const current = page?.filter === filter ? page : null;
  const items = current?.items ?? [];
  const loading = Boolean(orgId) && current === null && loadError === null;

  function changeFilter(next: UserStatus): void {
    if (next === filter) return;
    setFilter(next);
    // Ces remises à zéro se font dans un gestionnaire d'événement, pas dans un
    // effet : c'est la forme que React recommande pour « adapter un état quand
    // une valeur change ».
    setLoadError(null);
    setPendingAction(null);
    setActionError(null);
  }

  function reload(): void {
    setLoadError(null);
    setPage(null);
    setReloadToken((value) => value + 1);
  }

  async function loadMore(): Promise<void> {
    if (!repository || !orgId || !current?.cursor) return;

    setLoadingMore(true);
    try {
      const next = await repository.listByStatus(orgId, filter, current.cursor);
      setPage((previous) =>
        previous && previous.filter === filter
          ? {
              ...previous,
              // `appendPage` écarte les doublons : un compte peut être renvoyé
              // deux fois si son statut change pendant la pagination.
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

  function startAction(action: PendingAction): void {
    setPendingAction(action);
    setReason('');
    setActionError(null);
  }

  async function confirmAction(): Promise<void> {
    if (!pendingAction || !adminFunctions) return;

    const trimmed = reason.trim();
    if (pendingAction.requiresReason && trimmed.length === 0) {
      setActionError('Un motif est nécessaire : la personne concernée le verra.');
      return;
    }

    setSubmitting(true);
    setActionError(null);

    try {
      await adminFunctions.setUserStatus({
        uid: pendingAction.user.id,
        status: pendingAction.status,
        ...(trimmed ? { reason: trimmed } : {}),
      });

      setPendingAction(null);
      setReason('');
      reload();
    } catch (error) {
      setActionError(userMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">Utilisateurs</h1>
        <p className="text-secondary">
          Validez les inscriptions et gérez les accès. Une inscription non validée ne donne accès à
          rien.
        </p>
      </header>

      {/* Filtres par statut, avec le rôle d'onglets */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrer par statut">
        {FILTERS.map((status) => {
          const selected = status === filter;
          return (
            <button
              key={status}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => changeFilter(status)}
              className={[
                'rounded-md border px-3 py-2 text-sm transition-colors',
                selected
                  ? 'border-primary bg-primary-soft font-semibold text-primary'
                  : 'border-border text-secondary hover:bg-surface-muted',
              ].join(' ')}
            >
              {USER_STATUS_LABELS[status]}
            </button>
          );
        })}
      </div>

      {loading ? (
        <p className="text-muted" role="status">
          Chargement des comptes…
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
          <p className="font-semibold text-foreground">
            Aucun compte « {USER_STATUS_LABELS[filter].toLowerCase()} »
          </p>
          <p className="mt-2 text-secondary">
            {filter === 'pending'
              ? 'Toutes les demandes ont été traitées. Les nouvelles inscriptions apparaîtront ici.'
              : 'Aucun compte ne se trouve dans cet état pour le moment.'}
          </p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {items.map((user) => (
            <li key={user.id}>
              <UserCard user={user} role={role} disabled={submitting} onAction={startAction} />
            </li>
          ))}
        </ul>
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

      {pendingAction ? (
        <ConfirmPanel
          action={pendingAction}
          reason={reason}
          onReasonChange={setReason}
          error={actionError}
          submitting={submitting}
          onCancel={() => {
            setPendingAction(null);
            setReason('');
            setActionError(null);
          }}
          onConfirm={() => void confirmAction()}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compte
// ---------------------------------------------------------------------------

function UserCard({
  user,
  role,
  disabled,
  onAction,
}: {
  user: UserProfile;
  role: UserProfile['role'] | undefined;
  disabled: boolean;
  onAction: (action: PendingAction) => void;
}): React.JSX.Element {
  const available = actionsFor(user).filter((action) =>
    hasPermission(role, permissionFor(action.status)),
  );

  // Les niveaux renseignés à l'inscription, affichés pour permettre à la FCPE
  // de vérifier qu'un rattachement correspond bien à un enfant scolarisé. Le
  // prénom des enfants n'est jamais transmis ici : il n'est lisible que par
  // leur propre parent.
  const levels = user.levels.map((level) => CLASS_LEVEL_LABELS[level]).join(', ');

  return (
    <article className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-foreground">
            {user.firstName} {user.lastName}
          </p>
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_TONES[user.status]}`}>
            {USER_STATUS_LABELS[user.status]}
          </span>
        </div>

        <p className="mt-1 truncate text-sm text-secondary">{user.email}</p>

        <dl className="mt-2 flex flex-col gap-1 text-xs text-muted">
          <div className="flex gap-2">
            <dt>Demande déposée le</dt>
            <dd>{formatDateTime(user.createdAt)}</dd>
          </div>
          <div className="flex gap-2">
            <dt>Niveaux déclarés</dt>
            <dd>{levels || '—'}</dd>
          </div>
          {user.statusReason ? (
            <div className="flex gap-2">
              <dt>Motif</dt>
              <dd className="text-danger">{user.statusReason}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      {available.length > 0 ? (
        <div className="flex shrink-0 flex-wrap gap-2">
          {available.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={disabled}
              onClick={() => onAction(action)}
              className={[
                'rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50',
                action.tone === 'danger'
                  ? 'border border-danger text-danger hover:bg-danger-soft'
                  : 'bg-primary text-on-primary hover:bg-primary-pressed',
              ].join(' ')}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="shrink-0 text-xs text-muted">Aucune action disponible avec votre rôle.</p>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

function ConfirmPanel({
  action,
  reason,
  onReasonChange,
  error,
  submitting,
  onCancel,
  onConfirm,
}: {
  action: PendingAction;
  reason: string;
  onReasonChange: (value: string) => void;
  error: string | null;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const { user, label, requiresReason, explanation, tone } = action;
  const reasonMissing = requiresReason && reason.trim().length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="flex w-full max-w-lg flex-col gap-4 rounded-lg border border-border bg-surface p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-1">
          <h2 id="confirm-title" className="text-lg font-semibold text-foreground">
            {label} — {user.firstName} {user.lastName}
          </h2>
          <p className="text-sm text-secondary">{explanation}</p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="action-reason" className="text-sm font-medium text-foreground">
            Motif {requiresReason ? '(obligatoire)' : '(facultatif)'}
          </label>
          <textarea
            id="action-reason"
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            rows={3}
            maxLength={500}
            // Le focus entre dans la boîte de dialogue dès son ouverture : le
            // motif est le seul champ, et la modale a été ouverte par une
            // action explicite.
            autoFocus
            className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-foreground"
            placeholder={
              requiresReason
                ? 'Expliquez la décision : cette phrase sera visible par la personne concernée.'
                : 'Précision conservée dans le journal d’audit.'
            }
          />
          <p className="text-xs text-muted">
            {reason.trim().length}/500 caractères. Conservé dans le journal d’audit.
          </p>
        </div>

        {error ? (
          <p className="rounded-md bg-danger-soft p-3 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-md border border-border px-4 py-2 text-sm text-secondary hover:bg-surface-muted disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting || reasonMissing}
            className={[
              'rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50',
              tone === 'danger'
                ? 'bg-danger text-on-primary'
                : 'bg-primary text-on-primary hover:bg-primary-pressed',
            ].join(' ')}
          >
            {submitting ? 'En cours…' : `Confirmer : ${label.toLowerCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}
