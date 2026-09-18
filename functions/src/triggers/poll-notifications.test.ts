/**
 * Ce que le déclencheur d'un sondage doit faire, et surtout ne pas faire.
 *
 * ## Pourquoi ces décisions se lisent dans la source
 *
 * Aucune n'est observable par un test de comportement sans émulateur : elles
 * portent sur la **forme** du déclencheur — à quel événement il s'abonne, ce
 * qu'il lit, dans quel ordre il écrit. C'est le motif de `send.test.ts` et de
 * `comment-notifications.test.ts`, et il est ici d'autant plus justifié que le
 * fichier est court et voué à un seul déclencheur.
 *
 * ## Les trois pièges que ces tests ferment
 *
 * **L'abonnement trop étroit.** `onDocumentCreated` raterait le brouillon ouvert
 * plus tard, `onDocumentUpdated` raterait le sondage publié d'un seul geste. Le
 * déclencheur écoute donc les **écritures**, et c'est le plan qui ramène les
 * deux chemins à une règle — la transition vers `open`.
 *
 * **L'ordre de l'écriture.** `notifiedAt` est posé **après** l'envoi. Marquer
 * d'abord puis échouer laisserait le sondage marqué comme notifié alors que
 * personne n'a rien reçu : une perte silencieuse, pire qu'un doublon. C'est un
 * ordre, donc rien d'autre qu'un test de forme ne le mesure.
 *
 * **La lecture de profil systématique.** Le nom de l'auteur n'est pas sur le
 * document et le journal l'exige, mais le lire à chaque écriture coûterait une
 * lecture pour les cas qui ne peuvent pas notifier — et ils sont les plus
 * nombreux : le balayage planifié écrit la clôture toutes les cinq minutes.
 */
import { describe, expect, it } from 'vitest';

import { corpsDeLaFonction, lireSource } from '../test-helpers/source.js';

const CHEMIN = ['functions', 'src', 'triggers', 'poll-notifications.ts'];
const SOURCE = lireSource(CHEMIN);
const CORPS = corpsDeLaFonction(SOURCE, 'notifyPollAudience', CHEMIN);

describe('notifyPollAudience, sur l’événement écouté', () => {
  it('se déclare sur les écritures d’un sondage', () => {
    // Le chemin est écrit en clair parce que Firebase l'exige, et il doit
    // correspondre à la déclaration des règles (`match /polls/{pollId}`) comme
    // à `paths.poll`.
    expect(CORPS).toContain('onDocumentWritten(');
    expect(CORPS).toContain("document: 'polls/{pollId}'");
  });

  it('ne s’abonne ni à la création ni à la mise à jour', () => {
    // Un abonnement à la création raterait le brouillon ouvert plus tard, un
    // abonnement à la mise à jour raterait le sondage publié d'un seul geste.
    // Les deux chemins existent, donc il faut les deux — et un seul abonnement
    // les couvre.
    //
    // L'assertion porte sur le **corps** : l'en-tête explique justement
    // pourquoi ces deux formes ont été écartées, et les citer n'est pas s'y
    // abonner.
    expect(CORPS).not.toContain('onDocumentCreated');
    expect(CORPS).not.toContain('onDocumentUpdated');
  });

  it('se déclare dans la région européenne', () => {
    // Les données sont hébergées en Europe, et la région d'une fonction décide
    // de l'emplacement de son exécution comme de ses journaux.
    expect(CORPS).toContain("region: 'europe-west1'");
  });
});

describe('notifyPollAudience, sur ce qu’il lit', () => {
  it('lit le profil de l’auteur par le helper, jamais sur le document', () => {
    // `Poll` ne porte que `createdBy` — `createPoll` a délibérément refusé d'y
    // recopier un nom qu'aucune règle ne vérifie — et le journal d'envoi exige
    // `sentByName`. La lecture elle-même appartient à `nomDeLAuteur`, éprouvé
    // plus bas : ce que ce corps-ci doit montrer, c'est qu'il **passe par lui**
    // et n'invente pas un second chemin.
    expect(CORPS).toContain('nomDeLAuteur(after)');
  });

  it('ne lit le profil que si le statut devient ouvert', () => {
    // Ce n'est pas une seconde règle : c'est la **première clause** du plan lue
    // seule. Elle suffit à éviter une lecture de profil sur les écritures qui
    // ne peuvent pas notifier, et ce sont les plus nombreuses.
    expect(CORPS).toContain("after?.status === 'open'");
  });

  it('sort sans rien envoyer quand il n’y a rien à envoyer', () => {
    expect(CORPS).toContain('if (!plan) return;');
  });
});

