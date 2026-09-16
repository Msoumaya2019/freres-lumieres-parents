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
