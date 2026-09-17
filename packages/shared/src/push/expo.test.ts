/**
 * Envoi réel, avec le réseau simulé.
 *
 * ## Ce que ces tests protègent
 *
 * Le **compte rendu** d'un envoi. `PushResult` est ce que l'administration
 * affiche après une notification : « 412 envoyées, 3 échecs, 2 appareils
 * retirés ». Un compte faux ne casse rien — il ne lève aucune erreur et
 * n'empêche aucun envoi — mais il rend le tableau de bord inutilisable, et il
 * masque précisément ce qu'on veut voir : combien de parents ont réellement
 * reçu l'information.
 *
 * Le cas le plus traître est celui d'une réponse **plus courte que la
 * demande**. L'API Expo rend un ticket par jeton envoyé, dans le même ordre ;
 * si elle en rend moins, les jetons sans ticket n'ont pas été confirmés. Les
 * ignorer donnait un envoi « entièrement livré » alors qu'une partie des
 * parents n'avait rien reçu.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PushMessage, PushRecipient } from './dispatcher.js';
import { ExpoPushDispatcher } from './expo.js';

function recipient(overrides: Partial<PushRecipient> = {}): PushRecipient {
  return {
    token: 'ExponentPushToken[abc]',
    platform: 'android',
    enabled: true,
    disabledCategories: [],
    audienceKeys: ['org:fcpe-montmagny'],
    ...overrides,
  };
}

function message(overrides: Partial<PushMessage> = {}): PushMessage {
  return {
    title: 'Cantine',
    body: 'Le menu change lundi',
    category: 'publications',
    audienceKeys: ['org:fcpe-montmagny'],
    data: { type: 'post', orgId: 'fcpe-montmagny' },
    ...overrides,
  };
}

/** Réponse simulée du service Expo Push. */
function reponse(tickets: readonly unknown[], status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => ({ data: tickets }),
  } as unknown as Response;
}

const TICKET_OK = { status: 'ok', id: 'ticket-1' };
const TICKET_DESINSTALLE = { status: 'error', details: { error: 'DeviceNotRegistered' } };
const TICKET_AUTRE_ERREUR = { status: 'error', message: 'Message too long' };

