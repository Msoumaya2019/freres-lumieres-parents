'use client';

/**
 * La liste des sondages de l'organisation, du plus récent au plus ancien.
 *
 * ## Tous les statuts, y compris les brouillons
 *
 * C'est la différence avec le fil mobile. Un membre de la FCPE suit un
 * brouillon comme un sondage ouvert : c'est lui qui l'a enregistré, et c'est
 * lui qui l'ouvrira. Filtrer sur `open` et `closed` ferait disparaître de
 * l'écran, précisément, les sondages qui n'attendent que lui.
 *
 * Ce n'est pas non plus un choix de confort : c'est ce qui rend la requête
 * **démontrable**. Les règles ne filtrent pas — elles autorisent ou refusent
 * une requête entière, et Firestore n'évalue la règle qu'à partir des
 * contraintes que la requête porte. La branche FCPE de `allow read` exige
 * `orgId`, et c'est exactement ce que `fetchForAdmin` contraint. Un filtre de
 * statut ne démontrerait rien de plus, et coûterait un second index.
 *
 * ## Elle ne peut pas montrer les résultats d'un sondage qu'elle ne peut pas lire
 *
 * Le décompte est demandé **par chaque ligne**, et seulement si le rôle y a
 * droit — voir `poll-row.tsx`. La liste, elle, n'a pas à connaître cette
 * question : elle ne charge que les sondages, et un refus de lecture sur
 * `pollResults` s'affiche sur la ligne concernée sans emporter les autres.
 *
 * ## Pourquoi la liste est rechargée après chaque écriture
 *
 * Clore un sondage change son statut, donc son badge et le libellé de son
 * bouton, et publie son décompte. **Ouvrir un brouillon fait plus** : il change
 * le statut, le badge, et `startsAt` — donc la **place** du sondage dans la
 * liste, qui est triée dessus. Une liste retouchée à la main le laisserait à sa
 * position de brouillon, c'est-à-dire précisément là où on ne le cherche plus
 * après l'avoir publié.
 *
 * Retoucher l'état local donnerait une liste juste jusqu'à la prochaine
 * ouverture ; le rechargement coûte une requête sur une collection de quelques
 * dizaines de documents, et garantit que ce qui est affiché existe vraiment.
 * C'est le choix déjà fait pour les publications et pour la file des comptes.
 *
 * ## Le bouton « Actualiser » n'est pas un ornement
 *
 * L'échéance d'un sondage est comparée à l'horloge du navigateur, et rien ne
 * prévient la page qu'elle vient de passer : un sondage affiché « Ouvert »
 * reste affiché ainsi jusqu'au prochain rendu, même si la règle refuse déjà les
 * votes depuis une minute. Aucun compte à rebours n'a été ajouté pour autant —
 * il faudrait un minuteur par ligne, pour un écran d'administration qu'on
 * regarde quelques secondes à la fois. Le rechargement à la demande dit ce
 * qu'il fait, et suffit.
 */

import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';

import { appendPage, userMessage, type PollRepository } from '@fl/firebase';
import { hasPollEnded } from '@fl/shared';
import type { Poll, UserRole } from '@fl/types';

import { PollRow } from '@/features/polls/poll-row';

interface PollListProps {
  readonly repository: PollRepository;
  readonly orgId: string;
  readonly role: UserRole | undefined;
  /**
   * Incrémenté par l'écran parent après une création : la liste se relit au
   * lieu de fabriquer une ligne. Un sondage créé est un document, et ce qui
   * s'affiche doit venir du serveur — c'est aussi ce qui fait apparaître en
   * tête celui que le formulaire vient d'écrire, puisque la liste est triée
   * du plus récent au plus ancien.
   */
  readonly refreshToken: number;
}

interface LoadedPage {
  readonly items: readonly Poll[];
  readonly cursor: QueryDocumentSnapshot | null;
  readonly hasMore: boolean;
}

