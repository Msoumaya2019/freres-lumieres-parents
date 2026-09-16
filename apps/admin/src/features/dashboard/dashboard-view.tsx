'use client';

/**
 * Tableau de bord.
 *
 * Lit un **document unique** (`counters/{orgId}`) plutôt que d'exécuter des
 * requêtes d'agrégation. Afficher « 312 parents actifs » coûterait sinon des
 * milliers d'index lus à chaque ouverture ; ici, c'est une lecture.
 *
 * Le document est maintenu par les Cloud Functions (Phase 4). Tant qu'il
 * n'existe pas, l'écran l'indique explicitement plutôt que d'afficher des
 * zéros trompeurs.
 */
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';

import { paths } from '@fl/firebase';
import type { DashboardCounters } from '@fl/types';

import { getFirebaseDb } from '@/lib/firebase';
import { useAdminAuth } from '@/providers/auth-provider';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; counters: DashboardCounters }
  | { status: 'empty' }
  | { status: 'error'; message: string };

export function DashboardView(): React.JSX.Element {
  const { profile } = useAdminAuth();
  const orgId = profile?.orgId;
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (!orgId) return;

    let cancelled = false;

    void getDoc(doc(getFirebaseDb(), paths.counter(orgId)))
      .then((snapshot) => {
        if (cancelled) return;
        if (!snapshot.exists()) {
          setState({ status: 'empty' });
          return;
        }
        setState({
          status: 'ready',
          counters: { ...(snapshot.data() as Omit<DashboardCounters, 'id'>), id: snapshot.id },
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Erreur inconnue',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // Tant qu'aucune organisation n'est connue, il n'y a rien à lire. Cette
  // situation se déduit du rendu — inutile de pousser un état depuis l'effet,
  // ce qui provoquerait un rendu en cascade au montage.
  const view: LoadState = orgId ? state : { status: 'empty' };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">Tableau de bord</h1>
        <p className="text-secondary">
          {profile?.firstName ? `Bonjour ${profile.firstName}. ` : ''}
          Voici l’état de l’application.
        </p>
      </header>

      {view.status === 'loading' ? (
        <p className="text-muted" role="status">
          Chargement des statistiques…
        </p>
      ) : null}

      {view.status === 'error' ? (
        <p className="rounded-md bg-danger-soft p-4 text-danger" role="alert">
          Impossible de charger les statistiques : {view.message}
        </p>
      ) : null}

      {view.status === 'empty' ? (
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="font-semibold text-foreground">Statistiques non disponibles</p>
          <p className="mt-2 text-secondary">
            Le document agrégé{' '}
            <code className="rounded bg-surface-muted px-1.5 py-0.5">
              counters/{profile?.orgId ?? '…'}
            </code>{' '}
            n’existe pas encore. Il est alimenté par les Cloud Functions mises en place à la Phase
            4.
          </p>
          <p className="mt-2 text-sm text-muted">
            Le tableau de bord affichera alors : parents inscrits, comptes en attente, utilisateurs
            actifs, publications récentes, signalements ouverts, commentaires signalés, prochain
            événement et dernier sondage.
          </p>
        </div>
      ) : null}

      {view.status === 'ready' ? (
        <>
          <section aria-labelledby="users-heading" className="flex flex-col gap-3">
            <h2
              id="users-heading"
              className="text-sm font-semibold uppercase tracking-wide text-muted"
            >
              Utilisateurs
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard label="Inscrits" value={view.counters.users.total} />
              <StatCard label="En attente" value={view.counters.users.pending} tone="warning" />
              <StatCard label="Actifs" value={view.counters.users.active} tone="success" />
              <StatCard label="Suspendus" value={view.counters.users.suspended} tone="danger" />
              <StatCard label="Actifs 7 j" value={view.counters.users.activeLast7Days} />
            </div>
          </section>

          <section aria-labelledby="moderation-heading" className="flex flex-col gap-3">
            <h2
              id="moderation-heading"
              className="text-sm font-semibold uppercase tracking-wide text-muted"
            >
              Modération
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatCard
                label="Signalements ouverts"
                value={view.counters.moderation.reportsOpen}
                tone="warning"
              />
              <StatCard label="En cours" value={view.counters.moderation.reportsInProgress} />
              <StatCard
                label="À modérer"
                value={view.counters.moderation.moderationQueueOpen}
                tone="danger"
              />
            </div>
          </section>

          <section aria-labelledby="engagement-heading" className="flex flex-col gap-3">
            <h2
              id="engagement-heading"
              className="text-sm font-semibold uppercase tracking-wide text-muted"
            >
              Vie de l’école
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Sondages ouverts" value={view.counters.engagement.openPolls} />
              <StatCard
                label="Sujets en cours"
                value={view.counters.engagement.openCollectiveIssues}
              />
              <StatCard
                label="Événements à venir"
                value={view.counters.engagement.upcomingEvents}
              />
              <StatCard
                label="Questions en attente"
                value={view.counters.engagement.pendingCouncilQuestions}
              />
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}): React.JSX.Element {
  const toneClass = {
    neutral: 'text-foreground',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
  }[tone];

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className={`text-2xl font-bold tabular-nums ${toneClass}`}>{value}</p>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  );
}
