/**
 * À qui un commentaire est notifié, et sous quel libellé.
 *
 * ## Les décisions que ces tests tiennent
 *
 * **La cible.** Un commentaire vise une **personne**, pas une audience. La
 * règle en désigne deux selon le cas : l'auteur de la publication, ou celui du
 * commentaire auquel on répond. Le repli quand le parent a disparu est une
 * décision, pas un accident : rendre `null` serait un silence, et un silence ne
 * se distingue pas d'une panne.
 *
 * **Le type.** `new_comment` et `comment_reply` ne décrivent pas la même règle,
 * et le type est ce que l'historique garde. Les confondre écrirait qu'un
 * commentaire a été publié là où quelqu'un a répondu.
 *
 * **L'audience vide.** Le message ne porte aucune clé d'audience. La remplir
 * ferait décrire au journal un envoi de masse qui n'a pas eu lieu — c'est le
 * champ que l'écran d'administration affiche.
 *
 * ## Pourquoi le lien est éprouvé par `routeForDeeplink`
 *
 * Un lien profond faux n'échoue pas : il ouvre l'écran d'accueil. Vérifier sa
 * forme ne prouverait donc rien. Le test demande à l'application ce qu'elle
 * ferait du lien, et exige une route — c'est-à-dire un écran qui existe
 * vraiment.
 */
import { describe, expect, it } from 'vitest';

import { routeForDeeplink } from '@fl/shared';

import { LONGUEUR_CORPS_NOTIFICATION, extraitNotification } from './post-plan.js';
import {
  commentNotificationPlan,
  commentPushMessage,
  parentIdOf,
  type CommentNotificationContext,
} from './comment-plan.js';

/** Contexte ordinaire : la publication appartient à `u1`, pas de parent. */
const contexte: CommentNotificationContext = {
  orgId: 'fl',
  postTitle: 'Cantine — menus de la semaine',
  postAuthorId: 'u1',
  parentAuthorId: null,
};

/** Commentaire d'un parent sur la publication de `u1`. */
const commentaire = {
  authorId: 'u2',
  authorName: 'Anne Dupont',
  body: 'Super, merci pour l’information !',
  status: 'visible',
  replyCount: 0,
};

/** Réponse au commentaire `c1`, dont l'auteur est `u2`. */
const reponse = { ...commentaire, authorId: 'u3', authorName: 'Karim', parentId: 'c1' };

describe('parentIdOf', () => {
  it('lit un identifiant de parent', () => {
    expect(parentIdOf(reponse)).toBe('c1');
  });

  it('ne confond pas une absence avec un parent vide', () => {
    // Un `parentId` vide ou d'un autre type ne désigne rien : le déclencheur ne
    // doit pas aller lire un document dont le chemin serait « undefined ».
    expect(parentIdOf(commentaire)).toBeNull();
    expect(parentIdOf({ ...commentaire, parentId: '   ' })).toBeNull();
    expect(parentIdOf({ ...commentaire, parentId: 42 })).toBeNull();
    expect(parentIdOf(undefined)).toBeNull();
  });
});

