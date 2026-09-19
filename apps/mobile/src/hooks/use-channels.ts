/**
 * Canaux de discussion : la liste, puis le fil d'un canal.
 *
 * ## La liste se lit en une passe, le fil s'abonne
 *
 * Le critère de sortie de la phase 6 est « un seul listener temps réel dans
 * toute l'application, celui du canal ouvert ». La liste n'en a donc pas : elle
 * compte treize entrées fixes, qui ne peuvent pas se réordonner sous une
 * pagination, et un abonnement y coûterait une lecture par visiteur pour un
 * résultat identique. Elle se relit au geste de rafraîchissement.
 *
 * ## Le fil élargit sa fenêtre au lieu d'avancer un curseur
 *
 * Firestore ne sait pas rendre « les trente derniers, puis les trente
 * précédents » avec un seul abonnement. « Charger plus » augmente donc la
 * taille de la fenêtre, et l'abonnement est refait. Le prix est réel et assumé :
 * élargir de 30 à 60 relit 60 messages au lieu de 30. Un curseur demanderait de
 * renoncer à l'abonnement, c'est-à-dire au seul listener que la phase autorise.
 *
 * ## Le chargement est dérivé, jamais poussé
 *
 * Aucun `setLoading(true)` : ce serait un `setState` synchrone dans un effet,
 * interdit par `react-hooks/set-state-in-effect`. L'état mémorisé porte
 * l'identifiant du canal auquel il répond, donc changer de canal suffit à
 * remettre l'écran en chargement sans rien nettoyer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  MESSAGE_WINDOW_SIZE,
  createChannelRepository,
  isAppError,
  toAppError,
  type ChannelRepository,
} from '@fl/firebase';
import { displayName, isFcpeRole } from '@fl/shared';
import type { AppError, Channel, ChannelMessage } from '@fl/types';

import { initializeFirebase } from '@/lib/firebase';
import { useAuth } from '@/providers/auth-provider';

import type { AsyncData } from './use-reference-data';

/** Résultat mémorisé, avec l'empreinte de la demande à laquelle il répond. */
interface LoadedChannels {
  readonly key: string;
  readonly data: AsyncData<readonly Channel[]>;
}

export interface ChannelsResult {
  readonly status: AsyncData<readonly Channel[]>['status'];
  readonly channels: readonly Channel[];
  /** Erreur du premier chargement : remplace tout l'écran. */
  readonly error: AppError | null;
  /** Erreur d'un rafraîchissement : signalée sans effacer la liste. */
  readonly refreshError: AppError | null;
  readonly refreshing: boolean;
  retry: () => void;
  refresh: () => void;
}

