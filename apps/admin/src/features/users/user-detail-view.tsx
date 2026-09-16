'use client';

/**
 * Fiche d'un compte.
 *
 * ## Pourquoi elle existe
 *
 * La file de validation se parcourt par statut, ce qui suffit à traiter une
 * demande mais pas à en vérifier une. Devant une inscription douteuse — un
 * rattachement qui ne correspond à aucun enfant scolarisé, une adresse
 * inattendue — l'administrateur a besoin de tout voir au même endroit.
 *
 * ## Pourquoi elle est en lecture seule
 *
 * Les actions sur un compte — approuver, refuser, suspendre — modifient les
 * Custom Claims et passent donc par une Cloud Function. Elles restent dans la
 * file, qui les présente avec leur motif obligatoire. Les dupliquer ici
 * donnerait deux implémentations d'une décision d'autorisation, ce que la
 * conception du projet cherche précisément à éviter.
 *
 * ## Ce qu'elle n'affiche pas
 *
 * Le rattachement nominatif des enfants. La règle qui le protège
 * (`users/{uid}/children`) n'est pas cloisonnée par organisation : la lire
 * depuis cet écran reviendrait à s'appuyer sur une frontière absente. Les
 * niveaux et classes déclarés, eux, sont recopiés sur le profil et suffisent à
 * vérifier une inscription. Voir `docs/04-security.md` § 10.
 */
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import {
  appendPage,
  createAdminLogRepository,
  createReferenceRepository,
  createUserRepository,
  userMessage,
} from '@fl/firebase';
import {
  CLASS_LEVEL_LABELS,
  USER_ROLE_LABELS,
  adminActionLabel,
  formatDateTime,
  hasPermission,
} from '@fl/shared';
import type { AdminLog, School, SchoolClass, UserProfile } from '@fl/types';

import { UserStatusBadge } from '@/components/user-status-badge';
import { initializeFirebase } from '@/lib/firebase';
import { useAdminAuth } from '@/providers/auth-provider';

/** Type de ressource écrit dans le journal par les fonctions d'administration. */
const TARGET_TYPE = 'user';

/** Une fiche chargée, rattachée au compte qu'elle décrit. */
interface Detail {
  readonly uid: string;
  readonly profile: UserProfile | null;
  readonly logs: readonly AdminLog[];
  readonly logCursor: QueryDocumentSnapshot | null;
  readonly hasMoreLogs: boolean;
}

/** Données de référence, chargées une fois : elles servent à nommer les rattachements. */
interface Reference {
  readonly schools: readonly School[];
  readonly classes: readonly SchoolClass[];
}

