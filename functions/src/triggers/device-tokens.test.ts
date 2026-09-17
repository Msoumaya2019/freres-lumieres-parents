/**
 * Synchronisation des jetons d'appareil : ce que le serveur en déduit.
 *
 * ## Pourquoi ces tests vivent ici et non dans `@fl/testing`
 *
 * Les tests de règles vérifient **qui a le droit d'écrire** `audienceKeys` et
 * `disabledCategories` sur un jeton. Ils ne disent rien de ce que la Cloud
 * Function y met — et c'est pourtant là que se prennent les décisions qui
 * comptent : quels droits un appareil reçoit, et à partir de quand il n'en
 * reçoit plus aucun.
 *
 * Ces fonctions sont pures, donc testables sans émulateur ni Java, comme
 * `counters.test.ts`. Le déclencheur ne fait plus que la plomberie Firestore.
 *
 * ## Le défaut que ces tests empêchent
 *
 * La recopie existait — `rebuildAudienceKeysForTokens` — mais **rien ne
 * l'appelait**. Les jetons seraient restés avec `audienceKeys: []`, l'état que
 * les règles imposent au client, et aucun parent n'aurait jamais reçu la
 * moindre notification. Aucun test de règles ne pouvait le voir : les règles,
 * elles, étaient satisfaites.
 */
import { describe, expect, it } from 'vitest';

import { tokenOwnerChanged, tokenSyncFields, tokensNeedResync } from './device-tokens.js';

/** Profil actif et complet, point de départ des variations. */
const profile = {
  status: 'active',
  audienceKeys: ['org:fl', 'school:lumiere', 'level:lumiere:ce1'],
  notificationPrefs: { enabled: true, disabledCategories: ['discussions'] },
};

describe('tokenSyncFields', () => {
  it('recopie les clés d’audience d’un compte actif', () => {
    expect(tokenSyncFields(profile).audienceKeys).toEqual([
      'org:fl',
      'school:lumiere',
      'level:lumiere:ce1',
    ]);
  });

  it('recopie les catégories désactivées du profil', () => {
    expect(tokenSyncFields(profile).disabledCategories).toEqual(['discussions']);
  });

  // --- Le repli fermé : ne rien recevoir ------------------------------------

  it('ne donne aucune clé à un compte en attente de validation', () => {
    // Un compte `pending` ne peut rien lire : lui envoyer une notification
    // révélerait dans le bandeau de l'écran de verrouillage un contenu auquel
    // il n'a pas accès.
    expect(tokenSyncFields({ ...profile, status: 'pending' }).audienceKeys).toEqual([]);
  });

  it('ne donne aucune clé à un compte suspendu', () => {
    // Le cas qui n'était couvert par rien : les règles empêchent un compte non
    // actif de **créer** un jeton, mais rien ne vidait un jeton déjà créé au
    // moment de la suspension. Un parent suspendu continuait de tout recevoir.
    expect(tokenSyncFields({ ...profile, status: 'suspended' }).audienceKeys).toEqual([]);
  });

  it('ne donne aucune clé à un compte refusé', () => {
    expect(tokenSyncFields({ ...profile, status: 'rejected' }).audienceKeys).toEqual([]);
  });

  it('ne donne aucune clé si le statut est absent', () => {
    // Même repli que pour les Custom Claims : l'absence de statut vaut
    // `pending`, jamais `active`. Un profil incomplet ne doit pas ouvrir de
    // droits.
    expect(tokenSyncFields({ ...profile, status: undefined }).audienceKeys).toEqual([]);
  });

  it('ne donne aucune clé si le statut n’est pas une chaîne', () => {
    expect(tokenSyncFields({ ...profile, status: 42 }).audienceKeys).toEqual([]);
  });

  it('vide aussi les préférences d’un compte non actif', () => {
    // Sans conséquence fonctionnelle — sans clé, rien n'est envoyé — mais cela
    // garde le document cohérent : un jeton inactif ne porte rien.
    expect(tokenSyncFields({ ...profile, status: 'suspended' }).disabledCategories).toEqual([]);
  });

  it('tolère un profil sans clés d’audience', () => {
    expect(tokenSyncFields({ status: 'active' }).audienceKeys).toEqual([]);
  });

  it('ignore les clés d’audience qui ne sont pas du texte', () => {
    expect(
      tokenSyncFields({ ...profile, audienceKeys: ['org:fl', 7, null, 'school:lumiere'] })
        .audienceKeys,
    ).toEqual(['org:fl', 'school:lumiere']);
  });

  it('accepte une liste de clés qui n’est pas un tableau', () => {
    expect(tokenSyncFields({ ...profile, audienceKeys: 'org:fl' }).audienceKeys).toEqual([]);
  });

  // --- Le repli ouvert : la préférence -------------------------------------

  it('ne désactive rien si les préférences sont absentes', () => {
    expect(
      tokenSyncFields({ ...profile, notificationPrefs: undefined }).disabledCategories,
    ).toEqual([]);
  });

  it('ne désactive rien si une catégorie est inconnue du schéma', () => {
    // Le cas qui décide du sens du repli. Des préférences illisibles rendent
    // muet si l'on échoue fermé : un parent dont le profil porte une catégorie
    // ajoutée par une version plus récente cesserait de **tout** recevoir. Une
    // préférence ne fait que réduire ce qui arrive — l'ignorer est le moindre
    // mal, et une fermeture d'école manquée ne se rattrape pas.
    expect(
      tokenSyncFields({
        ...profile,
        notificationPrefs: { enabled: true, disabledCategories: ['categorie_inconnue'] },
      }).disabledCategories,
    ).toEqual([]);
  });

  it('conserve les clés d’audience quand les préférences sont illisibles', () => {
    // Le point qui compte : les deux replis sont indépendants. Une préférence
    // illisible ne doit pas se propager aux clés d'audience, sinon le repli
    // ouvert d'un champ rendrait l'autre fermé.
    const fields = tokenSyncFields({
      ...profile,
      notificationPrefs: 'illisible',
    });

    expect(fields.disabledCategories).toEqual([]);
    expect(fields.audienceKeys).toEqual(['org:fl', 'school:lumiere', 'level:lumiere:ce1']);
  });
});

