/**
 * Quand un sondage déclenche une notification, et avec quoi.
 *
 * ## Les deux chemins vers l'ouverture, et pourquoi un seul suffit
 *
 * Un sondage peut naître `open` — publié d'un seul geste — ou le devenir : un
 * brouillon préparé la veille pour le lendemain, que la FCPE ouvre plus tard.
 * C'est la raison d'`onDocumentWritten` côté déclencheur, et c'est cette
 * fonction qui ramène les deux cas à une seule règle : le statut **devient**
 * `open`. Les deux premiers tests fixent chacun des deux chemins ; un
 * déclencheur de création aurait raté le second, un déclencheur de mise à jour
 * le premier.
 *
 * ## Les trois gardes ne protègent pas du même cas
 *
 * Le déclencheur écrit `notifiedAt` dans le document qu'il écoute, donc il est
 * rappelé. Chaque garde est éprouvée séparément, et pour une raison :
 *
 *  - le **changement de statut** arrête l'écriture ordinaire — une clôture, une
 *    correction de question, le balayage planifié ;
 *  - `notifiedAt` arrête le **rejeu** du même événement, que Firestore peut
 *    produire seul ;
 *  - `notifiedAt` arrête aussi la **réouverture**, que la garde de transition
 *    laisse passer — `closed` puis `open` — et c'est le cas qu'un test de rejeu
 *    ne couvre pas : il part d'un brouillon, pas d'un sondage déjà parti.
 */
import { describe, expect, it } from 'vitest';

import { formatDateTime } from '@fl/shared';

import {
  AUTEUR_PAR_DEFAUT,
  CORPS_SANS_PRECISION,
  corpsDuSondage,
  pollNotificationPlan,
  pollPushMessage,
} from './poll-plan.js';
import { LONGUEUR_CORPS_NOTIFICATION } from './post-plan.js';

/** Sondage publié d'un seul geste : le statut naît `open`. */
const ouvert = {
  orgId: 'fl',
  question: 'Faut-il maintenir la kermesse ?',
  description: 'Le conseil d’école en discute le 2 octobre.',
  options: [
    { id: 'yes', label: 'Oui' },
    { id: 'no', label: 'Non' },
  ],
  status: 'open',
  audience: { type: 'all' },
  audienceKeys: ['org:fl'],
  createdBy: 'u1',
};

/** Le même, enregistré en brouillon : le second chemin vers l'ouverture. */
const brouillon = { ...ouvert, status: 'draft' };

/** Nom de l'auteur, tel que le déclencheur le lit sur le profil. */
const contexte = { authorName: 'Soumaya' };