export function UserDetailView({ uid }: { uid: string }): React.JSX.Element {
  const { profile: ownProfile } = useAdminAuth();
  const role = ownProfile?.role;

  // Le rôle est vérifié avant de lancer les lectures, et pas seulement avant
  // l'affichage : sans cela, un rôle sans `user.read.any` déclencherait trois
  // requêtes que les règles refusent, pour un écran qui n'affichera que le
  // panneau ci-dessous.
  const canRead = hasPermission(role, 'user.read.any');

  // `initializeFirebase()` est idempotent : l'appeler ici ne crée pas une
  // seconde application Firebase.
  const [ready] = useState(() => initializeFirebase());
  const repositories = useMemo(() => {
    if (!ready) return null;
    return {
      users: createUserRepository(ready.db),
      logs: createAdminLogRepository(ready.db),
      reference: createReferenceRepository(ready.db),
    };
  }, [ready]);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [reference, setReference] = useState<Reference>({ schools: [], classes: [] });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!repositories || !canRead) return;

    let cancelled = false;

    void (async () => {
      try {
        // Les trois lectures partent ensemble : la fiche n'a d'intérêt
        // qu'entière, et les données de référence sont partagées par tous les
        // comptes.
        const [profile, schools, classes, logs] = await Promise.all([
          repositories.users.get(uid),
          repositories.reference.listSchools(),
          repositories.reference.listClasses(),
          repositories.logs.list({ kind: 'target', targetType: TARGET_TYPE, targetId: uid }),
        ]);

        if (cancelled) return;

        setReference({ schools, classes });
        setDetail({
          uid,
          profile,
          logs: logs.items,
          logCursor: logs.nextCursor,
          hasMoreLogs: logs.hasMore,
        });
        setLoadError(null);
      } catch (error) {
        if (cancelled) return;
        setLoadError(userMessage(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [repositories, canRead, uid, reloadToken]);

  /**
   * La fiche affichée est celle du compte courant.
   *
   * Une fiche chargée pour un autre identifiant est ignorée : c'est ce qui
   * permet de dériver « en cours de chargement » sans le stocker, donc sans le
   * pousser depuis un effet.
   */
  const current = detail?.uid === uid ? detail : null;
  const profile = current?.profile ?? null;
  const loading = Boolean(repositories) && canRead && current === null && loadError === null;

  function reload(): void {
    setLoadError(null);
    setDetail(null);
    setReloadToken((value) => value + 1);
  }

  async function loadMoreLogs(): Promise<void> {
    if (!repositories || !current?.logCursor) return;

    setLoadingMore(true);
    try {
      const next = await repositories.logs.list(
        { kind: 'target', targetType: TARGET_TYPE, targetId: uid },
        current.logCursor,
      );
      setDetail((previous) =>
        previous && previous.uid === uid
          ? {
              ...previous,
              logs: appendPage(previous.logs, next),
              logCursor: next.nextCursor,
              hasMoreLogs: next.hasMore,
            }
          : previous,
      );
    } catch (error) {
      setLoadError(userMessage(error));
    } finally {
      setLoadingMore(false);
    }
  }

  // Le menu masque déjà la section aux rôles sans `user.read.any`, mais une
  // adresse saisie à la main y mène quand même.
  if (!canRead) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6">
        <h1 className="text-lg font-semibold text-foreground">Fiche réservée</h1>
        <p className="mt-2 text-secondary">
          Le détail d’un compte est réservé aux membres de la FCPE.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href="/utilisateurs" className="text-sm text-secondary hover:text-foreground">
        ← Retour aux utilisateurs
      </Link>

      {loading ? (
        <p className="text-muted" role="status">
          Chargement de la fiche…
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

      {!loading && !loadError && current && profile === null ? (
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="font-semibold text-foreground">Compte introuvable</p>
          <p className="mt-2 text-secondary">
            Ce compte n’existe pas, ou il appartient à une autre organisation.
          </p>
        </div>
      ) : null}

      {profile ? (
        <>
          <header className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-foreground">
                {profile.firstName} {profile.lastName}
              </h1>
              <UserStatusBadge status={profile.status} />
              <span className="rounded bg-surface-muted px-2 py-0.5 text-xs font-medium text-secondary">
                {USER_ROLE_LABELS[profile.role]}
              </span>
            </div>
            <p className="break-all text-secondary">{profile.email}</p>
          </header>

          {profile.statusReason ? (
            <p className="rounded-md bg-danger-soft p-3 text-sm text-danger">
              Motif enregistré : {profile.statusReason}
            </p>
          ) : null}

          <Section title="Coordonnées">
            <Field label="Téléphone" value={profile.phone ?? '—'} />
            <Field label="Organisation" value={profile.orgId} />
            <Field label="Inscription déposée le" value={formatDateTime(profile.createdAt)} />
            <Field label="Dernière activité" value={formatDateTime(profile.lastSeenAt)} />
            <Field label="Approuvée le" value={formatDateTime(profile.approvedAt)} />
          </Section>

          <Section title="Rattachement déclaré">
            <Field
              label="Établissements"
              value={noms(profile.schoolIds, reference.schools) || '—'}
            />
            <Field
              label="Niveaux"
              value={profile.levels.map((level) => CLASS_LEVEL_LABELS[level]).join(', ') || '—'}
            />
            <Field label="Classes" value={noms(profile.classIds, reference.classes) || '—'} />
          </Section>

          <Section title="Consentements">
            <Field
              label="Politique de confidentialité"
              value={profile.consents.privacyPolicy ? 'Acceptée' : 'Non acceptée'}
            />
            <Field
              label="Règlement des discussions"
              value={profile.consents.communityRules ? 'Accepté' : 'Non accepté'}
            />
            <Field
              label="Contact par la FCPE"
              value={profile.consents.fcpeContact ? 'Autorisé' : 'Refusé'}
            />
          </Section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-foreground">Historique du compte</h2>

            {current && current.logs.length === 0 ? (
              <p className="rounded-lg border border-border bg-surface p-4 text-secondary">
                Aucune action enregistrée sur ce compte. Le journal ne retient que les décisions
                d’administration : validation, refus, suspension, changement de rôle.
              </p>
            ) : null}

            {current && current.logs.length > 0 ? (
              <ol className="flex flex-col gap-2">
                {current.logs.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium text-foreground">
                        {adminActionLabel(entry.action)}
                      </p>
                      <p className="text-xs text-muted">{formatDateTime(entry.at)}</p>
                    </div>
                    <p className="text-sm text-secondary">
                      Par <span className="text-foreground">{entry.actorName}</span> (
                      {USER_ROLE_LABELS[entry.actorRole]})
                    </p>
                    {entry.metadata.reason ? (
                      <p className="text-sm text-secondary">
                        Motif : {String(entry.metadata.reason)}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : null}

            {current?.hasMoreLogs ? (
              <button
                type="button"
                onClick={() => void loadMoreLogs()}
                disabled={loadingMore}
                className="self-start rounded-md border border-border bg-surface px-4 py-2 text-sm text-secondary hover:bg-surface-muted disabled:opacity-50"
              >
                {loadingMore ? 'Chargement…' : 'Charger la suite'}
              </button>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Présentation
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <dl className="flex flex-col gap-1">{children}</dl>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-x-2 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

/** Traduit des identifiants de référence en noms, en gardant l'identifiant en repli. */
function noms(ids: readonly string[], source: readonly { id: string; name: string }[]): string {
  return ids.map((id) => source.find((item) => item.id === id)?.name ?? id).join(', ');
}
