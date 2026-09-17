/**
 * Ce que le regroupement d'un canal doit faire, et surtout ne pas faire.
 *
 * ## Pourquoi ces décisions se lisent dans la source
 *
 * Aucune n'est observable sans émulateur : elles portent sur la **forme** —
 * quel événement est écouté, dans quel ordre deux écritures s'enchaînent, ce
 * qui n'est pas écrit. C'est le motif de `comment-notifications.test.ts` et de
 * `send.test.ts`.
 *
 * ## Les quatre pièges que ces tests ferment
 *
 * **L'envoi depuis le déclencheur.** Un déclencheur qui enverrait lui-même
 * annulerait le regroupement : un canal actif produirait une notification par
 * message. C'est le défaut le plus probable de cet incrément, parce qu'il
 * « marche » — la notification part, personne ne se plaint — et que seul le
 * volume le révèle.
 *
 * **L'écrasement du lot.** Sans transaction, deux messages écrits au même
 * instant liraient le même état et l'un écraserait l'autre : trois messages
 * annoncés comme deux, sans aucune erreur.
 *
 * **L'ordre envoi / suppression.** Supprimer avant d'envoyer perd la
 * notification quand le processus est interrompu entre les deux — un défaut
 * silencieux, indiscernable d'un canal calme.
 *
 * **Le lien profond.** Le type `channel` existe mais n'a pas d'écran : un lien
 * de ce type passerait l'analyse puis n'ouvrirait rien. Le test exige qu'aucun
 * lien ne soit écrit.
 */
import { describe, expect, it } from 'vitest';

import { corpsDeLaFonction, lireSource } from '../test-helpers/source.js';

const CHEMIN_TRIGGER = ['functions', 'src', 'triggers', 'channel-notifications.ts'];
const SOURCE_TRIGGER = lireSource(CHEMIN_TRIGGER);
const CORPS_TRIGGER = corpsDeLaFonction(SOURCE_TRIGGER, 'notifyChannelAudience', CHEMIN_TRIGGER);

const CHEMIN_PLAN = ['functions', 'src', 'triggers', 'digest-schedule.ts'];
const SOURCE_PLAN = lireSource(CHEMIN_PLAN);
const CORPS_PLAN = corpsDeLaFonction(SOURCE_PLAN, 'onChannelDigestsDue', CHEMIN_PLAN);

const CHEMIN_FLUSH = ['functions', 'src', 'notifications', 'digest-flush.ts'];
const SOURCE_FLUSH = lireSource(CHEMIN_FLUSH);
const CORPS_FLUSH = corpsDeLaFonction(SOURCE_FLUSH, 'flushChannelDigests', CHEMIN_FLUSH);

describe('notifyChannelAudience, sur l’événement écouté', () => {
  it('se déclare sur la création d’un message de canal', () => {
    // Le chemin est écrit en clair parce que Firebase l'exige : il doit
    // correspondre à la déclaration des règles (`match /messages/{messageId}`
    // sous `match /channels/{channelId}`).
    expect(CORPS_TRIGGER).toContain('onDocumentCreated(');
    expect(CORPS_TRIGGER).toContain("document: 'channels/{channelId}/messages/{messageId}'");
  });

  it('ne s’abonne pas aux écritures', () => {
    // Un message naît `visible`, les règles l'imposent : il n'y a pas de second
    // chemin à réduire à une règle. Et s'abonner aux écritures ferait réveiller
    // le déclencheur par le masquage d'un message, pour constater qu'il n'y a
    // rien à ajouter.
    expect(CORPS_TRIGGER).not.toContain('onDocumentWritten');
    expect(CORPS_TRIGGER).not.toContain('onDocumentUpdated');
  });
});

describe('notifyChannelAudience, sur ce qu’il n’envoie pas', () => {
  it('n’envoie aucune notification', () => {
    // La décision centrale de l'incrément : le déclencheur accumule, le passage
    // planifié annonce. Envoyer ici supprimerait le regroupement sans que rien
    // ne le signale.
    expect(CORPS_TRIGGER).not.toContain('sendToAudience(');
    expect(CORPS_TRIGGER).not.toContain('sendToUser(');
  });

  it('ne touche pas au message qui l’a réveillé', () => {
    // Le déclencheur de publication écrit `notifiedAt` dans le document qu'il
    // écoute, et c'est cette écriture qu'une seconde garde arrête. Ici rien
    // n'est écrit dans le message : la fonction ne se réveille pas elle-même.
    expect(CORPS_TRIGGER).not.toContain('notifiedAt');
    expect(CORPS_TRIGGER).not.toContain('paths.channelMessage(');
  });
});