describe('pollNotificationPlan', () => {
  // --- Quand notifier -------------------------------------------------------

  it('planifie un sondage créé directement ouvert', () => {
    // Premier des deux chemins : la rédaction et la publication sont un seul
    // geste, donc `before` n'existe pas.
    const plan = pollNotificationPlan('p1', undefined, ouvert, contexte);

    expect(plan).not.toBeNull();
    expect(plan?.sourceId).toBe('p1');
    expect(plan?.orgId).toBe('fl');
  });

  it('planifie un brouillon ouvert plus tard', () => {
    // Second chemin, et c'est celui qu'un déclencheur de création aurait raté :
    // le document existait déjà en brouillon, seule sa mise à jour l'ouvre.
    const plan = pollNotificationPlan('p1', brouillon, ouvert, contexte);

    expect(plan).not.toBeNull();
    expect(plan?.sourceId).toBe('p1');
  });

  it('donne la catégorie « sondages » et le type « new_poll »', () => {
    // `new_poll` est le **seul** type qu'un sondage produise :
    // `NotificationType` n'en prévoit pas d'autre, et annoncer une clôture
    // sous ce type ferait mentir l'historique des envois.
    const plan = pollNotificationPlan('p1', undefined, ouvert, contexte);

    expect(plan?.category).toBe('sondages');
    expect(plan?.type).toBe('new_poll');
  });

  it('ne demande pas la priorité maximale', () => {
    // `sondages` n'est pas une catégorie obligatoire : l'envoi part en priorité
    // normale, et un parent qui a coupé la catégorie ne le reçoit pas. C'est le
    // but d'une préférence, et `filterRecipients` s'en charge.
    const plan = pollNotificationPlan('p1', undefined, ouvert, contexte);

    expect(plan && pollPushMessage(plan).priority).toBeUndefined();
  });

  it('construit le lien profond vers le sondage', () => {
    const plan = pollNotificationPlan('sondage-abc123', undefined, ouvert, contexte);

    expect(plan?.deeplink).toBe('frereslumieres://poll/sondage-abc123');
  });

  it('reprend la question comme titre', () => {
    // Et non un libellé générique : « Nouveau sondage » forcerait le parent à
    // ouvrir l'application pour savoir de quoi il retourne.
    const plan = pollNotificationPlan('p1', undefined, ouvert, contexte);

    expect(plan?.title).toBe('Faut-il maintenir la kermesse ?');
  });

  it('porte l’audience du sondage', () => {
    const plan = pollNotificationPlan('p1', undefined, ouvert, contexte);

    expect(plan?.audience).toEqual({ type: 'all' });
    expect(plan?.audienceKeys).toEqual(['org:fl']);
  });

  it('attribue l’envoi à l’auteur du sondage', () => {
    // Le journal d'administration doit pouvoir répondre à « qui a envoyé
    // quoi » : pour un envoi automatique, c'est l'auteur du contenu.
    const plan = pollNotificationPlan('p1', undefined, ouvert, contexte);

    expect(plan?.authorId).toBe('u1');
    expect(plan?.authorName).toBe('Soumaya');
  });

  it('se replie sur « La FCPE » quand le profil de l’auteur a disparu', () => {
    // Le sondage est celui de l'**association**, pas d'une personne : un compte
    // supprimé ne doit pas rendre muet le sondage qu'il a préparé. L'absence de
    // nom n'est donc pas une raison de ne rien envoyer — le journal, lui,
    // exige un nom, et c'est ce repli qui le fournit.
    for (const authorName of [undefined, null, '', '   ', 42, {}]) {
      const plan = pollNotificationPlan('p1', undefined, ouvert, { authorName });

      expect(plan?.authorName).toBe(AUTEUR_PAR_DEFAUT);
    }
  });

  // --- Quand ne rien faire --------------------------------------------------

  it('ne planifie rien pour un sondage déjà ouvert', () => {
    // Le cas le plus fréquent en production : c'est l'écriture de `notifiedAt`
    // elle-même, et toute correction ultérieure du sondage. Sans cette garde,
    // le déclencheur se rappellerait indéfiniment.
    expect(pollNotificationPlan('p1', ouvert, ouvert, contexte)).toBeNull();
    expect(
      pollNotificationPlan('p1', ouvert, { ...ouvert, question: 'Corrigée' }, contexte),
    ).toBeNull();
  });

  it('ne planifie rien à la clôture', () => {
    // La clôture ne notifie pas, et ce n'est pas un oubli : `new_poll` est le
    // seul type disponible, et l'employer ferait mentir l'historique des
    // envois. Le balayage planifié comme la clôture manuelle passent par ici.
    expect(
      pollNotificationPlan('p1', ouvert, { ...ouvert, status: 'closed' }, contexte),
    ).toBeNull();
  });

  it('ne planifie rien pour un statut qui n’ouvre pas', () => {
    for (const status of ['draft', 'closed', 'archived']) {
      expect(pollNotificationPlan('p1', undefined, { ...ouvert, status }, contexte)).toBeNull();
      expect(pollNotificationPlan('p1', brouillon, { ...ouvert, status }, contexte)).toBeNull();
    }
  });

  it('ne planifie rien si le document a déjà été notifié', () => {
    // La garde de rejeu, indépendante de la précédente : un événement rejoué
    // après incident présente `before.status == 'draft'` **et**
    // `after.notifiedAt` posé. Seule cette condition l'arrête.
    const dejaNotifie = { ...ouvert, notifiedAt: new Date('2026-09-10T08:00:00Z') };

    expect(pollNotificationPlan('p1', brouillon, dejaNotifie, contexte)).toBeNull();
  });

  it('ne planifie rien pour un sondage rouvert', () => {
    // Le cas que la garde de rejeu ne couvre **pas** : `closed` puis `open` est
    // une vraie transition de statut, donc elle franchit la première garde.
    // Seul `notifiedAt` l'arrête — et sans lui, un aller-retour de statut
    // renverrait la même notification à toute l'audience.
    const rouvert = { ...ouvert, notifiedAt: new Date('2026-09-10T08:00:00Z') };

    expect(
      pollNotificationPlan('p1', { ...ouvert, status: 'closed' }, rouvert, contexte),
    ).toBeNull();
  });

  it('ne planifie rien pour un sondage supprimé', () => {
    expect(pollNotificationPlan('p1', ouvert, undefined, contexte)).toBeNull();
  });

  it('ne planifie rien sans audience', () => {
    // Une audience vide ne concerne personne. Écrire un envoi à zéro
    // destinataire ferait croire à un échec, alors qu'il n'y avait rien à
    // envoyer.
    for (const audienceKeys of [[], undefined, null, 'org:fl', 42]) {
      expect(
        pollNotificationPlan('p1', undefined, { ...ouvert, audienceKeys }, contexte),
      ).toBeNull();
    }
  });

  it('ne planifie rien si l’audience est illisible', () => {
    for (const audience of [undefined, null, {}, { type: 'inconnu' }, 'all', 42]) {
      expect(pollNotificationPlan('p1', undefined, { ...ouvert, audience }, contexte)).toBeNull();
    }
  });

  it('ne planifie rien si la question, l’organisation ou l’auteur manque', () => {
    // Chaque champ absent est une notification qui s'afficherait vide, ou un
    // journal sans auteur. Mieux vaut ne rien envoyer, et le journaliser.
    for (const champ of ['question', 'orgId', 'createdBy']) {
      expect(
        pollNotificationPlan('p1', undefined, { ...ouvert, [champ]: undefined }, contexte),
      ).toBeNull();
      expect(
        pollNotificationPlan('p1', undefined, { ...ouvert, [champ]: '   ' }, contexte),
      ).toBeNull();
    }
  });

  it('écarte les clés d’audience qui ne sont pas des chaînes', () => {
    // Le champ sort de Firestore, dont les valeurs ne sont garanties par rien.
    // Une clé non textuelle ferait échouer la requête de jetons au milieu de
    // l'envoi, après le journal.
    const plan = pollNotificationPlan(
      'p1',
      undefined,
      { ...ouvert, audienceKeys: ['org:fl', 42, '', null, 'class:cm2'] },
      contexte,
    );

    expect(plan?.audienceKeys).toEqual(['org:fl', 'class:cm2']);
  });
});

