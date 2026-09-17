'use client';

/**
 * Écran d'administration des notifications.
 *
 * ## Ce que cet écran fait, et ce qu'il ne fait pas
 *
 * Il envoie une **annonce écrite à la main** et affiche l'historique des envois
 * de l'organisation. Il ne déclenche aucune notification automatique : celles-ci
 * partent des Cloud Functions, à l'instant où le contenu qui les justifie est
 * publié. La ligne qui apparaîtra dans l'historique après un commentaire ou un
 * sondage n'aura donc pas été écrite ici.
 *
 * ## Le formulaire valide avec le schéma du serveur
 *
 * `notificationSendSchema` vient de `@fl/shared` : c'est **le même objet** que
 * celui qu'applique la fonction appelable. Recopier les bornes ici — trois
 * caractères au titre, quatre cents au texte — les ferait diverger, et le
 * formulaire accepterait alors ce que le serveur refuse. Ce contrôle n'est pas
 * une barrière, c'est un message ; la barrière est dans la fonction.
 *
 * Corollaire : le schéma est strict, donc **l'organisation n'est pas envoyée**.
 * Elle est lue dans le profil de l'appelant, côté serveur. L'ajouter « au cas
 * où » ferait échouer tous les envois, et ce serait mérité — une organisation
 * fournie par le client est une organisation qu'on peut choisir.
 *
 * ## Une seule permission suffit pour les deux usages
 *
 * `notification.send` est accordée exactement aux rôles que les règles
 * Firestore autorisent à lire `notifications`. Ajouter une seconde vérification
 * pour l'historique donnerait l'illusion de deux barrières là où il n'y en a
 * qu'une — et la seconde serait fausse, puisqu'il n'existe pas de permission de
 * lecture séparée.
 *
 * ## Pourquoi l'historique est rechargé après un envoi
 *
 * L'envoi écrit un document que cet écran n'a pas composé : il vient de la
 * fonction, avec ses compteurs. Retoucher l'état local afficherait une ligne
 * approchée ; relire la première page coûte une requête sur une collection
 * paginée et garantit que ce qui est affiché existe vraiment. C'est le choix
 * déjà fait pour les publications et la file des comptes.
 *
 * ## `deliveredCount` à `null` n'est pas zéro
 *
 * À l'envoi, on sait ce que le service a **accepté**. Le nombre de remises
 * n'existe qu'après la relecture des reçus, une quinzaine de minutes plus tard.
 * Afficher « 0 remis » avant cette relecture affirmerait qu'aucun message n'est
 * arrivé — l'inverse de la vérité, qui est « on ne sait pas encore ». D'où
 * `remis()` ci-dessous, qui rend une phrase et jamais un nombre par défaut.
 *
 * ## Le lien profond
 *
 * Facultatif, et **refusé quand il n'ouvre aucun écran** : `parseDeeplink`
 * reconnaît cinq types de cible, dont quatre n'ont pas encore d'écran. La liste
 * des formes acceptées est dérivée de `DEEPLINK_ROUTES` plutôt que recopiée —
 * le jour où un écran apparaît, la phrase se corrige seule.
 *
 * Limite assumée : un identifiant **inexistant** passe la validation. Rien ne
 * peut l'en distinguer d'un identifiant valide sans une lecture, et le tap
 * ouvrirait alors un écran vide. Une liste déroulante des publications récentes
 * serait plus sûre, mais elle ne couvrirait que la première page : un faux
 * confort, sur un champ qui n'est pas obligatoire.
 */
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';

import {
  appendPage,
  createAdminFunctionsClient,
  createNotificationRepository,
  createReferenceRepository,
  userMessage,
  type SendNotificationResult,
} from '@fl/firebase';
import {
  APP_SCHEME,
  AUDIENCE_TYPE_LABELS,
  DEEPLINK_ROUTES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_DESCRIPTIONS,
  NOTIFICATION_CATEGORY_LABELS,
  formatDateTime,
  hasPermission,
  notificationSendSchema,
} from '@fl/shared';
import type {
  Audience,
  NotificationCategory,
  NotificationLog,
  School,
  SchoolClass,
} from '@fl/types';

