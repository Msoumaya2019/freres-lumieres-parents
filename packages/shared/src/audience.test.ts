import { describe, expect, it } from 'vitest';

import {
  audienceKeyToTopic,
  buildAudienceKeys,
  buildUserAudienceKeys,
  chunkAudienceKeys,
  isVisibleForUserKeys,
  validateAudience,
} from './audience.js';

describe('buildAudienceKeys', () => {
  const orgId = 'fcpe-montmagny';

  it('cible toute l’organisation avec la clé org', () => {
    expect(buildAudienceKeys({ type: 'all' }, orgId)).toEqual(['org:fcpe-montmagny']);
  });

  it('cible une école précise', () => {
    expect(buildAudienceKeys({ type: 'school', schoolId: 'elem' }, orgId)).toEqual(['school:elem']);
  });

  it('inclut l’école dans la clé de niveau, pour éviter les fuites entre établissements', () => {
    expect(buildAudienceKeys({ type: 'level', schoolId: 'elem', level: 'CE1' }, orgId)).toEqual([
      'level:elem:CE1',
    ]);
  });

  it('cible une classe', () => {
    expect(buildAudienceKeys({ type: 'class', classId: 'ce1a' }, orgId)).toEqual(['class:ce1a']);
  });

  it('cible les membres FCPE', () => {
    expect(buildAudienceKeys({ type: 'fcpe' }, orgId)).toEqual(['fcpe:fcpe-montmagny']);
  });

  it('ne produit aucune clé si l’audience est incomplète', () => {
    expect(buildAudienceKeys({ type: 'level' }, orgId)).toEqual([]);
    expect(buildAudienceKeys({ type: 'school' }, orgId)).toEqual([]);
    expect(buildAudienceKeys({ type: 'class' }, orgId)).toEqual([]);
  });
});

describe('buildUserAudienceKeys', () => {
  it('donne à tout parent validé la clé de son organisation', () => {
    const keys = buildUserAudienceKeys({
      orgIds: ['fcpe-montmagny'],
      schoolIds: ['elem'],
      levels: ['CE1'],
      classIds: [],
      role: 'parent',
      levelSchoolPairs: [{ schoolId: 'elem', level: 'CE1' }],
    });

    expect(keys).toContain('org:fcpe-montmagny');
    expect(keys).toContain('school:elem');
    expect(keys).toContain('level:elem:CE1');
    // Un parent ne doit jamais obtenir la clé de l'espace privé FCPE.
    expect(keys).not.toContain('fcpe:fcpe-montmagny');
  });

  it('ajoute la clé FCPE pour les rôles concernés', () => {
    for (const role of ['fcpe', 'moderator', 'admin'] as const) {
      const keys = buildUserAudienceKeys({
        orgIds: ['fcpe-montmagny'],
        schoolIds: [],
        levels: [],
        classIds: [],
        role,
      });
      expect(keys).toContain('fcpe:fcpe-montmagny');
    }
  });

  it('gère plusieurs enfants dans deux écoles différentes', () => {
    const keys = buildUserAudienceKeys({
      orgIds: ['fcpe-montmagny'],
      schoolIds: ['maternelle', 'elem'],
      levels: ['GS', 'CE1'],
      classIds: ['ce1a'],
      role: 'parent',
      levelSchoolPairs: [
        { schoolId: 'maternelle', level: 'GS' },
        { schoolId: 'elem', level: 'CE1' },
      ],
    });

    expect(keys).toEqual(
      expect.arrayContaining([
        'org:fcpe-montmagny',
        'school:maternelle',
        'school:elem',
        'level:maternelle:GS',
        'level:elem:CE1',
        'class:ce1a',
      ]),
    );
  });

  it('ne dépasse jamais la limite Firestore de array-contains-any', () => {
    const keys = buildUserAudienceKeys({
      orgIds: ['org'],
      schoolIds: Array.from({ length: 20 }, (_, i) => `school-${i}`),
      levels: [],
      classIds: Array.from({ length: 20 }, (_, i) => `class-${i}`),
      role: 'parent',
    });
    // 1 org + 20 écoles + 20 classes = 41 clés : la découpe doit produire 2 lots.
    expect(keys.length).toBe(41);
    expect(chunkAudienceKeys(keys)).toHaveLength(2);
    expect(chunkAudienceKeys(keys)[0]).toHaveLength(30);
  });
});

describe('isVisibleForUserKeys', () => {
  const userKeys = ['org:fcpe-montmagny', 'school:elem', 'level:elem:CE1'];

  it('autorise une publication générale', () => {
    expect(isVisibleForUserKeys(['org:fcpe-montmagny'], userKeys)).toBe(true);
  });

  it('autorise une publication du bon niveau', () => {
    expect(isVisibleForUserKeys(['level:elem:CE1'], userKeys)).toBe(true);
  });

  it('refuse une publication d’un autre niveau ou d’une autre école', () => {
    expect(isVisibleForUserKeys(['level:elem:CM2'], userKeys)).toBe(false);
    expect(isVisibleForUserKeys(['school:maternelle'], userKeys)).toBe(false);
    expect(isVisibleForUserKeys(['fcpe:fcpe-montmagny'], userKeys)).toBe(false);
  });

  it('refuse un contenu sans clé d’audience (échec fermé)', () => {
    expect(isVisibleForUserKeys([], userKeys)).toBe(false);
  });
});

describe('validateAudience', () => {
  it('valide les audiences complètes', () => {
    expect(validateAudience({ type: 'all' }).valid).toBe(true);
    expect(validateAudience({ type: 'school', schoolId: 'elem' }).valid).toBe(true);
    expect(validateAudience({ type: 'level', schoolId: 'elem', level: 'CE1' }).valid).toBe(true);
    expect(validateAudience({ type: 'class', classId: 'ce1a' }).valid).toBe(true);
    expect(validateAudience({ type: 'fcpe' }).valid).toBe(true);
  });

  it('rejette les audiences incomplètes avec une raison explicite', () => {
    const result = validateAudience({ type: 'level', schoolId: 'elem' });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('audience.level');
  });
});

describe('audienceKeyToTopic', () => {
  it('produit un nom de topic valide pour FCM', () => {
    expect(audienceKeyToTopic('level:elem:CE1')).toBe('level_elem_ce1');
    expect(audienceKeyToTopic('org:fcpe-montmagny')).toBe('org_fcpe-montmagny');
    // Un nom de topic ne doit contenir que [a-zA-Z0-9-_.~%]
    expect(audienceKeyToTopic('level:elem:CE1')).toMatch(/^[a-zA-Z0-9-_.~%]+$/);
  });

  it('est déterministe : client et serveur calculent le même topic', () => {
    expect(audienceKeyToTopic('class:ce1a')).toBe(audienceKeyToTopic('class:ce1a'));
  });
});
