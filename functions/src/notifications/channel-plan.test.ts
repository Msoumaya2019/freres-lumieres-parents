/**
 * Comment un canal regroupe ses messages, et ce qu'il en annonce.
 *
 * ## Les décisions que ces tests tiennent
 *
 * **La fenêtre ne glisse pas.** `flushAt` est fixé à l'ouverture du lot et n'est
 * plus repoussé. Le repousser à chaque message ferait qu'un canal bavard ne
 * serait jamais annoncé — la fenêtre glisserait indéfiniment. C'est la décision
 * la plus facile à casser sans qu'aucun test ne s'en aperçoive, puisqu'un lot
 * qui ne part jamais ne produit aucune erreur.
 *
 * **Un message seul prévient quand même les autres.** C'est la décision
 * centrale du regroupement. « On ne se notifie jamais soi-même » s'écrivait
 * jusqu'ici comme un abandon d'envoi ; ici, renoncer éteindrait la notification
 * pour tout le monde, et le demandeur n'obtiendrait aucune réponse parce qu'il a
 * posé sa question. La règle est donc déplacée vers `excludeUids`.
 *
 * **Le compte est celui des messages relus.** Un message masqué pendant la
 * fenêtre ne compte plus : annoncer « 3 nouveaux messages » sous un canal qui
 * n'en montre que deux enverrait les parents chercher ce qui n'est pas là.
 *
 * **Aucun lien profond.** Le type `channel` existe mais n'a pas d'écran — il
 * est déclaré dans `TYPES_SANS_ROUTE`. Un lien de ce type serait reconnu par
 * l'analyse puis refusé à l'ouverture : le tap laisserait l'application où elle
 * est. Le test vérifie l'**absence**, et c'est le seul endroit où l'absence est
 * la bonne réponse.
 */
import { describe, expect, it } from 'vitest';

import { DEEPLINK_TARGET_TYPES, TYPES_SANS_ROUTE } from '@fl/shared';

import { DIGEST_WINDOW_MINUTES, channelDigestPlan, digestNotification } from './channel-plan.js';

/** Instant de référence, fixe : une horloge réelle rendrait les tests instables. */
const MAINTENANT = new Date('2026-09-17T20:00:00.000Z');

/** Canal ordinaire, visible, dont l'audience est la classe de CE1. */
const canal = {
  orgId: 'fl',
  name: 'CE1',
  type: 'class',
  audience: { type: 'class', classId: 'ce1' },
  audienceKeys: ['org:fl', 'class:ce1'],
  status: 'visible',
};

/** Message ordinaire, écrit par `u2`. */
const message = {
  authorId: 'u2',
  authorName: 'Anne Dupont',
  body: 'Qui peut aider pour la sortie de jeudi ?',
  status: 'visible',
};