import { AudiencePicker } from '@/components/audience-picker';
import { initializeFirebase } from '@/lib/firebase';
import { useAdminAuth } from '@/providers/auth-provider';

const FIELD_CLASS =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground';
const LABEL_CLASS = 'text-sm font-medium text-foreground';

/**
 * Formes de lien profond acceptées aujourd'hui.
 *
 * Dérivée de `DEEPLINK_ROUTES` : la phrase affichée ne peut donc ni promettre
 * un écran qui n'existe pas, ni en oublier un qui vient d'arriver.
 */
const FORMES_DE_LIEN: readonly string[] = Object.keys(DEEPLINK_ROUTES).map(
  (type) => `${APP_SCHEME}://${type}/<identifiant>`,
);

/**
 * Phrase d'aide sous le champ de lien.
 *
 * Le cas « aucun type ouvrable » est écrit plutôt que laissé à une phrase
 * tronquée : il se produira si la table est vidée, et « Formes acceptées : »
 * suivi de rien ne dirait pas pourquoi.
 */
const AIDE_LIEN =
  FORMES_DE_LIEN.length === 0
    ? 'Aucun contenu n’est encore ouvrable depuis une notification : laissez ce champ vide.'
    : `Facultatif. Formes acceptées aujourd’hui : ${FORMES_DE_LIEN.join(', ')}.`;

/** Une page de l'historique. */
interface LoadedPage {
  readonly items: readonly NotificationLog[];
  readonly cursor: QueryDocumentSnapshot | null;
  readonly hasMore: boolean;
}

/**
 * Accorde un nom avec son nombre.
 *
 * Zéro prend le singulier en français — « 0 appareil visé ». Le détail compte :
 * ces nombres sont lus pour décider si un envoi a fonctionné.
 */
function accorde(nombre: number, singulier: string, pluriel: string): string {
  return `${nombre} ${nombre > 1 ? pluriel : singulier}`;
}

/**
 * Compte rendu d'un envoi, en une phrase.
 *
 * Il ne dit jamais « notifiés » : ces nombres décrivent le **transport**. Le
 * service dit qu'il a reçu le message, pas que le téléphone l'a affiché.
 */
function compteRendu(result: SendNotificationResult): string {
  if (result.recipientCount === 0) {
    // Le cas le plus fréquent tant qu'aucun appareil n'est enregistré, et le
    // plus déroutant : sans cette phrase, l'écran affiche « 0 appareil visé »
    // et laisse croire à une panne.
    return 'Aucun appareil à prévenir : aucune famille de cette audience n’a de téléphone enregistré. L’envoi figure tout de même dans l’historique, avec zéro destinataire.';
  }

  const morceaux = [
    accorde(result.recipientCount, 'appareil visé', 'appareils visés'),
    accorde(result.acceptedCount, 'message pris en charge', 'messages pris en charge'),
  ];
  if (result.failedCount > 0) morceaux.push(accorde(result.failedCount, 'refusé', 'refusés'));
  if (result.purgedTokens > 0) {
    morceaux.push(
      accorde(result.purgedTokens, 'appareil disparu retiré', 'appareils disparus retirés'),
    );
  }

  // `notificationId` absent ne veut pas dire « rien n'est parti » : les messages
  // sont partis, c'est le compte rendu qui manque. Le dire ainsi, sans quoi un
  // défaut de journal se lirait comme un échec d'envoi.
  const suite = result.notificationId
    ? 'Le compte rendu est dans l’historique ci-dessous.'
    : 'L’envoi a bien eu lieu, mais son compte rendu n’a pas pu être écrit : l’historique ne le montrera pas.';

  return `${morceaux.join(', ')}. ${suite}`;
}

/** Nombre de remises, ou la phrase qui dit qu'on ne le sait pas encore. */
function remis(valeur: number | null): string {
  return valeur === null ? 'pas encore connu' : String(valeur);
}

