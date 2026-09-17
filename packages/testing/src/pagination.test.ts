/**
 * Tests de la pagination par curseur.
 *
 * ## Pourquoi ce fichier existe
 *
 * `paginate` transmettait le curseur à `buildQuery`, à charge pour l'appelant
 * de l'appliquer. Sur les quatre listes paginées du projet — fil d'actualité,
 * liste d'administration, commentaires, file des comptes — **aucune** ne s'en
 * servait. Le curseur était accepté, renvoyé à l'écran, et jamais appliqué à
 * la requête.
 *
 * Le symptôme était silencieux : « charger la suite » relançait la première
 * page, la déduplication d'`appendPage` la réaffichait comme un ajout vide, et
 * la liste cessait simplement de grandir. Aucune erreur, aucun message. Le
 * seul coût visible était invisible : chaque clic relisait les mêmes
 * documents.
 *
 * Ces tests parcourent donc une collection **entièrement**, page après page,
 * comme le ferait un écran — c'est la seule façon de constater qu'une
 * pagination avance.
 *
 * ## Pourquoi les règles sont contournées
 *
 * Le sujet est la mécanique du curseur, pas la sécurité. La collection sonde
 * n'est déclarée nulle part dans `firestore.rules`, et c'est volontaire : elle
 * n'a aucune raison d'exister en production. Les lectures passent donc par un
 * contexte sans règles, ce qui évite de mêler deux préoccupations.
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
 * ESM. Ce sont deux instances distinctes du même paquet — vérifié, les
 * fonctions ne sont pas identiques — et Firestore refuse net les objets qui
 * passent de l'une à l'autre :
 *
 *     Type does not match the expected instance.
 *     Did you pass a reference from a different Firestore SDK?
 *
 * L'application ne connaît pas ce problème : Metro et Next regroupent tout en
 * un seul graphe de modules. C'est un artefact du harnais, et le seul moyen
 * simple de le contourner est de faire lire au test la **source** de
 * `paginate` plutôt que son `dist`. Les deux côtés passent alors par Vite, qui
 * résout `firebase/firestore` une seule fois.
 *
 * Une configuration `server.deps.inline: ['@fl/firebase']` a été essayée sans
 * effet : les six tests continuaient d'échouer à l'identique. Inutile de la
 * retenter.
 */
