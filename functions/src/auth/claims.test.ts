/**
 * Custom Claims : forme du jeton et échec fermé.
 *
 * ## Ce que ces tests protègent
 *
 * Les claims sont la seule barrière que les règles Firestore consultent
 * (`request.auth.token.status == 'active'`). Deux propriétés doivent tenir, et
 * aucune des deux n'est visible à la compilation :
 *
 *  1. **Le contenu.** Les claims sont lisibles par leur porteur et peuvent
 *     apparaître dans des journaux : aucune donnée personnelle ne doit y
 *     entrer, et leur taille doit rester dans le budget du jeton.
 *  2. **Les replis.** Un profil incomplet — champ absent, type inattendu —
 *     doit produire le moins de droits possibles, jamais davantage. Le repli
 *     de `status` est `pending`, pas `active`.
 *
 * ## Pourquoi ce fichier vit ici et non dans `@fl/testing`
 *
 * `@fl/testing` porte les tests qui exigent l'émulateur Firestore, donc Java.
 * Ces tests-ci sont purs : ils tournent partout, y compris là où l'émulateur
 * ne peut pas démarrer. C'est délibéré — la propriété d'échec fermé est trop
 * importante pour ne s'exécuter que dans un environnement privilégié.
 */
import { describe, expect, it } from 'vitest';

import { buildClaims, claimsSourceFromProfile, type ClaimsSource } from './claims.js';

/** Profil complet et cohérent, point de départ des variations. */
const profile: ClaimsSource = {
  role: 'parent',
  status: 'active',
  orgId: 'fcpe-montmagny',
  orgIds: ['fcpe-montmagny'],
};

describe('claimsSourceFromProfile — lecture d’un profil', () => {
  it('accepte un profil complet', () => {
    expect(claimsSourceFromProfile({ ...profile })).toEqual(profile);
  });

  it('refuse un profil sans organisation', () => {
    // Sans organisation, le repli serait arbitraire : un `orgId` inventé
    // pourrait donner accès aux données d'une autre FCPE.
    expect(claimsSourceFromProfile({ role: 'parent', status: 'active' })).toBeNull();
    expect(claimsSourceFromProfile({ orgId: '' })).toBeNull();
    expect(claimsSourceFromProfile({ orgId: 42 })).toBeNull();
    expect(claimsSourceFromProfile({ orgId: null })).toBeNull();
  });

  it('replie un statut absent sur « pending », jamais sur « active »', () => {
    // C'est LE test d'échec fermé : un profil dont on ne connaît pas le statut
    // est un profil dont on ne sait rien, pas un profil approuvé.
    const source = claimsSourceFromProfile({ orgId: 'fcpe-montmagny' });
    expect(source?.status).toBe('pending');
    expect(source?.status).not.toBe('active');
  });

  it('replie un statut d’un type inattendu sur « pending »', () => {
    for (const bogus of [null, undefined, 42, {}, []]) {
      const source = claimsSourceFromProfile({ orgId: 'fcpe-montmagny', status: bogus });
      expect(source?.status).toBe('pending');
    }
  });

  it('replie un rôle absent ou mal typé sur « parent »', () => {
    // `parent` est le rôle qui a le moins de permissions.
    expect(claimsSourceFromProfile({ orgId: 'fcpe-montmagny' })?.role).toBe('parent');
    expect(claimsSourceFromProfile({ orgId: 'fcpe-montmagny', role: 42 })?.role).toBe('parent');
    expect(claimsSourceFromProfile({ orgId: 'fcpe-montmagny', role: null })?.role).toBe('parent');
  });

  it('reprend un rôle explicite sans le rabaisser', () => {
    // Le repli ne doit pas écraser une valeur légitime : sinon un
    // administrateur deviendrait parent à chaque écriture de profil.
    expect(claimsSourceFromProfile({ ...profile, role: 'admin' })?.role).toBe('admin');
    expect(claimsSourceFromProfile({ ...profile, role: 'moderator' })?.role).toBe('moderator');
  });

  it('replie une liste d’organisations absente sur l’organisation principale', () => {
    expect(claimsSourceFromProfile({ orgId: 'fcpe-montmagny' })?.orgIds).toEqual([
      'fcpe-montmagny',
    ]);
    expect(
      claimsSourceFromProfile({ orgId: 'fcpe-montmagny', orgIds: 'pas-un-tableau' })?.orgIds,
    ).toEqual(['fcpe-montmagny']);
  });

  it('transmet un statut inconnu tel quel', () => {
    // Comportement assumé, et sans danger : les règles comparent
    // `status == 'active'` en égalité stricte, donc toute autre valeur — y
    // compris une valeur inventée — est refusée comme les autres. Valider ici
    // n'ajouterait pas de sécurité, seulement un cas d'erreur à gérer.
    expect(claimsSourceFromProfile({ ...profile, status: 'superuser' })?.status).toBe('superuser');
  });
});

describe('buildClaims — contenu du jeton', () => {
  it('n’expose que les quatre champs prévus', () => {
    expect(Object.keys(buildClaims(profile)).sort()).toEqual(['orgId', 'orgIds', 'role', 'status']);
  });

  it('ne laisse filtrer aucune donnée personnelle', () => {
    // Les claims sont lisibles par leur porteur et peuvent apparaître dans des
    // journaux : le prénom, le nom, l'e-mail et les enfants n'y ont pas leur
    // place. Le profil transmis ici en contient volontairement.
    const avecDonneesPersonnelles = {
      ...profile,
      firstName: 'Camille',
      lastName: 'Dupont',
      email: 'camille.dupont@example.org',
      children: [{ firstName: 'Léa' }],
      schoolIds: ['ecole-freres-lumieres'],
      levels: ['ce2'],
    };

    const claims = buildClaims(avecDonneesPersonnelles);
    const serialised = JSON.stringify(claims);

    for (const fuite of ['Camille', 'Dupont', 'example.org', 'Léa', 'ce2']) {
      expect(serialised).not.toContain(fuite);
    }
    expect(Object.keys(claims)).toHaveLength(4);
  });

  it('copie la liste des organisations au lieu de la référencer', () => {
    // Sans la copie, une mutation ultérieure du profil modifierait des claims
    // déjà appliqués — un écart entre ce que le jeton dit et ce que la base
    // contient, donc exactement le genre d'incohérence que les claims servent
    // à éviter.
    const orgIds = ['fcpe-montmagny'];
    const claims = buildClaims({ ...profile, orgIds });

    orgIds.push('autre-fcpe');

    expect(claims.orgIds).toEqual(['fcpe-montmagny']);
  });

  it('reste dans le budget de taille du jeton', () => {
    // Firebase plafonne les Custom Claims à 1000 octets. Le budget visé est
    // bien plus bas : ce test échoue si quelqu'un ajoute un champ volumineux
    // (une liste d'écoles, de niveaux ou d'enfants) au jeton.
    const taille = JSON.stringify(buildClaims(profile)).length;
    expect(taille).toBeLessThan(200);
  });

  it('grandit linéairement avec le nombre d’organisations, sans plus', () => {
    // Un parent appartient à une organisation, parfois deux. Si ce test
    // demande un ajustement, c'est que le modèle a changé — et qu'il faut
    // alors se demander si la donnée a sa place dans un jeton.
    const deux = buildClaims({ ...profile, orgIds: ['fcpe-montmagny', 'fcpe-ville'] });
    const une = buildClaims(profile);

    expect(deux.orgIds).toHaveLength(2);
    expect(JSON.stringify(deux).length - JSON.stringify(une).length).toBeLessThan(30);
  });
});