describe('commentNotificationPlan', () => {
  // --- La cible -------------------------------------------------------------

  it('notifie l’auteur de la publication pour un nouveau commentaire', () => {
    const plan = commentNotificationPlan('p1', 'c1', commentaire, contexte);

    expect(plan?.targetUid).toBe('u1');
    expect(plan?.type).toBe('new_comment');
    expect(plan?.category).toBe('discussions');
    expect(plan?.postId).toBe('p1');
    expect(plan?.commentId).toBe('c1');
  });

  it('notifie l’auteur du commentaire parent pour une réponse', () => {
    // Le destinataire change de nature : ce n'est plus le propriétaire du fil,
    // c'est la personne à qui l'on vient de répondre.
    const plan = commentNotificationPlan('p1', 'c2', reponse, {
      ...contexte,
      parentAuthorId: 'u2',
    });

    expect(plan?.targetUid).toBe('u2');
    expect(plan?.type).toBe('comment_reply');
  });

  it('retombe sur l’auteur de la publication si le parent a disparu', () => {
    // `parentId` peut désigner un commentaire masqué ou supprimé entre-temps.
    // Le type reste `comment_reply` — c'est bien une réponse qui a été écrite —
    // mais la cible devient l'autre partie légitime du fil.
    const plan = commentNotificationPlan('p1', 'c2', reponse, contexte);

    expect(plan?.targetUid).toBe('u1');
    expect(plan?.type).toBe('comment_reply');
  });

  // --- On ne se notifie jamais soi-même ------------------------------------

  it('ne notifie pas l’auteur d’un commentaire sur sa propre publication', () => {
    const plan = commentNotificationPlan('p1', 'c1', { ...commentaire, authorId: 'u1' }, contexte);

    expect(plan).toBeNull();
  });

  it('ne notifie pas l’auteur d’une réponse à son propre commentaire', () => {
    const plan = commentNotificationPlan(
      'p1',
      'c2',
      { ...reponse, authorId: 'u2' },
      { ...contexte, parentAuthorId: 'u2' },
    );

    expect(plan).toBeNull();
  });

  it('compare les identifiants, jamais les noms', () => {
    // Deux personnes peuvent porter le même nom. Comparer les noms ferait
    // taire un parent légitime — ou, dans l'autre sens, lui enverrait sa propre
    // notification.
    const plan = commentNotificationPlan(
      'p1',
      'c1',
      { ...commentaire, authorId: 'u2', authorName: 'Soumaya' },
      contexte,
    );

    expect(plan?.targetUid).toBe('u1');
  });

  // --- Quand ne rien envoyer ------------------------------------------------

  it('ignore un commentaire qui n’est pas visible', () => {
    // Les règles imposent `visible` à la création ; la garde couvre ce qu'une
    // migration aurait pu écrire. Notifier pour un commentaire que personne ne
    // peut lire enverrait le parent sur un fil vide.
    for (const status of ['hidden', 'deleted', 'pending']) {
      expect(commentNotificationPlan('p1', 'c1', { ...commentaire, status }, contexte)).toBeNull();
    }
  });

  it('ignore un commentaire supprimé entre-temps', () => {
    expect(commentNotificationPlan('p1', 'c1', undefined, contexte)).toBeNull();
  });

  it('ignore ce qu’il ne peut pas nommer ni situer', () => {
    // Chaque champ manquant rend le plan nul, et aucun ne doit passer pour un
    // envoi à zéro destinataire.
    const cas: readonly [string, Record<string, unknown>, CommentNotificationContext][] = [
      ['corps vide', { ...commentaire, body: '   ' }, contexte],
      ['auteur absent', { ...commentaire, authorId: '' }, contexte],
      ['nom absent', { ...commentaire, authorName: undefined }, contexte],
      ['organisation absente', commentaire, { ...contexte, orgId: null }],
      ['titre absent', commentaire, { ...contexte, postTitle: null }],
      ['publication sans auteur', commentaire, { ...contexte, postAuthorId: null }],
    ];

    for (const [nom, doc, ctx] of cas) {
      expect(commentNotificationPlan('p1', 'c1', doc, ctx), nom).toBeNull();
    }
  });

  // --- Ce que le parent lit -------------------------------------------------

  it('nomme l’auteur dans le corps et garde le fil en titre', () => {
    const plan = commentNotificationPlan('p1', 'c1', commentaire, contexte);

    expect(plan?.title).toBe('Cantine — menus de la semaine');
    expect(plan?.body).toBe('Anne Dupont : Super, merci pour l’information !');
  });

  it('borne le corps à ce qu’un bandeau affiche', () => {
    const plan = commentNotificationPlan(
      'p1',
      'c1',
      { ...commentaire, body: 'mot '.repeat(200) },
      contexte,
    );

    expect(plan?.body).toHaveLength(LONGUEUR_CORPS_NOTIFICATION);
    expect(plan?.body.endsWith('…')).toBe(true);
  });

  it('vise la publication, jamais le commentaire', () => {
    // Un commentaire n'est pas adressable : `DEEPLINK_TARGET_TYPES` ne connaît
    // pas de type `comment`, et le fil de la publication est le seul écran où
    // il se lit.
    const plan = commentNotificationPlan('p1', 'c1', commentaire, contexte);

    expect(plan?.deeplink).toBe('frereslumieres://post/p1');
  });

  it('produit un lien que l’application sait ouvrir', () => {
    // La promesse vérifiée ici n'est pas « le lien a la bonne forme » mais « le
    // tap ouvre un écran ». Les quatre types de cible sans écran seraient
    // reconnus par l'analyse puis refusés à l'ouverture, et le tap laisserait
    // l'application sur son écran d'accueil.
    const plan = commentNotificationPlan('p1', 'c1', commentaire, contexte);

    expect(routeForDeeplink(plan?.deeplink)).toBe('/post/p1');
  });

  it('journalise l’auteur du commentaire comme expéditeur', () => {
    // C'est lui qui a écrit, donc lui qui « envoie » au sens du journal — pas
    // l'auteur de la publication, qui n'a rien fait.
    const plan = commentNotificationPlan('p1', 'c1', commentaire, contexte);

    expect(plan?.authorId).toBe('u2');
    expect(plan?.authorName).toBe('Anne Dupont');
  });
});

describe('commentPushMessage', () => {
  const plan = commentNotificationPlan('p1', 'c1', commentaire, contexte);

  it('ne porte aucune clé d’audience', () => {
    // Le message vise les appareils d'une personne, pas une audience. Remplir
    // ce champ ferait décrire au journal un envoi de masse qui n'a pas eu lieu.
    expect(plan).not.toBeNull();
    expect(commentPushMessage(plan!).audienceKeys).toEqual([]);
  });

  it('ne demande pas la priorité maximale', () => {
    // `discussions` est désactivable, donc ordinaire : la priorité maximale est
    // réservée aux catégories obligatoires.
    expect(commentPushMessage(plan!).priority).toBeUndefined();
  });

  it('transporte de quoi ouvrir le bon contenu', () => {
    expect(commentPushMessage(plan!).data).toEqual({
      type: 'new_comment',
      orgId: 'fl',
      sourceId: 'p1',
      deeplink: 'frereslumieres://post/p1',
    });
  });
});

describe('extraitNotification, employé par les deux plans', () => {
  it('normalise les espaces avant de couper', () => {
    // Le plan du commentaire s'appuie sur l'extrait du plan de publication : le
    // test le fixe ici pour que le déplacer ne se fasse pas en silence.
    expect(extraitNotification('  deux\n\nlignes  ')).toBe('deux lignes');
  });
});