describe('channelDigestPlan — l’état du lot', () => {
  it('ouvre un lot sur le premier message, et fixe la fenêtre', () => {
    const plan = channelDigestPlan('ce1', 'm1', message, canal, undefined, MAINTENANT);

    expect(plan).not.toBeNull();
    expect(plan?.messageIds).toEqual(['m1']);
    expect(plan?.orgId).toBe('fl');
    expect(plan?.channelId).toBe('ce1');
    expect(plan?.flushAt.getTime()).toBe(MAINTENANT.getTime() + DIGEST_WINDOW_MINUTES * 60_000);
  });

  it('ajoute un message à la fenêtre ouverte sans la repousser', () => {
    const ouvert = channelDigestPlan('ce1', 'm1', message, canal, undefined, MAINTENANT);
    expect(ouvert).not.toBeNull();

    // Deux minutes plus tard : la fenêtre court toujours.
    const plusTard = new Date(MAINTENANT.getTime() + 2 * 60_000);
    const suivant = channelDigestPlan(
      'ce1',
      'm2',
      { ...message, authorId: 'u3', authorName: 'Karim' },
      canal,
      { messageIds: ouvert?.messageIds, flushAt: ouvert?.flushAt },
      plusTard,
    );

    expect(suivant?.messageIds).toEqual(['m1', 'm2']);
    // La décision : la fenêtre n'a pas bougé, malgré le nouveau message.
    expect(suivant?.flushAt.getTime()).toBe(ouvert?.flushAt.getTime());
  });

  it('rouvre une fenêtre quand la précédente est écoulée', () => {
    const ecoule = new Date(MAINTENANT.getTime() - 60_000);
    const suivant = channelDigestPlan(
      'ce1',
      'm9',
      message,
      canal,
      { messageIds: ['m1', 'm2'], flushAt: ecoule },
      MAINTENANT,
    );

    // Les anciens messages sont conservés — ils n'ont jamais été annoncés — mais
    // la fenêtre repart de maintenant.
    expect(suivant?.messageIds).toEqual(['m1', 'm2', 'm9']);
    expect(suivant?.flushAt.getTime()).toBe(MAINTENANT.getTime() + DIGEST_WINDOW_MINUTES * 60_000);
  });

  it('ignore un message déjà compté, livré deux fois', () => {
    const existant = {
      messageIds: ['m1', 'm2'],
      flushAt: new Date(MAINTENANT.getTime() + 3 * 60_000),
    };

    expect(channelDigestPlan('ce1', 'm2', message, canal, existant, MAINTENANT)).toBeNull();
  });

  it('n’ouvre pas de lot pour un message masqué', () => {
    const masque = { ...message, status: 'hidden' };
    expect(channelDigestPlan('ce1', 'm1', masque, canal, undefined, MAINTENANT)).toBeNull();
  });

  it('n’ouvre pas de lot dans un canal masqué', () => {
    const retire = { ...canal, status: 'hidden' };
    expect(channelDigestPlan('ce1', 'm1', message, retire, undefined, MAINTENANT)).toBeNull();
  });

  it('n’ouvre pas de lot quand le canal n’a pas d’organisation', () => {
    const sansOrg = { ...canal, orgId: undefined };
    expect(channelDigestPlan('ce1', 'm1', message, sansOrg, undefined, MAINTENANT)).toBeNull();
  });

  it('n’ouvre pas de lot quand le canal a disparu', () => {
    expect(channelDigestPlan('ce1', 'm1', message, undefined, undefined, MAINTENANT)).toBeNull();
  });

  it('lit la fenêtre d’un lot existant écrite en Timestamp Firestore', () => {
    const echeance = new Date(MAINTENANT.getTime() + 4 * 60_000);
    // Forme rendue par Firestore : un objet qui sait se convertir en Date.
    const existant = { messageIds: ['m1'], flushAt: { toDate: () => echeance } };

    const suivant = channelDigestPlan('ce1', 'm2', message, canal, existant, MAINTENANT);

    expect(suivant?.flushAt.getTime()).toBe(echeance.getTime());
  });

  it('rouvre une fenêtre quand l’échéance du lot est illisible', () => {
    const existant = { messageIds: ['m1'], flushAt: 'jeudi' };
    const suivant = channelDigestPlan('ce1', 'm2', message, canal, existant, MAINTENANT);

    // Un `flushAt` illisible ne doit pas faire lever : il doit rouvrir une
    // fenêtre. Sans quoi un document abîmé bloquerait le canal pour toujours.
    expect(suivant?.flushAt.getTime()).toBe(MAINTENANT.getTime() + DIGEST_WINDOW_MINUTES * 60_000);
  });
});

