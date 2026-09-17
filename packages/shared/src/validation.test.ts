/**
 * Contrat des schémas utilisés comme charges utiles de Cloud Functions.
 *
 * Ces tests ne vérifient pas une règle métier mais une **contrainte
 * structurelle** : la cible (`uid`) est transmise dans le même objet que la
 * décision, et le serveur la lit hors du résultat du parse. Un passage de ces
 * schémas en `.strict()` ferait échouer les trois fonctions
 * d'administration à l'exécution, avec pour seul message « Demande
 * invalide » — et aucune erreur de compilation pour l'annoncer.
 *
 * Le test est donc là pour rendre cet échec bruyant, et immédiat.
 *
 * Le dernier bloc vérifie autre chose : une **promesse tenue**. Le schéma des
 * préférences acceptait `urgent` dans les catégories désactivées alors que le
 * filtre d'envoi ne la filtre jamais — l'utilisateur aurait « désactivé » une
 * alerte sans rien désactiver. Deux tests encadrent la frontière, ce qui est
 * refusé et ce qui doit continuer de passer : un schéma trop strict casserait
 * l'écran de préférences aussi sûrement qu'un schéma trop permissif le rend
 * menteur.
 */
import { describe, expect, it } from 'vitest';

import {
  MANDATORY_NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORIES,
  OPTIONAL_NOTIFICATION_CATEGORIES,
} from './constants.js';
import {
  firstIssueByField,
  notificationPrefsSchema,
  notificationSendSchema,
  postInputSchema,
  userRoleUpdateSchema,
  userStatusUpdateSchema,
  contentStatusUpdateSchema,
} from './validation.js';

/** Charge utile telle qu'émise par le client d'administration. */
const statusPayload = { uid: 'abc123', status: 'active', reason: 'Dossier complet.' };
const rolePayload = { uid: 'abc123', role: 'admin', reason: 'Élu au conseil.' };

describe('charges utiles des fonctions d’administration', () => {
  it('accepte un uid à côté des champs de décision', () => {
    // C'est le cœur du contrat : la cible n'est pas décrite par le schéma,
    // mais sa présence ne doit pas invalider la demande.
    expect(userStatusUpdateSchema.safeParse(statusPayload).success).toBe(true);
    expect(userRoleUpdateSchema.safeParse(rolePayload).success).toBe(true);
  });

  it('écarte le uid du résultat plutôt que de le conserver', () => {
    const parsed = userStatusUpdateSchema.safeParse(statusPayload);
    expect(parsed.success).toBe(true);
    expect(parsed.success && 'uid' in parsed.data).toBe(false);
  });

  it('conserve la décision et le motif', () => {
    const parsed = userStatusUpdateSchema.parse(statusPayload);
    expect(parsed.status).toBe('active');
    expect(parsed.reason).toBe('Dossier complet.');
  });

  it('refuse une décision invalide malgré un uid valide', () => {
    // La tolérance porte sur la cible, jamais sur la décision.
    expect(userStatusUpdateSchema.safeParse({ uid: 'a', status: 'root' }).success).toBe(false);
    expect(userRoleUpdateSchema.safeParse({ uid: 'a', role: 'president' }).success).toBe(false);
    expect(
      userStatusUpdateSchema.safeParse({ uid: 'a', status: 'active', reason: 'x'.repeat(501) })
        .success,
    ).toBe(false);
  });

  it('refuse une décision absente', () => {
    expect(userStatusUpdateSchema.safeParse({ uid: 'a' }).success).toBe(false);
    expect(userRoleUpdateSchema.safeParse({ uid: 'a' }).success).toBe(false);
  });

  it('applique la même tolérance au schéma de contenu', () => {
    expect(
      contentStatusUpdateSchema.safeParse({ targetId: 'p1', status: 'published' }).success,
    ).toBe(true);
  });
});

describe('lecture d’un résultat de validation', () => {
  it('ne retient qu’un message par champ', () => {
    // Deux problèmes sur le même champ : le premier est celui que l'auteur du
    // formulaire doit lire, le second n'ajouterait que du bruit.
    const messages = firstIssueByField([
      { path: ['title'], message: 'Le titre est trop court.' },
      { path: ['title'], message: 'Maximum 140 caractères.' },
    ]);

    expect(messages.title).toBe('Le titre est trop court.');
  });

  it('regroupe un champ répété par son chemin complet', () => {
    // C'est ce qui permet à un formulaire à plusieurs enfants de retrouver
    // l'erreur du deuxième sans connaître l'indexation interne de Zod.
    const messages = firstIssueByField([
      { path: ['children', 0, 'schoolId'], message: 'Choisissez un établissement.' },
      { path: ['children', 1, 'schoolId'], message: 'Choisissez un établissement.' },
      { path: ['children', 1, 'classId'], message: 'Choisissez une classe.' },
    ]);

    expect(Object.keys(messages).sort()).toEqual([
      'children.0.schoolId',
      'children.1.classId',
      'children.1.schoolId',
    ]);
  });

  it('ne rend rien quand il n’y a rien à signaler', () => {
    expect(firstIssueByField([])).toEqual({});
  });

  it('accepte tel quel le résultat d’un schéma du paquet', () => {
    // La forme attendue est structurelle : elle doit accepter Zod sans
    // conversion. Si ce test casse, c'est que le contrat a changé de forme et
    // que les trois écrans qui l'utilisent cesseraient de compiler.
    const parsed = postInputSchema.safeParse({
      title: 'a',
      body: '',
      category: 'information',
      audience: { type: 'all' },
    });

    expect(parsed.success).toBe(false);
    const messages = firstIssueByField(parsed.success ? [] : parsed.error.issues);

    expect(messages.title).toBe('Le titre est trop court.');
    expect(messages.body).toBe('Le contenu est obligatoire.');
  });
});

