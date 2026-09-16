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
 */
import { describe, expect, it } from 'vitest';

import {
  firstIssueByField,
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
