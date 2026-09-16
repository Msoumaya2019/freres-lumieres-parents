/**
 * Tests des règles Firestore.
 *
 * Chaque test correspond à une frontière de sécurité annoncée dans
 * `docs/04-security.md`. Si l'un d'eux échoue, ce n'est pas le test qu'il faut
 * corriger : c'est la règle.
 *
 * Les cas de refus sont testés au même titre que les cas d'autorisation. Un
 * test qui ne vérifierait que les autorisations continuerait de passer si la
 * règle était supprimée — il ne protégerait donc rien.
 *
 * ## Exécution
 *
 * Ces tests ont besoin d'un émulateur Firestore :
 *
 *     npm run rules:test        # démarre l'émulateur, puis lance les tests
 *
 * `firebase emulators:exec` renseigne `FIRESTORE_EMULATOR_HOST`. En son
 * absence — c'est le cas de `npm run test`, qui tourne sans Java dans la CI —
 * la suite entière est ignorée plutôt que mise en échec. Un échec bruyant
 * apprendrait à contourner la commande ; un test ignoré se voit dans le
 * rapport.
 */
import {
  assertFails,
  assertSucceeds,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { CLAIMS, TEST_ORG, TEST_OTHER_ORG, UID, createRulesTestEnvironment } from './env.js';

/** L'émulateur est-il disponible ? Voir l'en-tête du fichier. */
const EMULATOR_AVAILABLE = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

let testEnv: RulesTestEnvironment;
let parent: RulesTestContext;
let fcpe: RulesTestContext;
let moderator: RulesTestContext;
let admin: RulesTestContext;
let pending: RulesTestContext;
let anonymous: RulesTestContext;

/** Profil minimal mais complet, tel que le produit le formulaire d'inscription. */
function userDocument(uid: string, status: 'pending' | 'active' = 'active') {
  return {
    id: uid,
    firstName: 'Camille',
    lastName: 'Durand',
    email: `${uid}@example.org`,
    role: 'parent',
    status,
    orgId: TEST_ORG,
    orgIds: [TEST_ORG],
    schoolIds: [],
    levels: [],
    classIds: [],
    audienceKeys: [`org:${TEST_ORG}`],
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function postDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-1',
    title: 'Réunion de rentrée',
    body: 'La réunion aura lieu le 12 septembre à 18 h.',
    category: 'information',
    status: 'published',
    orgId: TEST_ORG,
    authorId: UID.fcpe,
    audienceKeys: [`org:${TEST_ORG}`],
    stats: { commentCount: 0, reactionCount: 0 },
    publishedAt: new Date('2026-09-01T10:00:00Z'),
    createdAt: new Date('2026-09-01T09:00:00Z'),
    ...overrides,
  };
}

describe.skipIf(!EMULATOR_AVAILABLE)('Règles de sécurité Firestore', () => {
  beforeAll(async () => {
    testEnv = await createRulesTestEnvironment();

    parent = testEnv.authenticatedContext(UID.parent, CLAIMS.parent);
    fcpe = testEnv.authenticatedContext(UID.fcpe, CLAIMS.fcpe);
    moderator = testEnv.authenticatedContext(UID.moderator, CLAIMS.moderator);
    admin = testEnv.authenticatedContext(UID.admin, CLAIMS.admin);
    pending = testEnv.authenticatedContext(UID.parent, CLAIMS.pending);
    anonymous = testEnv.unauthenticatedContext();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();

    // Les données de départ sont écrites en contournant les règles : on teste
    // la lecture, pas la capacité du harnais à créer des documents.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      await setDoc(doc(db, 'users', UID.parent), userDocument(UID.parent, 'pending'));
      await setDoc(doc(db, 'users', UID.otherParent), userDocument(UID.otherParent, 'active'));
      await setDoc(doc(db, 'users', UID.fcpe), {
        ...userDocument(UID.fcpe, 'active'),
        role: 'fcpe',
      });
      await setDoc(doc(db, 'users', UID.parent, 'children', 'child-1'), {
        id: 'child-1',
        firstName: 'Léa',
        schoolId: 'ecole-elementaire',
        level: 'ce2',
        classId: 'ce2-a',
      });

      await setDoc(doc(db, 'posts', 'post-own-published'), postDocument());
      await setDoc(
        doc(db, 'posts', 'post-own-draft'),
        postDocument({ status: 'draft', publishedAt: null }),
      );
      await setDoc(
        doc(db, 'posts', 'post-other-org'),
        postDocument({ orgId: TEST_OTHER_ORG, audienceKeys: [`org:${TEST_OTHER_ORG}`] }),
      );

      await setDoc(doc(db, 'adminLogs', 'log-1'), {
        id: 'log-1',
        action: 'user.approve',
        actorId: UID.admin,
        orgId: TEST_ORG,
        createdAt: new Date('2026-09-01T10:00:00Z'),
      });

      await setDoc(doc(db, 'deviceTokens', 'token-1'), {
        token: 'token-1',
        uid: UID.parent,
        orgId: TEST_ORG,
        audienceKeys: [`org:${TEST_ORG}`],
      });

      await setDoc(doc(db, 'counters', TEST_ORG), {
        id: TEST_ORG,
        users: { total: 1, pending: 1, active: 0, suspended: 0, activeLast7Days: 0 },
      });

      await setDoc(doc(db, 'polls', 'poll-1'), {
        id: 'poll-1',
        question: 'Faut-il maintenir la kermesse ?',
        options: [
          { id: 'yes', label: 'Oui' },
          { id: 'no', label: 'Non' },
        ],
        status: 'open',
        orgId: TEST_ORG,
        audienceKeys: [`org:${TEST_ORG}`],
      });
      await setDoc(doc(db, 'polls', 'poll-1', 'votes', UID.otherParent), {
        pollId: 'poll-1',
        voterId: UID.otherParent,
        optionIds: ['yes'],
      });
    });
  });

  // -------------------------------------------------------------------------
  // Comptes non validés — la porte d'entrée du système
  // -------------------------------------------------------------------------

  describe('Comptes non validés', () => {
    // C'est LE critère de sortie de la Phase 2 : un compte en attente ne doit
    // rien voir, y compris en interrogeant Firestore directement.
    it('un compte « pending » ne peut pas lire une publication publiée', async () => {
      await assertFails(getDoc(doc(pending.firestore(), 'posts', 'post-own-published')));
    });

    it('un compte « pending » ne peut pas lister le fil d’actualité', async () => {
      const db = pending.firestore();
      const feed = query(
        collection(db, 'posts'),
        where('orgId', '==', TEST_ORG),
        where('status', '==', 'published'),
      );
      await assertFails(getDocs(feed));
    });

    it('un compte suspendu ne peut pas lire une publication', async () => {
      const db = testEnv.authenticatedContext(UID.parent, CLAIMS.suspended).firestore();
      await assertFails(getDoc(doc(db, 'posts', 'post-own-published')));
    });

    it('un compte refusé ne peut pas lire une publication', async () => {
      const db = testEnv.authenticatedContext(UID.parent, CLAIMS.rejected).firestore();
      await assertFails(getDoc(doc(db, 'posts', 'post-own-published')));
    });

    it('un visiteur non authentifié ne peut rien lire', async () => {
      await assertFails(getDoc(doc(anonymous.firestore(), 'posts', 'post-own-published')));
    });

    it('un compte « pending » peut malgré tout lire son propre profil', async () => {
      // Sans cela, l'utilisateur ne pourrait pas voir où en est sa demande ni
      // compléter ses informations.
      await assertSucceeds(getDoc(doc(pending.firestore(), 'users', UID.parent)));
    });
  });

  // -------------------------------------------------------------------------
  // Cloisonnement entre organisations
  // -------------------------------------------------------------------------

  describe('Cloisonnement entre organisations', () => {
    it('un parent actif lit une publication publiée de son organisation', async () => {
      await assertSucceeds(getDoc(doc(parent.firestore(), 'posts', 'post-own-published')));
    });

    it('un parent actif ne lit pas une publication d’une autre organisation', async () => {
      const db = testEnv.authenticatedContext('parent-externe', CLAIMS.parentOtherOrg).firestore();
      await assertFails(getDoc(doc(db, 'posts', 'post-own-published')));
    });

    it('un parent actif ne lit pas un brouillon', async () => {
      await assertFails(getDoc(doc(parent.firestore(), 'posts', 'post-own-draft')));
    });

    it('le fil se charge en une requête contrainte', async () => {
      // Illustre la contrainte « les règles ne sont pas des filtres » : la
      // requête doit contraindre les champs sur lesquels la règle s'appuie
      // (`orgId` et `status`), sinon Firestore refuse la requête entière.
      const db = parent.firestore();
      const feed = query(
        collection(db, 'posts'),
        where('orgId', '==', TEST_ORG),
        where('status', '==', 'published'),
      );
      await assertSucceeds(getDocs(feed));
    });

    it('une requête non contrainte est refusée', async () => {
      // Même règle, mais sans les contraintes : la démonstration échoue.
      await assertFails(getDocs(collection(parent.firestore(), 'posts')));
    });
  });

  // -------------------------------------------------------------------------
  // Écriture des publications
  // -------------------------------------------------------------------------

  describe('Écriture des publications', () => {
    it('un parent ne peut pas publier dans le fil d’actualité', async () => {
      const db = parent.firestore();
      await assertFails(
        setDoc(doc(db, 'posts', 'post-du-parent'), postDocument({ authorId: UID.parent })),
      );
    });

    it('un membre de la FCPE peut publier', async () => {
      const db = fcpe.firestore();
      await assertSucceeds(
        setDoc(doc(db, 'posts', 'post-fcpe'), postDocument({ authorId: UID.fcpe })),
      );
    });

    it('une publication ne peut pas être attribuée à quelqu’un d’autre', async () => {
      const db = fcpe.firestore();
      await assertFails(
        setDoc(doc(db, 'posts', 'post-usurpe'), postDocument({ authorId: UID.parent })),
      );
    });

    it('un parent ne peut pas supprimer une publication', async () => {
      await assertFails(deleteDoc(doc(parent.firestore(), 'posts', 'post-own-published')));
    });
  });

  // -------------------------------------------------------------------------
  // Profils et données des enfants
  // -------------------------------------------------------------------------

  describe('Profils utilisateurs', () => {
    it('un parent lit son propre profil', async () => {
      await assertSucceeds(getDoc(doc(parent.firestore(), 'users', UID.parent)));
    });

    it('un parent ne lit pas le profil d’un autre parent', async () => {
      await assertFails(getDoc(doc(parent.firestore(), 'users', UID.otherParent)));
    });

    it('un membre de la FCPE lit le profil d’un parent', async () => {
      await assertSucceeds(getDoc(doc(fcpe.firestore(), 'users', UID.otherParent)));
    });

    it('un parent ne peut pas s’activer lui-même', async () => {
      // L'escalade de privilèges la plus évidente : modifier son propre statut.
      await assertFails(
        updateDoc(doc(parent.firestore(), 'users', UID.parent), { status: 'active' }),
      );
    });

    it('un parent ne peut pas se donner un rôle supérieur', async () => {
      await assertFails(updateDoc(doc(parent.firestore(), 'users', UID.parent), { role: 'admin' }));
    });

    it('un parent peut modifier ses informations personnelles', async () => {
      await assertSucceeds(
        updateDoc(doc(parent.firestore(), 'users', UID.parent), { firstName: 'Camille-Marie' }),
      );
    });
  });

  describe('Données des enfants', () => {
    it('un parent actif lit le rattachement de son propre enfant', async () => {
      const db = testEnv.authenticatedContext(UID.parent, CLAIMS.parent).firestore();
      await assertSucceeds(getDoc(doc(db, 'users', UID.parent, 'children', 'child-1')));
    });

    it('un compte « pending » peut créer le rattachement de son enfant', async () => {
      // Chemin critique de l'inscription : le formulaire exige au moins un
      // enfant, et il est rempli avant toute validation. Si cette écriture
      // échoue, personne ne peut s'inscrire.
      const db = testEnv.authenticatedContext('nouveau-parent', CLAIMS.pending).firestore();
      await assertSucceeds(
        setDoc(doc(db, 'users', 'nouveau-parent', 'children', 'child-nouveau'), {
          id: 'child-nouveau',
          schoolId: 'ecole-elementaire',
          level: 'ce2',
          classId: 'elementaire-freres-lumieres-ce2',
          academicYear: '2026-2027',
        }),
      );
    });

    it('un compte « pending » relit le rattachement qu’il vient de créer', async () => {
      // L'écran d'attente de validation propose de vérifier ses informations.
      const db = testEnv.authenticatedContext(UID.parent, CLAIMS.pending).firestore();
      await assertSucceeds(getDoc(doc(db, 'users', UID.parent, 'children', 'child-1')));
    });

    it('un autre parent ne peut pas lire ce rattachement', async () => {
      const db = testEnv.authenticatedContext(UID.otherParent, CLAIMS.parent).firestore();
      await assertFails(getDoc(doc(db, 'users', UID.parent, 'children', 'child-1')));
    });

    it('un modérateur peut consulter le rattachement pour traiter une demande', async () => {
      await assertSucceeds(
        getDoc(doc(moderator.firestore(), 'users', UID.parent, 'children', 'child-1')),
      );
    });

    it('un modérateur ne peut pas modifier le rattachement à la place du parent', async () => {
      // Consulter oui, corriger non : le rattachement engage le parent.
      await assertFails(
        setDoc(doc(moderator.firestore(), 'users', UID.parent, 'children', 'child-1'), {
          id: 'child-1',
          schoolId: 'ecole-maternelle',
          level: 'PS',
          academicYear: '2026-2027',
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Journal d'audit
  // -------------------------------------------------------------------------

  describe('Journal d’audit', () => {
    it('un administrateur peut lire le journal', async () => {
      await assertSucceeds(getDoc(doc(admin.firestore(), 'adminLogs', 'log-1')));
    });

    it('un parent ne peut pas lire le journal', async () => {
      await assertFails(getDoc(doc(parent.firestore(), 'adminLogs', 'log-1')));
    });

    it('même un administrateur ne peut pas écrire dans le journal', async () => {
      // Un journal falsifiable par celui qu'il est censé surveiller n'a aucune
      // valeur en cas de litige.
      await assertFails(
        setDoc(doc(admin.firestore(), 'adminLogs', 'log-forge'), { action: 'faux' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Jetons de notification
  // -------------------------------------------------------------------------

  describe('Jetons de notification', () => {
    it('un jeton n’est jamais lisible depuis un client', async () => {
      // Un jeton push permet d'envoyer des notifications à un appareil : sa
      // lecture est réservée aux Cloud Functions.
      await assertFails(getDoc(doc(parent.firestore(), 'deviceTokens', 'token-1')));
    });
  });

  // -------------------------------------------------------------------------
  // Sondages
  // -------------------------------------------------------------------------

  describe('Sondages', () => {
    it('un parent enregistre son propre vote', async () => {
      await assertSucceeds(
        setDoc(doc(parent.firestore(), 'polls', 'poll-1', 'votes', UID.parent), {
          pollId: 'poll-1',
          voterId: UID.parent,
          optionIds: ['yes'],
        }),
      );
    });

    it('un parent ne peut pas voter à la place d’un autre', async () => {
      await assertFails(
        setDoc(doc(parent.firestore(), 'polls', 'poll-1', 'votes', UID.otherParent), {
          pollId: 'poll-1',
          voterId: UID.otherParent,
          optionIds: ['no'],
        }),
      );
    });

    it('un vote ne peut pas être supprimé, même par son auteur', async () => {
      // Supprimer un vote fausserait le résultat sans laisser de trace.
      await assertFails(deleteDoc(doc(parent.firestore(), 'polls', 'poll-1', 'votes', UID.parent)));
    });

    it('un parent ne lit pas le vote d’un autre', async () => {
      await assertFails(
        getDoc(doc(parent.firestore(), 'polls', 'poll-1', 'votes', UID.otherParent)),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Documents agrégés
  // -------------------------------------------------------------------------

  describe('Compteurs', () => {
    it('un membre actif lit les compteurs de son organisation', async () => {
      await assertSucceeds(getDoc(doc(parent.firestore(), 'counters', TEST_ORG)));
    });

    it('aucun client ne peut modifier les compteurs', async () => {
      // Sinon les chiffres du tableau de bord seraient manipulables.
      await assertFails(
        updateDoc(doc(admin.firestore(), 'counters', TEST_ORG), { 'users.active': 999 }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Refus par défaut
  // -------------------------------------------------------------------------

  describe('Refus par défaut', () => {
    it('une collection non déclarée reste inaccessible', async () => {
      await assertFails(getDoc(doc(admin.firestore(), 'collectionInventee', 'doc-1')));
    });

    it('la lecture d’une organisation est réservée aux comptes connectés', async () => {
      await assertFails(getDoc(doc(anonymous.firestore(), 'organizations', TEST_ORG)));
      await assertSucceeds(getDoc(doc(parent.firestore(), 'organizations', TEST_ORG)));
    });

    it('les écoles restent lisibles par un compte en attente', async () => {
      // Nécessaire au formulaire d'inscription, qui doit proposer les
      // établissements avant que le compte ne soit validé.
      await assertSucceeds(getDoc(doc(pending.firestore(), 'schools', 'ecole-elementaire')));
    });
  });
});