describe('préférences de notification', () => {
  const prefs = (disabledCategories: string[]) => ({ enabled: true, disabledCategories });

  it('refuse les alertes urgentes dans les catégories désactivées', () => {
    // L'exception est appliquée à l'envoi par `filterRecipients`. L'accepter
    // ici laissait l'utilisateur croire qu'il l'avait désactivée : la
    // préférence était enregistrée, et aucun envoi n'en tenait compte.
    expect(notificationPrefsSchema.safeParse(prefs(['urgent'])).success).toBe(false);
  });

  it('refuse urgent même noyée parmi des catégories valides', () => {
    // Le cas réel : une liste où seul un élément pose problème. Un contrôle
    // qui ne regarderait que le premier élément passerait ce test à tort.
    expect(
      notificationPrefsSchema.safeParse(prefs(['discussions', 'urgent', 'agenda'])).success,
    ).toBe(false);
  });

  it('refuse avec un message explicite, pas un échec d’énumération', () => {
    // Prouve que le refus vient bien de la règle métier. Sans cela, une
    // faute de frappe dans le nom de la catégorie produirait le même `false`,
    // et le test resterait vert en ne vérifiant rien.
    const parsed = notificationPrefsSchema.safeParse(prefs(['urgent']));
    const messages = firstIssueByField(parsed.success ? [] : parsed.error.issues);

    expect(messages.disabledCategories).toContain('urgent');
  });

  it('accepte les six catégories désactivables', () => {
    expect(
      notificationPrefsSchema.safeParse(prefs([...OPTIONAL_NOTIFICATION_CATEGORIES])).success,
    ).toBe(true);
  });

  it('accepte une liste vide', () => {
    // Le cas par défaut de tout profil : `repositories/users.ts` écrit
    // `disabledCategories: []` à la création.
    expect(notificationPrefsSchema.safeParse(prefs([])).success).toBe(true);
  });

  it('refuse toute catégorie déclarée obligatoire', () => {
    // Boucle sur la constante plutôt qu'une liste recopiée : rendre demain une
    // catégorie obligatoire sans la refuser dans le schéma fait échouer ce
    // test, sans qu'on ait à y penser.
    for (const category of MANDATORY_NOTIFICATION_CATEGORIES) {
      expect(notificationPrefsSchema.safeParse(prefs([category])).success).toBe(false);
    }
  });

  it('accepte toute catégorie qui n’est pas obligatoire', () => {
    // La borne opposée, et elle compte : un schéma qui refuserait tout
    // passerait tous les tests ci-dessus. Sans ce pendant, la correction
    // « refuse urgent » serait indiscernable de « refuse les préférences ».
    const facultatives = NOTIFICATION_CATEGORIES.filter(
      (category) => !(MANDATORY_NOTIFICATION_CATEGORIES as readonly string[]).includes(category),
    );

    expect(facultatives).toHaveLength(OPTIONAL_NOTIFICATION_CATEGORIES.length);
    for (const category of facultatives) {
      expect(notificationPrefsSchema.safeParse(prefs([category])).success).toBe(true);
    }
  });

  it('borne la liste au nombre de catégories désactivables', () => {
    // Sept entrées ne sont plus atteignables : la borne suit la même source
    // que la règle, au lieu de rester sur le nombre total de catégories.
    const trop = Array.from(
      { length: OPTIONAL_NOTIFICATION_CATEGORIES.length + 1 },
      () => 'discussions',
    );

    expect(notificationPrefsSchema.safeParse(prefs(trop)).success).toBe(false);
  });
});

describe('notificationSendSchema', () => {
  /** Annonce écrite à la main depuis l'administration. */
  const annonce = {
    title: 'Fermeture de l’école',
    body: 'L’école sera fermée vendredi.',
    category: 'publications',
    audience: { type: 'all' },
  };

  it('accepte une annonce sans lien profond', () => {
    expect(notificationSendSchema.safeParse(annonce).success).toBe(true);
  });

  it('refuse un lien profond qui n’ouvre aucun écran', () => {
    // La forme seule ne suffit pas : `frereslumieres://poll/…` est un lien
    // valide dont l'écran n'existe pas encore. L'accepter ici le ferait
    // échouer **en silence** sur le téléphone, et l'administrateur croirait
    // avoir posé un lien qui marche.
    const resultat = notificationSendSchema.safeParse({
      ...annonce,
      deeplink: 'frereslumieres://poll/p1',
    });

    expect(resultat.success).toBe(false);
  });

  it('accepte un lien profond qui ouvre un écran', () => {
    // La borne opposée : un schéma qui refuserait **tous** les liens passerait
    // le test précédent. Elle se relira d'elle-même le jour où un écran
    // s'ajoute à `DEEPLINK_ROUTES` — c'est la table qui décide, pas une liste
    // recopiée ici.
    const resultat = notificationSendSchema.safeParse({
      ...annonce,
      deeplink: 'frereslumieres://post/p1',
    });

    expect(resultat.success).toBe(true);
  });

  it('refuse un champ que le serveur ne lit pas', () => {
    // `orgId` surtout : l'accepter laisserait croire qu'un administrateur peut
    // choisir l'organisation destinataire, alors que le plan la lit sur le
    // profil de l'appelant.
    expect(notificationSendSchema.safeParse({ ...annonce, orgId: 'autre' }).success).toBe(false);
  });

  it('refuse un titre trop court et une catégorie inconnue', () => {
    expect(notificationSendSchema.safeParse({ ...annonce, title: 'ok' }).success).toBe(false);
    expect(notificationSendSchema.safeParse({ ...annonce, category: 'urgente' }).success).toBe(
      false,
    );
  });
});