describe('notifyPollAudience, sur ce qu’il écrit', () => {
  it('marque le sondage après l’envoi, jamais avant', () => {
    // L'ordre est la décision, et rien d'autre ne la mesure. Marquer d'abord
    // puis échouer laisserait `notifiedAt` posé alors que personne n'a rien
    // reçu : le rejeu suivant verrait un envoi déjà fait, et la notification
    // serait perdue **en silence** — pire qu'un doublon.
    expect(CORPS.indexOf('sendToAudience(')).toBeGreaterThanOrEqual(0);
    expect(CORPS.indexOf('notifiedAt')).toBeGreaterThanOrEqual(0);
    expect(CORPS.indexOf('sendToAudience(')).toBeLessThan(CORPS.indexOf('notifiedAt'));
  });

  it('horodate le marquage sur le serveur', () => {
    // Une horloge cliente n'a aucune valeur ici : ce champ dit quand l'envoi a
    // eu lieu, et il est écrit par le serveur.
    expect(CORPS).toContain('FieldValue.serverTimestamp()');
  });

  it('n’écrit rien d’autre que le marquage', () => {
    // Le déclencheur ne touche ni au statut, ni à la question, ni aux options :
    // il n'a aucun mandat pour modifier le sondage qu'il annonce.
    expect(CORPS).toContain('.update({');
    expect(CORPS).not.toContain("status: 'closed'");
    expect(CORPS).not.toContain('.delete(');
  });
});

describe('notifyPollAudience, sur l’envoi', () => {
  it('envoie à l’audience du sondage, par la plomberie commune', () => {
    expect(CORPS).toContain('sendToAudience(');
    expect(CORPS).toContain('pollPushMessage(plan)');
  });

  it('journalise le sondage comme source et son auteur comme expéditeur', () => {
    // L'administration lit cette collection pour savoir ce qui est réellement
    // parti : `sourceType` et `sourceId` la rattachent au sondage, `sentBy` et
    // `sentByName` répondent à « qui a envoyé quoi ».
    expect(CORPS).toContain("sourceType: 'poll'");
    expect(CORPS).toContain('sourceId: plan.sourceId');
    expect(CORPS).toContain('sentBy: plan.authorId');
    expect(CORPS).toContain('sentByName: plan.authorName');
  });

  it('inscrit l’audience du sondage, parce que l’envoi est bien un envoi de masse', () => {
    // Contrairement à une notification de commentaire, qui vise une personne et
    // n'a donc pas d'audience à déclarer : ici l'audience décide des
    // destinataires, et la taire ferait décrire un envoi sans cible.
    expect(CORPS).toContain('audience: plan.audience');
    expect(CORPS).toContain('deeplink: plan.deeplink');
  });
});

describe('nomDeLAuteur', () => {
  const CORPS_AUTEUR = corpsDeLaFonction(SOURCE, 'nomDeLAuteur', CHEMIN);

  it('lit le profil par le chemin partagé', () => {
    // `paths.user` est la seule écriture du chemin d'un profil, et
    // `nomDuProfil` la seule mise en forme du nom — celle que l'admin et le
    // serveur emploient déjà. Un second format ici ferait diverger l'en-tête
    // affiché et le nom journalisé.
    expect(CORPS_AUTEUR).toContain('paths.user(uid)');
    expect(CORPS_AUTEUR).toContain('nomDuProfil(');
  });

  it('ne lève pas quand l’identifiant de l’auteur manque', () => {
    // C'est la différence avec `resolveCaller`, et elle est voulue : un
    // déclencheur agit **au nom d'un auteur** dont le profil peut avoir
    // disparu. Un compte supprimé ne doit pas rendre muet le sondage qu'il a
    // préparé — le plan se replie alors sur « La FCPE ».
    expect(CORPS_AUTEUR).toContain('return null');
    expect(CORPS_AUTEUR).not.toContain('throw');
  });
});
