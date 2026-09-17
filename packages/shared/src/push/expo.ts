/**
 * Implémentation Expo Push du dispatcher.
 *
 * Côté serveur uniquement : cette classe est utilisée par les Cloud Functions,
 * jamais par l'application mobile. Elle n'a besoin que de `fetch`, disponible
 * nativement en Node 22.
 *
 * Le transport réel reste Firebase Cloud Messaging sur Android et APNs sur
 * iOS : Expo Push Service relaie vers ces deux services.
 *
 * ## Deux sortes d'échec, et une seule est un échec d'envoi
 *
 * Une panne réseau ou un `500` sont des échecs **de cet envoi** : ils se
 * comptent, et le prochain envoi se passera peut-être mieux. Un `401` n'est pas
 * cela — le jeton d'accès est refusé, donc **aucun** envoi ne peut aboutir, ni
 * maintenant ni dans une heure, et rien ne le réparera sans intervention. Le
 * confondre avec les premiers rendait la panne invisible : c'est le défaut que
 * `PushCredentialsError` supprime.
 */
import type {
  PushDispatcher,
  PushMessage,
  PushReceipts,
  PushRecipient,
  PushResult,
  PushTicketRef,
} from './dispatcher.js';
import {
  androidChannelId,
  chunkRecipients,
  chunkTicketIds,
  filterRecipients,
} from './dispatcher.js';
import { PushCredentialsError } from './errors.js';
import { summariseReceipts, type ExpoPushReceipt } from './receipts.js';

const EXPO_PUSH_SEND_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_RECEIPTS_ENDPOINT = 'https://exp.host/--/api/v2/push/getReceipts';

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
      return { accepted: 0, failed: 0, invalidTokens: [], tickets: [] };
    }

    let accepted = 0;
    let failed = 0;
    const invalidTokens: string[] = [];
    const tickets: PushTicketRef[] = [];

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
        const ticketsRendus = await this.postTickets(payload);

        ticketsRendus.forEach((ticket, index) => {
          const recipient = batch[index];
          if (!recipient) return;

          if (ticket.status === 'ok') {
            accepted += 1;
            // Un ticket accepté sans identifiant ne pourra jamais être relu :
            // le contrat du service en garantit un, donc son absence est une
            // anomalie de protocole, et elle est journalisée comme telle. La
            // compter en échec serait faux — le message a bien été accepté.
            if (ticket.id) tickets.push({ id: ticket.id, token: recipient.token });
            else
              this.log('Ticket accepté sans identifiant : reçu illisible.', {
                platform: recipient.platform,
              });
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
        // `accepted + failed` inférieur au nombre de destinataires, et
        // l'administration annonçait un envoi complet alors qu'une partie des
        // parents n'avait rien reçu.
        const sansTicket = batch.length - ticketsRendus.length;
        if (sansTicket > 0) {
          failed += sansTicket;
          this.log('Réponse incomplète du service Expo Push.', {
            batchSize: batch.length,
            tickets: ticketsRendus.length,
          });
        }
      } catch (error) {
        // Un refus d'authentification interrompt l'envoi, il ne le compte pas.
        //
        // Deux raisons, et la seconde est la vraie. D'abord, le jeton est refusé
        // pour **tous** les lots : continuer ferait N appels identiques, tous
        // refusés, pour épuiser le quota d'invocations. Ensuite — et c'est ce
        // qui compte —, compter ces lots en échec écrirait « 412 appareils
        // injoignables » dans l'historique, alors qu'aucun message n'est parti
        // et que le problème est un secret expiré. Le compte rendu serait faux
        // dans le sens qui rassure : il désignerait les parents au lieu de la
        // configuration.
        if (error instanceof PushCredentialsError) throw error;

        failed += batch.length;
        this.log('Échec de l’appel au service Expo Push.', {
          error: error instanceof Error ? error.message : String(error),
          batchSize: batch.length,
        });
      }
    }

    return { accepted, failed, invalidTokens, tickets };
  }

  /**
   * Relit les reçus d'un envoi précédent.
   *
   * ## Ce que cette méthode ne peut pas faire, et pourquoi
   *
   * Elle rend des **identifiants** morts, pas des jetons : le service ne dit
   * jamais à quel appareil un reçu correspond. La traduction appartient à
   * l'appelant, qui seul a conservé le ticket et son jeton côte à côte.
   *
   * ## Pourquoi elle lève au lieu de rendre des zéros
   *
   * Une relecture en échec laisse l'historique intact — `deliveredCount` reste
   * `null`, donc « non relu ». Rendre des zéros à la place écrirait « aucun
   * message remis » dans un document que personne ne relira, et le mensonge
   * deviendrait un fait. L'appelant, lui, peut réessayer.
   *
   * Sauf sur un refus d'authentification, qui remonte tel quel
   * (`PushCredentialsError`) : celui-là ne se répare pas en réessayant, et
   * l'appelant doit cesser d'insister au lieu de réessayer toutes les heures.
   */
  async readReceipts(ticketIds: readonly string[]): Promise<PushReceipts> {
    if (ticketIds.length === 0) {
      return { delivered: 0, failed: 0, pending: 0, deadTicketIds: [] };
    }

    let delivered = 0;
    let failed = 0;
    let pending = 0;
    const deadTicketIds: string[] = [];

    for (const lot of chunkTicketIds(ticketIds)) {
      const data = await this.postReceipts(lot);
      const comptes = summariseReceipts(lot, data);

      delivered += comptes.delivered;
      failed += comptes.failed;
      pending += comptes.pending;
      deadTicketIds.push(...comptes.deadTicketIds);
    }

    return { delivered, failed, pending, deadTicketIds };
  }

  /**
   * Appel HTTP avec attente exponentielle.
   *
   * Trois tentatives maximum : au-delà, il est préférable d'abandonner et de
   * journaliser que de retenter en boucle. Une boucle de retrait infinie est
   * la façon la plus rapide d'épuiser le quota d'invocations.
   */
  private async postJson(url: string, payload: unknown, attempt = 1): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
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
        return this.postJson(url, payload, attempt + 1);
      }

      // Un `401` n'est pas une panne : c'est un secret à remplacer. Le
      // distinguer ici, au plus près du statut, évite d'avoir à le deviner plus
      // tard à partir d'une phrase de journal.
      if (response.status === 401) {
        throw new PushCredentialsError(response.status);
      }

      if (!response.ok) {
        throw new Error(`Expo Push a répondu ${response.status}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /** Envoi d'un lot, réduit à la liste des tickets. */
  private async postTickets(payload: unknown[]): Promise<ExpoPushTicket[]> {
    const body = (await this.postJson(EXPO_PUSH_SEND_ENDPOINT, payload)) as {
      data?: ExpoPushTicket[];
    };
    return body.data ?? [];
  }

  /**
   * Relecture d'un lot de reçus.
   *
   * Une réponse `200` **sans** table `data` est traitée comme une erreur, pas
   * comme « aucun reçu » : les deux se ressemblent et n'ont pas le même sens.
   * La première dit que le service a changé de forme, la seconde qu'il n'a rien
   * à répondre — et confondre les deux ferait écrire des messages « en attente »
   * qui ne se résoudront jamais.
   */
  private async postReceipts(lot: readonly string[]): Promise<Record<string, ExpoPushReceipt>> {
    const body = (await this.postJson(EXPO_PUSH_RECEIPTS_ENDPOINT, { ids: lot })) as {
      data?: Record<string, ExpoPushReceipt>;
    };

    if (!body.data || typeof body.data !== 'object') {
      throw new Error('Expo Push a répondu sans table de reçus.');
    }

    return body.data;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
