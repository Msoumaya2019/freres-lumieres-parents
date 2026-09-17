/**
 * Ce que le déclencheur d'un commentaire doit faire, et surtout ne pas faire.
 *
 * ## Pourquoi ces décisions se lisent dans la source
 *
 * Aucune n'est observable par un test de comportement sans émulateur : elles
 * portent sur la **forme** du déclencheur — à quel événement il s'abonne, ce
 * qu'il lit, ce qu'il n'écrit pas. C'est le motif de `send.test.ts` et de
 * `paths.test.ts`, et il est ici d'autant plus justifié que le fichier est
 * court et voué à un seul déclencheur.
 *
 * ## Les trois pièges que ces tests ferment
 *
 * **Le réveil inutile.** S'abonner aux **écritures** du commentaire ferait
 * réveiller le déclencheur à chaque réaction posée : `onCommentReactionWritten`
 * écrit le décompte dans le commentaire. Chaque réaction coûterait alors une
 * invocation pour constater que le statut n'a pas changé. L'abonnement à la
 * création ne les voit pas passer.
 *
 * **La lecture inutile.** Le commentaire parent n'est lu que lorsqu'il y a un
 * `parentId`. Sans cette garde, chaque commentaire d'une publication coûterait
 * la lecture d'un document qui n'existe pas.
 *
 * **Le mensonge du journal.** L'envoi vise une personne. Recopier l'audience de
 * la publication ferait afficher à l'administration « envoyé à toute l'école »
 * pour un envoi à un seul parent — dans la collection même où elle lit ce qui
 * est réellement parti.
 */
import { describe, expect, it } from 'vitest';

import { corpsDeLaFonction, lireSource } from '../test-helpers/source.js';

const CHEMIN = ['functions', 'src', 'triggers', 'comment-notifications.ts'];
const SOURCE = lireSource(CHEMIN);
const CORPS = corpsDeLaFonction(SOURCE, 'notifyCommentAuthor', CHEMIN);

describe('notifyCommentAuthor, sur l’événement écouté', () => {
  it('se déclare sur la création d’un commentaire', () => {
    // Le chemin est écrit en clair parce que Firebase l'exige, et il doit
    // correspondre à la déclaration des règles (`match /comments/{commentId}`
    // sous `match /posts/{postId}`) comme à `paths.comment`.
    expect(CORPS).toContain('onDocumentCreated(');
    expect(CORPS).toContain("document: 'posts/{postId}/comments/{commentId}'");
  });

  it('ne s’abonne pas aux écritures', () => {
    // C'est la décision qui évite d'être réveillé par chaque réaction : le
    // décompte des réactions s'écrit dans le commentaire.
    //
    // L'assertion porte sur le **corps**, pas sur le fichier : l'en-tête
    // explique justement pourquoi `onDocumentWritten` a été écarté, et le
    // citer n'est pas s'y abonner.
    expect(CORPS).not.toContain('onDocumentWritten');
    expect(CORPS).not.toContain('onDocumentUpdated');
  });
});

describe('notifyCommentAuthor, sur ce qu’il lit', () => {
  it('lit toujours la publication', () => {
    // Elle porte l'organisation, le titre et l'auteur — que le commentaire, en
    // sous-collection, ne connaît pas.
    expect(CORPS).toContain('paths.post(postId)');
    expect(CORPS).toContain("post.get('orgId')");
    expect(CORPS).toContain("post.get('title')");
    expect(CORPS).toContain("post.get('authorId')");
  });

  it('ne lit le commentaire parent que s’il y en a un', () => {
    expect(CORPS).toContain('parentId ?');
    expect(CORPS).toContain('paths.comment(postId, parentId)');
    expect(CORPS).toContain("parent?.get('authorId')");
  });
});

describe('notifyCommentAuthor, sur ce qu’il écrit', () => {
  it('ne marque rien dans le commentaire', () => {
    // Le déclencheur de publication écrit `notifiedAt` dans le document qu'il
    // écoute, et c'est cette écriture qu'une seconde garde arrête. Ici, rien
    // n'est écrit : la fonction ne se réveille pas elle-même. Les reprises
    // n'étant pas activées, il n'y a pas non plus de rejeu à couvrir — et une
    // garde qui fonctionnerait demanderait une relecture en base à chaque
    // commentaire.
    expect(CORPS).not.toContain('notifiedAt');
    expect(CORPS).not.toContain('serverTimestamp');
    expect(CORPS).not.toContain('.update(');
    expect(CORPS).not.toContain('.set(');
  });
});

describe('notifyCommentAuthor, sur l’envoi', () => {
  it('vise une personne, désignée par le plan', () => {
    expect(CORPS).toContain('sendToUser(');
    expect(CORPS).toContain('uid: plan.targetUid');
  });

  it('n’inscrit aucune audience dans le journal', () => {
    // `NotificationJournalEntry.audience` est facultative depuis cet incrément,
    // précisément pour ce cas. La remplir ferait décrire un envoi de masse.
    expect(CORPS).not.toContain('audience:');
    expect(CORPS).toContain("sourceType: 'post'");
  });

  it('journalise l’auteur du commentaire comme expéditeur', () => {
    expect(CORPS).toContain('sentBy: plan.authorId');
    expect(CORPS).toContain('sentByName: plan.authorName');
  });

  it('sort sans rien envoyer quand il n’y a rien à envoyer', () => {
    // Le cas le plus fréquent : commentaire de l'auteur sur sa propre
    // publication, commentaire masqué, champ manquant.
    expect(CORPS).toContain('if (!plan) return;');
  });
});
