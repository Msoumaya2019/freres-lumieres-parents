/**
 * Règles de décompte des voix d'un sondage.
 *
 * ## Pourquoi ces tests existent
 *
 * Le calcul décide de ce que le sondage **affiche**. Il porte trois règles qu'un
 * déclencheur ne peut pas rendre évidentes : un changement de vote *déplace* une
 * voix au lieu d'en ajouter une ; le décompte parcourt les options du
 * **sondage**, jamais celles du vote — c'est ce qui empêche un client
 * d'inventer une réponse ; et les comptes existants se retrouvent par
 * **identifiant**, dans un document de résultats distinct, qui peut les porter
 * dans un autre ordre.
 *
 * ## Ce que ces tests ne couvrent pas
 *
 * La transaction elle-même, et la lecture des deux documents. Elle demande
 * l'émulateur et un harnais de déclencheurs, qui n'existe pas dans ce dépôt —
 * même limite que `counters.test.ts`. Le risque résiduel est une erreur de
 * plomberie, pas une erreur de comptage.
 */
import { describe, expect, it } from 'vitest';

import { appliquerVote, voteDeltas } from './poll-counters.js';

/** Vote réduit à ce que le calcul regarde. */
function vote(...optionIds: string[]) {
  return { optionIds };
}

/**
 * Sondage réduit à ce que le calcul regarde.
 *
 * Il ne porte **aucun compteur** : c'est le point du modèle, et le refléter ici
 * évite qu'un test passe au vert sur une forme qui n'existe plus.
 */
function sondage(...ids: readonly string[]) {
  return { options: ids.map((id, order) => ({ id, label: id, order })) };
}

/** Document de résultats, dans l'ordre qu'on veut — c'est le cas intéressant. */
function resultats(totalVoters: number, ...comptes: readonly (readonly [string, number])[]) {
  return { totalVoters, options: comptes.map(([id, votes]) => ({ id, votes })) };
}

describe('voteDeltas', () => {
  it('compte la création d’un vote', () => {
    expect(voteDeltas(undefined, vote('yes'))).toEqual({ parOption: { yes: 1 }, votants: 1 });
  });

  it('déplace la voix quand le vote change, sans ajouter de votant', () => {
    // Le point qui compte : c'est la même personne. Compter +1 sur la nouvelle
    // réponse sans décompter l'ancienne gonflerait le total à chaque hésitation.
    expect(voteDeltas(vote('yes'), vote('no'))).toEqual({
      parOption: { no: 1, yes: -1 },
      votants: 0,
    });
  });

  it('n’applique rien quand le vote est réécrit à l’identique', () => {
    // Cas le plus fréquent : un rejeu du client, ou une livraison en double.
    expect(voteDeltas(vote('yes'), vote('yes'))).toEqual({ parOption: {}, votants: 0 });
  });

  it('décompte la suppression d’un vote', () => {
    expect(voteDeltas(vote('yes'), undefined)).toEqual({ parOption: { yes: -1 }, votants: -1 });
  });

  it('ne compte qu’une fois une réponse cochée deux fois', () => {
    // Les règles refusent déjà les doublons ; ce repli évite qu'une donnée
    // écrite par un autre chemin fasse dériver le total.
    expect(voteDeltas(undefined, vote('yes', 'yes'))).toEqual({
      parOption: { yes: 1 },
      votants: 1,
    });
  });

  it('compte chaque réponse d’un choix multiple', () => {
    expect(voteDeltas(undefined, vote('yes', 'peut_etre'))).toEqual({
      parOption: { yes: 1, peut_etre: 1 },
      votants: 1,
    });
  });

  it('ignore une liste d’options qui n’en est pas une', () => {
    // Le vote compte comme un participant, mais ne désigne aucune réponse : le
    // décompte des options ne verra rien à incrémenter.
    expect(voteDeltas(undefined, { optionIds: 'yes' })).toEqual({ parOption: {}, votants: 1 });
  });
});

