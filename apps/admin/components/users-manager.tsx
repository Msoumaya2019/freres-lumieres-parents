'use client';

import type { User, UserRole, UserStatus } from '@flp/types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAdminAuth } from './auth-provider';
import {
  changeRole,
  changeStatus,
  listOrganizationUsers,
} from '@/services/users';

const statusLabels: Record<UserStatus, string> = {
  pending: 'En attente',
  active: 'Actif',
  suspended: 'Suspendu',
  rejected: 'Refusé',
};
const roleLabels: Record<UserRole, string> = {
  parent: 'Parent',
  fcpe: 'FCPE',
  moderator: 'Modérateur',
  admin: 'Admin',
};

export function UsersManager() {
  const { organizationId, user: currentUser } = useAdminAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<UserStatus | 'all'>('pending');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      setUsers(await listOrganizationUsers(organizationId));
      setError('');
    } catch {
      setError('Impossible de charger les utilisateurs.');
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    void listOrganizationUsers(organizationId)
      .then((result) => {
        if (!cancelled) {
          setUsers(result);
          setError('');
        }
      })
      .catch(() => {
        if (!cancelled) setError('Impossible de charger les utilisateurs.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('fr');
    return users.filter(
      (user) =>
        (filter === 'all' || user.status === filter) &&
        (!needle ||
          `${user.firstName} ${user.lastName} ${user.email}`
            .toLocaleLowerCase('fr')
            .includes(needle)),
    );
  }, [filter, search, users]);

  async function run(uid: string, action: () => Promise<void>) {
    setBusy(uid);
    setError('');
    try {
      await action();
      await reload();
    } catch {
      setError('L’action n’a pas pu être appliquée. Vérifiez vos permissions.');
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Utilisateurs</h1>
          <p>Valider les inscriptions et gérer les accès.</p>
        </div>
        <span className="pill">
          {users.filter((user) => user.status === 'pending').length} EN ATTENTE
        </span>
      </header>
      <section className="card user-toolbar">
        <label className="search-field">
          Rechercher
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nom ou adresse email"
          />
        </label>
        <label className="search-field">
          Statut
          <select
            value={filter}
            onChange={(event) =>
              setFilter(event.target.value as UserStatus | 'all')
            }
          >
            <option value="all">Tous</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </section>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <div className="card state-card">Chargement…</div>
      ) : visible.length === 0 ? (
        <div className="card state-card">Aucun utilisateur correspondant.</div>
      ) : (
        <div className="users-list">
          {visible.map((user) => (
            <article className="card user-card" key={user.id}>
              <div className="user-identity">
                <strong>
                  {user.firstName} {user.lastName}
                </strong>
                <span>{user.email}</span>
                <small>
                  {user.schoolIds.join(', ') || 'Établissement non renseigné'} ·{' '}
                  {user.levelIds.join(', ') || 'Niveau non renseigné'}
                </small>
              </div>
              <span className={`status status-${user.status}`}>
                {statusLabels[user.status]}
              </span>
              <label className="compact-field">
                Rôle
                <select
                  aria-label={`Rôle de ${user.firstName} ${user.lastName}`}
                  disabled={busy === user.id || user.id === currentUser?.uid}
                  value={user.role}
                  onChange={(event) =>
                    void run(user.id, () =>
                      changeRole(user.id, event.target.value as UserRole),
                    )
                  }
                >
                  {Object.entries(roleLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="user-actions">
                {user.status !== 'active' ? (
                  <button
                    disabled={busy === user.id}
                    onClick={() =>
                      void run(user.id, () => changeStatus(user.id, 'active'))
                    }
                  >
                    Approuver / réactiver
                  </button>
                ) : null}
                {user.status !== 'suspended' ? (
                  <button
                    className="warning-button"
                    disabled={busy === user.id || user.id === currentUser?.uid}
                    onClick={() =>
                      void run(user.id, () =>
                        changeStatus(user.id, 'suspended'),
                      )
                    }
                  >
                    Suspendre
                  </button>
                ) : null}
                {user.status === 'pending' ? (
                  <button
                    className="danger-button"
                    disabled={busy === user.id}
                    onClick={() =>
                      void run(user.id, () => changeStatus(user.id, 'rejected'))
                    }
                  >
                    Refuser
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