describe('corpsDuSondage', () => {
  it('reprend la description du sondage', () => {
    // Ce que la FCPE a écrit pour être lu passe avant tout le reste.
    expect(corpsDuSondage(ouvert)).toBe('Le conseil d’école en discute le 2 octobre.');
  });

  it('normalise et tronque une description trop longue', () => {
    const long = `  ${'a'.repeat(400)}\n\n  `;
    const corps = corpsDuSondage({ ...ouvert, description: long });

    expect(corps).toHaveLength(LONGUEUR_CORPS_NOTIFICATION);
    expect(corps.endsWith('…')).toBe(true);
  });

  it('annonce la date de clôture quand il n’y a pas de description', () => {
    // La seule information qui aide un parent à décider **quand** répondre, et
    // elle vient du document. Le libellé est comparé à ce que rend le formateur
    // partagé : c'est lui que les écrans emploient pour la même échéance, et
    // deux formats divergeraient.
    const echeance = new Date('2026-10-02T20:00:00Z');
    const corps = corpsDuSondage({ ...ouvert, description: undefined, endsAt: echeance });

    expect(corps).toBe(`Clôture le ${formatDateTime(echeance)}`);
  });

  it('se replie sur une invitation neutre, et ne promet rien de plus', () => {
    // Sans description ni échéance, il ne reste rien à dire du sondage. Le
    // repli est une invitation, pas une promesse : il n'annonce aucune date
    // qu'un parent pourrait croire tenue.
    expect(corpsDuSondage({ ...ouvert, description: undefined })).toBe(CORPS_SANS_PRECISION);
    expect(corpsDuSondage({ ...ouvert, description: '  ' })).toBe(CORPS_SANS_PRECISION);
  });

  it('lit une échéance écrite en chaîne ISO', () => {
    // `toDate` est la convertisseuse partagée, et elle accepte **trois** formes :
    // un `Date`, un horodatage Firestore, et une chaîne ISO. Le plan n'a pas à
    // être plus strict qu'elle — refuser ici laisserait un corps vide là où le
    // document porte une échéance parfaitement lisible. C'est `validPoll()`, à
    // l'écriture, qui ferme le champ aux chaînes ; le plan n'a pas à refaire ce
    // contrôle, et le refaire divergerait.
    const echeance = new Date('2026-10-02T20:00:00Z');
    const corps = corpsDuSondage({
      ...ouvert,
      description: undefined,
      endsAt: echeance.toISOString(),
    });

    expect(corps).toBe(`Clôture le ${formatDateTime(echeance)}`);
  });

  it('se replie quand l’échéance n’est pas lisible', () => {
    // Les valeurs que `toDate` ne reconnaît pas, et une chaîne qui n'est pas une
    // date. Elle est **totale** : elle rend `null` au lieu de lever au milieu
    // d'un envoi. Une migration ou une version antérieure du schéma peut avoir
    // écrit autre chose qu'un horodatage, et `validPoll()` rend le cas
    // improbable, pas impossible.
    for (const endsAt of [42, {}, [], true, 'demain']) {
      expect(corpsDuSondage({ ...ouvert, description: undefined, endsAt })).toBe(
        CORPS_SANS_PRECISION,
      );
    }
  });
});