export function PollList({
  repository,
  orgId,
  role,
  refreshToken,
}: PollListProps): React.JSX.Element {
  const [page, setPage] = useState<LoadedPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Incrémenté pour forcer un rechargement de la première page. `page` n'est
  // volontairement pas une dépendance de l'effet.
  const [reloadToken, setReloadToken] = useState(0);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void repository
      .fetchForAdmin({ orgId })
      .then((result) => {
        if (cancelled) return;
        setLoadError(null);
        setPage({ items: result.items, cursor: result.nextCursor, hasMore: result.hasMore });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(userMessage(error));
      });

    return () => {
      cancelled = true;
    };
  }, [repository, orgId, reloadToken, refreshToken]);

  const loading = page === null && loadError === null;
  const items = page?.items ?? [];

  function reload(): void {
    setLoadError(null);
    setPage(null);
    setReloadToken((value) => value + 1);
  }

  async function loadMore(): Promise<void> {
    if (!page?.cursor) return;

    setLoadingMore(true);
    try {
      const next = await repository.fetchForAdmin({ orgId, cursor: page.cursor });
      setPage((previous) =>
        previous
          ? {
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

  async function run(action: () => Promise<void>, message: string): Promise<void> {
    setBusy(true);
    setActionError(null);
    setNotice(null);

    try {
      await action();
      setNotice(message);
      reload();
    } catch (error) {
      setActionError(userMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function close(target: Poll): void {
    // Le message dit ce qui vient de se passer, et les deux cas ne se
    // ressemblent pas : dans l'un le vote était déjà fermé, dans l'autre il
    // vient de l'être. Un message unique ferait croire, une fois sur deux, à
    // une action qui n'a pas eu lieu.
    const dejaFerme = hasPollEnded({ endsAt: target.endsAt });

    void run(
      () => repository.close(target.id),
      dejaFerme
        ? 'Clôture inscrite. Le vote était déjà fermé par l’échéance annoncée.'
        : 'Sondage clos. Les votes sont désormais refusés, et le décompte publié.',
    );
  }

  function open(target: Poll): void {
    // Même raison que pour la clôture, et elle porte ici sur la notification :
    // elle part dans les deux cas, mais dans l'un elle annonce un sondage
    // auquel plus personne ne peut répondre. Le taire ferait passer pour une
    // publication ordinaire un envoi qui ne l'est pas.
    const echeancePassee = hasPollEnded({ endsAt: target.endsAt });

    void run(
      () => repository.open(target.id),
      echeancePassee
        ? 'Brouillon publié, mais l’échéance annoncée est déjà passée : la règle refuse les votes, et le décompte est publié. La notification part malgré tout.'
        : 'Brouillon publié. La question est désormais lisible par son audience, et la notification d’annonce est déclenchée.',
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-foreground">Suivi des sondages</h2>
          <p className="text-sm text-secondary">
            Tous les statuts, brouillons compris, du plus récent au plus ancien.
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-secondary hover:bg-surface-muted"
        >
          Actualiser
        </button>
      </header>

      {notice ? (
        <p className="rounded-md bg-success-soft p-3 text-sm text-success" role="status">
          {notice}
        </p>
      ) : null}

      {actionError ? (
        <p className="rounded-md bg-danger-soft p-3 text-sm text-danger" role="alert">
          {actionError}
        </p>
      ) : null}

      {loading ? (
        <p className="text-muted" role="status">
          Chargement des sondages…
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
          <p className="font-semibold text-foreground">Aucun sondage pour le moment</p>
          <p className="mt-2 text-secondary">
            Les sondages créés ci-dessus apparaissent ici, quel que soit leur statut.
          </p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {items.map((poll) => (
            <li key={poll.id}>
              <PollRow
                poll={poll}
                role={role}
                repository={repository}
                busy={busy}
                onClose={close}
                onOpen={open}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {page?.hasMore ? (
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