describe('digestNotification — l’annonce du lot', () => {
  /** Deux messages, deux auteurs différents. */
  const deuxAuteurs = [message, { ...message, authorId: 'u3', authorName: 'Karim' }];

  it('annonce le nombre de messages relus', () => {
    const plan = digestNotification('ce1', canal, deuxAuteurs);

    expect(plan?.count).toBe(2);
    expect(plan?.message.title).toBe('CE1');
    expect(plan?.message.body).toBe('2 nouveaux messages');
    expect(plan?.message.category).toBe('discussions');
    expect(plan?.message.data.type).toBe('new_message');
  });

  it('annonce un message seul, et exclut son auteur', () => {
    const plan = digestNotification('ce1', canal, [message]);

    // Le corps s'accorde au singulier…
    expect(plan?.message.body).toBe('Nouveau message');
    // …et l'auteur est retiré des destinataires : les autres sont prévenus.
    expect(plan?.excludeUids).toEqual(['u2']);
  });

  it('exclut tous les auteurs du lot, sans doublon', () => {
    const plan = digestNotification('ce1', canal, [
      message,
      { ...message, authorId: 'u3', authorName: 'Karim' },
      { ...message, authorId: 'u2', authorName: 'Anne Dupont' },
    ]);

    expect(plan?.excludeUids).toEqual(['u2', 'u3']);
    expect(plan?.count).toBe(3);
  });

  it('ne compte que les messages encore visibles', () => {
    const plan = digestNotification('ce1', canal, [
      message,
      { ...message, authorId: 'u3', authorName: 'Karim', status: 'hidden' },
    ]);

    expect(plan?.count).toBe(1);
    expect(plan?.excludeUids).toEqual(['u2']);
  });

  it('n’annonce rien quand plus rien n’est visible', () => {
    const plan = digestNotification('ce1', canal, [
      { ...message, status: 'hidden' },
      { ...message, status: 'deleted' },
    ]);

    expect(plan).toBeNull();
  });

  it('n’annonce rien quand le canal a disparu ou a été masqué', () => {
    expect(digestNotification('ce1', undefined, [message])).toBeNull();
    expect(digestNotification('ce1', { ...canal, status: 'hidden' }, [message])).toBeNull();
  });

  it('n’annonce rien sans nom de canal', () => {
    // Un lot qu'on ne peut pas nommer ne peut pas être annoncé : le bandeau
    // dirait « Nouveau message » sans dire où.
    expect(digestNotification('ce1', { ...canal, name: '  ' }, [message])).toBeNull();
  });

  it('reporte les clés d’audience du canal, et rien d’autre', () => {
    const plan = digestNotification(
      'ce1',
      { ...canal, audienceKeys: ['org:fl', '', 'class:ce1'] },
      [message],
    );

    // La clé vide est écartée : elle ne recoupe rien.
    expect(plan?.message.audienceKeys).toEqual(['org:fl', 'class:ce1']);
  });

  it('nomme le dernier auteur lisible du lot', () => {
    const plan = digestNotification('ce1', canal, [
      message,
      { ...message, authorId: 'u3', authorName: 'Karim' },
    ]);

    // Le journal d'un envoi groupé n'a pas d'auteur unique : il en désigne un,
    // le dernier du lot, et il doit être lisible.
    expect(plan?.authorId).toBe('u3');
    expect(plan?.authorName).toBe('Karim');
  });

  it('remonte le lot jusqu’au dernier auteur lisible', () => {
    const plan = digestNotification('ce1', canal, [
      message,
      { ...message, authorId: 'u3', authorName: '' },
    ]);

    // Le nom du dernier message manque : on remonte au précédent plutôt que
    // d'abandonner le lot — un nom manquant ferait taire une discussion.
    expect(plan?.authorId).toBe('u2');
    expect(plan?.authorName).toBe('Anne Dupont');
  });

  it('n’emporte aucun lien profond, parce qu’aucun écran ne l’ouvrirait', () => {
    const plan = digestNotification('ce1', canal, [message]);

    expect(plan?.message.data.deeplink).toBeUndefined();

    // Ce que le test protège : `channel` est un type de cible connu, mais il
    // n'a pas de route. Le jour où l'écran existera, `TYPES_SANS_ROUTE` perdra
    // sa ligne et c'est ici qu'il faudra écrire le lien.
    expect(DEEPLINK_TARGET_TYPES).toContain('channel');
    expect(TYPES_SANS_ROUTE.channel).toBeDefined();
  });
});
