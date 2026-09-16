/**
 * Tests du repository du journal d'audit.
 *
 * ## Ce qui était déjà couvert, et ce qui ne l'était pas
 *
 * Les **règles** sont testées ailleurs : un administrateur lit le journal, un
 * parent ne le lit pas, et personne n'y écrit — pas même un administrateur.
 * Ce qui restait sans vérification, c'est la **requête** elle-même.
 *
 * L'omission serait silencieuse, et c'est ce qui la rend dangereuse : une
 * clause `where` perdue rendrait toutes les entrées au lieu de celles de
 * l'action demandée. L'écran afficherait une liste plus longue que prévu, sans
 * erreur ni message — un filtre qui ne filtre pas ne se distingue pas d'un
 * journal où tout porterait la même action. Aucune règle de sécurité ne
 * s'en apercevrait : la lecture reste autorisée, c'est le résultat qui est
 * faux.
 *
 * ## Ce que ces tests exercent
 *
 * Le parcours d'une collection **filtrée**, page après page, comme le ferait
 * l'écran. Deux mécanismes distincts s'y composent : le filtre et le curseur.
 * Les éprouver séparément laisserait passer le cas où `startAfter` s'applique
 * avant le `where` — ou ne s'applique qu'à la requête non filtrée.
 *
 * Le volume est choisi pour que **plusieurs pages** soient nécessaires quelle
 * que soit la taille de page raisonnable : 60 entrées de l'action observée,
 * quand le repository en demande 25 par page. Si ce nombre venait à changer,
 * les assertions « au moins deux pages » le signaleraient — c'est voulu, une
 * pagination qu'on ne parcourt plus ne se vérifie plus.
 *
 * ## Exécution
 *
 * Comme les tests de règles, ce fichier exige un émulateur :
 *
 *     npm run rules:test
 *
 * Sans `FIRESTORE_EMULATOR_HOST`, la suite est ignorée plutôt que mise en
 * échec.
 *
 * ## Pourquoi la source est importée directement
 *
 * `@fl/firebase` est consommé depuis son `dist`, compilé en **CommonJS** : il
 * appelle `require('firebase/firestore')`, donc l'entrée CJS du SDK, tandis
 * qu'un test qui écrit `import … from 'firebase/firestore'` reçoit l'entrée
 * ESM. Firestore refuse alors les objets qui passent d'une instance à l'autre
 * (« Type does not match the expected instance »). Le détail du diagnostic est
 * dans l'en-tête de `pagination.test.ts` ; la conclusion est la même : on lit
 * la **source**, et les deux côtés passent par Vite, qui ne résout
 * `firebase/firestore` qu'une fois.
 */
import type { AdminLog } from '@fl/types';
import { doc, setDoc, type Firestore, type QueryDocumentSnapshot } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { FirestorePage } from '../../firebase/src/pagination.js';
import {
  createAdminLogRepository,
  type AdminLogFilter,
  type AdminLogRepository,
} from '../../firebase/src/repositories/admin-logs.js';

import { createRulesTestEnvironment, type RulesTestEnvironment } from './env.js';

const EMULATOR_AVAILABLE = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const COLLECTION = 'adminLogs';

/**
 * Construit le repository sur le `db` du harnais.
 *
 * `@firebase/rules-unit-testing` déclare `firestore()` d'après le namespace
 * **compat** (`firebase.firestore.Firestore`), alors que le repository attend
 * le type modulaire de `firebase/firestore`. Sa propre documentation précise
 * pourtant que la méthode rend « a Firebase JS Client SDK instance » : à
 * l'exécution c'est bien la même, et `pagination.test.ts` la passe déjà sans
 * difficulté aux fonctions modulaires. Seules les deux déclarations ne se
 * recouvrent pas.
 *
 * Le transtypage est donc confiné au harnais. Il ne dit rien du code de
 * production, qui reçoit le `db` de `initializeFirebase()`, correctement typé.
 */
function depotDe(db: unknown): AdminLogRepository {
  return createAdminLogRepository(db as Firestore);
}

/** Action observée : celle dont on parcourt le sous-ensemble. */
const ACTION_OBSERVEE = 'user.approve';
/** Action témoin : elle doit rester invisible quand on filtre sur l'autre. */
const ACTION_TEMOIN = 'post.create';
/** Action sans aucune entrée : sert à éprouver le filtre vide. */
const ACTION_ABSENTE = 'poll.close';

const NB_OBSERVEES = 60;
const NB_TEMOINS = 15;
const TOTAL = NB_OBSERVEES + NB_TEMOINS;

/** Instant de référence. Les entrées s'échelonnent à la minute, donc uniques. */
const ORIGINE = Date.UTC(2026, 8, 1, 8, 0, 0);

/** Le rang est porté par le document, ce qui rend l'ordre attendu lisible. */
function rangDe(entree: AdminLog): number {
  const rang = entree.metadata.rang;
  return typeof rang === 'number' ? rang : -1;
}

/**
 * Rangs attendus pour un ensemble, **du plus récent au plus ancien**.
 *
 * La requête trie sur `at` décroissant, et `at` croît avec le rang : la suite
 * attendue est donc décroissante. L'écrire à la main est le meilleur moyen de
 * se tromper de sens.
 */
function rangsAttendus(premier: number, nombre: number): number[] {
  return Array.from({ length: nombre }, (_, index) => premier + nombre - 1 - index);
}

