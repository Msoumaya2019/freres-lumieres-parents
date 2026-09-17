/**
 * Les deux règles qui ne se voient pas à l'œil.
 *
 * Un appui sur un bouton d'action et un appui sur le corps arrivent par le
 * même hook ; et le hook rend le même objet à chaque rendu. Ces deux faits
 * produisent des défauts discrets — un écran ouvert pour rien, une pile de
 * trois écrans identiques — qu'aucune vérification manuelle ne distingue d'un
 * fonctionnement normal. D'où ces tests.
 */
import { describe, expect, it } from 'vitest';

import { cibleDeLaNotification, type ReponseNotification } from './notification-target';

const ACTION_PAR_DEFAUT = 'expo.modules.notifications.actions.DEFAULT';

/** Réponse d'un appui sur le corps d'une notification de publication. */
function appui(overrides: Partial<ReponseNotification> = {}): ReponseNotification {
  return {
    identifiant: 'notification-1',
    action: ACTION_PAR_DEFAUT,
    donnees: { deeplink: 'frereslumieres://post/post-abc123' },
    ...overrides,
  };
}

function cible(reponse: ReponseNotification | null | undefined, dejaTraitee: string | null = null) {
  return cibleDeLaNotification(reponse, { dejaTraitee, actionParDefaut: ACTION_PAR_DEFAUT });
}

describe('cible d’une notification', () => {
  it('rend la route de la publication annoncée', () => {
    expect(cible(appui())).toEqual({
      identifiant: 'notification-1',
      route: '/post/post-abc123',
    });
  });

  it('ne rend rien quand aucune notification n’a été appuyée', () => {
    // Le hook rend `undefined` tant qu'il ne sait pas, puis `null`. Les deux
    // doivent être traités comme « rien à faire ».
    expect(cible(undefined)).toBeNull();
    expect(cible(null)).toBeNull();
  });

  it('ne rend rien pour un appui sur un bouton d’action', () => {
    // Sans ce filtre, appuyer sur « Marquer comme lu » ouvrirait le contenu —
    // et l'utilisateur ne comprendrait pas pourquoi l'écran a changé.
    expect(cible(appui({ action: 'marquer-lu' }))).toBeNull();
  });

  it('ne rend rien pour une notification déjà traitée', () => {
    // Le hook rend le même objet à chaque rendu. Sans cette mémoire, chaque
    // changement de thème rouvrirait le même écran.
    expect(cible(appui(), 'notification-1')).toBeNull();
  });

  it('traite de nouveau une notification différente', () => {
    // La borne opposée : un dédoublonnage qui bloquerait tout passerait le
    // test précédent sans rien valoir, et l'application n'ouvrirait plus
    // jamais la seconde notification.
    expect(cible(appui({ identifiant: 'notification-2' }), 'notification-1')).toEqual({
      identifiant: 'notification-2',
      route: '/post/post-abc123',
    });
  });

  it('ne rend rien quand le lien est absent ou illisible', () => {
    // Une notification sans lien n'ouvre rien : l'application reste où elle
    // est, plutôt que d'aller sur un écran « introuvable ».
    expect(cible(appui({ donnees: {} }))).toBeNull();
    expect(cible(appui({ donnees: { deeplink: 'frereslumieres://facture/x' } }))).toBeNull();
    expect(cible(appui({ donnees: { deeplink: 42 } }))).toBeNull();
  });

  it('ne lève pas sur une charge utile d’un type inattendu', () => {
    // La charge utile traverse un service tiers et le système d'exploitation :
    // elle peut être n'importe quoi. Une exception ici ferait planter le
    // rendu du layout racine, donc toute l'application.
    for (const donnees of [undefined, null, 'texte', 7, [], true]) {
      expect(() => cible(appui({ donnees }))).not.toThrow();
      expect(cible(appui({ donnees }))).toBeNull();
    }
  });
});