import {
  collection,
  doc,
  orderBy,
  query,
  setDoc,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Import de la source, et non de `@fl/firebase` : voir l'en-tête. Le chemin
// relatif est volontaire, il contourne délibérément la frontière du paquet.
import { paginate, type FirestorePage } from '../../firebase/src/pagination.js';

import { createRulesTestEnvironment, type RulesTestEnvironment } from './env.js';

const EMULATOR_AVAILABLE = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

/** Collection sonde, absente des règles : elle ne sert qu'ici. */
const COLLECTION = 'paginationProbe';

/** Volontairement non multiple de la taille de page : la dernière est partielle. */
const TOTAL = 7;
const PAGE_SIZE = 3;

/** Nombre de pages attendu : 3 + 3 + 1. */
const PAGES_ATTENDUES = 3;

interface Ligne {
  readonly id: string;
}

describe.skipIf(!EMULATOR_AVAILABLE)('Pagination par curseur', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await createRulesTestEnvironment('demo-fl-pagination-test');
  });

  afterAll(async () => {
    // `beforeAll` peut avoir échoué avant d'assigner `testEnv` — émulateur lent
    // à compiler les règles, port occupé. Sans cette garde, `afterAll` lève
    // « Cannot read properties of undefined (reading 'cleanup') » : une erreur
    // **en cascade**, qui remplace la cause réelle par un message qui ne dit
    // rien. Le défaut a été rencontré, et c'est ce qui a rendu un diagnostic
    // difficile.
    await testEnv?.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      for (let rang = 0; rang < TOTAL; rang += 1) {
        // L'identifiant suit le rang, ce qui rend l'ordre attendu lisible dans
        // le message d'échec.
        await setDoc(doc(db, COLLECTION, `ligne-${String(rang).padStart(2, '0')}`), { rang });
      }
    });
  });

  /**
   * Parcourt la collection page après page, comme un écran qui appellerait
   * « charger la suite » jusqu'à épuisement.
   *
   * Le garde-fou sur le nombre de pages est essentiel : sans lui, une
   * pagination qui n'avance pas ferait tourner la boucle indéfiniment, et le
   * test se bloquerait au lieu d'échouer. Un test qui pend n'apprend rien.
   *
   * Les accumulateurs sont déclarés **hors** du rappel : `withSecurityRulesDisabled`
   * n'accepte qu'un rappel sans valeur de retour.
   */
  async function parcourirTout(): Promise<{
    ids: string[];
    pages: number;
    curseursNuls: number;
    taillesDePage: number[];
  }> {
    const ids: string[] = [];
    const taillesDePage: number[] = [];
    let curseursNuls = 0;
    let pages = 0;

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      let cursor: QueryDocumentSnapshot | null = null;

      for (;;) {
        // Annotation explicite : sans elle, le type de `page` dépend de
        // `cursor`, qui est lui-même réassigné depuis `page.nextCursor`, et
        // TypeScript renonce à l'inférence (TS7022).
        const page: FirestorePage<Ligne> = await paginate<Ligne>({
          pageSize: PAGE_SIZE,
          cursor,
          buildQuery: () => query(collection(db, COLLECTION), orderBy('rang', 'asc')),
          mapDocument: (snapshot) => ({ id: snapshot.id }),
        });

        pages += 1;
        ids.push(...page.items.map((item) => item.id));
        taillesDePage.push(page.items.length);

        if (page.nextCursor === null) {
          curseursNuls += 1;
          break;
        }

        cursor = page.nextCursor;

        if (pages > TOTAL + 1) {
          throw new Error(
            `La pagination n’avance pas : ${pages} pages lues pour ${TOTAL} documents. ` +
              'Le curseur n’est probablement pas appliqué à la requête.',
          );
        }
      }
    });

    return { ids, pages, curseursNuls, taillesDePage };
  }

  it('parcourt tous les documents, une seule fois chacun', async () => {
    const { ids } = await parcourirTout();

    expect(ids).toHaveLength(TOTAL);
    expect(new Set(ids).size).toBe(TOTAL);
  });

  it('avance réellement d’une page à l’autre', async () => {
    // L'assertion qui attrape l'oubli du curseur : sans `startAfter`, chaque
    // page relit la première et la boucle ne se termine jamais.
    const { pages, taillesDePage } = await parcourirTout();

    expect(pages).toBe(PAGES_ATTENDUES);
    expect(taillesDePage).toEqual([PAGE_SIZE, PAGE_SIZE, TOTAL - 2 * PAGE_SIZE]);
  });

  it('rend les documents dans l’ordre demandé', async () => {
    const { ids } = await parcourirTout();

    expect(ids).toEqual([...ids].sort());
  });

  it('ne rend un curseur nul que sur la dernière page', async () => {
    const { curseursNuls } = await parcourirTout();

    expect(curseursNuls).toBe(1);
  });

  it('annonce qu’il reste des documents tant que c’est vrai', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      const premiere = await paginate<Ligne>({
        pageSize: PAGE_SIZE,
        buildQuery: () => query(collection(db, COLLECTION), orderBy('rang', 'asc')),
        mapDocument: (snapshot) => ({ id: snapshot.id }),
      });

      expect(premiere.items).toHaveLength(PAGE_SIZE);
      expect(premiere.hasMore).toBe(true);
    });
  });

  it('annonce la fin quand la page est la dernière', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      // Une page plus grande que la collection : tout tient d'un coup.
      const seule = await paginate<Ligne>({
        pageSize: TOTAL + 1,
        buildQuery: () => query(collection(db, COLLECTION), orderBy('rang', 'asc')),
        mapDocument: (snapshot) => ({ id: snapshot.id }),
      });

      expect(seule.items).toHaveLength(TOTAL);
      expect(seule.hasMore).toBe(false);
      expect(seule.nextCursor).toBeNull();
    });
  });
});