describe.skipIf(!EMULATOR_AVAILABLE)('Repository du journal d’audit', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await createRulesTestEnvironment('demo-fl-admin-logs-test');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      for (let rang = 0; rang < TOTAL; rang += 1) {
        const observee = rang < NB_OBSERVEES;

        await setDoc(doc(db, COLLECTION, `entree-${String(rang).padStart(3, '0')}`), {
          actorId: 'administrateur',
          actorName: 'Administrateur de test',
          actorRole: 'admin',
          action: observee ? ACTION_OBSERVEE : ACTION_TEMOIN,
          targetType: 'user',
          targetId: `cible-${String(rang)}`,
          metadata: { rang },
          // Le serveur écrit un horodatage ; ici il est explicite, pour que
          // l'ordre attendu soit une donnée du test et non une coïncidence.
          at: new Date(ORIGINE + rang * 60_000),
        });
      }
    });
  });

  /**
   * Parcourt tout ce que rend un filtre, page après page, comme un écran qui
   * appellerait « charger la suite » jusqu'à épuisement.
   *
   * Le garde-fou sur le nombre de pages est essentiel : sans lui, un curseur
   * non appliqué ferait tourner la boucle indéfiniment, et le test se
   * bloquerait au lieu d'échouer. Un test qui pend n'apprend rien.
   *
   * Les accumulateurs sont déclarés **hors** du rappel :
   * `withSecurityRulesDisabled` n'accepte qu'un rappel sans valeur de retour.
   */
  async function parcourir(filtre: AdminLogFilter): Promise<{
    ids: string[];
    rangs: number[];
    pages: number;
    tailles: number[];
  }> {
    const ids: string[] = [];
    const rangs: number[] = [];
    const tailles: number[] = [];
    let pages = 0;

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const depot = depotDe(context.firestore());
      let cursor: QueryDocumentSnapshot | null = null;

      for (;;) {
        // Annotation explicite : sans elle, le type de `page` dépend de
        // `cursor`, réassigné depuis `page.nextCursor`, et TypeScript renonce à
        // l'inférence (TS7022).
        const page: FirestorePage<AdminLog> = await depot.list(filtre, cursor);

        pages += 1;
        tailles.push(page.items.length);
        for (const entree of page.items) {
          ids.push(entree.id);
          rangs.push(rangDe(entree));
        }

        if (page.nextCursor === null) break;
        cursor = page.nextCursor;

        if (pages > TOTAL + 1) {
          throw new Error(
            `La pagination ne progresse pas : ${pages} pages lues pour ${TOTAL} entrées. ` +
              'Le curseur n’est probablement pas appliqué à la requête.',
          );
        }
      }
    });

    return { ids, rangs, pages, tailles };
  }

  const filtreObserve: AdminLogFilter = { kind: 'action', action: ACTION_OBSERVEE };

  describe('sans filtre', () => {
    it('parcourt tout le journal, une seule fois chaque entrée', async () => {
      const { ids } = await parcourir({ kind: 'all' });

      expect(ids).toHaveLength(TOTAL);
      expect(new Set(ids).size).toBe(TOTAL);
    });

    it('avance d’une page à l’autre', async () => {
      const { pages } = await parcourir({ kind: 'all' });

      expect(pages).toBeGreaterThan(1);
    });

    it('rend les entrées de la plus récente à la plus ancienne', async () => {
      const { rangs } = await parcourir({ kind: 'all' });

      // Strictement décroissant : deux entrées de même horodatage rendraient
      // l'ordre indéterminé, donc le test instable.
      expect(rangs).toEqual([...rangs].sort((a, b) => b - a));
      expect(new Set(rangs).size).toBe(TOTAL);
    });
  });

  describe('filtré par type d’action', () => {
    it('ne rend que l’action demandée', async () => {
      // L'assertion qui attrape le `where` oublié : sans filtre, les quinze
      // entrées témoins s'ajouteraient aux soixante attendues.
      const { ids, rangs } = await parcourir(filtreObserve);

      expect(ids).toHaveLength(NB_OBSERVEES);
      expect(rangs).toEqual(rangsAttendus(0, NB_OBSERVEES));
    });

    it('suit l’action demandée plutôt qu’une action figée', async () => {
      // Le filtre doit être paramétré. Une clause codée en dur sur
      // `user.approve` passerait tout ce qui précède — il suffit de demander
      // l'autre action pour la démasquer.
      const { ids, rangs } = await parcourir({ kind: 'action', action: ACTION_TEMOIN });

      expect(ids).toHaveLength(NB_TEMOINS);
      expect(rangs).toEqual(rangsAttendus(NB_OBSERVEES, NB_TEMOINS));
    });

    it('avance d’une page à l’autre sur une requête filtrée', async () => {
      // Le curseur et le filtre se composent : une implémentation qui
      // n'appliquerait `startAfter` qu'à la requête non filtrée passerait les
      // deux tests précédents, puisqu'ils parcourent tout en une page.
      const { pages, tailles } = await parcourir(filtreObserve);

      expect(pages).toBeGreaterThan(1);

      // La dernière page est la seule à pouvoir être partielle. La taille de
      // page n'est pas recopiée ici : c'est la première page qui la donne.
      const [premiere = 0] = tailles;
      expect(tailles.slice(0, -1).every((taille) => taille === premiere)).toBe(true);
      expect(tailles[tailles.length - 1]).toBeLessThanOrEqual(premiere);
    });

    it('rend le sous-ensemble dans l’ordre décroissant', async () => {
      const { rangs } = await parcourir(filtreObserve);

      expect(rangs).toEqual([...rangs].sort((a, b) => b - a));
    });

    it('rend une page vide et annonce la fin quand rien ne correspond', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const depot = depotDe(context.firestore());

        const page = await depot.list({ kind: 'action', action: ACTION_ABSENTE });

        expect(page.items).toEqual([]);
        expect(page.hasMore).toBe(false);
        expect(page.nextCursor).toBeNull();
      });
    });
  });
});