describe('ExpoPushDispatcher', () => {
  let fetchSimule: ReturnType<typeof vi.fn>;
  let journal: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSimule = vi.fn();
    journal = vi.fn();
    vi.stubGlobal('fetch', fetchSimule);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function dispatcher(): ExpoPushDispatcher {
    return new ExpoPushDispatcher({ log: journal, accessToken: 'jeton-expo' });
  }

  /** Charge utile réellement transmise au service, pour un appel donné. */
  function chargeEnvoyee(index = 0): { to: string; channelId: string; priority: string }[] {
    const appel = fetchSimule.mock.calls[index] as unknown as [string, { body: string }];
    return JSON.parse(appel[1].body) as { to: string; channelId: string; priority: string }[];
  }

  it('n’appelle pas le réseau quand personne n’est éligible', async () => {
    // Un appel qui ne peut rien envoyer coûte une invocation et du temps ; sur
    // une catégorie que tout le monde a coupée, c'est à chaque publication.
    const resultat = await dispatcher().send(message({ category: 'agenda' }), [
      recipient({ disabledCategories: ['agenda'] }),
    ]);

    expect(fetchSimule).not.toHaveBeenCalled();
    expect(resultat).toEqual({ delivered: 0, failed: 0, invalidTokens: [] });
  });

  it('adresse le message à chaque destinataire éligible', async () => {
    fetchSimule.mockResolvedValueOnce(reponse([TICKET_OK, TICKET_OK]));

    await dispatcher().send(message(), [recipient({ token: 'a' }), recipient({ token: 'b' })]);

    expect(chargeEnvoyee().map((entree) => entree.to)).toEqual(['a', 'b']);
  });

  it('n’envoie rien à un parent qui a désactivé la catégorie', async () => {
    // Le filtrage doit précéder l'envoi, pas le suivre : une notification
    // envoyée puis « filtrée » est déjà reçue.
    fetchSimule.mockResolvedValueOnce(reponse([TICKET_OK]));

    await dispatcher().send(message(), [
      recipient({ token: 'garde' }),
      recipient({ token: 'coupe', disabledCategories: ['publications'] }),
    ]);

    expect(chargeEnvoyee().map((entree) => entree.to)).toEqual(['garde']);
  });

  it('range chaque catégorie dans son canal Android', async () => {
    fetchSimule.mockResolvedValueOnce(reponse([TICKET_OK]));

    await dispatcher().send(message({ category: 'vie_fcpe' }), [recipient()]);

    expect(chargeEnvoyee()[0]?.channelId).toBe('fl-vie_fcpe');
  });

  it('élève la priorité d’une alerte urgente', async () => {
    fetchSimule.mockResolvedValueOnce(reponse([TICKET_OK]));

    await dispatcher().send(message({ category: 'urgent', priority: 'max' }), [recipient()]);

    expect(chargeEnvoyee()[0]?.priority).toBe('high');
  });

  // --- Le compte rendu -----------------------------------------------------

  it('compte les livraisons confirmées', async () => {
    fetchSimule.mockResolvedValueOnce(reponse([TICKET_OK, TICKET_OK]));

    const resultat = await dispatcher().send(message(), [
      recipient({ token: 'a' }),
      recipient({ token: 'b' }),
    ]);

    expect(resultat).toEqual({ delivered: 2, failed: 0, invalidTokens: [] });
  });

  it('retient le jeton d’une application désinstallée', async () => {
    // Sans cette liste, le jeton mort serait retenté à chaque envoi, pour
    // toujours : `DeviceNotRegistered` est définitif.
    fetchSimule.mockResolvedValueOnce(reponse([TICKET_DESINSTALLE]));

    const resultat = await dispatcher().send(message(), [recipient({ token: 'mort' })]);

    expect(resultat).toEqual({ delivered: 0, failed: 1, invalidTokens: ['mort'] });
  });

  it('journalise une erreur sans retirer le jeton', async () => {
    // Un message trop long n'est pas un appareil disparu : retirer le jeton
    // priverait ce parent de **toutes** les notifications à venir.
    fetchSimule.mockResolvedValueOnce(reponse([TICKET_AUTRE_ERREUR]));

    const resultat = await dispatcher().send(message(), [recipient({ token: 'vivant' })]);

    expect(resultat.invalidTokens).toEqual([]);
    expect(resultat.failed).toBe(1);
    expect(journal).toHaveBeenCalled();
  });

  it('compte comme échec un jeton sans ticket', async () => {
    // L'API rend un ticket par jeton, dans le même ordre. Un lot de deux jetons
    // qui n'en rend qu'un n'est pas « une livraison sur deux » : le second n'a
    // pas été confirmé. Sans ce compte, `delivered + failed` valait moins que
    // le nombre de destinataires, et l'administration annonçait un envoi
    // complet.
    fetchSimule.mockResolvedValueOnce(reponse([TICKET_OK]));

    const resultat = await dispatcher().send(message(), [
      recipient({ token: 'a' }),
      recipient({ token: 'b' }),
    ]);

    expect(resultat.delivered).toBe(1);
    expect(resultat.failed).toBe(1);
  });

  it('compte tout le lot en échec quand la réponse est vide', async () => {
    fetchSimule.mockResolvedValueOnce(reponse([]));

    const resultat = await dispatcher().send(message(), [
      recipient({ token: 'a' }),
      recipient({ token: 'b' }),
    ]);

    expect(resultat).toEqual({ delivered: 0, failed: 2, invalidTokens: [] });
  });

  it('compte tout le lot en échec quand le service refuse', async () => {
    fetchSimule.mockResolvedValueOnce(reponse([], 500));

    const resultat = await dispatcher().send(message(), [recipient({ token: 'a' })]);

    expect(resultat).toEqual({ delivered: 0, failed: 1, invalidTokens: [] });
    expect(journal).toHaveBeenCalled();
  });

  it('compte tout le lot en échec quand le réseau lâche', async () => {
    fetchSimule.mockRejectedValueOnce(new Error('réseau indisponible'));

    const resultat = await dispatcher().send(message(), [recipient({ token: 'a' })]);

    expect(resultat.failed).toBe(1);
  });

  it('réessaie après une limitation de débit', async () => {
    // Expo répond 429 quand on envoie trop vite. Abandonner au premier refus
    // perdrait la notification pour tout le lot, alors que le service demande
    // simplement d'attendre.
    fetchSimule.mockResolvedValueOnce(reponse([], 429)).mockResolvedValueOnce(reponse([TICKET_OK]));

    const resultat = await dispatcher().send(message(), [recipient({ token: 'a' })]);

    expect(fetchSimule).toHaveBeenCalledTimes(2);
    expect(resultat.delivered).toBe(1);
  });

  it('découpe un envoi nombreux en plusieurs requêtes', async () => {
    fetchSimule.mockResolvedValue(reponse([TICKET_OK]));

    const destinataires = Array.from({ length: 101 }, (_, index) =>
      recipient({ token: `t${index}` }),
    );
    await dispatcher().send(message(), destinataires);

    // Deux lots, donc deux appels : la charge utile ne dépasse jamais 100.
    expect(fetchSimule).toHaveBeenCalledTimes(2);
    expect(chargeEnvoyee(0)).toHaveLength(100);
    expect(chargeEnvoyee(1)).toHaveLength(1);
  });

  it('transmet les données de navigation jusqu’à l’application', async () => {
    // C'est ce qui permet d'ouvrir la bonne publication au toucher. Sans ces
    // données, la notification ouvre l'application sur son écran d'accueil.
    fetchSimule.mockResolvedValueOnce(reponse([TICKET_OK]));

    await dispatcher().send(
      message({
        data: {
          type: 'post',
          orgId: 'fcpe-montmagny',
          sourceId: 'post-1',
          deeplink: '/post/post-1',
        },
      }),
      [recipient()],
    );

    const appel = fetchSimule.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(appel[1].body)).toMatchObject([
      { data: { type: 'post', sourceId: 'post-1', deeplink: '/post/post-1' } },
    ]);
  });
});
