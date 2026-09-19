/**
 * Le dépôt des sondages, éprouvé sur une base **injectable**.
 *
 * ## Ce que ce fichier prouve, et ce qu'il ne prouve pas
 *
 * Il prouve ce que le **dépôt** décide : quels états il refuse, avec quel code,
 * et ce qu'il écrit exactement quand il accepte. Il ne prouve **rien** de
 * Firestore — `firebase/firestore` est remplacé par un faux, et une écriture
 * acceptée ici peut parfaitement être refusée par les règles.
 *
 * Les deux moitiés sont donc nécessaires, et elles vivent séparément.
 * `packages/testing/src/firestore.rules.test.ts` fixe ce que les **règles**
 * permettent — que `draft` → `open` est autorisé à la FCPE, qu'un parent ne
 * peut pas écrire le statut, et qu'un sondage clos est rouvrable par la règle.
 * Ici, on mesure la couche au-dessus : celle dont le rôle est de refuser ce qui
 * n'a pas de sens **avant** de partir, et de rendre un message lisible plutôt
 * qu'un `permission-denied` générique.
 *
 * ## Pourquoi un faux, et pas l'émulateur
 *
 * Le dépôt ne contient aucune règle. Il traduit une intention en écriture, et
 * refuse les états qui n'ont pas de sens. C'est cette décision-là qu'on mesure,
 * et elle n'a pas besoin d'un serveur.
 *
 * Le faux est donc délibérément **bête** : il enregistre, il restitue, et il ne
 * juge rien. C'est le point — un faux qui *déciderait* quelque chose mesurerait
 * le faux, et un test vert ne dirait plus rien du code de production.
 *
 * ## Il n'y a que `open` ici, et c'est le premier du genre
 *
 * `create`, `vote` et `close` ne sont pas couverts : ce fichier existe pour le
 * chemin qui manquait, et le harnais qu'il pose est réutilisable tel quel pour
 * les trois autres. Les couvrir est un travail distinct, pas une extension
 * gratuite de celui-ci.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Firestore } from 'firebase/firestore';
// Le module entier, en **type** seulement : la fabrique ci-dessous en a besoin
// pour typer ce qu'`importOriginal()` lui rend. La règle de lint interdit
// l'annotation `import()` en ligne, et elle a raison — un `import type` nommé se
// lit, se cherche et se réutilise.
import type * as sdkFirestore from 'firebase/firestore';
import type { AppError } from '@fl/types';

import { createPollRepository } from './polls.js';

/**
 * Ce que rend `serverTimestamp()`.
 *
 * Une sentinelle reconnaissable, et surtout **pas** une date : le dépôt ne doit
 * jamais poser `new Date()`, et un test qui accepterait n'importe quoi ici ne
 * verrait pas la différence. Le faux Firestore la stocke telle quelle, comme le
 * vrai stocke une intention d'horodatage que le serveur résout.
 */
const SENTINELLE = { __sentinelle: 'serverTimestamp' } as const;

interface DocFactice {
  readonly path: string;
  readonly id: string;
}

/** Les documents du faux Firestore, par chemin. */
const documents = new Map<string, Record<string, unknown>>();

/** Les écritures observées, dans l'ordre où elles ont été demandées. */
const ecritures: Array<{ path: string; data: Record<string, unknown>; options: unknown }> = [];

/**
 * Remplace `firebase/firestore` en gardant le reste du module réel.
 *
 * `importOriginal` n'est pas une commodité : `pagination.ts` importe `getDocs`,
 * `limit`, `query` et `startAfter` du même module. Une fabrique qui n'exporterait
 * que les cinq fonctions utilisées ici ferait échouer l'import — Vitest refuse un
 * nom absent d'un module simulé, avant même d'exécuter le moindre test.
 */
vi.mock('firebase/firestore', async (importOriginal) => {
  const reel = await importOriginal<typeof sdkFirestore>();

  const faux = {
    collection: (_db: unknown, path: string): { path: string } => ({ path }),

    // Appelé de deux façons : `doc(db, 'polls/x')` et
    // `doc(collection(db, 'polls'))`, où le second argument est la collection.
    doc: (premier: unknown, second?: unknown): DocFactice => {
      const path =
        typeof second === 'string'
          ? second
          : `${(premier as { path: string }).path}/identifiant-genere`;
      return { path, id: path.slice(path.lastIndexOf('/') + 1) };
    },

    getDoc: async (ref: DocFactice) => {
      const donnees = documents.get(ref.path);
      return {
        id: ref.id,
        exists: () => donnees !== undefined,
        data: () => donnees,
      };
    },

    setDoc: async (ref: DocFactice, data: Record<string, unknown>, options?: unknown) => {
      ecritures.push({ path: ref.path, data, options });
      const fusionner = (options as { merge?: boolean } | undefined)?.merge === true;
      documents.set(ref.path, { ...(fusionner ? documents.get(ref.path) : {}), ...data });
    },

    serverTimestamp: () => SENTINELLE,
  };

  return { ...reel, ...faux } as unknown as typeof reel;
});

const depot = createPollRepository({} as Firestore);

