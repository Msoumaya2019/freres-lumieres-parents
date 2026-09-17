/**
 * Ce qu'un document `deviceTokens` malformé devient.
 *
 * ## Le défaut que ces tests empêchent
 *
 * La sélection se faisait dans le déclencheur, mêlée à la lecture Firestore :
 * rien ne pouvait être éprouvé sans émulateur. Or c'est le seul endroit où des
 * données **non fiables** entrent dans le chemin d'envoi. Les règles imposent
 * des invariants à l'écriture, mais une migration, un script d'administration
 * ou une version antérieure du schéma peuvent les avoir laissés passer.
 *
 * Le point qui compte n'est pas qu'un document invalide soit refusé — c'est
 * qu'il **n'emporte pas les autres**. Un tableau jeté en bloc parce qu'une
 * entrée est illisible rendrait muets des parents dont l'appareil est
 * parfaitement valide.
 *
 * ## Les replis opposés, et pourquoi ils le sont
 *
 * `audienceKeys` illisible → vide, donc l'appareil ne reçoit rien : une
 * notification s'affiche sur un écran de verrouillage, et on ne devine pas son
 * contenu. `disabledCategories` illisible → vide, donc **rien de désactivé**,
 * et `enabled` absent ou illisible → **activé** : rendre muet un parent au
 * profil incomplet serait pire qu'un envoi de trop.
 */
import { describe, expect, it } from 'vitest';

import { excludeOwners, selectRecipients } from './recipients.js';

/** Document complet, point de départ des variations. */
const jeton = {
  token: 'ExponentPushToken[abc]',
  platform: 'android',
  enabled: true,
  audienceKeys: ['org:fl', 'school:lumiere'],
  disabledCategories: ['discussions'],
};

describe('selectRecipients', () => {
  it('retient un document complet', () => {
    const { recipients, rejected } = selectRecipients([jeton]);

    expect(rejected).toEqual([]);
    expect(recipients).toEqual([
      {
        token: 'ExponentPushToken[abc]',
        platform: 'android',
        enabled: true,
        audienceKeys: ['org:fl', 'school:lumiere'],
        disabledCategories: ['discussions'],
      },
    ]);
  });

  it('conserve l’ordre reçu', () => {
    // L'ordre n'a pas d'importance pour l'envoi, mais il en a pour lire un
    // journal : une fonction qui réordonne rend les rapports instables.
    const { recipients } = selectRecipients([
      { ...jeton, token: 'a' },
      { ...jeton, token: 'b' },
      { ...jeton, token: 'c' },
    ]);

    expect(recipients.map((r) => r.token)).toEqual(['a', 'b', 'c']);
  });

  // --- Le point qui compte : un refus n'emporte pas les autres --------------

  it('n’interrompt pas le parcours sur un document refusé', () => {
    const { recipients, rejected } = selectRecipients([
      { ...jeton, token: 'valide-1' },
      { ...jeton, token: undefined },
      { ...jeton, token: 'valide-2' },
    ]);

    expect(recipients.map((r) => r.token)).toEqual(['valide-1', 'valide-2']);
    expect(rejected).toHaveLength(1);
  });

  it('nomme la raison du refus plutôt que de l’exclure en silence', () => {
    // Une exclusion muette est indiscernable d'un parent qui n'a jamais
    // enregistré d'appareil : le journal ne permettrait pas de trancher.
    const { rejected } = selectRecipients([{ ...jeton, platform: 'blackberry' }]);

    expect(rejected).toEqual([
      { token: 'ExponentPushToken[abc]', reason: 'plateforme inconnue : blackberry' },
    ]);
  });

  // --- Documents inutilisables ----------------------------------------------

  it('écarte un document sans jeton', () => {
    for (const token of [undefined, null, '', '   ', 42]) {
      const { recipients, rejected } = selectRecipients([{ ...jeton, token }]);
      expect(recipients).toEqual([]);
      expect(rejected[0]?.reason).toBe('jeton absent ou illisible');
    }
  });

  it('écarte un document dont la plateforme est absente ou inconnue', () => {
    for (const platform of [undefined, null, '', 'ios ', 7]) {
      const { recipients } = selectRecipients([{ ...jeton, platform }]);
      expect(recipients).toEqual([]);
    }
  });

  it('écarte une entrée qui n’est pas un objet', () => {
    const { recipients, rejected } = selectRecipients([null, 'texte', 42]);

    expect(recipients).toEqual([]);
    expect(rejected).toHaveLength(3);
    expect(rejected[0]?.token).toBeNull();
  });

  it('accepte les trois plateformes déclarées', () => {
    for (const platform of ['ios', 'android', 'web']) {
      expect(selectRecipients([{ ...jeton, platform }]).recipients).toHaveLength(1);
    }
  });

  // --- Le repli ouvert : la préférence --------------------------------------

  it('traite des préférences illisibles comme « rien de désactivé »', () => {
    // Le sens du repli, et il est délibéré : une préférence qu'on ne sait pas
    // lire ne doit pas rendre muet. Une fermeture d'école manquée ne se
    // rattrape pas.
    for (const disabledCategories of [undefined, null, 'discussions', 42, {}]) {
      const { recipients } = selectRecipients([{ ...jeton, disabledCategories }]);
      expect(recipients[0]?.disabledCategories).toEqual([]);
    }
  });

  it('écarte les catégories inconnues sans toucher aux connues', () => {
    const { recipients } = selectRecipients([
      { ...jeton, disabledCategories: ['discussions', 'categorie_inconnue', 42, 'agenda'] },
    ]);

    expect(recipients[0]?.disabledCategories).toEqual(['discussions', 'agenda']);
  });

  it('conserve urgent, que seul le filtre d’envoi ignore', () => {
    // Un document écrit avant que le schéma ne refuse `urgent` peut encore la
    // porter. La retirer ici serait une seconde décision, à un endroit qui ne
    // décide pas de l'envoi : c'est `filterRecipients` qui tranche, et lui seul.
    const { recipients } = selectRecipients([
      { ...jeton, disabledCategories: ['urgent', 'discussions'] },
    ]);

    expect(recipients[0]?.disabledCategories).toEqual(['urgent', 'discussions']);
  });

  // --- Le repli ouvert : l'interrupteur général ------------------------------

  it('n’éteint un appareil que sur un `false` explicite', () => {
    // L'interrupteur général est lu ici et appliqué par `filterRecipients`, qui
    // fait passer les alertes obligatoires outre. Le repli est **ouvert** : un
    // champ absent n'est pas une décision de l'utilisateur.
    expect(selectRecipients([{ ...jeton, enabled: false }]).recipients[0]?.enabled).toBe(false);
    expect(selectRecipients([{ ...jeton, enabled: true }]).recipients[0]?.enabled).toBe(true);
  });

  it('traite un interrupteur illisible comme activé', () => {
    // Même sens que pour `disabledCategories`, et pour la même raison : rendre
    // muet un parent dont le document est incomplet serait pire qu'un envoi de
    // trop. Une fermeture d'école manquée ne se rattrape pas.
    for (const enabled of [undefined, null, 0, '', 'false', {}]) {
      expect(selectRecipients([{ ...jeton, enabled }]).recipients[0]?.enabled).toBe(true);
    }
  });

  // --- Le repli fermé : l'audience ------------------------------------------

  it('traite une audience illisible comme vide', () => {
    // Sens inverse, et tout aussi délibéré : un appareil dont on ne sait pas
    // ce qu'il doit recevoir ne reçoit rien.
    for (const audienceKeys of [undefined, null, 'org:fl', 42, {}]) {
      const { recipients } = selectRecipients([{ ...jeton, audienceKeys }]);
      expect(recipients[0]?.audienceKeys).toEqual([]);
    }
  });

  it('écarte les clés d’audience qui ne sont pas du texte', () => {
    const { recipients } = selectRecipients([
      { ...jeton, audienceKeys: ['org:fl', 7, null, '', 'school:lumiere'] },
    ]);

    expect(recipients[0]?.audienceKeys).toEqual(['org:fl', 'school:lumiere']);
  });

  it('accepte un jeton sans audience ni préférences', () => {
    // Le document minimal : ni `enabled`, ni `audienceKeys`, ni
    // `disabledCategories`. L'appareil reste **activé** — c'est le repli ouvert
    // de l'interrupteur — et il ne recevra rien, faute d'audience.
    const { recipients, rejected } = selectRecipients([
      { token: 'ExponentPushToken[seul]', platform: 'ios' },
    ]);

    expect(rejected).toEqual([]);
    expect(recipients[0]).toEqual({
      token: 'ExponentPushToken[seul]',
      platform: 'ios',
      enabled: true,
      audienceKeys: [],
      disabledCategories: [],
    });
  });

  it('ne rend rien pour une liste vide', () => {
    expect(selectRecipients([])).toEqual({ recipients: [], rejected: [] });
  });
});

