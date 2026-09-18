'use client';

/**
 * Écran d'administration des sondages.
 *
 * ## Ce que cet écran fait
 *
 * Il **crée** un sondage : la question, ses réponses, le ciblage, et le moment
 * où les résultats deviennent visibles. Il porte aussi le **suivi** — la liste
 * des sondages de l'organisation, avec le décompte et la clôture — dans
 * `poll-list.tsx`, montée sous le formulaire.
 *
 * Les deux moitiés vivent dans des fichiers séparés, et pas seulement par
 * longueur : elles ne lisent pas la même chose. Le formulaire n'écrit qu'à la
 * soumission et ne dépend d'aucune lecture ; la liste lit une page de
 * documents, un décompte par ligne, et écrit une clôture. Un écran qui ferait
 * les deux verrait chacun de ses états se mêler à ceux de l'autre — un
 * rechargement de liste ferait clignoter le formulaire.
 *
 * ## `notify` n'est pas une case à cocher parmi d'autres, c'est un statut
 *
 * `pollInputSchema` porte un booléen `notify` que le document ne conserve pas :
 * il choisit le **statut initial**. L'écran le présente donc pour ce qu'il est —
 * publier maintenant, ou enregistrer en brouillon — plutôt que de l'enterrer
 * dans une liste de réglages. Un brouillon n'est lisible que par la FCPE, et
 * c'est précisément ce qu'il faut pour préparer une question sans la laisser
 * filtrer.
 *
 * ## Les identifiants des réponses sont fabriqués ici, et c'est assumé
 *
 * `pollOptionSchema` exige un `id` et un `order` par réponse. L'écran les dérive
 * de la position (`option-1`, `option-2`…), ce qui évite de tenir un état dont
 * personne ne se sert : un sondage n'est créé qu'une fois, à la soumission, et
 * rien ne référence ces identifiants avant. Retirer une réponse au milieu
 * renumérote donc les suivantes — sans conséquence, puisque la renumérotation
 * a lieu **avant** l'écriture, jamais après.
 *
 * ## Le formulaire valide avec le schéma du serveur
 *
 * `pollInputSchema` vient de `@fl/shared` : c'est **le même objet** que celui
 * qu'applique `createPoll`. Recopier les bornes ici les ferait diverger, et le
 * formulaire accepterait alors ce que le dépôt refuse. Ce contrôle n'est pas une
 * barrière, c'est un message ; la barrière est dans les règles Firestore.
 *
 * ## L'anonymat est une promesse d'interface, et l'écran le dit
 *
 * `anonymous` interdit au document de vote de porter un `uid`, et les règles le
 * vérifient. Cela protège contre l'application, pas contre la base : le vote
 * reste un document par personne, puisque c'est l'unicité qui empêche le vote
 * multiple. L'écran l'écrit plutôt que de laisser croire à un anonymat qu'aucun
 * système ne peut tenir **tout en** garantissant l'unicité.
 */

import { useEffect, useMemo, useState } from 'react';

import { createPollRepository, createReferenceRepository, userMessage } from '@fl/firebase';
import {
  POLL_RESULTS_VISIBILITIES,
  POLL_RESULTS_VISIBILITY_LABELS,
  TEXT_LIMITS,
  hasPermission,
  pollInputSchema,
} from '@fl/shared';
import type { Audience, PollResultsVisibility, School, SchoolClass } from '@fl/types';

import { AudiencePicker } from '@/components/audience-picker';
import { PollList } from '@/features/polls/poll-list';
import { initializeFirebase } from '@/lib/firebase';
import { useAdminAuth } from '@/providers/auth-provider';

const FIELD_CLASS =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground';
const LABEL_CLASS = 'text-sm font-medium text-foreground';
const HELP_CLASS = 'text-xs text-secondary';

/** Réponses proposées au premier affichage : deux, le minimum du schéma. */
const REPONSES_INITIALES: readonly string[] = ['', ''];