describe('tokensNeedResync', () => {
  it('ne resynchronise pas un profil inchangé', () => {
    expect(tokensNeedResync(profile, { ...profile })).toBe(false);
  });

  it('ne resynchronise pas sur un simple réordonnancement', () => {
    // L'ordre d'un tableau de clés ou de catégories n'a aucun sens ici. Le
    // comparer ferait une écriture par appareil à chaque réécriture du profil
    // dans un ordre différent.
    expect(
      tokensNeedResync(profile, {
        ...profile,
        audienceKeys: ['level:lumiere:ce1', 'org:fl', 'school:lumiere'],
        notificationPrefs: { enabled: true, disabledCategories: ['discussions'] },
      }),
    ).toBe(false);
  });

  it('resynchronise quand les clés d’audience changent', () => {
    expect(tokensNeedResync(profile, { ...profile, audienceKeys: ['org:fl', 'fcpe:fl'] })).toBe(
      true,
    );
  });

  it('resynchronise quand le statut change', () => {
    expect(tokensNeedResync(profile, { ...profile, status: 'suspended' })).toBe(true);
  });

  it('resynchronise quand une préférence change', () => {
    // Le cas qui justifie la fonction : sans lui, décocher « discussions »
    // n'atteindrait que l'appareil qui a fait la demande, et la tablette du
    // même parent continuerait de les recevoir.
    expect(
      tokensNeedResync(profile, {
        ...profile,
        notificationPrefs: { enabled: true, disabledCategories: ['discussions', 'agenda'] },
      }),
    ).toBe(true);
  });

  it('resynchronise quand le profil n’existait pas encore', () => {
    // Un document créé n'a pas d'état précédent : ses champs dérivés doivent
    // être calculés. C'est aussi le filet si le déclencheur de création de
    // profil venait à manquer.
    expect(tokensNeedResync(undefined, profile)).toBe(true);
  });

  it('ne resynchronise pas sur l’interrupteur général', () => {
    // `notificationPrefs.enabled` n'est **pas** recopié : il n'a pas de
    // consommateur, et sa portée sur les alertes `urgent` n'est pas tranchée.
    // Le déclarer comme déclencheur ferait une écriture par appareil pour rien.
    expect(
      tokensNeedResync(profile, {
        ...profile,
        notificationPrefs: { enabled: false, disabledCategories: ['discussions'] },
      }),
    ).toBe(false);
  });
});

describe('tokenOwnerChanged', () => {
  /** Jeton tel qu'il existe en base, avec son porteur. */
  const jeton = {
    uid: 'parent-1',
    status: 'active',
    audienceKeys: ['org:fl'],
    notificationPrefs: { enabled: true, disabledCategories: [] },
  };

  it('ne détecte rien quand le client écrit `enabled` ou `lastUsedAt`', () => {
    // Les seules écritures que le client peut faire sur son propre jeton. Les
    // recalculer coûterait une lecture de profil à chaque ouverture de
    // l'application.
    expect(tokenOwnerChanged(jeton, { ...jeton })).toBe(false);
  });

  it('ne détecte rien quand la Cloud Function a écrit les champs dérivés', () => {
    // **C'est cette propriété qui termine la chaîne.** Le déclencheur écrit
    // dans le document qu'il écoute, donc il est rappelé : le porteur est
    // inchangé, il sort sans rien lire ni écrire. Sans cela, la boucle serait
    // infinie.
    expect(tokenOwnerChanged(jeton, { ...jeton, audienceKeys: ['org:fl', 'fcpe:fl'] })).toBe(false);
  });

  it('détecte un changement de porteur', () => {
    expect(tokenOwnerChanged(jeton, { ...jeton, uid: 'parent-2' })).toBe(true);
  });

  it('ne détecte rien à la création', () => {
    // `onDeviceTokenCreated` s'en charge : laisser cette garde répondre `true`
    // ferait deux fois le même travail sur le même événement.
    expect(tokenOwnerChanged(undefined, jeton)).toBe(false);
  });

  it('ne détecte rien à la suppression', () => {
    // Un jeton supprimé n'a plus rien à recaler.
    expect(tokenOwnerChanged(jeton, undefined)).toBe(false);
  });

  it('détecte l’apparition d’un porteur là où il n’y en avait pas', () => {
    // Un jeton sans `uid` ne reçoit rien — la Cloud Function de création l'a
    // laissé tel quel. Le jour où un porteur lui est attribué, il faut le
    // recalculer.
    const orphelin = { ...jeton, uid: undefined };
    expect(tokenOwnerChanged(orphelin, jeton)).toBe(true);
  });
});
