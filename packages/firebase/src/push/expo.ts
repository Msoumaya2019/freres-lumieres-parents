/**
 * Implémentation Expo Push du dispatcher.
 *
 * Côté serveur uniquement : cette classe est utilisée par les Cloud Functions,
 * jamais par l'application mobile. Elle n'a besoin que de `fetch`, disponible
 * nativement en Node 22.
 *
 * Le transport réel reste Firebase Cloud Messaging sur Android et APNs sur
 * iOS : Expo Push Service relaie vers ces deux services.
 */
import type { PushDispatcher, PushMessage, PushRecipient, PushResult } from './dispatcher.js';
import { androidChannelId, chunkRecipients, filterRecipients } from './dispatcher.js';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface ExpoPushDispatcherOptions {
  /**
   * Jeton d'accès Expo. Optionnel, mais recommandé en production : sans lui,
   * l'API applique une limite de débit beaucoup plus stricte.
   */
  accessToken?: string;
  /** Fonction de journalisation, injectable pour les tests. */
  log?: (message: string, context?: Record<string, unknown>) => void;
  /** Délai maximal d'un appel réseau, en millisecondes. */
  timeoutMs?: number;
}

export class ExpoPushDispatcher implements PushDispatcher {
  private readonly accessToken: string | undefined;
  private readonly log: (message: string, context?: Record<string, unknown>) => void;
  private readonly timeoutMs: number;

  constructor(options: ExpoPushDispatcherOptions = {}) {
    this.accessToken = options.accessToken;
    this.log = options.log ?? (() => undefined);
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async send(message: PushMessage, recipients: readonly PushRecipient[]): Promise<PushResult> {
    const eligible = filterRecipients(recipients, message.category);

    if (eligible.length === 0) {
      this.log('Aucun destinataire après filtrage des préférences.', {
        category: message.category,
      });
      return { delivered: 0, failed: 0, invalidTokens: [] };
    }

    let delivered = 0;
    let failed = 0;
    const invalidTokens: string[] = [];

    for (const batch of chunkRecipients(eligible)) {
      const payload = batch.map((recipient) => ({
        to: recipient.token,
        title: message.title,
        body: message.body,
        sound: message.priority === 'max' ? 'default' : undefined,
        priority: message.priority === 'max' ? 'high' : 'default',
        channelId: androidChannelId(message.category),
        data: message.data,
      }));

      try {
        const tickets = await this.postWithRetry(payload);

        tickets.forEach((ticket, index) => {
          const recipient = batch[index];
          if (!recipient) return;

          if (ticket.status === 'ok') {
            delivered += 1;
            return;
          }

          failed += 1;
          // `DeviceNotRegistered` signifie que l'application a été
          // désinstallée : le jeton doit être supprimé, sinon il sera
          // retenté indéfiniment à chaque envoi.
          if (ticket.details?.error === 'DeviceNotRegistered') {
            invalidTokens.push(recipient.token);
          } else {
            this.log('Échec d’envoi d’une notification.', {
              error: ticket.details?.error ?? ticket.message,
              platform: recipient.platform,
            });
          }
        });

        // L'API Expo rend un ticket par jeton envoyé, dans le même ordre. Un
        // lot plus court que prévu n'est donc pas un succès partiel : les
        // jetons sans ticket n'ont pas été confirmés. Les ignorer rendait
        // `delivered + failed` inférieur au nombre de destinataires, et
        // l'administration annonçait un envoi complet alors qu'une partie des
        // parents n'avait rien reçu.
        const sansTicket = batch.length - tickets.length;
        if (sansTicket > 0) {
          failed += sansTicket;
          this.log('Réponse incomplète du service Expo Push.', {
            batchSize: batch.length,
            tickets: tickets.length,
          });
        }
      } catch (error) {
        failed += batch.length;
        this.log('Échec de l’appel au service Expo Push.', {
          error: error instanceof Error ? error.message : String(error),
          batchSize: batch.length,
        });
      }
    }

    return { delivered, failed, invalidTokens };
  }

  /**
   * Appel HTTP avec attente exponentielle.
   *
   * Trois tentatives maximum : au-delà, il est préférable d'abandonner et de
   * journaliser que de retenter en boucle. Une boucle de retrait infinie est
   * la façon la plus rapide d'épuiser le quota d'invocations.
   */
  private async postWithRetry(payload: unknown[], attempt = 1): Promise<ExpoPushTicket[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
          ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.status === 429 && attempt < 3) {
        await delay(500 * 2 ** (attempt - 1));
        return this.postWithRetry(payload, attempt + 1);
      }

      if (!response.ok) {
        throw new Error(`Expo Push a répondu ${response.status}`);
      }

      const body = (await response.json()) as { data?: ExpoPushTicket[] };
      return body.data ?? [];
    } finally {
      clearTimeout(timer);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