describe('excludeOwners', () => {
  /** Deux appareils, portés par deux personnes différentes. */
  const appareils = [
    { token: 'ExponentPushToken[a]', uid: 'u1' },
    { token: 'ExponentPushToken[b]', uid: 'u2' },
  ];

  it('retire les appareils des porteurs exclus', () => {
    expect(excludeOwners(appareils, ['u2'])).toEqual([appareils[0]]);
  });

  it('retire tous les appareils d’un même porteur', () => {
    const deuxTelephones = [
      { token: 'ExponentPushToken[a]', uid: 'u1' },
      { token: 'ExponentPushToken[b]', uid: 'u1' },
      { token: 'ExponentPushToken[c]', uid: 'u2' },
    ];

    expect(excludeOwners(deuxTelephones, ['u1'])).toEqual([deuxTelephones[2]]);
  });

  it('rend une copie quand personne n’est exclu', () => {
    const rendu = excludeOwners(appareils, []);

    expect(rendu).toEqual(appareils);
    // Une copie, et non la liste reçue : le chemin d'envoi ne doit pas pouvoir
    // modifier par effet de bord la liste qu'un appelant garde en main.
    expect(rendu).not.toBe(appareils);
  });

  it('conserve un appareil dont le porteur est illisible', () => {
    // Le repli est **ouvert**, comme pour `enabled` : `uid` est écrit par le
    // serveur à l'enregistrement, et son absence signale un document abîmé, pas
    // quelqu'un à qui l'on veut cacher quelque chose. Écarter l'appareil
    // ferait payer à un parent l'irrégularité d'un document.
    const abime = [
      { token: 'ExponentPushToken[a]' },
      { token: 'ExponentPushToken[b]', uid: 42 },
      { token: 'ExponentPushToken[c]', uid: 'u2' },
    ];

    expect(excludeOwners(abime, ['u2'])).toEqual([abime[0], abime[1]]);
  });

  it('conserve un document illisible', () => {
    // C'est `selectRecipients` qui l'écartera, en le nommant. Le retirer ici le
    // ferait disparaître sans trace, indiscernable d'un appareil qui n'existe
    // pas.
    expect(excludeOwners([null, 'texte'], ['u1'])).toEqual([null, 'texte']);
  });
});