export function useChannels(): ChannelsResult {
  const { profile } = useAuth();
  const [firebase] = useState(() => initializeFirebase());

  const repository = useMemo<ChannelRepository | null>(
    () => (firebase ? createChannelRepository(firebase.db) : null),
    [firebase],
  );

  const orgId = profile?.orgId ?? null;

  /**
   * Le rôle décide de la **forme de la requête**, pas seulement de ce qui
   * s'affiche : la règle de lecture des canaux est une disjonction, et un
   * parent doit écarter lui-même le type `fcpe` pour que Firestore puisse la
   * satisfaire. Voir `channelsQuery` dans `@fl/firebase`.
   *
   * La liste des rôles vient de `@fl/shared`, jamais recopiée : un rôle ajouté
   * au modèle et oublié ici verrait sa requête refusée en bloc.
   */
  const isFcpe = profile ? isFcpeRole(profile.role) : false;

  const [loaded, setLoaded] = useState<LoadedChannels | null>(null);
  const [refreshError, setRefreshError] = useState<AppError | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const generation = useRef(0);

  const enabled = repository !== null && orgId !== null;
  const key = `${orgId ?? ''}|${isFcpe ? 'fcpe' : 'parent'}`;

  const fetchChannels = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial'): Promise<void> => {
      if (!repository || !orgId) return;

      const mine = (generation.current += 1);
      setRefreshError(null);

      try {
        const channels = await repository.listChannels({ orgId, isFcpe });
        if (mine !== generation.current) return;
        setLoaded({ key, data: { status: 'ready', data: channels } });
      } catch (error) {
        if (mine !== generation.current) return;
        const failure = isAppError(error) ? error : toAppError(error);

        // Un rafraîchissement raté n'efface pas la liste : le parent perdrait
        // ce qu'il lisait à cause d'une coupure d'une seconde. Le premier
        // chargement, lui, n'a rien à conserver — l'écran d'erreur est la
        // seule réponse possible quand il n'y a rien à montrer.
        if (mode === 'refresh') {
          setRefreshError(failure);
          return;
        }

        setLoaded({ key, data: { status: 'error', error: failure } });
      }
    },
    [repository, orgId, isFcpe, key],
  );

  useEffect(() => {
    if (!enabled) return;
    void fetchChannels();
  }, [enabled, fetchChannels]);

  const retry = useCallback(() => {
    void fetchChannels('initial');
  }, [fetchChannels]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void fetchChannels('refresh').finally(() => setRefreshing(false));
  }, [fetchChannels]);

  const current = loaded && loaded.key === key ? loaded.data : null;
  const status: AsyncData<readonly Channel[]>['status'] = !enabled
    ? 'idle'
    : current === null
      ? 'loading'
      : current.status;

  return {
    status,
    channels: current?.status === 'ready' ? current.data : [],
    error: current?.status === 'error' ? current.error : null,
    refreshError,
    refreshing,
    retry,
    refresh,
  };
}

// ---------------------------------------------------------------------------
// Fil d'un canal
// ---------------------------------------------------------------------------

/**
 * Un canal, par son identifiant.
 *
 * Lu **seul**, et non filtré depuis la liste : ouvrir un fil ne doit pas coûter
 * treize lectures. L'écran en a besoin pour deux choses — le titre de l'en-tête
 * et le drapeau `readOnly`, qui décide si le champ d'écriture s'affiche.
 *
 * Un canal introuvable n'est pas une erreur : `null` signifie « il n'y est
 * plus », et l'écran le dit. Lever ferait passer une suppression pour une panne.
 */