/**
 * Attend un refus, et le rend.
 *
 * Il **lève** si l'appel réussit : c'est la seule partie qui compte, et un
 * `catch` qui rendrait `undefined` sans rien dire ferait passer un appel accepté
 * pour un appel refusé. Le code et le message restent à vérifier par l'appelant,
 * parce que « refusé » ne dit pas **pourquoi** — c'est le piège que `assertFails`
 * tend aussi, et il se referme de la même façon.
 */
async function refusDe(appel: Promise<unknown>): Promise<AppError> {
  let resultat: unknown;
  let refuse = false;

  try {
    resultat = await appel;
  } catch (error) {
    refuse = true;
    resultat = error;
  }

  if (!refuse) {
    throw new Error(`l’appel devait être refusé, et il a rendu ${JSON.stringify(resultat)}`);
  }

  return resultat as AppError;
}

describe('PollRepository.open', () => {
  beforeEach(() => {
    documents.clear();
    ecritures.length = 0;

    documents.set('polls/poll-brouillon', {
      question: 'Faut-il ouvrir un second créneau de cantine ?',
      status: 'draft',
      orgId: 'org-test',
    });
    documents.set('polls/poll-ouvert', {
      question: 'Faut-il maintenir la kermesse ?',
      status: 'open',
      orgId: 'org-test',
    });
    documents.set('polls/poll-clos', {
      question: 'Faut-il maintenir la kermesse ?',
      status: 'closed',
      orgId: 'org-test',
    });
    // Le cas qui décide d'une ligne de conduite : un brouillon dont l'échéance
    // est déjà passée. Voir le test qui le vise.
    documents.set('polls/poll-brouillon-echu', {
      question: 'Faut-il maintenir la kermesse ?',
      status: 'draft',
      endsAt: new Date('2020-01-01T00:00:00Z'),
      orgId: 'org-test',
    });
  });

  it('publie un brouillon, et n’écrit que trois champs', async () => {
    await depot.open('poll-brouillon');

    expect(ecritures).toHaveLength(1);
    const ecriture = ecritures[0];

    expect(ecriture?.path).toBe('polls/poll-brouillon');
    // Les trois, et pas un de plus : `toEqual` refuse un champ surnuméraire, et
    // c'est voulu — le sondage porte `audienceKeys` et `options` que les règles
    // valident, et une écriture qui les omettrait sans `merge` les effacerait.
    expect(ecriture?.data).toEqual({
      status: 'open',
      startsAt: SENTINELLE,
      updatedAt: SENTINELLE,
    });
    // `merge` n'est pas une commodité : sans lui, `setDoc` **remplace** le
    // document, et `validPoll()` refuserait alors un sondage sans question ni
    // réponses — un refus qui ne nomme pas la cause, et un sondage perdu.
    expect(ecriture?.options).toEqual({ merge: true });
  });

  it('date la publication d’aujourd’hui, et non de la création du brouillon', async () => {
    // `startsAt` est ce que l'écran affiche en « mis en ligne le », et ce sur
    // quoi la liste d'administration est triée. Un brouillon enregistré il y a
    // trois semaines et publié aujourd'hui doit donc remonter en tête, et non
    // rester à sa place de brouillon — sinon le sondage qu'on vient de publier
    // disparaît de la première page.
    await depot.open('poll-brouillon');

    expect(ecritures[0]?.data.startsAt).toBe(SENTINELLE);
  });

  it('refuse un sondage déjà publié, et n’écrit rien', async () => {
    const refus = await refusDe(depot.open('poll-ouvert'));

    expect(ecritures).toHaveLength(0);
    expect(refus.code).toBe('failed-precondition');
    expect(refus.message).toContain('déjà publié');
    // Le message de ce cas ne doit pas être celui de la réouverture : les deux
    // refusent, et pour deux raisons différentes.
    expect(refus.message).not.toContain('notification');
  });

  it('refuse un sondage clos, et n’écrit rien', async () => {
    // Le refus qui compte : rouvrir changerait ce que la règle autorise, après
    // une clôture annoncée, et **aucune notification ne le dirait** —
    // `notifiedAt` est déjà posé, donc le plan s'arrête sur cette garde.
    const refus = await refusDe(depot.open('poll-clos'));

    expect(ecritures).toHaveLength(0);
    expect(refus.code).toBe('failed-precondition');
    expect(refus.message).toContain('notification');
  });

  it('refuse un sondage absent', async () => {
    const refus = await refusDe(depot.open('poll-inexistant'));

    expect(ecritures).toHaveLength(0);
    expect(refus.code).toBe('not-found');
  });

  it('publie un brouillon dont l’échéance est déjà passée', async () => {
    // Décision, et non oubli. Publier envoie une notification pour un sondage
    // que la règle refuse déjà — c'est laid, et ce n'est pourtant pas un motif
    // d'interdire : aucun écran ne corrige `endsAt`, donc refuser ici
    // **enfermerait** ce brouillon, ni ouvrable ni corrigeable. L'avertissement
    // appartient à l'écran ; la décision appartient à la FCPE.
    //
    // Ce test est aussi ce qui interdit de lire le statut **effectif** ici :
    // `pollEffectiveStatus` reclasse `open` sur une échéance passée, jamais
    // `draft` — les deux lectures donnent donc la même réponse, et c'est
    // précisément pourquoi la question ne se pose pas.
    await depot.open('poll-brouillon-echu');

    expect(ecritures).toHaveLength(1);
    expect(ecritures[0]?.data.status).toBe('open');
  });
});
