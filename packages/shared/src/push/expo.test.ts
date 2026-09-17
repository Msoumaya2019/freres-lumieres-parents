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
 *
 * ## Le second compte rendu, quinze minutes plus tard
 *
 * Le ticket dit « j'ai accepté ». Il ne dit pas « j'ai remis ». La seconde
 * moitié du compte rendu vient de `/push/getReceipts`, et elle a ses propres
 * pièges : un identifiant absent n'est ni livré ni échoué, un reçu mort désigne
 * un **ticket** et non un jeton, et une relecture en échec ne doit surtout pas
 * se déguiser en zéros. Les tests de `readReceipts` couvrent ces quatre cas.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PushMessage, PushRecipient } from './dispatcher.js';
import { PushCredentialsError } from './errors.js';
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

/** Réponse simulée de la relecture des reçus : une table indexée par ticket. */
function reponseRecus(data: Readonly<Record<string, unknown>>, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => ({ data }),
  } as unknown as Response;
}

const TICKET_OK = { status: 'ok', id: 'ticket-1' };
const TICKET_DESINSTALLE = { status: 'error', details: { error: 'DeviceNotRegistered' } };
const TICKET_AUTRE_ERREUR = { status: 'error', message: 'Message too long' };

/** Ticket accepté, avec un identifiant distinct — un appareil, un ticket. */
function ticketOk(id: string): { status: string; id: string } {
  return { status: 'ok', id };
}

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

  /** Adresse réellement appelée, pour un appel donné. */
  function urlAppelee(index = 0): string {
    const appel = fetchSimule.mock.calls[index] as unknown as [string];
    return appel[0];
  }

  /** Corps réellement transmis, pour un appel donné. */
  function corpsEnvoye(index = 0): unknown {
    const appel = fetchSimule.mock.calls[index] as unknown as [string, { body: string }];
    return JSON.parse(appel[1].body) as unknown;
  }

  it('n’appelle pas le réseau quand personne n’est éligible', async () => {
    // Un appel qui ne peut rien envoyer coûte une invocation et du temps ; sur
    // une catégorie que tout le monde a coupée, c'est à chaque publication.
    const resultat = await dispatcher().send(message({ category: 'agenda' }), [
      recipient({ disabledCategories: ['agenda'] }),
    ]);

    expect(fetchSimule).not.toHaveBeenCalled();
    expect(resultat).toEqual({ accepted: 0, failed: 0, invalidTokens: [], tickets: [] });
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
    fetchSimule.mockResolvedValueOnce(reponse([ticketOk('t1'), ticketOk('t2')]));

    const resultat = await dispatcher().send(message(), [
      recipient({ token: 'a' }),
      recipient({ token: 'b' }),
    ]);

    expect(resultat).toEqual({
      accepted: 2,
      failed: 0,
      invalidTokens: [],
      tickets: [
        { id: 't1', token: 'a' },
        { id: 't2', token: 'b' },
      ],
    });
  });

  it('retient le jeton d’une application désinstallée', async () => {
    // Sans cette liste, le jeton mort serait retenté à chaque envoi, pour
    // toujours : `DeviceNotRegistered` est définitif.
    fetchSimule.mockResolvedValueOnce(reponse([TICKET_DESINSTALLE]));

    const resultat = await dispatcher().send(message(), [recipient({ token: 'mort' })]);

    expect(resultat).toEqual({ accepted: 0, failed: 1, invalidTokens: ['mort'], tickets: [] });
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
    // pas été confirmé. Sans ce compte, `accepted + failed` valait moins que
    // le nombre de destinataires, et l'administration annonçait un envoi
    // complet.
    fetchSimule.mockResolvedValueOnce(reponse([TICKET_OK]));

    const resultat = await dispatcher().send(message(), [
      recipient({ token: 'a' }),
      recipient({ token: 'b' }),
    ]);

    expect(resultat.accepted).toBe(1);
    expect(resultat.failed).toBe(1);
  });

  it('compte tout le lot en échec quand la réponse est vide', async () => {
    fetchSimule.mockResolvedValueOnce(reponse([]));

    const resultat = await dispatcher().send(message(), [
      recipient({ token: 'a' }),
      recipient({ token: 'b' }),
    ]);

    expect(resultat).toEqual({ accepted: 0, failed: 2, invalidTokens: [], tickets: [] });
  });

  it('compte tout le lot en échec quand le service refuse', async () => {
    fetchSimule.mockResolvedValueOnce(reponse([], 500));

    const resultat = await dispatcher().send(message(), [recipient({ token: 'a' })]);

    expect(resultat).toEqual({ accepted: 0, failed: 1, invalidTokens: [], tickets: [] });
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
    expect(resultat.accepted).toBe(1);
  });

  // --- Le refus d'authentification -----------------------------------------

  describe('jeton d’accès refusé', () => {
    it('lève une erreur reconnaissable, et interrompt l’envoi au premier refus', async () => {
      // Deux propriétés, et une seule mutation les emporte toutes les deux —
      // d'où un seul test plutôt que deux voisins qui se confondraient.
      //
      // 1. **L'erreur est reconnaissable.** Un `401` et une panne réseau se
      //    ressemblent dans un journal, et n'ont rien de commun : l'un se
      //    répare tout seul, l'autre en remplaçant un secret. Tant que la
      //    seule différence est une phrase, personne ne peut les distinguer
      //    par programme. Ce qu'elle ne doit pas devenir non plus : un
      //    compteur — un « 250 appareils injoignables » désignerait les
      //    parents, alors que le problème est un secret expiré.
      //
      // 2. **L'envoi s'arrête au premier refus.** Le jeton est refusé pour
      //    *tous* les lots : continuer ferait N appels identiques, tous
      //    refusés, pour un résultat connu d'avance. Les 250 destinataires
      //    font trois lots — sans l'arrêt, le compte ci-dessous serait de
      //    trois.
      fetchSimule.mockResolvedValue(reponse([], 401));

      const destinataires = Array.from({ length: 250 }, (_, index) =>
        recipient({ token: `t${index}` }),
      );

      await expect(dispatcher().send(message(), destinataires)).rejects.toThrow(
        PushCredentialsError,
      );
      expect(fetchSimule).toHaveBeenCalledTimes(1);
    });

    it('compte toujours une panne ordinaire en échec, et poursuit', async () => {
      // La contrepartie, sans laquelle le test précédent serait satisfait par
      // une fonction qui lève au moindre problème : un `500` sur un lot ne doit
      // ni interrompre les suivants, ni changer de nature.
      //
      // Deux lots sont nécessaires pour l'éprouver, donc plus de cent
      // destinataires — la taille de lot de l'envoi.
      fetchSimule
        .mockResolvedValueOnce(reponse([], 500))
        .mockResolvedValueOnce(reponse([TICKET_OK]));

      const destinataires = Array.from({ length: 101 }, (_, index) =>
        recipient({ token: `t${index}` }),
      );
      const resultat = await dispatcher().send(message(), destinataires);

      expect(fetchSimule).toHaveBeenCalledTimes(2);
      expect(resultat.failed).toBe(100);
      expect(resultat.accepted).toBe(1);
    });
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

  it('n’invente pas de ticket relisible quand le service n’en rend pas', async () => {
    // Contrat du service : un ticket accepté porte un identifiant. S'il en
    // manque un, la remise ne pourra jamais être relue — et la compter en échec
    // serait faux, puisque le message a bel et bien été accepté. L'anomalie est
    // donc journalisée, pas maquillée.
    fetchSimule.mockResolvedValueOnce(reponse([{ status: 'ok' }]));

    const resultat = await dispatcher().send(message(), [recipient({ token: 'a' })]);

    expect(resultat.accepted).toBe(1);
    expect(resultat.tickets).toEqual([]);
    expect(journal).toHaveBeenCalled();
  });

  // --- La relecture des reçus ----------------------------------------------

  describe('readReceipts', () => {
    it('interroge le point d’entrée des reçus, pas celui de l’envoi', async () => {
      // Les deux points d'entrée se ressemblent et n'ont pas la même forme de
      // réponse. En appeler un pour l'autre rendrait une table de tickets lue
      // comme une table de reçus — donc des comptes faux, sans erreur.
      fetchSimule.mockResolvedValueOnce(reponseRecus({ t1: { status: 'ok' } }));

      await dispatcher().readReceipts(['t1']);

      expect(urlAppelee()).toContain('/push/getReceipts');
      expect(corpsEnvoye()).toEqual({ ids: ['t1'] });
    });

    it('n’appelle pas le réseau quand il n’y a rien à relire', async () => {
      const recus = await dispatcher().readReceipts([]);

      expect(fetchSimule).not.toHaveBeenCalled();
      expect(recus).toEqual({ delivered: 0, failed: 0, pending: 0, deadTicketIds: [] });
    });

    it('compte remis, échoué et en attente, sans en perdre un seul', async () => {
      // Un identifiant absent de la table n'est **pas** un échec : le service
      // omet simplement ce dont il n'a pas encore la réponse. Le compter en
      // échec aurait inventé des pannes ; le compter en livraison, des remises.
      fetchSimule.mockResolvedValueOnce(
        reponseRecus({
          t1: { status: 'ok' },
          t2: { status: 'error', message: 'Message too long' },
        }),
      );

      const recus = await dispatcher().readReceipts(['t1', 't2', 't3']);

      expect(recus).toEqual({ delivered: 1, failed: 1, pending: 1, deadTicketIds: [] });
      // L'invariant : aucun identifiant ne disparaît du compte rendu.
      expect(recus.delivered + recus.failed + recus.pending).toBe(3);
    });

    it('rend l’identifiant d’un appareil mort, et jamais un jeton', async () => {
      // Le reçu ne dit pas à quel appareil il correspond : c'est la limite du
      // service, et elle doit rester visible dans le type. Si cette liste
      // contenait des jetons par accident, la purge supprimerait des appareils
      // vivants.
      fetchSimule.mockResolvedValueOnce(
        reponseRecus({
          't-mort': { status: 'error', details: { error: 'DeviceNotRegistered' } },
          't-vivant': { status: 'ok' },
        }),
      );

      const recus = await dispatcher().readReceipts(['t-mort', 't-vivant']);

      expect(recus.deadTicketIds).toEqual(['t-mort']);
      expect(recus.delivered).toBe(1);
    });

    it('découpe une relecture de plus de mille identifiants', async () => {
      // La limite du service est de 1000 identifiants par requête, dix fois
      // celle de l'envoi. Un lot trop gros fait échouer la relecture entière,
      // et l'échec ressemblerait à « aucun reçu disponible ».
      fetchSimule.mockResolvedValue(reponseRecus({}));

      const identifiants = Array.from({ length: 1500 }, (_, index) => `t${index}`);
      const recus = await dispatcher().readReceipts(identifiants);

      expect(fetchSimule).toHaveBeenCalledTimes(2);
      expect((corpsEnvoye(0) as { ids: string[] }).ids).toHaveLength(1000);
      expect((corpsEnvoye(1) as { ids: string[] }).ids).toHaveLength(500);
      expect(recus.pending).toBe(1500);
    });

    it('lève quand le service refuse, au lieu de rendre des zéros', async () => {
      // Rendre des zéros écrirait « aucun message remis » dans l'historique,
      // où personne ne relirait le document. Un échec de relecture doit rester
      // un échec : `deliveredCount` reste `null`, donc « non relu ».
      fetchSimule.mockResolvedValueOnce(reponseRecus({}, 500));

      await expect(dispatcher().readReceipts(['t1'])).rejects.toThrow('500');
    });

    it('distingue un refus d’authentification des autres échecs', async () => {
      // L'appelant doit pouvoir cesser d'insister : un jeton refusé ne se
      // répare pas en réessayant, et la tâche planifiée le reproduirait toutes
      // les heures. C'est la seule différence entre une panne qu'on répare et
      // une panne qu'on subit.
      fetchSimule.mockResolvedValueOnce(reponseRecus({}, 401));

      await expect(dispatcher().readReceipts(['t1'])).rejects.toThrow(PushCredentialsError);
    });

    it('lève quand la réponse n’a pas de table de reçus', async () => {
      // Une réponse `200` sans `data` n'est pas « aucun reçu » : c'est une
      // forme inattendue. Les confondre ferait écrire des messages « en
      // attente » qui ne se résoudraient jamais.
      fetchSimule.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({}),
      } as unknown as Response);

      await expect(dispatcher().readReceipts(['t1'])).rejects.toThrow('sans table de reçus');
    });
  });
});
