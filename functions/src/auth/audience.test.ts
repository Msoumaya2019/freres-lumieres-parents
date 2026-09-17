/**
 * Détection d'un changement de rattachement.
 *
 * ## Ce que cette fonction décide
 *
 * Elle répond à une seule question : les clés d'audience d'un utilisateur
 * doivent-elles être recalculées ? La réponse fausse a deux coûts très
 * différents :
 *
 *  - **trop souvent** : une lecture de profil, une requête sur les enfants et
 *    une écriture, à chaque modification anodine ;
 *  - **pas assez souvent** : l'utilisateur voit **moins** de choses que prévu,
 *    silencieusement. Rien n'échoue, aucun journal ne le signale.
 *
 * Le second est de loin le plus grave, et c'est celui qui s'était produit.
 *
 * ## Le défaut corrigé
 *
 * La comparaison ne portait que sur `levels`, `classIds` et `schoolIds`. Or la
 * clé `fcpe:` se déduit du **rôle**, et la clé `org:` des **organisations**.
 * Un parent promu au rôle `fcpe` — ou rattaché à une seconde organisation — ne
 * voyait donc jamais sa clé apparaître : il restait inscrit au fil des parents
 * et n'accédait à aucun contenu réservé à la FCPE.
 */
import { describe, expect, it } from 'vitest';

import { audienceChanged } from './audience.js';

/** Profil parent ordinaire, point de départ des variations. */
const profile = {
  role: 'parent',
  orgIds: ['fl'],
  schoolIds: ['lumiere'],
  levels: ['ce1'],
  classIds: ['ce1-a'],
};

describe('audienceChanged', () => {
  it('ne détecte rien sur un profil identique', () => {
    expect(audienceChanged(profile, { ...profile })).toBe(false);
  });

  it('ne détecte rien sur un réordonnancement', () => {
    // Les tableaux de rattachement viennent de sources différentes — profil,
    // sous-collection des enfants — donc leur ordre varie sans que rien ne
    // change. Le comparer ferait une lecture de profil, une requête sur les
    // enfants et une écriture pour rien.
    expect(
      audienceChanged(
        { ...profile, levels: ['ce1', 'cm2'] },
        { ...profile, levels: ['cm2', 'ce1'] },
      ),
    ).toBe(false);
  });

  // --- Les rattachements, déjà couverts avant ------------------------------

  it('détecte un changement de niveau', () => {
    expect(audienceChanged(profile, { ...profile, levels: ['cm2'] })).toBe(true);
  });

  it('détecte un changement de classe', () => {
    expect(audienceChanged(profile, { ...profile, classIds: ['cm2-b'] })).toBe(true);
  });

  it('détecte un changement d’école', () => {
    expect(audienceChanged(profile, { ...profile, schoolIds: ['jean-moulin'] })).toBe(true);
  });

  // --- Le rôle et les organisations : le défaut corrigé --------------------

  it('détecte une promotion au rôle fcpe', () => {
    // Sans cette détection, le nouveau membre de la FCPE n'obtenait jamais la
    // clé `fcpe:` : il ne voyait aucun contenu réservé à la FCPE, et rien ne
    // le signalait.
    expect(audienceChanged(profile, { ...profile, role: 'fcpe' })).toBe(true);
  });

  it('détecte une rétrogradation depuis le rôle fcpe', () => {
    // Le sens inverse compte tout autant : sans recalcul, un parent rétrogradé
    // conserverait l'accès aux contenus de la FCPE.
    expect(audienceChanged({ ...profile, role: 'fcpe' }, profile)).toBe(true);
  });

  it('détecte l’ajout d’une organisation', () => {
    expect(audienceChanged(profile, { ...profile, orgIds: ['fl', 'autre'] })).toBe(true);
  });

  it('détecte le retrait d’une organisation', () => {
    expect(audienceChanged({ ...profile, orgIds: ['fl', 'autre'] }, profile)).toBe(true);
  });

  // --- Les cas limites -----------------------------------------------------

  it('détecte la création du profil', () => {
    // Un document créé n'a pas d'état précédent : ses clés doivent être
    // calculées. C'est aussi le filet si le déclencheur de création venait à
    // manquer.
    expect(audienceChanged(undefined, profile)).toBe(true);
  });

  it('tolère un profil dont les tableaux sont absents', () => {
    // Un profil incomplet ne doit pas lever : le repli est « aucun
    // rattachement », donc aucune clé au-delà de `org:`.
    expect(audienceChanged({}, {})).toBe(false);
    expect(audienceChanged({ levels: ['ce1'] }, {})).toBe(true);
  });

  it('ignore les valeurs qui ne sont pas des chaînes', () => {
    // Firestore ne garantit pas le type d'un champ. Un élément non textuel
    // dans un tableau ne doit pas provoquer de recalcul en boucle.
    expect(audienceChanged(profile, { ...profile, levels: [42, 'ce1'] })).toBe(false);
  });

  it('détecte un champ de type inattendu', () => {
    // `levels` passé d'un tableau à une chaîne n'est pas un réordonnancement :
    // c'est un profil abîmé, dont les clés dérivées changent réellement. Le
    // recalcul est la bonne réponse — il réécrit la valeur sous sa forme
    // attendue.
    expect(audienceChanged(profile, { ...profile, levels: 'ce1' })).toBe(true);
    expect(audienceChanged(profile, { ...profile, levels: undefined })).toBe(true);
  });
});