describe('appliquerVote', () => {
  it('incrémente la réponse choisie et le nombre de participants', () => {
    const resultat = appliquerVote(
      sondage('yes', 'no'),
      resultats(0, ['yes', 3], ['no', 1]),
      voteDeltas(undefined, vote('yes')),
    );

    expect(resultat.options).toEqual([
      { id: 'yes', votes: 4 },
      { id: 'no', votes: 1 },
    ]);
    expect(resultat.totalVoters).toBe(1);
    expect(resultat.deriveDetectee).toBe(false);
  });

  it('part de zéro quand le document de résultats n’existe pas encore', () => {
    // Un sondage sans voix n'a pas de document de résultats : c'est le premier
    // vote qui le crée. Le cas le plus fréquent en production, et le seul où
    // les comptes n'ont rien à reprendre.
    const resultat = appliquerVote(sondage('yes', 'no'), {}, voteDeltas(undefined, vote('no')));

    expect(resultat.options).toEqual([
      { id: 'yes', votes: 0 },
      { id: 'no', votes: 1 },
    ]);
    expect(resultat.totalVoters).toBe(1);
  });

  it('n’ajoute jamais une réponse que le sondage ne propose pas', () => {
    // La propriété qui rend le résultat infalsifiable : le décompte parcourt les
    // options du sondage, pas celles du vote. Une réponse inventée est ignorée,
    // et ne peut donc pas apparaître dans les résultats.
    const resultat = appliquerVote(
      sondage('yes', 'no'),
      resultats(0, ['yes', 0], ['no', 0]),
      voteDeltas(undefined, vote('reponse_inventee')),
    );

    expect(resultat.options).toEqual([
      { id: 'yes', votes: 0 },
      { id: 'no', votes: 0 },
    ]);
    // Le participant, lui, est bien compté : il a voté, même mal.
    expect(resultat.totalVoters).toBe(1);
  });

  it('conserve le compte des réponses que le vote ne touche pas', () => {
    const resultat = appliquerVote(
      sondage('yes', 'no'),
      resultats(4, ['yes', 3], ['no', 1]),
      voteDeltas(undefined, vote('yes')),
    );

    expect(resultat.options[1]).toEqual({ id: 'no', votes: 1 });
  });

  it('retrouve une option par son identifiant, pas par sa position', () => {
    // C'est la raison de la transaction : réordonner les options ne doit pas
    // déplacer les voix d'une réponse à l'autre. Le document de résultats liste
    // ici `yes` en premier, le sondage `no` — une lecture par position
    // incrémenterait la mauvaise réponse.
    const resultat = appliquerVote(
      sondage('no', 'yes'),
      resultats(7, ['yes', 2], ['no', 5]),
      voteDeltas(undefined, vote('yes')),
    );

    expect(resultat.options).toEqual([
      { id: 'no', votes: 5 },
      { id: 'yes', votes: 3 },
    ]);
  });

  it('n’oublie pas une réponse absente du document de résultats', () => {
    // Le sondage fait autorité sur les options, le document de résultats sur
    // les comptes. Une réponse ajoutée après le dernier vote — l'administration
    // corrige une question — doit donc apparaître, à zéro, et recevoir sa voix.
    const resultat = appliquerVote(
      sondage('yes', 'no', 'nouvelle'),
      resultats(3, ['yes', 2], ['no', 1]),
      voteDeltas(undefined, vote('nouvelle')),
    );

    expect(resultat.options).toEqual([
      { id: 'yes', votes: 2 },
      { id: 'no', votes: 1 },
      { id: 'nouvelle', votes: 1 },
    ]);
  });

  it('ramène à zéro un décompte négatif, et le signale', () => {
    // Un rejeu de déclencheur applique le même delta deux fois. Un « −1
    // participant » n'a aucun sens à l'écran ; la dérive, elle, doit rester
    // visible dans les journaux.
    const resultat = appliquerVote(
      sondage('yes'),
      resultats(1, ['yes', 0]),
      voteDeltas(vote('yes'), undefined),
    );

    expect(resultat.options).toEqual([{ id: 'yes', votes: 0 }]);
    expect(resultat.totalVoters).toBe(0);
    expect(resultat.deriveDetectee).toBe(true);
  });

  it('tolère un sondage sans options', () => {
    // Un document écrit par un autre chemin ne doit pas faire échouer le
    // déclencheur : il n'y a rien à décompter, donc rien à signaler.
    const resultat = appliquerVote({}, {}, voteDeltas(undefined, vote('yes')));

    expect(resultat.options).toEqual([]);
    expect(resultat.totalVoters).toBe(1);
    expect(resultat.deriveDetectee).toBe(false);
  });
});
