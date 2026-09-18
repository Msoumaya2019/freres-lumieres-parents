'use client';

/**
 * Un sondage dans la liste d'administration.
 *
 * ## Le statut affiché n'est pas `poll.status`
 *
 * Le badge lit `pollEffectiveStatus`, et non `poll.status`. Un sondage ouvert
 * dont l'échéance est passée est clos **par la règle** : plus aucun vote n'est
 * accepté, et le décompte est publié. Le document, lui, porte encore `open`
 * jusqu'au passage du planificateur, ou jusqu'à la clôture déclenchée ici.
 * Afficher `poll.status` ferait dire « Ouvert » à la fiche qui écrit, deux
 * lignes plus bas, que la date de clôture est passée — l'écran mobile le
 * faisait, et c'est ce qui a fait remonter la dérivation dans `@fl/shared`.
 *
 * Le **bouton**, lui, lit le statut enregistré, et c'est voulu : une clôture
 * s'inscrit sur un document qui porte encore `open`. Un sondage déjà clos n'a
 * rien à inscrire, et `close()` le refuserait. Les deux lectures répondent donc
 * à deux questions différentes, et c'est la raison pour laquelle elles
 * coexistent ici sans que l'une dérive de l'autre.
 *
 * ## Le décompte est lu par la ligne, et seulement par qui y a droit
 *
 * `pollResults/{pollId}` est lisible par la FCPE **quel que soit le statut** :
 * la branche `isFcpe()` de la règle ne dépend ni du statut ni de
 * `resultsVisibility`. C'est nécessaire — c'est la FCPE qui suit un sondage en
 * préparation, et qui décide de le clore. Un parent, lui, passe par la seconde
 * branche, qui est étroite.
 *
 * La ligne reproduit donc `isFcpeRole(role)` — le pendant client de `isFcpe()`
 * — **avant** de demander. Ce n'est pas une protection : les règles restent
 * seules juges. C'est ce qui évite une lecture qui échouerait à tous les coups,
 * et un abonnement refusé ne se rouvre pas tout seul.
 *
 * `getResults()` **lève** un refus plutôt que de rendre `null`, et c'est le bon
 * choix : `null` veut dire « aucune voix », pas « je n'ai pas le droit ». Les
 * deux ne se confondent pas ici — l'erreur s'affiche sur la ligne, à sa place,
 * sans emporter la liste.
 *
 * ## Le décompte est reconstruit depuis les réponses du sondage
 *
 * `results.options` devrait porter toutes les réponses, y compris à zéro voix.
 * On prend quand même `poll.options` comme référence : c'est le sondage qui
 * porte la question et son ordre, et un décompte plus ancien que la dernière
 * écriture du sondage ne doit pas faire disparaître une réponse de l'écran.
 *
 * ## Clore n'est pas toujours « fermer le vote »
 *
 * Les deux cas ne se disent pas de la même façon, et les confondre ferait une
 * promesse fausse dans l'un des deux :
 *
 *  - **échéance passée** : le vote est déjà fermé et le décompte déjà publié.
 *    Le bouton ne fait qu'**inscrire** un fait accompli ;
 *  - **échéance à venir, ou absente** : la clôture **ferme le vote
 *    maintenant**. C'est une décision, et elle a une conséquence que l'écran
 *    doit nommer — la date annoncée aux familles ne sera pas honorée.
 *
 * D'où la confirmation en deux temps. `close()` refuse un second appel, et rien
 * dans cet écran ne rouvre un sondage clos : la fermeture est donc à sens
 * unique **depuis ici**, même si la règle de mise à jour, elle, accepterait un
 * retour à `open` — `unchanged('status')` n'y figure pas.
 */

import { useEffect, useState } from 'react';

import { userMessage, type PollRepository } from '@fl/firebase';
import {
  POLL_RESULTS_VISIBILITY_LABELS,
  POLL_STATUS_BADGES,
  POLL_STATUS_LABELS,
  audienceLabel,
  formatDateTime,
  hasPermission,
  hasPollEnded,
  isFcpeRole,
  pluralize,
  pollEffectiveStatus,
} from '@fl/shared';
import type { Poll, PollResults, UserRole } from '@fl/types';

