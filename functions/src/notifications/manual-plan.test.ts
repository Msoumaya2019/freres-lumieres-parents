/**
 * Ce que produit une annonce écrite à la main.
 *
 * ## Les deux décisions que ces tests fixent
 *
 *  - **le type ne dit pas l'urgence.** Une annonce urgente reste
 *    `manual_announcement` et porte `category: 'urgent'`. Emprunter
 *    `urgent_alert` ferait écrire dans l'historique qu'une publication a été
 *    créée, alors que personne n'a publié — et l'écran d'historique n'aurait
 *    plus les moyens de distinguer une annonce du bureau d'un fil de classe ;
 *  - **l'organisation vient de l'appelant.** Le schéma ne porte aucun `orgId`,
 *    donc le plan ne peut pas en lire un : le test vérifie que la clé d'audience
 *    est celle du profil, y compris quand rien dans l'entrée ne la désigne.
 *
 * ## Ce qui n'est pas testé ici
 *
 * L'envoi lui-même. Le plan est pur et couvre la décision ; la plomberie
 * Firestore et réseau de `sendToAudience` demande un émulateur.
 */
import { describe, expect, it } from 'vitest';

import type { NotificationSendInput } from '@fl/shared';

import { LONGUEUR_CORPS_NOTIFICATION, extraitNotification } from './post-plan.js';
import {
  TYPE_ANNONCE_MANUELLE,
  manualNotificationPlan,
  manualPushMessage,
  type ManualCaller,
} from './manual-plan.js';

const APPELANT: ManualCaller = { uid: 'u1', name: 'Soumaya B.', orgId: 'fl' };

/** Une annonce valide, telle que le schéma la rend après validation. */
function annonce(modifications: Partial<NotificationSendInput> = {}): NotificationSendInput {
  return {
    title: 'Fermeture de l’école',
    body: 'L’école sera fermée vendredi.',
    category: 'publications',
    audience: { type: 'all' },
    ...modifications,
  };
}

describe('manualNotificationPlan', () => {
  it('cible l’organisation de l’appelant, et pas celle de la requête', () => {
    // Le schéma ne porte pas d'`orgId` : il n'y a rien à lire dans l'entrée, et
    // c'est précisément ce qui met la frontière d'organisation hors de portée
    // du client.
    const plan = manualNotificationPlan(annonce(), { ...APPELANT, orgId: 'autre' });

    expect(plan?.orgId).toBe('autre');
    expect(plan?.audienceKeys).toEqual(['org:autre']);
  });

  it('traduit chaque type d’audience en clés', () => {
    const cas: readonly (readonly [NotificationSendInput['audience'], readonly string[]])[] = [
      [{ type: 'all' }, ['org:fl']],
      [{ type: 'school', schoolId: 'ecole-a' }, ['school:ecole-a']],
      [{ type: 'level', schoolId: 'ecole-a', level: 'CE1' }, ['level:ecole-a:CE1']],
      [{ type: 'class', classId: 'ce1-a' }, ['class:ce1-a']],
      [{ type: 'fcpe' }, ['fcpe:fl']],
    ];

    for (const [audience, attendu] of cas) {
      const plan = manualNotificationPlan(annonce({ audience }), APPELANT);
      expect(plan?.audienceKeys, `audience ${audience.type}`).toEqual(attendu);
    }
  });

  it('rend null plutôt qu’un envoi à zéro destinataire', () => {
    // Le schéma exige `schoolId` pour une audience `school` : ce cas ne peut
    // donc pas venir d'une requête validée. Le plan ne le suppose pas, et la
    // conversion est là pour éprouver la branche — sans elle, la seule façon de
    // la couvrir serait de la retirer.
    const sansIdentifiant = { type: 'school' } as unknown as NotificationSendInput['audience'];

    expect(manualNotificationPlan(annonce({ audience: sansIdentifiant }), APPELANT)).toBeNull();
  });

  it('coupe le corps, et journalise la version envoyée', () => {
    const long = `${'Un paragraphe très long. '.repeat(20)}fin`;
    const plan = manualNotificationPlan(annonce({ body: long }), APPELANT);

    expect(plan?.body).toBe(extraitNotification(long));
    expect(plan?.body.length).toBeLessThanOrEqual(LONGUEUR_CORPS_NOTIFICATION);
    expect(plan?.body.endsWith('…')).toBe(true);
  });

  it('ne réveille un téléphone que pour la catégorie obligatoire', () => {
    const ordinaire = manualNotificationPlan(annonce(), APPELANT);
    const urgente = manualNotificationPlan(annonce({ category: 'urgent' }), APPELANT);

    expect(ordinaire?.priority).toBe('default');
    expect(urgente?.priority).toBe('max');
  });

  it('garde le type d’annonce, même urgente', () => {
    const plan = manualNotificationPlan(annonce({ category: 'urgent' }), APPELANT);
    const message = manualPushMessage(plan!);

    expect(message.data.type).toBe(TYPE_ANNONCE_MANUELLE);
    expect(message.data.type).not.toBe('urgent_alert');
    expect(message.category).toBe('urgent');
  });

  it('porte l’auteur, pour que l’envoi soit attribuable', () => {
    const plan = manualNotificationPlan(annonce(), APPELANT);

    expect(plan?.sentBy).toBe('u1');
    expect(plan?.sentByName).toBe('Soumaya B.');
  });
});

describe('manualPushMessage', () => {
  it('n’invente pas de sourceId', () => {
    // Une annonce ne se rattache à aucun contenu. Un `sourceId` fabriqué
    // écrirait dans l'historique une référence qui ne désigne rien.
    const message = manualPushMessage(manualNotificationPlan(annonce(), APPELANT)!);

    expect(message.data).not.toHaveProperty('sourceId');
  });

  it('ne pose pas de lien profond quand il n’y en a pas', () => {
    const message = manualPushMessage(manualNotificationPlan(annonce(), APPELANT)!);

    expect(message.data).not.toHaveProperty('deeplink');
  });

  it('transmet le lien profond quand il y en a un', () => {
    const plan = manualNotificationPlan(
      annonce({ deeplink: 'frereslumieres://post/p1' }),
      APPELANT,
    );

    expect(manualPushMessage(plan!).data.deeplink).toBe('frereslumieres://post/p1');
  });

  it('reprend titre, corps, catégorie et audience', () => {
    const plan = manualNotificationPlan(
      annonce({ audience: { type: 'class', classId: 'ce1-a' } }),
      APPELANT,
    );
    const message = manualPushMessage(plan!);

    expect(message.title).toBe('Fermeture de l’école');
    expect(message.body).toBe('L’école sera fermée vendredi.');
    expect(message.category).toBe('publications');
    expect(message.audienceKeys).toEqual(['class:ce1-a']);
    expect(message.data.orgId).toBe('fl');
  });
});
