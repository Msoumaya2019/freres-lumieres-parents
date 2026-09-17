/**
 * Quand une publication déclenche une notification, et avec quoi.
 *
 * ## Le défaut que ces tests empêchent
 *
 * Le déclencheur écoute **toutes** les écritures d'un document `posts`, et il
 * en produit lui-même une — celle qui marque `notifiedAt`. Sans garde, cette
 * écriture relancerait un envoi, qui marquerait à nouveau, et ainsi de suite :
 * chaque parent recevrait la même notification en boucle. Les deux gardes qui
 * l'empêchent sont éprouvées séparément, parce qu'elles ne protègent pas du
 * même cas — le changement de statut couvre l'édition ordinaire, `notifiedAt`
 * couvre le **rejeu** du même événement, que Firestore peut produire seul.
 *
 * ## Le cas qu'un déclencheur de création aurait raté
 *
 * Un brouillon publié plus tard n'est pas une création. C'est la raison du
 * choix d'`onDocumentWritten`, et le premier test le fixe.
 */
import { describe, expect, it } from 'vitest';

import { POST_CATEGORIES } from '@fl/shared';

import {
  LONGUEUR_CORPS_NOTIFICATION,
  extraitNotification,
  postNotificationPlan,
  postPushMessage,
} from './post-plan.js';

/** Publication enregistrée en brouillon. */
const brouillon = {
  orgId: 'fl',
  title: 'Cantine — menus de la semaine',
  body: 'Les menus du 21 au 25 septembre sont disponibles.',
  category: 'cantine',
  audience: { type: 'all' },
  audienceKeys: ['org:fl'],
  authorId: 'u1',
  authorName: 'Soumaya',
  status: 'draft',
};

/** La même, publiée. */
const publie = { ...brouillon, status: 'published' };

describe('postNotificationPlan', () => {
  // --- Quand notifier -------------------------------------------------------

  it('planifie une publication créée directement publiée', () => {
    // Premier des deux chemins : la rédaction et la publication sont un seul
    // geste, donc `before` n'existe pas.
    const plan = postNotificationPlan('p1', undefined, publie);

    expect(plan).not.toBeNull();
    expect(plan?.sourceId).toBe('p1');
    expect(plan?.orgId).toBe('fl');
  });

  it('planifie un brouillon publié plus tard', () => {
    // Second chemin, et c'est celui qu'un déclencheur de création aurait raté :
    // le document existait déjà en brouillon, seule sa mise à jour le publie.
    const plan = postNotificationPlan('p1', brouillon, publie);

    expect(plan).not.toBeNull();
    expect(plan?.sourceId).toBe('p1');
  });

  it('donne la catégorie « publications » à une publication ordinaire', () => {
    const plan = postNotificationPlan('p1', undefined, publie);

    expect(plan?.category).toBe('publications');
    expect(plan?.type).toBe('post_published');
    expect(plan?.priority).toBe('default');
  });

  it('réserve la priorité maximale aux alertes urgentes', () => {
    // La priorité n'est pas décorative : elle décide du canal Android et de la
    // façon dont le système réveille l'appareil.
    const plan = postNotificationPlan('p1', undefined, { ...publie, category: 'urgent' });

    expect(plan?.category).toBe('urgent');
    expect(plan?.type).toBe('urgent_alert');
    expect(plan?.priority).toBe('max');
  });

  it('n’élève en urgence que la catégorie « urgent »', () => {
    // Boucle sur la liste réelle des catégories de publication : une
    // comparaison approximative — préfixe, `includes`, valeur par défaut — ou
    // une catégorie ajoutée demain qui déclencherait l'urgence par accident
    // fait tomber ce test, sans qu'on ait à y penser. `urgent` est une
    // catégorie parmi onze, pas un mot-clé.
    for (const category of POST_CATEGORIES) {
      const plan = postNotificationPlan('p1', undefined, { ...publie, category });
      const urgente = category === 'urgent';

      expect(plan?.category).toBe(urgente ? 'urgent' : 'publications');
      expect(plan?.priority).toBe(urgente ? 'max' : 'default');
      expect(plan?.type).toBe(urgente ? 'urgent_alert' : 'post_published');
    }
  });

  it('construit le lien profond vers la publication', () => {
    const plan = postNotificationPlan('post-abc123', undefined, publie);

    expect(plan?.deeplink).toBe('frereslumieres://post/post-abc123');
  });

  it('reprend le texte de la publication', () => {
    const plan = postNotificationPlan('p1', undefined, publie);

    expect(plan?.title).toBe('Cantine — menus de la semaine');
    expect(plan?.body).toBe('Les menus du 21 au 25 septembre sont disponibles.');
  });

  it('attribue l’envoi à l’auteur de la publication', () => {
    // Le journal d'administration doit pouvoir répondre à « qui a envoyé
    // quoi » : pour un envoi automatique, c'est l'auteur du contenu.
    const plan = postNotificationPlan('p1', undefined, publie);

    expect(plan?.authorId).toBe('u1');
    expect(plan?.authorName).toBe('Soumaya');
  });

  // --- Quand ne rien faire --------------------------------------------------

  it('ne planifie rien pour une publication déjà publiée', () => {
    // Le cas le plus fréquent en production : c'est l'écriture de `notifiedAt`
    // elle-même, et toute correction ultérieure de la publication. Sans cette
    // garde, le déclencheur se rappellerait indéfiniment.
    expect(postNotificationPlan('p1', publie, publie)).toBeNull();
    expect(postNotificationPlan('p1', publie, { ...publie, title: 'Corrigé' })).toBeNull();
  });

  it('ne planifie rien pour une publication retirée ou archivée', () => {
    for (const status of ['hidden', 'deleted', 'archived']) {
      expect(postNotificationPlan('p1', publie, { ...publie, status })).toBeNull();
    }
  });

  it('ne planifie rien pour un brouillon retiré avant publication', () => {
    // Le cas que la garde « déjà publiée » ne couvre **pas** : le document n'a
    // jamais été publié, donc seule la condition de statut l'arrête. Sans elle,
    // une publication masquée serait notifiée — une notification pour un
    // contenu que personne ne peut lire.
    //
    // Ce test manquait, et c'est la mutation qui l'a montré : neutraliser la
    // condition de statut ne faisait tomber aucun test, parce que le test
    // ci-dessus part d'une publication déjà publiée et se faisait arrêter par
    // la garde voisine.
    for (const status of ['hidden', 'deleted', 'archived']) {
      expect(postNotificationPlan('p1', brouillon, { ...brouillon, status })).toBeNull();
    }
  });

  it('ne planifie rien si le document a déjà été notifié', () => {
    // La garde de rejeu, indépendante de la précédente : un événement rejoué
    // après incident présente `before.status == 'draft'` **et**
    // `after.notifiedAt` posé. Seule cette condition l'arrête.
    const dejaNotifiee = { ...publie, notifiedAt: new Date('2026-09-17T10:00:00Z') };

    expect(postNotificationPlan('p1', brouillon, dejaNotifiee)).toBeNull();
  });

  it('ne planifie rien pour une publication supprimée', () => {
    expect(postNotificationPlan('p1', publie, undefined)).toBeNull();
  });

  it('ne planifie rien sans audience', () => {
    // Une publication sans clé ne concerne personne. Écrire un envoi à zéro
    // destinataire ferait croire à un échec, alors qu'il n'y avait rien à
    // envoyer.
    expect(postNotificationPlan('p1', undefined, { ...publie, audienceKeys: [] })).toBeNull();
    expect(
      postNotificationPlan('p1', undefined, { ...publie, audienceKeys: undefined }),
    ).toBeNull();
    expect(postNotificationPlan('p1', undefined, { ...publie, audienceKeys: 'org:fl' })).toBeNull();
  });

  it('ne planifie rien si le titre, le corps ou l’auteur manque', () => {
    // Chaque champ absent est une notification qui s'afficherait vide, ou un
    // journal sans auteur. Mieux vaut ne rien envoyer, et le journaliser.
    for (const champ of ['title', 'body', 'authorId', 'authorName', 'orgId']) {
      expect(postNotificationPlan('p1', undefined, { ...publie, [champ]: undefined })).toBeNull();
      expect(postNotificationPlan('p1', undefined, { ...publie, [champ]: '   ' })).toBeNull();
    }
  });

  it('ne planifie rien si l’audience est illisible', () => {
    for (const audience of [undefined, null, {}, { type: 'inconnu' }, 'all', 42]) {
      expect(postNotificationPlan('p1', undefined, { ...publie, audience })).toBeNull();
    }
  });
});