interface PollRowProps {
  readonly poll: Poll;
  readonly role: UserRole | undefined;
  /** Le dépôt de la liste : la ligne ne fait que lire le décompte. */
  readonly repository: PollRepository;
  /** Une écriture est en cours : les actions sont neutralisées. */
  readonly busy: boolean;
  readonly onClose: (poll: Poll) => void;
}

const ACTION_CLASS =
  'rounded-md border border-border px-3 py-1.5 text-sm text-secondary hover:bg-surface-muted disabled:opacity-50';

export function PollRow({
  poll,
  role,
  repository,
  busy,
  onClose,
}: PollRowProps): React.JSX.Element {
  const echeancePassee = hasPollEnded({ endsAt: poll.endsAt });
  // Une seule dérivation, et deux lectures : le badge et son libellé viennent
  // du même statut effectif. Deux appels auraient pu diverger le jour où l'un
  // des deux gagnerait une condition.
  const statutEffectif = pollEffectiveStatus({ status: poll.status, endsAt: poll.endsAt });
  const badge = POLL_STATUS_BADGES[statutEffectif];
  const libelle = POLL_STATUS_LABELS[statutEffectif];

  // `open` enregistré, échéance passée : la règle tient déjà le sondage clos,
  // et le document ne le sait pas encore. C'est le cas que la clôture manuelle
  // sert à inscrire, et c'est aussi celui que le libellé doit distinguer.
  const closParLEcheance = poll.status === 'open' && echeancePassee;

  const peutLire = role !== undefined && isFcpeRole(role);
  const peutClore = poll.status === 'open' && hasPermission(role, 'poll.close');

  const [results, setResults] = useState<PollResults | null | undefined>(undefined);
  const [tallyError, setTallyError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState(false);

  useEffect(() => {
    if (!peutLire) return;

    let cancelled = false;

    void repository
      .getResults(poll.id)
      .then((loaded) => {
        if (cancelled) return;
        setTallyError(null);
        setResults(loaded);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setTallyError(userMessage(error));
      });

    return () => {
      cancelled = true;
    };
  }, [repository, poll.id, peutLire]);

  // L'absence de document vaut zéro : un sondage sans voix n'en a pas, et le
  // document n'apparaît qu'au premier vote. Voir `PollResults`.
  const voix = (optionId: string): number =>
    results?.options.find((one) => one.id === optionId)?.votes ?? 0;
  // Le total est reconstruit depuis les réponses **du sondage** plutôt que
  // depuis `results.options` : c'est le sondage qui fait foi sur ce qu'il a
  // proposé, et un décompte plus ancien ne doit pas en retirer une.
  const totalVoix = poll.options.reduce((somme, option) => somme + voix(option.id), 0);

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded px-2 py-0.5 text-xs font-semibold"
          style={{ color: badge.color, backgroundColor: badge.background }}
        >
          {libelle}
        </span>

        {poll.anonymous ? (
          <span className="rounded bg-surface-muted px-2 py-0.5 text-xs text-secondary">
            Anonyme
          </span>
        ) : null}

        {poll.allowMultiple ? (
          <span className="rounded bg-surface-muted px-2 py-0.5 text-xs text-secondary">
            Choix multiple
          </span>
        ) : null}

        {closParLEcheance ? (
          <span className="rounded bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">
            Clôture non inscrite
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="font-semibold text-foreground">{poll.question}</h3>
        {poll.description ? (
          <p className="line-clamp-3 whitespace-pre-line text-sm text-secondary">
            {poll.description}
          </p>
        ) : null}
      </div>

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <div className="flex gap-1">
          <dt>Mis en ligne le</dt>
          <dd>{formatDateTime(poll.startsAt)}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Clôture</dt>
          <dd>{poll.endsAt ? formatDateTime(poll.endsAt) : 'aucune date annoncée'}</dd>
        </div>
        {poll.closedAt ? (
          <div className="flex gap-1">
            <dt>Clôturé le</dt>
            <dd>{formatDateTime(poll.closedAt)}</dd>
          </div>
        ) : null}
        <div className="flex gap-1">
          <dt>Audience</dt>
          <dd>{audienceLabel(poll.audience)}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Résultats</dt>
          <dd>{POLL_RESULTS_VISIBILITY_LABELS[poll.resultsVisibility]}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Réponses</dt>
          <dd>{pluralize(poll.options.length, 'réponse')}</dd>
        </div>
      </dl>

      {closParLEcheance ? (
        <p className="text-xs text-warning">
          La date annoncée est passée : la règle refuse déjà les votes et publie déjà le décompte.
          Seule la mention de clôture manque encore au document.
        </p>
      ) : null}

      {peutLire ? (
        <div className="flex flex-col gap-2 rounded-md bg-surface-muted p-3">
          {tallyError ? (
            <p className="text-xs text-danger">{tallyError}</p>
          ) : results === undefined ? (
            <p className="text-xs text-muted">Lecture du décompte…</p>
          ) : results === null ? (
            <p className="text-xs text-muted">Aucune voix pour l’instant.</p>
          ) : (
            <>
              <p className="text-xs text-secondary">
                {/* « Voix » est invariable, et `pluralize` ajoute un « s » par
                    défaut : le pluriel est donc passé explicitement, sans quoi
                    l’écran afficherait « 2 voixs ». */}
                {`${pluralize(results.totalVoters, 'participant')} · ${pluralize(totalVoix, 'voix', 'voix')}`}
              </p>
              <ul className="flex flex-col gap-1">
                {poll.options.map((option) => (
                  <li
                    key={option.id}
                    className="flex items-baseline justify-between gap-3 text-xs text-foreground"
                  >
                    <span className="truncate">{option.label}</span>
                    <span className="shrink-0 tabular-nums text-secondary">{voix(option.id)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}

      {confirmation ? (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-muted p-3">
          <p className="text-sm text-foreground">
            {closParLEcheance
              ? `Le vote est déjà fermé depuis le ${formatDateTime(poll.endsAt)} : la règle refuse les votes et publie le décompte. Inscrire la clôture ne change rien pour les familles — cela l’écrit au document, et la fiche cessera d’afficher « clôture non inscrite ».`
              : poll.endsAt
                ? `Clore maintenant ferme le vote : dès que le statut passe à « clôturé », la règle n’accepte plus de vote. La date annoncée (${formatDateTime(poll.endsAt)}) ne sera donc pas honorée, et les familles ne pourront plus voter avant.`
                : `Clore maintenant ferme le vote : dès que le statut passe à « clôturé », la règle n’accepte plus de vote. Ce sondage n’annonce aucune date de clôture — c’est cette action qui y met fin.`}
          </p>
          <p className="text-xs text-muted">
            Rien dans cet écran ne rouvre un sondage clos, et une clôture déjà inscrite ne peut pas
            être réécrite.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              disabled={busy}
              onClick={() => {
                setConfirmation(false);
                onClose(poll);
              }}
            >
              {closParLEcheance ? 'Inscrire la clôture' : 'Clore le sondage'}
            </button>
            <button
              type="button"
              className={ACTION_CLASS}
              disabled={busy}
              onClick={() => {
                setConfirmation(false);
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {peutClore ? (
            <button
              type="button"
              className={ACTION_CLASS}
              disabled={busy}
              onClick={() => {
                setConfirmation(true);
              }}
            >
              {closParLEcheance ? 'Inscrire la clôture' : 'Clore'}
            </button>
          ) : null}

          {poll.status === 'draft' ? (
            <p className="text-xs text-muted">
              Un brouillon ne se clôt pas : il n’est lisible que par la FCPE, et le clore le
              publierait à toute l’organisation.
            </p>
          ) : null}
        </div>
      )}
    </article>
  );
}