export function PollsView(): React.JSX.Element {
  const { profile } = useAdminAuth();
  const orgId = profile?.orgId ?? null;
  const role = profile?.role;

  // `initializeFirebase()` est idempotent : l'appeler ici ne crée pas une
  // seconde application Firebase.
  const [ready] = useState(() => initializeFirebase());
  const polls = useMemo(() => (ready ? createPollRepository(ready.db) : null), [ready]);
  const reference = useMemo(() => (ready ? createReferenceRepository(ready.db) : null), [ready]);

  const canUse = hasPermission(role, 'poll.create');

  const [schools, setSchools] = useState<readonly School[]>([]);
  const [classes, setClasses] = useState<readonly SchoolClass[]>([]);

  const [question, setQuestion] = useState('');
  const [description, setDescription] = useState('');
  const [labels, setLabels] = useState<readonly string[]>(REPONSES_INITIALES);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [allowChangeVote, setAllowChangeVote] = useState(true);
  const [audience, setAudience] = useState<Audience>({ type: 'all' });
  const [resultsVisibility, setResultsVisibility] = useState<PollResultsVisibility>('after_vote');
  const [endsAt, setEndsAt] = useState('');
  const [publish, setPublish] = useState(true);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Incrémenté après une création : la liste se relit au lieu de fabriquer une
  // ligne, et le sondage créé apparaît en tête puisqu'elle est triée du plus
  // récent au plus ancien.
  const [refreshToken, setRefreshToken] = useState(0);

  // Données de référence, nécessaires au ciblage uniquement. La lecture est
  // refusée à qui n'a pas la permission : dans ce cas on laisse les listes
  // vides, ce qui désactive les ciblages qui en dépendent, plutôt que de
  // proposer une audience incomplète.
  useEffect(() => {
    if (!reference || !canUse) return;

    let cancelled = false;

    void Promise.all([reference.listSchools(), reference.listClasses()])
      .then(([loadedSchools, loadedClasses]) => {
        if (cancelled) return;
        setSchools(loadedSchools);
        setClasses(loadedClasses);
      })
      .catch(() => {
        if (cancelled) return;
        setSchools([]);
        setClasses([]);
      });

    return () => {
      cancelled = true;
    };
  }, [reference, canUse]);

  function changeLabel(index: number, value: string): void {
    setLabels((previous) => previous.map((one, at) => (at === index ? value : one)));
  }

  function addLabel(): void {
    setLabels((previous) =>
      previous.length >= TEXT_LIMITS.pollMaxOptions ? previous : [...previous, ''],
    );
  }

  function removeLabel(index: number): void {
    // Deux réponses sont le minimum du schéma : en retirer une troisième est
    // permis, descendre en dessous de deux ne l'est pas. Le bouton est désactivé
    // dans ce cas, et cette garde couvre l'appel qui viendrait d'ailleurs.
    setLabels((previous) =>
      previous.length <= 2 ? previous : previous.filter((_, at) => at !== index),
    );
  }

  async function submit(): Promise<void> {
    const trimmedDescription = description.trim();

    const parsed = pollInputSchema.safeParse({
      question: question.trim(),
      // Un champ vide est omis : « pas de description » est un état légitime du
      // formulaire, alors que le schéma refuse la chaîne vide.
      ...(trimmedDescription ? { description: trimmedDescription } : {}),
      options: labels.map((label, index) => ({
        id: `option-${index + 1}`,
        label: label.trim(),
        order: index,
      })),
      allowMultiple,
      anonymous,
      allowChangeVote,
      audience,
      resultsVisibility,
      ...(endsAt ? { endsAt } : {}),
      notify: publish,
    });

    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        // Les erreurs de réponse portent un chemin `options.2.label` : on les
        // rattache au champ `options`, faute de quoi elles n'auraient pas de
        // place où s'afficher et disparaîtraient silencieusement.
        const field = issue.path[0];
        const key = typeof field === 'string' ? String(field) : 'form';
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      setSubmitError(null);
      return;
    }

    if (!polls || !orgId || !profile) return;

    setFieldErrors({});
    setSubmitError(null);
    setReport(null);
    setSaving(true);

    try {
      const pollId = await polls.create({
        orgId,
        authorId: profile.id,
        input: parsed.data,
      });

      // Le contenu est effacé, le ciblage et les réglages sont conservés : un
      // second sondage vise le plus souvent la même audience, avec les mêmes
      // règles. Laisser la question en place inviterait à la republier.
      setQuestion('');
      setDescription('');
      setLabels(REPONSES_INITIALES);
      setEndsAt('');

      setReport(
        publish
          ? `Sondage publié. Les parents de l’audience choisie peuvent voter (référence ${pollId}). Il figure en tête du suivi ci-dessous.`
          : `Brouillon enregistré (référence ${pollId}). Il n’est lisible que par la FCPE tant qu’il n’est pas publié. Il figure en tête du suivi ci-dessous.`,
      );

      setRefreshToken((value) => value + 1);
    } catch (error) {
      setSubmitError(userMessage(error));
    } finally {
      setSaving(false);
    }
  }

  // Le menu masque déjà la section aux rôles sans `poll.create`, mais une
  // adresse saisie à la main y mène quand même. Mieux vaut une phrase qu'un
  // écran vide, ou qu'une erreur de permission brute.
  if (!canUse) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6">
        <h1 className="text-lg font-semibold text-foreground">Sondages réservés</h1>
        <p className="mt-2 text-secondary">
          Créer un sondage est réservé aux membres de la FCPE et aux rôles de modération. Demandez à
          un administrateur de vous ouvrir l’accès.
        </p>
      </div>
    );
  }

  const peutAjouter = labels.length < TEXT_LIMITS.pollMaxOptions;
  const peutRetirer = labels.length > 2;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">Sondages</h1>
        <p className="text-secondary">
          Posez une question aux familles, choisissez qui la reçoit, et décidez quand les résultats
          deviennent visibles. Le suivi, plus bas, montre ce que chaque sondage a recueilli et
          permet d’en inscrire la clôture.
        </p>
      </header>

      <form
        className="flex max-w-2xl flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col gap-1">
          <label className={LABEL_CLASS} htmlFor="poll-question">
            Question
          </label>
          <input
            id="poll-question"
            className={FIELD_CLASS}
            value={question}
            maxLength={TEXT_LIMITS.pollQuestion}
            onChange={(event) => {
              setQuestion(event.target.value);
            }}
          />
          {fieldErrors.question ? (
            <p className="text-xs text-danger">{fieldErrors.question}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label className={LABEL_CLASS} htmlFor="poll-description">
            Précisions <span className={HELP_CLASS}>(facultatif)</span>
          </label>
          <textarea
            id="poll-description"
            className={FIELD_CLASS}
            rows={3}
            value={description}
            maxLength={TEXT_LIMITS.pollDescription}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
          {fieldErrors.description ? (
            <p className="text-xs text-danger">{fieldErrors.description}</p>
          ) : null}
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className={LABEL_CLASS}>Réponses possibles</legend>
          {labels.map((label, index) => (
            // L'index est la clé, et c'est acceptable ici : les lignes ne sont
            // jamais réordonnées, seulement ajoutées ou retirées en fin de
            // liste — sauf le retrait au milieu, qui décale les suivantes. La
            // valeur affichée reste alors celle de la ligne, et le champ n'a
            // pas d'état interne à perdre.
            <div key={index} className="flex items-center gap-2">
              <input
                className={FIELD_CLASS}
                value={label}
                maxLength={TEXT_LIMITS.pollOptionLabel}
                aria-label={`Réponse ${index + 1}`}
                onChange={(event) => {
                  changeLabel(index, event.target.value);
                }}
              />
              <button
                type="button"
                className="rounded-md border border-border px-3 py-2 text-sm text-secondary disabled:opacity-40"
                disabled={!peutRetirer}
                onClick={() => {
                  removeLabel(index);
                }}
              >
                Retirer
              </button>
            </div>
          ))}
          {fieldErrors.options ? (
            <p className="text-xs text-danger">{fieldErrors.options}</p>
          ) : null}
          <div>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-sm text-foreground disabled:opacity-40"
              disabled={!peutAjouter}
              onClick={addLabel}
            >
              Ajouter une réponse
            </button>
            <p className={`mt-1 ${HELP_CLASS}`}>
              Entre deux et {TEXT_LIMITS.pollMaxOptions} réponses.
            </p>
          </div>
        </fieldset>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={allowMultiple}
              onChange={(event) => {
                setAllowMultiple(event.target.checked);
              }}
            />
            Autoriser plusieurs réponses
          </label>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={allowChangeVote}
              onChange={(event) => {
                setAllowChangeVote(event.target.checked);
              }}
            />
            Autoriser à modifier son vote
          </label>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(event) => {
                setAnonymous(event.target.checked);
              }}
            />
            Sondage anonyme
          </label>
          <p className={HELP_CLASS}>
            Un vote reste un document par personne : c’est ce qui empêche de voter deux fois.
            L’anonymat porte sur ce que l’application affiche et sur les champs du vote, jamais sur
            l’unicité.
          </p>
        </div>

        <AudiencePicker
          value={audience}
          onChange={setAudience}
          schools={schools}
          classes={classes}
        />

        <div className="flex flex-col gap-1">
          <label className={LABEL_CLASS} htmlFor="poll-results">
            Visibilité des résultats
          </label>
          <select
            id="poll-results"
            className={FIELD_CLASS}
            value={resultsVisibility}
            onChange={(event) => {
              setResultsVisibility(event.target.value as PollResultsVisibility);
            }}
          >
            {POLL_RESULTS_VISIBILITIES.map((value) => (
              <option key={value} value={value}>
                {POLL_RESULTS_VISIBILITY_LABELS[value]}
              </option>
            ))}
          </select>
          <p className={HELP_CLASS}>
            La clôture du sondage publie les résultats à tout le monde, quel que soit ce réglage :
            c’est ce que « à la clôture » veut dire.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className={LABEL_CLASS} htmlFor="poll-ends-at">
            Date de clôture <span className={HELP_CLASS}>(facultative)</span>
          </label>
          <input
            id="poll-ends-at"
            type="datetime-local"
            className={FIELD_CLASS}
            value={endsAt}
            onChange={(event) => {
              setEndsAt(event.target.value);
            }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className={LABEL_CLASS} htmlFor="poll-publish">
            Publication
          </label>
          <select
            id="poll-publish"
            className={FIELD_CLASS}
            value={publish ? 'now' : 'draft'}
            onChange={(event) => {
              setPublish(event.target.value === 'now');
            }}
          >
            <option value="now">Publier maintenant — les familles reçoivent le sondage</option>
            <option value="draft">
              Enregistrer en brouillon — lisible par la FCPE seule, ouvert plus tard
            </option>
          </select>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            disabled={saving}
          >
            {saving
              ? 'Enregistrement…'
              : publish
                ? 'Publier le sondage'
                : 'Enregistrer le brouillon'}
          </button>
        </div>

        {submitError ? <p className="text-sm text-danger">{submitError}</p> : null}
        {report ? <p className="text-sm text-secondary">{report}</p> : null}
      </form>

      {polls && orgId ? (
        <section className="flex flex-col gap-4 border-t border-border pt-8">
          <PollList repository={polls} orgId={orgId} role={role} refreshToken={refreshToken} />
        </section>
      ) : null}
    </div>
  );
}