describe('notifyChannelAudience, sur le lot', () => {
  it('lit le canal et écrit le lot', () => {
    expect(CORPS_TRIGGER).toContain('paths.channel(channelId)');
    expect(CORPS_TRIGGER).toContain('paths.channelDigest(channelId)');
  });

  it('met le lot à jour dans une transaction', () => {
    // Sans elle, deux messages simultanés écraseraient mutuellement leur lot.
    expect(CORPS_TRIGGER).toContain('runTransaction(');
    expect(CORPS_TRIGGER).toContain('transaction.get(digestRef)');
    expect(CORPS_TRIGGER).toContain('transaction.set(digestRef');
  });

  it('confie toute la décision au plan', () => {
    expect(CORPS_TRIGGER).toContain('channelDigestPlan(');
    expect(CORPS_TRIGGER).toContain('if (!plan) return;');
  });
});

describe('onChannelDigestsDue, sur la cadence', () => {
  it('passe toutes les cinq minutes, sur le fuseau des utilisateurs', () => {
    // La fenêtre de regroupement est de cinq minutes : un lot ne peut pas être
    // annoncé avant, et un passage chaque minute gagnerait au plus quatre
    // minutes pour cinq fois plus d'invocations.
    expect(CORPS_PLAN).toContain("schedule: 'every 5 minutes'");
    expect(CORPS_PLAN).toContain("timeZone: 'Europe/Paris'");
    expect(CORPS_PLAN).toContain("region: 'europe-west1'");
  });

  it('délègue au passage, sans rien décider', () => {
    expect(CORPS_PLAN).toContain('await flushChannelDigests()');
  });
});

describe('flushChannelDigests, sur la requête', () => {
  it('ne contraint que l’échéance', () => {
    // Une plage sur un seul champ : l'index simple est créé par Firestore.
    // Ajouter `orgId` demanderait un index composite non déclaré, et la requête
    // serait refusée à l'exécution avec un message qui ne dit pas lequel manque.
    expect(CORPS_FLUSH).toContain("where('flushAt', '<=', maintenant)");
    expect(CORPS_FLUSH).not.toContain("where('orgId'");
  });

  it('borne le nombre de lots traités', () => {
    // Sans borne, une reprise après une panne longue ferait un passage unique
    // très long, interrompu au milieu sans que rien ne dise où.
    expect(CORPS_FLUSH).toContain('limit(MAX_LOTS_PAR_PASSAGE)');
  });
});

describe('flushChannelDigests, sur l’ordre des écritures', () => {
  it('envoie avant de supprimer le lot', () => {
    const envoi = CORPS_FLUSH.indexOf('await sendToAudience(');
    const suppression = CORPS_FLUSH.indexOf('.ref.delete()', envoi);

    expect(envoi).toBeGreaterThan(-1);
    // L'envoi précède la suppression qui le suit : un passage interrompu entre
    // les deux réannoncera le lot — un doublon visible — plutôt que de perdre
    // la notification en silence.
    expect(suppression).toBeGreaterThan(envoi);
  });

  it('supprime sans envoyer un lot qui n’a plus rien à annoncer', () => {
    const suppression = CORPS_FLUSH.indexOf('.ref.delete()');
    const envoi = CORPS_FLUSH.indexOf('await sendToAudience(');

    // Le lot vide est supprimé **avant** toute tentative d'envoi, et c'est
    // l'autre ordre — délibéré : il n'y a rien à perdre, et le garder ferait
    // interroger la base à chaque passage pour un lot définitivement muet.
    expect(suppression).toBeLessThan(envoi);
  });
});

describe('flushChannelDigests, sur l’envoi', () => {
  it('exclut les auteurs du lot', () => {
    // C'est ici que vit « on ne se notifie jamais soi-même » depuis que le
    // regroupement existe : renoncer à envoyer éteindrait la notification pour
    // tout le monde.
    expect(CORPS_FLUSH).toContain('excludeUids: plan.excludeUids');
  });

  it('inscrit l’audience du canal dans le journal', () => {
    // Le lot est bien un envoi de masse — contrairement à une notification de
    // commentaire —, et l'historique doit le dire.
    expect(CORPS_FLUSH).toContain("sourceType: 'message'");
    expect(CORPS_FLUSH).toContain('sourceId: channelId');
    expect(CORPS_FLUSH).toContain('...(audience ? { audience: audience as Audience } : {})');
  });

  it('relit les messages au lieu de les recopier', () => {
    // Un message masqué pendant la fenêtre ne doit plus être compté : le compte
    // annoncé est celui des messages **relus**.
    expect(CORPS_FLUSH).toContain('db.getAll(...references)');
    expect(CORPS_FLUSH).toContain('paths.channelMessage(channelId, messageId)');
  });
});