describe('pollPushMessage', () => {
  it('transporte de quoi ouvrir le contenu', () => {
    const plan = pollNotificationPlan('p1', undefined, ouvert, contexte);
    const message = plan ? pollPushMessage(plan) : null;

    expect(message?.data).toEqual({
      type: 'new_poll',
      orgId: 'fl',
      sourceId: 'p1',
      deeplink: 'frereslumieres://poll/p1',
    });
  });

  it('ne transporte rien de plus que le nécessaire', () => {
    // Chaque champ de `data` est une copie de plus à garder d'accord avec le
    // document d'origine, sans que rien ne le vérifie.
    const plan = pollNotificationPlan('p1', undefined, ouvert, contexte);
    const message = plan ? pollPushMessage(plan) : null;

    expect(Object.keys(message?.data ?? {}).sort()).toEqual([
      'deeplink',
      'orgId',
      'sourceId',
      'type',
    ]);
  });

  it('reporte le titre et le corps décidés par le plan', () => {
    const plan = pollNotificationPlan('p1', undefined, ouvert, contexte);
    const message = plan ? pollPushMessage(plan) : null;

    expect(message?.title).toBe(plan?.title);
    expect(message?.body).toBe(plan?.body);
    expect(message?.category).toBe('sondages');
    expect(message?.audienceKeys).toEqual(['org:fl']);
  });
});