describe('extraitNotification', () => {
  it('laisse intact un texte court', () => {
    expect(extraitNotification('Bonjour.')).toBe('Bonjour.');
  });

  it('normalise les espaces avant de couper', () => {
    // Un paragraphe qui commence par trois retours à la ligne afficherait
    // sinon un bandeau vide sur deux lignes.
    expect(extraitNotification('  Bonjour\n\n  à tous.  ')).toBe('Bonjour à tous.');
  });

  it('tronque un texte trop long, et le montre', () => {
    const long = 'a'.repeat(LONGUEUR_CORPS_NOTIFICATION + 50);
    const extrait = extraitNotification(long);

    expect(extrait).toHaveLength(LONGUEUR_CORPS_NOTIFICATION);
    expect(extrait.endsWith('…')).toBe(true);
  });

  it('ne coupe pas un texte qui tient exactement', () => {
    // La borne est inclusive : à un caractère près, un texte ne doit pas être
    // tronqué sans raison.
    const exact = 'a'.repeat(LONGUEUR_CORPS_NOTIFICATION);
    const extrait = extraitNotification(exact);

    expect(extrait).toBe(exact);
    expect(extrait.endsWith('…')).toBe(false);
  });
});

describe('postPushMessage', () => {
  it('transporte de quoi ouvrir le contenu', () => {
    const plan = postNotificationPlan('p1', undefined, publie);
    const message = plan ? postPushMessage(plan) : null;

    expect(message?.data).toEqual({
      type: 'post_published',
      orgId: 'fl',
      sourceId: 'p1',
      deeplink: 'frereslumieres://post/p1',
    });
  });

  it('ne transporte rien de plus que le nécessaire', () => {
    // Chaque champ de `data` est une copie de plus à garder d'accord avec le
    // document d'origine, sans que rien ne le vérifie.
    const plan = postNotificationPlan('p1', undefined, publie);
    const message = plan ? postPushMessage(plan) : null;

    expect(Object.keys(message?.data ?? {}).sort()).toEqual([
      'deeplink',
      'orgId',
      'sourceId',
      'type',
    ]);
  });

  it('reporte la priorité décidée par le plan', () => {
    const plan = postNotificationPlan('p1', undefined, { ...publie, category: 'urgent' });
    const message = plan ? postPushMessage(plan) : null;

    expect(message?.priority).toBe('max');
  });
});