export function useChannel(channelId: string): {
  readonly channel: Channel | null;
  readonly resolved: boolean;
  readonly error: AppError | null;
  retry: () => void;
} {
  const [firebase] = useState(() => initializeFirebase());

  const repository = useMemo<ChannelRepository | null>(
    () => (firebase ? createChannelRepository(firebase.db) : null),
    [firebase],
  );

  const [result, setResult] = useState<{
    readonly channelId: string;
    readonly channel: Channel | null;
    readonly error: AppError | null;
  } | null>(null);

  // Même compteur que le fil : changer sa valeur relit le document, et le
  // nettoyage de l'effet précédent passe avant.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!repository || channelId === '') return;

    let cancelled = false;

    void repository
      .getChannel(channelId)
      .then((channel) => {
        if (!cancelled) setResult({ channelId, channel, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setResult({
            channelId,
            channel: null,
            error: isAppError(error) ? error : toAppError(error),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repository, channelId, attempt]);

  const retry = useCallback(() => {
    setAttempt((count) => count + 1);
  }, []);

  const current = result?.channelId === channelId ? result : null;

  return {
    channel: current?.channel ?? null,
    resolved: current !== null,
    error: current?.error ?? null,
    retry,
  };
}

interface Snapshot {
  readonly channelId: string;
  readonly messages: readonly ChannelMessage[];
}

interface Failure {
  readonly channelId: string;
  readonly error: AppError;
}

export interface ChannelThreadResult {
  readonly status: AsyncData<readonly ChannelMessage[]>['status'];
  readonly messages: readonly ChannelMessage[];
  readonly error: AppError | null;
  /**
   * D'autres messages peuvent être chargés au-dessus.
   *
   * Déduit du remplissage de la fenêtre : une fenêtre pleine peut en cacher
   * d'autres, une fenêtre incomplète est le début du canal. Rien ne permet de
   * savoir s'il reste exactement un message ou trente, et c'est sans
   * conséquence — le bouton disparaît de lui-même au chargement suivant.
   */
  readonly hasOlder: boolean;
  readonly loadingOlder: boolean;
  readonly sending: boolean;
  readonly sendError: AppError | null;
  loadOlder: () => void;
  /** Réessaie après un abonnement refusé ou interrompu. */
  retry: () => void;
  /** Écrit un message. Rend `true` si l'écriture est partie. */
  send: (body: string, replyTo?: { id: string; preview: string }) => Promise<boolean>;
}

export function useChannelThread(channelId: string): ChannelThreadResult {
  const { profile } = useAuth();
  const [firebase] = useState(() => initializeFirebase());

  const repository = useMemo<ChannelRepository | null>(
    () => (firebase ? createChannelRepository(firebase.db) : null),
    [firebase],
  );

  const [windowSize, setWindowSize] = useState(MESSAGE_WINDOW_SIZE);
  // Incrémenté pour réessayer : l'abonnement est refait quand sa valeur change,
  // et le nettoyage de l'effet précédent passe avant — jamais deux écouteurs.
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<AppError | null>(null);

  const enabled = repository !== null && channelId !== '';

  useEffect(() => {
    if (!repository || channelId === '') return;

    const unsubscribe = repository.subscribeToMessages({
      channelId,
      windowSize,
      onChange: (messages) => {
        setSnapshot({ channelId, messages });
        setLoadingOlder(false);
      },
      // Un abonnement refusé est silencieux par nature : sans ce gestionnaire,
      // l'écran resterait vide sans que rien ne dise pourquoi.
      onError: (error) => {
        setFailure({ channelId, error: isAppError(error) ? error : toAppError(error) });
        setLoadingOlder(false);
      },
    });

    // Le nettoyage passe **avant** l'effet suivant : élargir la fenêtre ne fait
    // donc jamais vivre deux abonnements en même temps.
    return unsubscribe;
  }, [repository, channelId, windowSize, attempt]);

  const loadOlder = useCallback(() => {
    setLoadingOlder(true);
    setWindowSize((size) => size + MESSAGE_WINDOW_SIZE);
  }, []);

  const retry = useCallback(() => {
    setAttempt((count) => count + 1);
  }, []);

  const send = useCallback(
    async (body: string, replyTo?: { id: string; preview: string }): Promise<boolean> => {
      if (!repository || !profile) return false;

      setSending(true);
      setSendError(null);

      try {
        await repository.sendMessage({
          channelId,
          author: {
            id: profile.id,
            name: displayName(profile.firstName, profile.lastName),
            role: profile.role,
          },
          input: {
            body,
            attachments: [],
            ...(replyTo ? { replyToId: replyTo.id } : {}),
          },
          ...(replyTo ? { replyToPreview: replyTo.preview } : {}),
        });

        return true;
      } catch (error) {
        setSendError(isAppError(error) ? error : toAppError(error));
        return false;
      } finally {
        setSending(false);
      }
    },
    [repository, profile, channelId],
  );

  const messages = snapshot?.channelId === channelId ? snapshot.messages : [];
  const error = failure?.channelId === channelId ? failure.error : null;

  const status: AsyncData<readonly ChannelMessage[]>['status'] = !enabled
    ? 'idle'
    : error !== null
      ? 'error'
      : snapshot?.channelId === channelId
        ? 'ready'
        : 'loading';

  return {
    status,
    messages,
    error,
    hasOlder: messages.length >= windowSize,
    loadingOlder,
    sending,
    sendError,
    loadOlder,
    retry,
    send,
  };
}