/**
 * À qui l'envoi a été adressé.
 *
 * Une annonce ciblée n'a pas d'audience : elle vise une personne, désignée par
 * la règle du déclencheur — l'auteur de la publication, ou celui du commentaire
 * auquel on répond. `entry.audience` est alors absent, et c'est le **type** qui
 * dit laquelle des deux règles a parlé.
 *
 * Sans ce repli, l'écran lirait `entry.audience.type` sur `undefined` et
 * lèverait — sur le premier commentaire reçu, au lieu d'afficher une ligne de
 * plus. Le cas est récent : tant que le seul envoi existant était la
 * publication, le champ était toujours là.
 */
function destinataire(entry: NotificationLog): string {
  if (entry.audience) return AUDIENCE_TYPE_LABELS[entry.audience.type];

  if (entry.type === 'new_comment') return 'l’auteur de la publication';
  if (entry.type === 'comment_reply') return 'l’auteur du commentaire';

  // Un envoi ciblé dont le type ne dit pas la règle : le nommer vaut mieux que
  // d'afficher « undefined », et le cas se verra dans l'historique.
  return 'un destinataire nommé';
}

export function NotificationsView(): React.JSX.Element {
  const { profile } = useAdminAuth();
  const orgId = profile?.orgId ?? null;
  const role = profile?.role;

  // `initializeFirebase()` est idempotent : l'appeler ici ne crée pas une
  // seconde application Firebase.
  const [ready] = useState(() => initializeFirebase());
  const history = useMemo(() => (ready ? createNotificationRepository(ready.db) : null), [ready]);
  const reference = useMemo(() => (ready ? createReferenceRepository(ready.db) : null), [ready]);
  const admin = useMemo(
    () => (ready ? createAdminFunctionsClient(ready.functions) : null),
    [ready],
  );

  const canUse = hasPermission(role, 'notification.send');

  const [page, setPage] = useState<LoadedPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Incrémenté pour forcer la relecture de la première page. `page` n'est
  // volontairement pas une dépendance de l'effet.
  const [reloadToken, setReloadToken] = useState(0);

  const [schools, setSchools] = useState<readonly School[]>([]);
  const [classes, setClasses] = useState<readonly SchoolClass[]>([]);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<NotificationCategory>('publications');
  const [audience, setAudience] = useState<Audience>({ type: 'all' });
  const [deeplink, setDeeplink] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  // Données de référence, nécessaires au ciblage uniquement. La lecture est
  // conditionnée à la permission : rien ne sert de charger des écoles pour un
  // écran qui n'affichera que le panneau « réservé ».
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
        // Un échec ici n'empêche pas de lire l'historique : le sélecteur
        // d'audience désactive simplement les types qu'il ne peut pas décrire,
        // plutôt que de proposer un ciblage incomplet.
        if (cancelled) return;
        setSchools([]);
        setClasses([]);
      });

    return () => {
      cancelled = true;
    };
  }, [reference, canUse]);

  useEffect(() => {
    if (!history || !canUse || !orgId) return;

    let cancelled = false;

    void history
      .list(orgId)
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
  }, [history, canUse, orgId, reloadToken]);

  const loading = canUse && orgId !== null && page === null && loadError === null;
  const items = page?.items ?? [];

  function reload(): void {
    setLoadError(null);
    setPage(null);
    setReloadToken((value) => value + 1);
  }

  async function loadMore(): Promise<void> {
    if (!history || !orgId || !page?.cursor) return;

    setLoadingMore(true);
    try {
      const next = await history.list(orgId, page.cursor);
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

  async function submit(): Promise<void> {
    const trimmedDeeplink = deeplink.trim();

    // Le lien vide est omis de la validation : « pas de lien » est un état
    // légitime du formulaire, alors que `z.string().trim().max(1024)` refuse la
    // chaîne vide.
    const parsed = notificationSendSchema.safeParse({
      title: title.trim(),
      body: body.trim(),
      category,
      audience,
      ...(trimmedDeeplink ? { deeplink: trimmedDeeplink } : {}),
    });

    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === 'string' && !errors[field]) errors[field] = issue.message;
      }
      setFieldErrors(errors);
      setSendError(null);
      return;
    }

    if (!admin) return;

    setFieldErrors({});
    setSendError(null);
    setReport(null);
    setSending(true);

    try {
      const result = await admin.sendNotification(parsed.data);
      setReport(compteRendu(result));

      // Le contenu est effacé, le ciblage et la catégorie sont conservés : un
      // second envoi vise le plus souvent la même audience. Laisser le texte
      // en place inviterait à le renvoyer par inadvertance.
      setTitle('');
      setBody('');
      setDeeplink('');

      reload();
    } catch (error) {
      setSendError(userMessage(error));
    } finally {
      setSending(false);
    }
  }

  // Le menu masque déjà la section aux rôles sans `notification.send`, mais une
  // adresse saisie à la main y mène quand même. Mieux vaut une phrase qu'un
  // écran vide, ou qu'une erreur de permission brute.
  if (!canUse) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6">
        <h1 className="text-lg font-semibold text-foreground">Notifications réservées</h1>
        <p className="mt-2 text-secondary">
          Envoyer une annonce à une école entière est réservé aux membres de la FCPE et aux rôles de
          modération. Demandez à un administrateur de vous ouvrir l’accès.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
        <p className="text-secondary">
          Écrivez une annonce, choisissez qui la reçoit, puis retrouvez ci-dessous tout ce qui a été
          envoyé pour l’organisation.
        </p>
      </header>

      <form
        className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 className="text-lg font-semibold text-foreground">Nouvelle annonce</h2>

        <div className="flex flex-col gap-1">
          <label className={LABEL_CLASS} htmlFor="notification-title">
            Titre
          </label>
          <input
            id="notification-title"
            className={FIELD_CLASS}
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
          />
          {fieldErrors.title ? <p className="text-sm text-danger">{fieldErrors.title}</p> : null}
        </div>

        <div className="flex flex-col gap-1">
          <label className={LABEL_CLASS} htmlFor="notification-body">
            Texte
          </label>
          <textarea
            id="notification-body"
            className={`${FIELD_CLASS} min-h-24 resize-y`}
            value={body}
            maxLength={400}
            onChange={(event) => setBody(event.target.value)}
          />
          {/* Le texte d'une notification n'est pas une publication : il s'affiche
              sur un écran verrouillé, tronqué à la deuxième ligne. */}
          <p className="text-xs text-muted">
            Affiché sur l’écran verrouillé, souvent tronqué : une à deux phrases suffisent, le
            détail a sa place dans une publication.
          </p>
          {fieldErrors.body ? <p className="text-sm text-danger">{fieldErrors.body}</p> : null}
        </div>

        <div className="flex flex-col gap-1">
          <label className={LABEL_CLASS} htmlFor="notification-category">
            Catégorie
          </label>
          <select
            id="notification-category"
            className={FIELD_CLASS}
            value={category}
            onChange={(event) => setCategory(event.target.value as NotificationCategory)}
          >
            {NOTIFICATION_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {NOTIFICATION_CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted">{NOTIFICATION_CATEGORY_DESCRIPTIONS[category]}</p>
        </div>

        {category === 'urgent' ? (
          // La catégorie porte l'exception : une alerte urgente traverse le
          // filtre des préférences et part même vers les familles qui ont coupé
          // les notifications. L'écrire ici évite de découvrir l'effet après
          // coup — et chaque envoi est journalisé au nom de son auteur.
          <p className="rounded-md bg-warning-soft p-3 text-sm text-warning" role="note">
            Une alerte urgente part même vers les familles qui ont coupé les notifications. Cet
            envoi est journalisé à votre nom, avec sa catégorie et son audience.
          </p>
        ) : null}

        <AudiencePicker
          value={audience}
          onChange={setAudience}
          schools={schools}
          classes={classes}
        />
        {fieldErrors.audience ? (
          <p className="text-sm text-danger">{fieldErrors.audience}</p>
        ) : null}

        <div className="flex flex-col gap-1">
          <label className={LABEL_CLASS} htmlFor="notification-deeplink">
            Lien ouvert au tap (facultatif)
          </label>
          <input
            id="notification-deeplink"
            className={FIELD_CLASS}
            value={deeplink}
            placeholder={FORMES_DE_LIEN[0] ?? ''}
            onChange={(event) => setDeeplink(event.target.value)}
          />
          <p className="text-xs text-muted">{AIDE_LIEN}</p>
          {fieldErrors.deeplink ? (
            <p className="text-sm text-danger">{fieldErrors.deeplink}</p>
          ) : null}
        </div>

        {sendError ? (
          <p className="rounded-md bg-danger-soft p-3 text-sm text-danger" role="alert">
            {sendError}
          </p>
        ) : null}

        {report ? (
          <p className="rounded-md bg-success-soft p-3 text-sm text-success" role="status">
            {report}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={sending}
          className="self-start rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {sending ? 'Envoi en cours…' : 'Envoyer'}
        </button>
      </form>

      <section className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-foreground">Historique des envois</h2>
          <p className="text-sm text-secondary">
            Ces nombres décrivent le transport, pas les familles : le service de notification dit
            qu’il a reçu le message, jamais qu’un téléphone l’a affiché. « Remis » reste vide tant
            que les reçus n’ont pas été relus, une quinzaine de minutes après l’envoi.
          </p>
        </header>

        <button
          type="button"
          onClick={reload}
          className="self-start rounded-md border border-border px-4 py-2 text-sm text-secondary hover:bg-surface-muted"
        >
          Actualiser
        </button>

        {loading ? (
          <p className="text-muted" role="status">
            Chargement de l’historique…
          </p>
        ) : null}

        {loadError ? (
          <div
            className="flex flex-col items-start gap-3 rounded-md bg-danger-soft p-4"
            role="alert"
          >
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
            <p className="font-semibold text-foreground">Aucun envoi</p>
            <p className="mt-2 text-secondary">
              Rien n’a encore été notifié pour cette organisation. Les annonces envoyées ici, comme
              celles déclenchées par une publication, apparaîtront dans cette liste.
            </p>
          </div>
        ) : null}

        {items.length > 0 ? (
          <ol className="flex flex-col gap-3">
            {items.map((entry) => (
              <li key={entry.id}>
                <NotificationRow entry={entry} />
              </li>
            ))}
          </ol>
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
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entrée d'historique
// ---------------------------------------------------------------------------

function NotificationRow({ entry }: { entry: NotificationLog }): React.JSX.Element {
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-foreground">{entry.title}</p>
        <p className="text-xs text-muted">{formatDateTime(entry.sentAt)}</p>
      </div>

      <p className="text-sm text-secondary">{entry.body}</p>

      <p className="text-xs text-muted">
        {NOTIFICATION_CATEGORY_LABELS[entry.category]} · {destinataire(entry)} · par{' '}
        {entry.sentByName}
      </p>

      <dl className="flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-surface-muted p-3 text-xs">
        <Compteur label="Appareils visés" valeur={String(entry.recipientCount)} />
        <Compteur label="Pris en charge" valeur={String(entry.acceptedCount)} />
        {/* La seule valeur qui a le droit de ne pas être un nombre. */}
        <Compteur label="Remis" valeur={remis(entry.deliveredCount)} />
        <Compteur label="Refusés" valeur={String(entry.failedCount)} />
        <Compteur label="En attente" valeur={String(entry.pendingCount)} />
      </dl>
    </article>
  );
}

function Compteur({ label, valeur }: { label: string; valeur: string }): React.JSX.Element {
  return (
    <div className="flex gap-1">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-foreground">{valeur}</dd>
    </div>
  );
}
