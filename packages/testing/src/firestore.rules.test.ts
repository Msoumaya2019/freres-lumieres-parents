/**
 * Tests des règles Firestore.
 *
 * Chaque test correspond à une frontière de sécurité annoncée dans
 * `docs/04-security.md`.
 *
 * ## Quand un test échoue
 *
 * Un échec signifie que **la règle et le test ne disent pas la même chose** —
 * pas que la règle a tort. Il faut trancher en regardant le modèle de domaine :
 *
 *  - la règle est trop permissive ou trop stricte au regard de
 *    `@fl/types` → corriger la règle ;
 *  - le fixture ne décrit pas une donnée valide → corriger le fixture.
 *
 * Ce fichier a déjà connu le second cas : `postDocument()` omettait le champ
 * `audience`, obligatoire sur `Post`. Le seul test d'écriture qui attendait un
 * succès échouait donc, alors que les règles étaient justes. Les supprimer
 * aurait été la mauvaise réaction.
 *
 * ## Les cas de refus se testent aussi
 *
 * Un test qui ne vérifierait que les autorisations continuerait de passer si la
 * règle était supprimée — il ne protégerait donc rien. Attention toutefois :
 * `assertFails` passe dès que l'écriture est refusée, **quelle qu'en soit la
 * raison**. Un fixture invalide rend donc un test de refus complaisant. D'où
 * l'importance que chaque fixture soit une donnée réellement valide.
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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
function userDocument(
  uid: string,
  status: 'pending' | 'active' = 'active',
  orgId: string = TEST_ORG,
) {
  return {
    id: uid,
    firstName: 'Camille',
    lastName: 'Durand',
    email: `${uid}@example.org`,
    role: 'parent',
    status,
    orgId,
    orgIds: [orgId],
    schoolIds: [],
    levels: [],
    classIds: [],
    audienceKeys: [`org:${orgId}`],
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

/**
 * Publication minimale mais complète, telle que la produit `create()` du
 * repository `posts`.
 *
 * Les champs d'identité (`authorName`, `authorRole`) et `pinned` sont présents
 * parce que les règles les exigent désormais, et `attachments` parce que
 * `validPost()` vérifie qu'il s'agit bien d'une liste. Un fixture incomplet
 * rendrait les tests de refus complaisants — c'est le piège décrit en tête de
 * fichier, et il s'est déjà produit ici avec `audience`.
 *
 * `pinned` en particulier n'est pas décoratif : la branche « auteur » de
 * `allow update` le compare avec `unchanged()`, qui lève une erreur sur un
 * champ absent.
 */
function postDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-1',
    title: 'Réunion de rentrée',
    body: 'La réunion aura lieu le 12 septembre à 18 h.',
    category: 'information',
    status: 'published',
    orgId: TEST_ORG,
    authorId: UID.fcpe,
    // `authorRole` doit correspondre au rôle réel : `allow create` compare ce
    // champ au Custom Claim de l'appelant, pour qu'un membre de la FCPE ne
    // puisse pas se présenter comme administrateur dans le fil.
    authorName: 'FCPE Frères Lumières',
    authorRole: 'fcpe',
    // `audience` et `audienceKeys` doivent être cohérents : les règles exigent
    // les deux, et `buildAudienceKeys({ type: 'all' }, orgId)` produit
    // exactement la clé ci-dessous.
    //
    // La correspondance est écrite en dur plutôt que calculée en appelant
    // `buildAudienceKeys`. Un fixture qui dériverait ses valeurs du code
    // applicatif passerait au vert même si ce code était faux : le test ne
    // prouverait alors plus rien sur la donnée réellement écrite.
    audience: { type: 'all' },
    audienceKeys: [`org:${TEST_ORG}`],
    attachments: [],
    // Obligatoire dans le modèle, et exigé par `validPost()` : une publication
    // porte toujours la décision d'ouvrir ou de fermer ses commentaires.
    commentsEnabled: true,
    pinned: false,
    stats: { commentCount: 0, reactionCount: 0 },
    publishedAt: new Date('2026-09-01T10:00:00Z'),
    createdAt: new Date('2026-09-01T09:00:00Z'),
    ...overrides,
  };
}

/**
 * Commentaire minimal mais complet, tel que le produit `addComment()` du
 * repository `posts`.
 *
 * `reactions` et `replyCount` sont présents même vides : la règle de mise à
 * jour les compare avec `unchanged()`, et `unchanged` sur un champ absent lève
 * une erreur — une erreur vaut refus. Un fixture qui les omettrait ferait donc
 * échouer des tests pourtant légitimes.
 */
function commentDocument(overrides: Record<string, unknown> = {}) {
  return {
    postId: 'post-own-published',
    authorId: UID.parent,
    authorName: 'Camille Durand',
    authorRole: 'parent',
    body: 'Merci pour l’information.',
    replyCount: 0,
    reactions: {},
    status: 'visible',
    reportCount: 0,
    createdAt: new Date('2026-09-02T08:00:00Z'),
    ...overrides,
  };
}

/** Réaction de commentaire, telle que la produit `setReaction()`. */
function reactionDocument(overrides: Record<string, unknown> = {}) {
  return {
    uid: UID.parent,
    postId: 'post-own-published',
    commentId: 'comment-du-parent',
    emoji: '👍',
    createdAt: new Date('2026-09-03T09:00:00Z'),
    ...overrides,
  };
}

/** Canal de discussion minimal mais complet. */
function channelDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'channel-1',
    name: 'Vie de l’école',
    type: 'school',
    orgId: TEST_ORG,
    audience: { type: 'all' },
    audienceKeys: [`org:${TEST_ORG}`],
    order: 1,
    readOnly: false,
    status: 'published',
    stats: { messageCount: 0 },
    createdAt: new Date('2026-09-01T08:00:00Z'),
    ...overrides,
  };
}

/**
 * Message de canal, tel qu'un client l'écrirait.
 *
 * Comme pour les commentaires, `attachments` et `reactions` sont présents même
 * vides : la règle de mise à jour les compare avec `unchanged()`, qui lève une
 * erreur sur un champ absent.
 */
function messageDocument(overrides: Record<string, unknown> = {}) {
  return {
    channelId: 'channel-1',
    authorId: UID.parent,
    authorName: 'Camille Durand',
    authorRole: 'parent',
    body: 'Bonjour à tous.',
    attachments: [],
    reactions: {},
    status: 'visible',
    reportCount: 0,
    createdAt: new Date('2026-09-04T08:00:00Z'),
    ...overrides,
  };
}

/**
 * Jeton d'appareil, tel que l'application l'enregistre à la connexion.
 *
 * `audienceKeys` et `disabledCategories` sont **vides** : ces deux champs
 * appartiennent au serveur, qui les déduit du profil. Le client ne déclare que
 * son appareil. Un fixture qui les remplirait décrirait un document que le
 * client n'a pas le droit d'écrire — et rendrait complaisants les tests de
 * refus qui suivent.
 */
function deviceTokenDocument(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    token: id,
    uid: UID.parent,
    orgId: TEST_ORG,
    platform: 'android',
    audienceKeys: [],
    disabledCategories: [],
    enabled: true,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    lastUsedAt: new Date('2026-09-01T10:00:00Z'),
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
    // `beforeAll` peut avoir échoué avant d'assigner `testEnv` — émulateur pas
    // encore prêt, port occupé. Sans cette garde, `afterAll` lève
    // « Cannot read properties of undefined (reading 'cleanup') » : une erreur
    // **en cascade**, qui remplace le message utile (la cause réelle) par un
    // message qui ne dit rien. Le défaut a été rencontré, et c'est ce qui a
    // rendu un diagnostic difficile.
    await testEnv?.cleanup();
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
      // Un compte d'une autre organisation. Sans lui, aucun test ne pourrait
      // distinguer « la règle cloisonne » de « toutes les données sont dans la
      // même organisation ».
      await setDoc(
        doc(db, 'users', 'parent-autre-organisation'),
        userDocument('parent-autre-organisation', 'active', TEST_OTHER_ORG),
      );
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
      // Publication publiée mais fermée aux commentaires : sert à vérifier que
      // la fermeture est une règle, et non une convention d'affichage.
      await setDoc(
        doc(db, 'posts', 'post-commentaires-fermes'),
        postDocument({ commentsEnabled: false }),
      );

      // Brouillon d'un autre auteur : sert à vérifier que l'élargissement de la
      // lecture profite à l'auteur de la publication, et à personne d'autre.
      await setDoc(
        doc(db, 'posts', 'post-brouillon-autre'),
        postDocument({
          status: 'draft',
          publishedAt: null,
          authorId: UID.moderator,
          authorRole: 'moderator',
        }),
      );

      // Publication masquée : la modération doit pouvoir la relire pour revenir
      // sur son masquage, un parent ne doit pas la voir du tout.
      await setDoc(doc(db, 'posts', 'post-masquee'), postDocument({ status: 'hidden' }));

      // --- Publications ciblées ---------------------------------------------
      //
      // Elles servent à montrer ce que **la requête** filtre, et non ce que les
      // règles protègent : les règles ne lisent jamais `audienceKeys` (voir le
      // describe « Lecture filtrée »). Les clés sont écrites en dur plutôt que
      // calculées par `buildAudienceKeys` — un fixture qui dériverait ses
      // valeurs du code applicatif passerait au vert même si ce code était faux.
      //
      // Deux niveaux du même établissement : c'est le cas qui compte, parce que
      // les deux publications sont lisibles par le même parent au sens des
      // règles, et que seule la requête les distingue.
      //
      // Les identifiants sont préfixés pour ne pas heurter ceux que les tests
      // d'écriture **créent**. Une collision transforme silencieusement un test
      // de création en test de mise à jour — la règle appliquée n'est plus la
      // même, et l'échec désigne le test de création, pas la donnée de départ.
      // C'est arrivé ici avec `post-fcpe`, déjà pris par « un membre de la FCPE
      // peut publier ».
      await setDoc(
        doc(db, 'posts', 'post-niveau-ce2'),
        postDocument({
          audience: { type: 'level', schoolId: 'ecole-elementaire', level: 'CE2' },
          audienceKeys: ['level:ecole-elementaire:CE2'],
          publishedAt: new Date('2026-09-02T10:00:00Z'),
        }),
      );
      await setDoc(
        doc(db, 'posts', 'post-niveau-cm2'),
        postDocument({
          audience: { type: 'level', schoolId: 'ecole-elementaire', level: 'CM2' },
          audienceKeys: ['level:ecole-elementaire:CM2'],
          publishedAt: new Date('2026-09-03T10:00:00Z'),
        }),
      );
      await setDoc(
        doc(db, 'posts', 'post-reserve-fcpe'),
        postDocument({
          audience: { type: 'fcpe' },
          audienceKeys: [`fcpe:${TEST_ORG}`],
          publishedAt: new Date('2026-09-04T10:00:00Z'),
        }),
      );

      // Publication épinglée avec une date de fin : exerce le cas « champ
      // facultatif présent » de `unchangedOptional`. Les autres publications du
      // harnais n'ont ni `pinnedUntil` ni `notifiedAt`, ce qui exerce le cas
      // « absent des deux côtés » — les deux chemins comptent, puisque c'est
      // précisément l'absence qui faisait lever `unchanged()`.
      await setDoc(
        doc(db, 'posts', 'post-epinglee'),
        postDocument({ pinned: true, pinnedUntil: new Date('2026-10-01T00:00:00Z') }),
      );

      await setDoc(
        doc(db, 'posts', 'post-own-published', 'comments', 'comment-du-parent'),
        commentDocument(),
      );
      await setDoc(
        doc(db, 'posts', 'post-own-published', 'comments', 'comment-de-la-fcpe'),
        commentDocument({ authorId: UID.fcpe, authorName: 'FCPE', authorRole: 'fcpe' }),
      );
      // Un commentaire déjà signalé : sert à vérifier que son auteur ne peut
      // pas remettre `reportCount` à zéro pour effacer la trace.
      await setDoc(
        doc(db, 'posts', 'post-own-published', 'comments', 'comment-signale'),
        commentDocument({ reportCount: 2 }),
      );

      // Deux réactions, dont une posée par un autre parent : sert à vérifier
      // qu'on ne lit ni ne retire la réaction de quelqu'un d'autre.
      await setDoc(
        doc(
          db,
          'posts',
          'post-own-published',
          'comments',
          'comment-du-parent',
          'reactions',
          UID.parent,
        ),
        reactionDocument(),
      );
      await setDoc(
        doc(
          db,
          'posts',
          'post-own-published',
          'comments',
          'comment-du-parent',
          'reactions',
          UID.otherParent,
        ),
        reactionDocument({ uid: UID.otherParent }),
      );

      // Un canal et trois messages, dont un déjà signalé : sert à vérifier
      // qu'un auteur ne peut ni usurper une identité, ni s'attribuer un rôle,
      // ni effacer la trace d'un signalement.
      await setDoc(doc(db, 'channels', 'channel-1'), channelDocument());
      await setDoc(
        doc(db, 'channels', 'channel-1', 'messages', 'message-du-parent'),
        messageDocument(),
      );
      await setDoc(
        doc(db, 'channels', 'channel-1', 'messages', 'message-de-la-fcpe'),
        messageDocument({ authorId: UID.fcpe, authorName: 'FCPE', authorRole: 'fcpe' }),
      );
      await setDoc(
        doc(db, 'channels', 'channel-1', 'messages', 'message-signale'),
        messageDocument({ reportCount: 2 }),
      );

      await setDoc(doc(db, 'adminLogs', 'log-1'), {
        id: 'log-1',
        action: 'user.approve',
        actorId: UID.admin,
        orgId: TEST_ORG,
        createdAt: new Date('2026-09-01T10:00:00Z'),
      });

      // Jeton déjà enregistré, avec les champs tels que le serveur les aurait
      // déduits du profil : les clés d'audience d'un côté, une préférence de
      // catégorie de l'autre. C'est l'état réel en production, et celui contre
      // lequel les tests de mise à jour doivent s'exécuter — un `update` porte
      // sur le document entier, donc partir d'un document incomplet testerait
      // un cas qui n'existe pas.
      await setDoc(doc(db, 'deviceTokens', 'token-1'), {
        ...deviceTokenDocument('token-1'),
        audienceKeys: [`org:${TEST_ORG}`],
        disabledCategories: ['discussions'],
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
        uid: UID.otherParent,
        optionIds: ['yes'],
      });

      // Un brouillon et un sondage d'une **autre** organisation. Sans la paire,
      // un test ne peut pas distinguer « la règle cloisonne » de « tout est dans
      // la même organisation » ; sans le brouillon, il ne peut pas distinguer
      // « seuls les sondages ouverts se lisent » de « tous se lisent ».
      await setDoc(doc(db, 'polls', 'poll-brouillon'), {
        id: 'poll-brouillon',
        question: 'Faut-il ouvrir un second créneau de cantine ?',
        options: [
          { id: 'yes', label: 'Oui' },
          { id: 'no', label: 'Non' },
        ],
        status: 'draft',
        orgId: TEST_ORG,
        audienceKeys: [`org:${TEST_ORG}`],
      });
      await setDoc(doc(db, 'polls', 'poll-autre-org'), {
        id: 'poll-autre-org',
        question: 'Faut-il maintenir la kermesse ?',
        options: [
          { id: 'yes', label: 'Oui' },
          { id: 'no', label: 'Non' },
        ],
        status: 'open',
        orgId: TEST_OTHER_ORG,
        audienceKeys: [`org:${TEST_OTHER_ORG}`],
      });

      // --- Signalements, modération, tâches internes -------------------------
      //
      // Ces trois collections n'avaient **aucun** test, et c'est exactement
      // pourquoi leur défaut de cloisonnement a survécu : une règle de lecture
      // qui s'appuie sur le seul rôle (`isFcpe()`, `isModerator()`) est
      // satisfaite par Firestore sans contraindre aucun champ, donc la
      // collection entière est listable. Le défaut ne se voyait nulle part.
      //
      // Chaque collection reçoit un document de chaque organisation : sans la
      // paire, un test ne peut pas distinguer « la règle cloisonne » de
      // « toutes les données sont dans la même organisation ».
      await setDoc(doc(db, 'reports', 'report-du-parent'), {
        id: 'report-du-parent',
        title: 'Cantine trop salée',
        description: 'Les plats sont trop salés depuis la rentrée.',
        category: 'cantine',
        attachments: [],
        authorId: UID.parent,
        authorName: 'Camille Durand',
        status: 'received',
        visibility: 'private',
        timeline: [],
        replyCount: 0,
        orgId: TEST_ORG,
        createdAt: new Date('2026-09-05T08:00:00Z'),
      });
      // Un signalement d'un **autre parent de la même organisation** : c'est la
      // frontière annoncée par `docs/04-security.md` (« un parent ne lit que ses
      // propres signalements »), et elle se teste à l'intérieur d'une
      // organisation — sans ce document, le seul refus observable serait un
      // refus inter-organisations, qui ne dirait rien de cette promesse.
      await setDoc(doc(db, 'reports', 'report-autre-parent'), {
        id: 'report-autre-parent',
        title: 'Travaux dans la cour',
        description: 'La cour est impraticable depuis les travaux.',
        category: 'locaux',
        attachments: [],
        authorId: UID.otherParent,
        authorName: 'Alex Martin',
        status: 'received',
        visibility: 'private',
        timeline: [],
        replyCount: 0,
        orgId: TEST_ORG,
        createdAt: new Date('2026-09-05T08:30:00Z'),
      });
      await setDoc(doc(db, 'reports', 'report-autre-organisation'), {
        id: 'report-autre-organisation',
        title: 'Transport scolaire',
        description: 'Le car passe trop tôt le matin.',
        category: 'transport',
        attachments: [],
        authorId: 'parent-autre-organisation',
        authorName: 'Alex Martin',
        status: 'received',
        visibility: 'private',
        timeline: [],
        replyCount: 0,
        orgId: TEST_OTHER_ORG,
        createdAt: new Date('2026-09-05T08:00:00Z'),
      });

      await setDoc(doc(db, 'moderationReports', 'moderation-1'), {
        id: 'moderation-1',
        orgId: TEST_ORG,
        targetType: 'post',
        targetId: 'post-own-published',
        targetPath: `posts/post-own-published`,
        targetAuthorId: UID.fcpe,
        targetAuthorName: 'FCPE',
        targetExcerpt: 'Extrait du contenu signalé',
        reason: 'spam',
        reporterId: UID.parent,
        status: 'open',
        createdAt: new Date('2026-09-05T09:00:00Z'),
      });
      await setDoc(doc(db, 'moderationReports', 'moderation-autre-organisation'), {
        id: 'moderation-autre-organisation',
        orgId: TEST_OTHER_ORG,
        targetType: 'post',
        targetId: 'post-autre-organisation',
        targetPath: `posts/post-autre-organisation`,
        targetAuthorId: 'parent-autre-organisation',
        targetAuthorName: 'Alex Martin',
        targetExcerpt: 'Extrait du contenu signalé ailleurs',
        reason: 'spam',
        reporterId: 'parent-autre-organisation',
        status: 'open',
        createdAt: new Date('2026-09-05T09:00:00Z'),
      });

      await setDoc(doc(db, 'fcpeTasks', 'tache-fcpe'), {
        id: 'tache-fcpe',
        title: 'Préparer le conseil d’école',
        status: 'todo',
        priority: 'normal',
        orgId: TEST_ORG,
        createdAt: new Date('2026-09-05T10:00:00Z'),
      });
      await setDoc(doc(db, 'fcpeTasks', 'tache-autre-organisation'), {
        id: 'tache-autre-organisation',
        title: 'Préparer la kermesse',
        status: 'todo',
        priority: 'normal',
        orgId: TEST_OTHER_ORG,
        createdAt: new Date('2026-09-05T10:00:00Z'),
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

    // L'auteur doit pouvoir rouvrir son brouillon : sans cela, un brouillon
    // serait écrit puis définitivement invisible, y compris pour celui qui
    // vient de l'écrire — et l'éditeur ne pourrait pas le reprendre.
    it('l’auteur relit son propre brouillon', async () => {
      await assertSucceeds(getDoc(doc(fcpe.firestore(), 'posts', 'post-own-draft')));
    });

    it('un membre de la FCPE ne lit pas le brouillon d’un autre', async () => {
      await assertFails(getDoc(doc(fcpe.firestore(), 'posts', 'post-brouillon-autre')));
    });

    // La modération doit pouvoir relire un contenu masqué pour revenir sur son
    // masquage ; c'est la contrepartie du caractère réversible du masquage.
    it('un modérateur relit une publication masquée', async () => {
      await assertSucceeds(getDoc(doc(moderator.firestore(), 'posts', 'post-masquee')));
    });

    it('un parent ne lit pas une publication masquée', async () => {
      await assertFails(getDoc(doc(parent.firestore(), 'posts', 'post-masquee')));
    });

    // La lecture unitaire a été élargie, la requête non : c'est le cœur de la
    // distinction `get` / `list`. Une requête qui ne contraint pas `status`
    // reste refusée, sinon Firestore ne pourrait pas démontrer la règle.
    it('lister sans contraindre le statut est refusé', async () => {
      const db = moderator.firestore();
      const filtre = query(collection(db, 'posts'), where('orgId', '==', TEST_ORG));
      await assertFails(getDocs(filtre));
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
  // Signalements, modération et tâches internes
  // -------------------------------------------------------------------------
  //
  // Ces trois collections n'avaient **aucun** test, et c'est précisément
  // pourquoi leur défaut de cloisonnement a survécu si longtemps. Leur point
  // commun : la règle de lecture s'appuyait sur le seul **rôle**, sans comparer
  // l'organisation du document à celle du lecteur. Or une règle qui ne
  // référence aucun champ du document est satisfaite par Firestore pour
  // **n'importe quelle** requête — c'est le piège déjà rencontré sur `users`,
  // et il produit le même résultat : la collection entière devient listable,
  // toutes organisations confondues.
  //
  // Ce qui rend le défaut invisible mérite d'être dit : la lecture **unitaire**
  // se comporte correctement. Un `getDoc` sur un document de son organisation
  // passe, un `getDoc` sur un document d'une autre organisation est refusé —
  // dès lors qu'on connaît l'identifiant. C'est la **requête** qui franchit la
  // frontière, et seule une requête peut le montrer.
  //
  // Ces tests ont d'abord été écrits pour échouer : ils décrivent la règle
  // attendue, et les refus inter-organisations ont effectivement échoué contre
  // la règle d'alors. Le correctif est venu ensuite, comme pour `users`.

  describe('Signalements, modération et tâches internes', () => {
    it('un parent lit son propre signalement', async () => {
      await assertSucceeds(getDoc(doc(parent.firestore(), 'reports', 'report-du-parent')));
    });

    // La promesse de `docs/04-security.md` : « un parent ne lit que ses propres
    // signalements ». Elle se vérifie à l'intérieur d'une même organisation.
    it('un parent ne lit pas le signalement d’un autre parent', async () => {
      await assertFails(getDoc(doc(parent.firestore(), 'reports', 'report-autre-parent')));
    });

    it('un parent ne lit pas un signalement d’une autre organisation', async () => {
      await assertFails(getDoc(doc(parent.firestore(), 'reports', 'report-autre-organisation')));
    });

    it('un membre de la FCPE lit un signalement de son organisation', async () => {
      await assertSucceeds(getDoc(doc(fcpe.firestore(), 'reports', 'report-autre-parent')));
    });

    it('un membre de la FCPE ne liste pas les signalements d’une autre organisation', async () => {
      const db = fcpe.firestore();
      await assertFails(
        getDocs(query(collection(db, 'reports'), where('orgId', '==', TEST_OTHER_ORG))),
      );
    });

    // Sans contrainte de champ, Firestore doit refuser la requête : la règle
    // exige une comparaison sur `orgId`, qui ne se démontre pas sans `where`.
    it('un membre de la FCPE ne liste pas la collection entière des signalements', async () => {
      await assertFails(getDocs(collection(fcpe.firestore(), 'reports')));
    });

    it('un membre de la FCPE liste les signalements de son organisation', async () => {
      const db = fcpe.firestore();
      await assertSucceeds(
        getDocs(query(collection(db, 'reports'), where('orgId', '==', TEST_ORG))),
      );
    });

    it('un modérateur ne liste pas la file de modération d’une autre organisation', async () => {
      const db = moderator.firestore();
      await assertFails(
        getDocs(query(collection(db, 'moderationReports'), where('orgId', '==', TEST_OTHER_ORG))),
      );
    });

    it('un modérateur liste la file de modération de son organisation', async () => {
      const db = moderator.firestore();
      await assertSucceeds(
        getDocs(query(collection(db, 'moderationReports'), where('orgId', '==', TEST_ORG))),
      );
    });

    // `fcpeTasks` était déclarée `allow read, create, update: if isFcpe() &&
    // request.resource.data.orgId == orgId()`. Sur une **lecture**,
    // `request.resource` n'existe pas : l'expression lève, et une erreur vaut
    // refus. La collection était donc illisible, y compris par la FCPE, alors
    // que la règle semblait l'autoriser — un défaut de disponibilité, et non de
    // confidentialité, mais un défaut tout de même. D'où deux règles
    // distinctes : `resource` pour ce qui est lu, `request.resource` pour ce qui
    // est écrit.
    it('un membre de la FCPE lit une tâche interne de son organisation', async () => {
      await assertSucceeds(getDoc(doc(fcpe.firestore(), 'fcpeTasks', 'tache-fcpe')));
    });

    it('un membre de la FCPE ne lit pas une tâche d’une autre organisation', async () => {
      await assertFails(getDoc(doc(fcpe.firestore(), 'fcpeTasks', 'tache-autre-organisation')));
    });

    it('un parent ne lit aucune tâche interne', async () => {
      await assertFails(getDoc(doc(parent.firestore(), 'fcpeTasks', 'tache-fcpe')));
    });
  });

  // -------------------------------------------------------------------------
  // Lecture filtrée par les clés d'audience
  // -------------------------------------------------------------------------
  //
  // Ce bloc répond au critère de sortie de la Phase 3 — « un parent ne voit que
  // les publications de son audience » — et il faut le lire attentivement,
  // parce que la réponse n'est pas celle qu'on attendrait.
  //
  // Les règles **ne lisent jamais `audienceKeys`**. `allow get` exige
  // l'organisation, un compte actif et un statut publié ; `allow list` exige en
  // plus que la requête contraigne `orgId` et `status`. Le ciblage est donc
  // appliqué par la **requête du client** (`array-contains-any`), pas par la
  // règle. C'est une contrainte structurelle, pas une négligence : une règle de
  // requête doit être démontrable à partir des seules contraintes de la
  // requête, et « les clés du lecteur recoupent celles du document » ne se
  // démontre pas ainsi.
  //
  // Conséquence directe, encodée plus bas : le ciblage est un filtre de
  // **pertinence**, pas une frontière de confidentialité. Les vraies frontières
  // du système sont l'organisation, le statut du compte, les signalements, les
  // enfants, et `visibility: 'fcpe'` — toutes vérifiées par une règle.

  describe('Lecture filtrée par les clés d’audience', () => {
    /**
     * Type du Firestore que rend le harnais.
     *
     * Dérivé plutôt qu'importé de `firebase/firestore` :
     * `@firebase/rules-unit-testing` type ses contextes avec l'espace de noms
     * `firebase` (compat), alors que ce fichier utilise les fonctions
     * modulaires. Les deux désignent le même objet à l'exécution, mais ce sont
     * deux types distincts — les mélanger donne une erreur d'assignation qui ne
     * dit rien de la cause.
     */
    type TestFirestore = ReturnType<RulesTestContext['firestore']>;

    /**
     * Clés d'un parent dont l'enfant est en CE2 à l'école élémentaire.
     *
     * Écrites en dur, comme les fixtures : les calculer avec
     * `buildUserAudienceKeys` ferait passer le test même si le calcul était
     * faux, et c'est précisément le calcul qu'on veut voir confronté à des
     * documents réels.
     */
    const CLES_PARENT_CE2: readonly string[] = [
      `org:${TEST_ORG}`,
      'school:ecole-elementaire',
      'level:ecole-elementaire:CE2',
      'class:ce2-a',
    ];

    /** Clés d'un membre de la FCPE : les mêmes, plus la clé de son rôle. */
    const CLES_FCPE: readonly string[] = [...CLES_PARENT_CE2, `fcpe:${TEST_ORG}`];

    /** Requête du fil, telle que `fetchFeed` la construit. */
    function filtre(db: TestFirestore, cles: readonly string[]) {
      return query(
        collection(db, 'posts'),
        where('orgId', '==', TEST_ORG),
        where('status', '==', 'published'),
        where('audienceKeys', 'array-contains-any', [...cles]),
      );
    }

    async function identifiantsLus(db: TestFirestore, cles: readonly string[]): Promise<string[]> {
      const snapshot = await getDocs(filtre(db, cles));
      return snapshot.docs.map((document) => document.id).sort();
    }

    it('la requête du fil rend la publication du niveau du lecteur', async () => {
      expect(await identifiantsLus(parent.firestore(), CLES_PARENT_CE2)).toContain(
        'post-niveau-ce2',
      );
    });

    it('la requête du fil écarte la publication d’un autre niveau', async () => {
      // Le cas qui compte : les deux publications sont lisibles par le même
      // parent au sens des règles, et seule la requête les distingue.
      expect(await identifiantsLus(parent.firestore(), CLES_PARENT_CE2)).not.toContain(
        'post-niveau-cm2',
      );
    });

    it('la requête du fil rend la publication générale', async () => {
      expect(await identifiantsLus(parent.firestore(), CLES_PARENT_CE2)).toContain(
        'post-own-published',
      );
    });

    it('un parent ne reçoit pas la publication réservée à la FCPE', async () => {
      expect(await identifiantsLus(parent.firestore(), CLES_PARENT_CE2)).not.toContain(
        'post-reserve-fcpe',
      );
    });

    it('un membre de la FCPE reçoit la publication qui lui est réservée', async () => {
      // Le pendant positif : sans lui, une requête qui ne rendrait jamais rien
      // passerait pour correcte.
      expect(await identifiantsLus(fcpe.firestore(), CLES_FCPE)).toContain('post-reserve-fcpe');
    });

    it('le fil se charge en une seule requête, quel que soit le nombre de ciblages', async () => {
      // C'est le bénéfice des clés dénormalisées : quatre ciblages différents
      // tiennent dans un seul `array-contains-any`, donc une seule requête et
      // une seule facture. Une lecture par ciblage coûterait quatre fois plus.
      const snapshot = await getDocs(filtre(parent.firestore(), CLES_PARENT_CE2));
      expect(snapshot.size).toBeGreaterThan(0);
    });

    // -----------------------------------------------------------------------
    //  Limites assumées — ces deux tests décrivent le comportement réel
    // -----------------------------------------------------------------------
    //
    // Ils ne défendent pas une intention : ils **rendent visible** ce que les
    // règles autorisent aujourd'hui. Les supprimer parce qu'ils décrivent un
    // comportement gênant reviendrait à effacer la seule trace du problème. Le
    // jour où le modèle change, ce sont eux qu'il faut inverser.

    it('limite assumée : un parent lit par identifiant une publication d’un autre niveau', async () => {
      // `allow get` ne regarde ni `audience` ni `audienceKeys`. Un parent qui
      // connaît l'identifiant — il l'obtient d'un lien partagé — atteint la
      // publication. Impact faible : même organisation, aucun contenu
      // personnel, et l'application ne propose jamais ce chemin.
      await assertSucceeds(getDoc(doc(parent.firestore(), 'posts', 'post-niveau-cm2')));
    });

    it('limite assumée : un parent lit une publication réservée à la FCPE', async () => {
      // **Question tranchée : la promesse est retirée, la limite reste.**
      //
      // L'écran de publication annonçait « ne sera visible que par les membres
      // de la FCPE », et les règles ne l'appliquent pas : `allow get` n'exige
      // que l'organisation, un compte actif et un statut publié. Le libellé dit
      // maintenant ce que le mécanisme fait réellement — un ciblage de
      // pertinence, qui décide qui est **notifié** — et l'écart entre
      // l'interface et les règles a disparu par le haut, pas par le bas.
      //
      // Ce test reste, et c'est voulu : il n'encode plus une question ouverte
      // mais la **trace** de la limite. Rendre le ciblage FCPE étanche n'est
      // toujours pas une retouche de règle — il faudrait que la règle lise les
      // clés du lecteur, donc un `get()` sur son profil, que Firestore ne sait
      // pas démontrer à partir des contraintes d'une requête. Le fil devrait
      // passer par une Cloud Function, ou les publications être réparties par
      // audience. Le jour où l'espace privé de la phase 10 (`visibility:
      // 'fcpe'`) existera, c'est ce test qu'il faudra inverser, pas supprimer.
      await assertSucceeds(getDoc(doc(parent.firestore(), 'posts', 'post-reserve-fcpe')));
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

    it('une publication sans décision sur les commentaires est refusée', async () => {
      const db = fcpe.firestore();
      const { commentsEnabled: _ignore, ...sansDecision } = postDocument({ authorId: UID.fcpe });

      // Sans ce champ, la règle des commentaires devrait interpréter une
      // absence — exactement ce qu'un échec fermé ne doit pas faire.
      await assertFails(setDoc(doc(db, 'posts', 'post-sans-decision'), sansDecision));
    });

    it('un parent ne peut pas supprimer une publication', async () => {
      await assertFails(deleteDoc(doc(parent.firestore(), 'posts', 'post-own-published')));
    });

    // Épingler est réservé à `moderator` / `admin` dans la matrice de
    // permissions. Sans cette vérification à la création, la restriction ne
    // vivrait que dans l'interface : il suffisait de passer `pinned: true`.
    it('un membre de la FCPE ne peut pas publier d’emblée épinglé', async () => {
      const db = fcpe.firestore();
      await assertFails(
        setDoc(doc(db, 'posts', 'post-epingle-par-fcpe'), postDocument({ pinned: true })),
      );
    });

    it('un modérateur peut publier épinglé', async () => {
      const db = moderator.firestore();
      await assertSucceeds(
        setDoc(
          doc(db, 'posts', 'post-epingle-par-moderateur'),
          postDocument({ authorId: UID.moderator, authorRole: 'moderator', pinned: true }),
        ),
      );
    });

    // Le fil affiche un badge à partir de `authorRole` : le laisser libre
    // permettrait à un membre de la FCPE de se présenter comme administrateur.
    it('une publication ne peut pas se déclarer un autre rôle que le sien', async () => {
      const db = fcpe.firestore();
      await assertFails(
        setDoc(doc(db, 'posts', 'post-role-usurpe'), postDocument({ authorRole: 'admin' })),
      );
    });

    it('une publication dont les pièces jointes ne sont pas une liste est refusée', async () => {
      const db = fcpe.firestore();
      await assertFails(
        setDoc(doc(db, 'posts', 'post-pj-invalides'), postDocument({ attachments: 'aucune' })),
      );
    });

    // `validPost()` exige que `audienceKeys` soit une liste non vide et bornée.
    // Sans ces trois tests, retirer la contrainte ne ferait échouer personne :
    // une publication sans clé d'audience ne serait visible par **aucun** fil,
    // puisque `fetchFeed` filtre par `array-contains-any`, et une publication à
    // cinquante clés dépasserait la limite de Firestore à la requête — un échec
    // silencieux, découvert par un parent dont le fil ne se charge plus.
    it('une publication sans clé d’audience est refusée', async () => {
      const db = fcpe.firestore();
      await assertFails(
        setDoc(doc(db, 'posts', 'post-sans-cle'), postDocument({ audienceKeys: [] })),
      );
    });

    it('une publication dont les clés d’audience ne sont pas une liste est refusée', async () => {
      const db = fcpe.firestore();
      await assertFails(
        setDoc(
          doc(db, 'posts', 'post-cle-invalide'),
          postDocument({ audienceKeys: `org:${TEST_ORG}` }),
        ),
      );
    });

    it('une publication à plus de cinq clés d’audience est refusée', async () => {
      const db = fcpe.firestore();
      const trop = Array.from({ length: 6 }, (_value, index) => `class:classe-${index + 1}`);

      await assertFails(
        setDoc(doc(db, 'posts', 'post-trop-ciblee'), postDocument({ audienceKeys: trop })),
      );
    });

    it('une publication ciblée sur un niveau est acceptée', async () => {
      // Le pendant positif des trois tests ci-dessus : sans lui, une règle qui
      // refuserait **toute** publication ciblée passerait pour correcte.
      const db = fcpe.firestore();
      await assertSucceeds(
        setDoc(
          doc(db, 'posts', 'post-niveau-valide'),
          postDocument({
            audience: { type: 'level', schoolId: 'ecole-elementaire', level: 'CE2' },
            audienceKeys: ['level:ecole-elementaire:CE2'],
          }),
        ),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Mise à jour des publications — deux branches, un seul motif
  // -------------------------------------------------------------------------
  //
  // Une mise à jour est évaluée sur le document entier après fusion. Ces tests
  // vérifient donc chaque champ figé **un par un** : c'est la seule façon de
  // voir qu'une branche laisse passer ce qu'elle prétend interdire.

  describe('Mise à jour des publications', () => {
    it('l’auteur corrige le texte de sa publication', async () => {
      const db = fcpe.firestore();
      await assertSucceeds(
        updateDoc(doc(db, 'posts', 'post-own-published'), { body: 'Nouveau texte.' }),
      );
    });

    it('l’auteur ne peut pas modifier la publication d’un autre', async () => {
      const db = fcpe.firestore();
      await assertFails(
        updateDoc(doc(db, 'posts', 'post-brouillon-autre'), { body: 'Détournement.' }),
      );
    });

    it('un parent ne peut pas modifier une publication', async () => {
      const db = parent.firestore();
      await assertFails(
        updateDoc(doc(db, 'posts', 'post-own-published'), { body: 'Nouveau texte.' }),
      );
    });

    // `post.pin` est réservé aux rôles de modération : un auteur ne peut donc
    // pas épingler son propre texte, sans quoi la règle serait contournable par
    // celui qui publie le plus.
    it('l’auteur ne peut pas épingler sa propre publication', async () => {
      const db = fcpe.firestore();
      await assertFails(updateDoc(doc(db, 'posts', 'post-own-published'), { pinned: true }));
    });

    it('l’auteur ne peut pas désépingler une publication épinglée', async () => {
      const db = fcpe.firestore();
      await assertFails(updateDoc(doc(db, 'posts', 'post-epinglee'), { pinned: false }));
    });

    // Sans ce gel, `validPost()` n'exigeant qu'un entier positif, un auteur
    // pouvait écrire `commentCount: 9999` et se donner l'apparence d'une
    // publication très commentée.
    it('l’auteur ne peut pas gonfler le compteur de commentaires', async () => {
      const db = fcpe.firestore();
      await assertFails(
        updateDoc(doc(db, 'posts', 'post-own-published'), {
          stats: { commentCount: 9999, reactionCount: 0 },
        }),
      );
    });

    it('l’auteur ne peut pas se déclarer administrateur', async () => {
      const db = fcpe.firestore();
      await assertFails(updateDoc(doc(db, 'posts', 'post-own-published'), { authorRole: 'admin' }));
    });

    it('l’auteur ne peut pas attribuer sa publication à quelqu’un d’autre', async () => {
      const db = fcpe.firestore();
      await assertFails(
        updateDoc(doc(db, 'posts', 'post-own-published'), { authorId: UID.parent }),
      );
    });

    // Ce cas est le plus fragile du lot : `pinnedUntil` est facultatif, donc
    // `unchanged()` y lèverait une erreur — et une erreur vaut refus. C'est ce
    // test qui distingue `unchangedOptional()` d'un `unchanged()` naïf.
    it('l’auteur modifie une publication épinglée sans toucher à l’épinglage', async () => {
      const db = fcpe.firestore();
      await assertSucceeds(
        updateDoc(doc(db, 'posts', 'post-epinglee'), { body: 'Texte corrigé.' }),
      );
    });

    it('l’auteur peut repasser sa publication en brouillon', async () => {
      // Retirer son propre texte de la circulation n'est pas un acte de
      // modération : `draft` reste dans les statuts qu'un auteur peut écrire.
      const db = fcpe.firestore();
      await assertSucceeds(updateDoc(doc(db, 'posts', 'post-own-published'), { status: 'draft' }));
    });

    it('l’auteur ne peut pas masquer sa publication', async () => {
      // Masquer est réversible mais engage la modération : le statut `hidden`
      // n'appartient pas à la branche « auteur ».
      const db = fcpe.firestore();
      await assertFails(updateDoc(doc(db, 'posts', 'post-own-published'), { status: 'hidden' }));
    });

    it('un modérateur épingle la publication d’un autre', async () => {
      // La fonction centrale de l'écran d'administration, et celle que la règle
      // précédente rendait impossible : `validPost()` exige
      // `authorId == request.auth.uid`.
      const db = moderator.firestore();
      await assertSucceeds(updateDoc(doc(db, 'posts', 'post-own-published'), { pinned: true }));
    });

    it('un modérateur masque une publication', async () => {
      const db = moderator.firestore();
      await assertSucceeds(updateDoc(doc(db, 'posts', 'post-own-published'), { status: 'hidden' }));
    });

    it('un modérateur ne peut pas réécrire le corps d’une publication', async () => {
      // Masquer, oui ; réécrire sous le nom de l'auteur, non. Même frontière que
      // pour les commentaires et les messages.
      const db = moderator.firestore();
      await assertFails(
        updateDoc(doc(db, 'posts', 'post-own-published'), { body: 'Texte réécrit.' }),
      );
    });

    it('un modérateur ne peut pas s’attribuer une publication', async () => {
      const db = moderator.firestore();
      await assertFails(
        updateDoc(doc(db, 'posts', 'post-own-published'), { authorId: UID.moderator }),
      );
    });

    it('un modérateur ne peut pas archiver en changeant autre chose', async () => {
      // Le statut `archived` est légitime, mais il ne doit pas servir de
      // véhicule : la même écriture qui archive ne peut rien modifier d'autre.
      const db = moderator.firestore();
      await assertFails(
        updateDoc(doc(db, 'posts', 'post-own-published'), {
          status: 'archived',
          title: 'Titre réécrit.',
        }),
      );
    });

    it('un modérateur ne peut pas gonfler le compteur de commentaires', async () => {
      const db = moderator.firestore();
      await assertFails(
        updateDoc(doc(db, 'posts', 'post-own-published'), {
          stats: { commentCount: 9999, reactionCount: 0 },
        }),
      );
    });

    it('un modérateur ne peut pas fermer les commentaires d’une publication', async () => {
      // Fermer les commentaires est une décision éditoriale de la FCPE, mais
      // elle appartient à la branche « auteur » : la modération ne touche qu'à
      // l'épinglage et au statut.
      const db = moderator.firestore();
      await assertFails(
        updateDoc(doc(db, 'posts', 'post-own-published'), { commentsEnabled: false }),
      );
    });

    it('un membre de la FCPE ne peut pas épingler par la branche de modération', async () => {
      // Vérifie que les deux branches ne se recouvrent pas : `isFcpe()` couvre
      // `moderator` et `admin`, mais l'inverse est faux.
      const db = fcpe.firestore();
      await assertFails(updateDoc(doc(db, 'posts', 'post-brouillon-autre'), { pinned: true }));
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

    // -----------------------------------------------------------------------
    //  Listage des comptes
    // -----------------------------------------------------------------------
    //
    // Ces trois tests manquaient, et leur absence masquait une fuite : la règle
    // de lecture ne référence **aucun champ du document**. Pour un `list`,
    // Firestore peut alors la satisfaire pour n'importe quelle requête, y
    // compris une lecture sans filtre — le cloisonnement par organisation, qui
    // s'applique à onze autres collections, ne s'appliquait pas ici.
    //
    // Les lectures unitaires ci-dessus ne pouvaient pas le révéler : elles
    // portent sur un document précis, et une règle trop large y répond
    // correctement.

    it('un membre de la FCPE ne lit pas la collection entière des comptes', async () => {
      // La requête la plus large possible. Elle doit être refusée : c'est elle
      // qui donnerait à une organisation les noms, adresses et numéros de
      // téléphone des parents d'une autre.
      await assertFails(getDocs(collection(fcpe.firestore(), 'users')));
    });

    it('un membre de la FCPE ne liste pas les comptes d’une autre organisation', async () => {
      await assertFails(
        getDocs(query(collection(fcpe.firestore(), 'users'), where('orgId', '==', TEST_OTHER_ORG))),
      );
    });

    it('un membre de la FCPE liste les comptes de son organisation', async () => {
      // Le pendant positif : sans lui, une règle qui refuse tout passerait les
      // deux tests précédents, et la file de validation ne s'afficherait plus.
      await assertSucceeds(
        getDocs(query(collection(fcpe.firestore(), 'users'), where('orgId', '==', TEST_ORG))),
      );
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

    it('un nouveau compte ne peut pas créer son profil déjà activé', async () => {
      // L'escalade la plus directe, et elle ne passe pas par `update` : créer
      // d'emblée un profil `active` au lieu de le modifier ensuite. Les règles
      // de création exigent `status == 'pending'` et `role == 'parent'`, quel
      // que soit ce que le client envoie.
      const db = testEnv.authenticatedContext('nouveau-compte', CLAIMS.pending).firestore();
      await assertFails(setDoc(doc(db, 'users', 'nouveau-compte'), userDocument('nouveau-compte')));
    });

    it('un nouveau compte peut créer son profil en attente de validation', async () => {
      // Le pendant positif, et le premier pas de l'inscription : si cette
      // écriture échouait, personne ne pourrait s'inscrire. Un test de refus
      // seul ne détecterait pas une règle devenue trop stricte.
      const db = testEnv.authenticatedContext('nouveau-compte', CLAIMS.pending).firestore();
      await assertSucceeds(
        setDoc(doc(db, 'users', 'nouveau-compte'), userDocument('nouveau-compte', 'pending')),
      );
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

    it('un ticket de notification n’est ni lisible ni écrivable depuis un client', async () => {
      // Le document associe un identifiant de ticket à un jeton d'appareil :
      // c'est le seul endroit où les deux se rencontrent, et c'est ce qui permet
      // de supprimer un jeton que le transport a déclaré mort. Le client n'a
      // rien à y faire — il ne relit pas les reçus.
      //
      // La lecture compte autant que l'écriture : ranger ces jetons dans
      // `notifications`, que la FCPE lit, aurait exposé l'index des appareils
      // que la règle ci-dessus protège.
      const ref = doc(parent.firestore(), 'pushTickets', 'ticket-1');

      await assertFails(getDoc(ref));
      await assertFails(
        setDoc(ref, { orgId: TEST_ORG, token: 'ExponentPushToken[x]', notificationId: 'n-1' }),
      );
    });

    it('un lot de discussion n’est ni lisible ni écrivable depuis un client', async () => {
      // Le document porte l'état du regroupement des messages d'un canal : la
      // liste des messages en attente d'être annoncés, et l'instant où ils le
      // seront. Le client n'a rien à y faire — il ne regroupe pas.
      //
      // La lecture compte autant que l'écriture : un client qui lirait le lot
      // saurait ce qui n'a pas encore été annoncé. Et l'écriture est la plus
      // sensible des deux, puisque repousser la fenêtre ferait taire une
      // discussion sans qu'aucune erreur n'apparaisse nulle part.
      const ref = doc(parent.firestore(), 'channelDigests', 'ce1');

      await assertFails(getDoc(ref));
      await assertFails(setDoc(ref, { orgId: TEST_ORG, channelId: 'ce1', messageIds: ['m-1'] }));
    });

    it('un parent enregistre son appareil pour sa propre organisation', async () => {
      await assertSucceeds(
        setDoc(
          doc(parent.firestore(), 'deviceTokens', 'token-parent'),
          deviceTokenDocument('token-parent'),
        ),
      );
    });

    it('un parent ne peut pas enregistrer un appareil au nom d’une autre organisation', async () => {
      // Le serveur choisit les destinataires d'une notification en lisant
      // `orgId` sur le jeton. Un client qui choisit librement ce champ choisit
      // donc de recevoir les notifications d'une autre organisation.
      await assertFails(
        setDoc(
          doc(parent.firestore(), 'deviceTokens', 'token-autre-org'),
          deviceTokenDocument('token-autre-org', { orgId: TEST_OTHER_ORG }),
        ),
      );
    });

    it('un parent ne peut pas se déclarer une audience', async () => {
      // `audienceKeys` n'est pas une préférence mais une **autorisation** : le
      // serveur s'en sert pour décider qui reçoit quoi. Déclaré par le client,
      // il permettrait à un parent de s'abonner à l'audience de la FCPE, ou à
      // la classe d'un autre. Le champ appartient donc au serveur.
      await assertFails(
        setDoc(
          doc(parent.firestore(), 'deviceTokens', 'token-fcpe'),
          deviceTokenDocument('token-fcpe', {
            audienceKeys: [`org:${TEST_ORG}`, `fcpe:${TEST_ORG}`],
          }),
        ),
      );
    });

    it('un parent ne peut pas déclarer ses préférences à l’enregistrement', async () => {
      // `disabledCategories` est serveur : la préférence vit sur le profil, et
      // c'est le serveur qui la recopie sur **tous** les appareils du parent.
      // Un client qui la déclarerait à la création poserait un état que les
      // autres appareils ne partageraient pas — et l'écran de préférences
      // afficherait l'inverse de ce que la tablette applique.
      await assertFails(
        setDoc(
          doc(parent.firestore(), 'deviceTokens', 'token-prefs'),
          deviceTokenDocument('token-prefs', { disabledCategories: ['discussions'] }),
        ),
      );
    });

    it('un parent ne peut pas modifier les clés d’audience de son appareil', async () => {
      const db = parent.firestore();
      await assertFails(
        updateDoc(doc(db, 'deviceTokens', 'token-1'), {
          audienceKeys: [`org:${TEST_ORG}`, `fcpe:${TEST_ORG}`],
        }),
      );
    });

    it('un parent ne peut pas modifier les préférences de catégorie de son appareil', async () => {
      // `disabledCategories` est une préférence, donc inoffensive en soi — mais
      // elle est posée par **utilisateur** et recopiée par **appareil**. Le
      // client ne peut atteindre que l'appareil courant : s'il en était
      // propriétaire, les autres appareils du même parent continueraient de
      // recevoir ce que l'écran de préférences affiche comme désactivé.
      await assertFails(
        updateDoc(doc(parent.firestore(), 'deviceTokens', 'token-1'), {
          disabledCategories: ['discussions', 'agenda'],
        }),
      );
    });

    it('un parent ne peut pas se réabonner en réinitialisant ses préférences', async () => {
      // Le pendant du test précédent : sans `unchanged('disabledCategories')`,
      // un parent pourrait contourner le filtre en réécrivant le tableau à
      // vide. `update` porte sur le document entier, donc la règle doit porter
      // sur le champ lui-même et pas seulement sur les clés d'audience.
      await assertFails(
        updateDoc(doc(parent.firestore(), 'deviceTokens', 'token-1'), {
          disabledCategories: [],
        }),
      );
    });

    it('un parent peut désactiver les notifications de son appareil', async () => {
      // `enabled` est l'interrupteur de **cet appareil** : il ne concerne que
      // lui, donc le client en reste propriétaire. C'est la seule chose qu'il
      // puisse encore écrire, avec `lastUsedAt`.
      await assertSucceeds(
        updateDoc(doc(parent.firestore(), 'deviceTokens', 'token-1'), { enabled: false }),
      );
    });

    it('un appareil change de porteur en repartant de zéro', async () => {
      // Un appareil partagé entre deux parents, ou transmis. Le nouveau
      // porteur reprend le jeton — l'identifiant du document **est** le jeton,
      // donc il n'y a pas de doublon possible — mais il doit effacer ce que le
      // serveur avait déduit pour l'ancien.
      const nouveauPorteur = testEnv.authenticatedContext(UID.otherParent, CLAIMS.parent);

      await assertSucceeds(
        updateDoc(doc(nouveauPorteur.firestore(), 'deviceTokens', 'token-1'), {
          uid: UID.otherParent,
          audienceKeys: [],
          disabledCategories: [],
        }),
      );
    });

    it('un appareil ne peut pas changer de porteur en gardant l’audience de l’ancien', async () => {
      // Le défaut que cette clause ferme. Sans elle, le nouveau porteur
      // héritait des clés d'audience de l'ancien et recevait **ses**
      // notifications, indéfiniment : rien ne les recalculait, puisque ce sont
      // les clés du profil du nouveau porteur qui les déterminent, et que ce
      // profil-là n'a pas changé.
      const nouveauPorteur = testEnv.authenticatedContext(UID.otherParent, CLAIMS.parent);

      await assertFails(
        updateDoc(doc(nouveauPorteur.firestore(), 'deviceTokens', 'token-1'), {
          uid: UID.otherParent,
        }),
      );
    });

    it('un appareil ne peut pas changer de porteur en gardant les préférences de l’ancien', async () => {
      // Les deux champs sont exigés séparément : effacer l'audience mais
      // conserver les préférences laisserait le nouveau porteur avec les
      // catégories désactivées de l'ancien, et l'écran de préférences
      // afficherait l'inverse de ce que l'appareil applique.
      const nouveauPorteur = testEnv.authenticatedContext(UID.otherParent, CLAIMS.parent);

      await assertFails(
        updateDoc(doc(nouveauPorteur.firestore(), 'deviceTokens', 'token-1'), {
          uid: UID.otherParent,
          audienceKeys: [],
        }),
      );
    });

    it('un appareil ne peut pas changer de porteur vers une autre organisation', async () => {
      // Le transfert ne doit pas devenir un moyen de sortir de son
      // organisation : `orgId` reste comparé au claim de l'appelant, dans les
      // deux branches.
      const autreOrganisation = testEnv.authenticatedContext(
        'parent-autre-organisation',
        CLAIMS.parentOtherOrg,
      );

      await assertFails(
        updateDoc(doc(autreOrganisation.firestore(), 'deviceTokens', 'token-1'), {
          uid: 'parent-autre-organisation',
          orgId: TEST_OTHER_ORG,
          audienceKeys: [],
          disabledCategories: [],
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Sondages
  // -------------------------------------------------------------------------

  describe('Sondages', () => {
    it('un sondage ouvert se lit', async () => {
      await assertSucceeds(getDoc(doc(parent.firestore(), 'polls', 'poll-1')));
    });

    it('un brouillon ne se lit pas, même par un parent de l’audience visée', async () => {
      // La règle de lecture n'ouvre que `open` et `closed`. C'est ce qui rend
      // `notify: false` sûr : enregistrer un sondage sans le publier ne laisse
      // rien filtrer, pas même à ceux qu'il concerne.
      await assertFails(getDoc(doc(parent.firestore(), 'polls', 'poll-brouillon')));
    });

    it('un sondage d’une autre organisation ne se lit pas', async () => {
      await assertFails(getDoc(doc(parent.firestore(), 'polls', 'poll-autre-org')));
    });

    it('un parent ne crée pas de sondage', async () => {
      await assertFails(
        setDoc(doc(parent.firestore(), 'polls', 'poll-du-parent'), {
          question: 'Faut-il maintenir la kermesse ?',
          options: [
            { id: 'yes', label: 'Oui' },
            { id: 'no', label: 'Non' },
          ],
          status: 'open',
          orgId: TEST_ORG,
          audienceKeys: [`org:${TEST_ORG}`],
        }),
      );
    });

    it('la FCPE crée un sondage ouvert', async () => {
      // Le témoin du test suivant : à charge identique, seul le statut change.
      // Sans lui, un refus ne prouverait rien — `assertFails` est satisfait par
      // n'importe quelle raison de refuser.
      await assertSucceeds(
        setDoc(doc(fcpe.firestore(), 'polls', 'poll-fcpe'), {
          question: 'Faut-il maintenir la kermesse ?',
          options: [
            { id: 'yes', label: 'Oui' },
            { id: 'no', label: 'Non' },
          ],
          status: 'open',
          orgId: TEST_ORG,
          audienceKeys: [`org:${TEST_ORG}`],
        }),
      );
    });

    it('un statut que les règles n’énumèrent pas est refusé', async () => {
      // `POLL_STATUSES` en déclare quatre ; les règles n'en acceptent que trois.
      // `archived` n'est donc atteignable que par le serveur, qui contourne les
      // règles — c'est une décision, et ce test la fige.
      await assertFails(
        setDoc(doc(fcpe.firestore(), 'polls', 'poll-archive'), {
          question: 'Faut-il maintenir la kermesse ?',
          options: [
            { id: 'yes', label: 'Oui' },
            { id: 'no', label: 'Non' },
          ],
          status: 'archived',
          orgId: TEST_ORG,
          audienceKeys: [`org:${TEST_ORG}`],
        }),
      );
    });

    it('un parent enregistre son propre vote', async () => {
      await assertSucceeds(
        setDoc(doc(parent.firestore(), 'polls', 'poll-1', 'votes', UID.parent), {
          pollId: 'poll-1',
          uid: UID.parent,
          optionIds: ['yes'],
        }),
      );
    });

    it('un parent ne peut pas voter à la place d’un autre', async () => {
      await assertFails(
        setDoc(doc(parent.firestore(), 'polls', 'poll-1', 'votes', UID.otherParent), {
          pollId: 'poll-1',
          uid: UID.otherParent,
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
  // Commentaires
  //
  // Aucun test ne couvrait ces règles, et c'est précisément là qu'elles étaient
  // fausses : `allow update` autorisait un auteur — ou un modérateur — à
  // réécrire n'importe quel champ du document. Ces tests portent donc surtout
  // sur ce qui doit rester **immuable**.
  // -------------------------------------------------------------------------

  describe('Commentaires', () => {
    it('un membre actif lit un commentaire visible', async () => {
      await assertSucceeds(
        getDoc(
          doc(parent.firestore(), 'posts', 'post-own-published', 'comments', 'comment-du-parent'),
        ),
      );
    });

    it('un compte en attente ne lit aucun commentaire', async () => {
      await assertFails(
        getDoc(
          doc(pending.firestore(), 'posts', 'post-own-published', 'comments', 'comment-du-parent'),
        ),
      );
    });

    it('un membre actif commente une publication', async () => {
      await assertSucceeds(
        setDoc(
          doc(parent.firestore(), 'posts', 'post-own-published', 'comments', 'comment-nouveau'),
          commentDocument(),
        ),
      );
    });

    it('on ne commente pas une publication fermée aux commentaires', async () => {
      await assertFails(
        setDoc(
          doc(
            parent.firestore(),
            'posts',
            'post-commentaires-fermes',
            'comments',
            'comment-nouveau',
          ),
          commentDocument({ postId: 'post-commentaires-fermes' }),
        ),
      );
    });

    it('on ne commente pas une publication non publiée', async () => {
      await assertFails(
        setDoc(
          doc(parent.firestore(), 'posts', 'post-own-draft', 'comments', 'comment-nouveau'),
          commentDocument({ postId: 'post-own-draft' }),
        ),
      );
    });

    it('on ne commente pas une publication inexistante', async () => {
      await assertFails(
        setDoc(
          doc(parent.firestore(), 'posts', 'post-inexistant', 'comments', 'comment-nouveau'),
          commentDocument({ postId: 'post-inexistant' }),
        ),
      );
    });

    it('on ne commente pas sous une autre identité', async () => {
      await assertFails(
        setDoc(
          doc(parent.firestore(), 'posts', 'post-own-published', 'comments', 'comment-usurpe'),
          commentDocument({ authorId: UID.otherParent }),
        ),
      );
    });

    it('l’auteur modifie le corps de son commentaire', async () => {
      await assertSucceeds(
        updateDoc(
          doc(parent.firestore(), 'posts', 'post-own-published', 'comments', 'comment-du-parent'),
          { body: 'Merci, texte corrigé.' },
        ),
      );
    });

    it('l’auteur retire son propre commentaire', async () => {
      await assertSucceeds(
        updateDoc(
          doc(parent.firestore(), 'posts', 'post-own-published', 'comments', 'comment-du-parent'),
          { status: 'deleted' },
        ),
      );
    });

    it('l’auteur ne peut pas réécrire son commentaire sous une autre identité', async () => {
      // `authorName` est dénormalisé et affiché : changer `authorId` ferait
      // apparaître le commentaire sous le nom d'un autre parent.
      await assertFails(
        updateDoc(
          doc(parent.firestore(), 'posts', 'post-own-published', 'comments', 'comment-du-parent'),
          { authorId: UID.otherParent, authorName: 'Quelqu’un d’autre' },
        ),
      );
    });

    it('l’auteur ne peut pas s’attribuer un rôle', async () => {
      // Sans cette contrainte, n'importe quel parent pouvait afficher une
      // pastille « FCPE » ou « administrateur » sous son commentaire.
      await assertFails(
        updateDoc(
          doc(parent.firestore(), 'posts', 'post-own-published', 'comments', 'comment-du-parent'),
          { authorRole: 'admin' },
        ),
      );
    });

    it('l’auteur ne peut pas rattacher son commentaire à une autre publication', async () => {
      await assertFails(
        updateDoc(
          doc(parent.firestore(), 'posts', 'post-own-published', 'comments', 'comment-du-parent'),
          { postId: 'post-own-draft' },
        ),
      );
    });

    it('l’auteur ne peut pas effacer un signalement', async () => {
      await assertFails(
        updateDoc(
          doc(parent.firestore(), 'posts', 'post-own-published', 'comments', 'comment-signale'),
          { reportCount: 0 },
        ),
      );
    });

    it('un parent ne modifie pas le commentaire d’un autre', async () => {
      await assertFails(
        updateDoc(
          doc(parent.firestore(), 'posts', 'post-own-published', 'comments', 'comment-de-la-fcpe'),
          { body: 'Propos détournés.' },
        ),
      );
    });

    it('un modérateur masque un commentaire', async () => {
      await assertSucceeds(
        updateDoc(
          doc(
            moderator.firestore(),
            'posts',
            'post-own-published',
            'comments',
            'comment-du-parent',
          ),
          { status: 'hidden' },
        ),
      );
    });

    it('un modérateur ne réécrit pas le corps d’un commentaire', async () => {
      // Il masque ; réécrire le texte sous le nom de son auteur n'est pas son
      // rôle, et le commentaire de la règle l'annonçait déjà.
      await assertFails(
        updateDoc(
          doc(
            moderator.firestore(),
            'posts',
            'post-own-published',
            'comments',
            'comment-du-parent',
          ),
          { body: 'Propos détournés.' },
        ),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Réactions de commentaire
  //
  // Le décompte affiché vit sur le commentaire (`reactions`), tenu par une Cloud
  // Function. Ce qui se joue ici est plus étroit : l'identifiant du document est
  // l'UID du porteur, donc une double réaction est impossible par construction,
  // et personne ne peut lire ni retirer celle d'un autre.
  // -------------------------------------------------------------------------

  describe('Réactions', () => {
    const reaction = (context: RulesTestContext, uid: string) =>
      doc(
        context.firestore(),
        'posts',
        'post-own-published',
        'comments',
        'comment-du-parent',
        'reactions',
        uid,
      );

    it('un membre actif lit sa propre réaction', async () => {
      await assertSucceeds(getDoc(reaction(parent, UID.parent)));
    });

    it('personne ne lit la réaction d’un autre', async () => {
      // Savoir qui a réagi à quoi n'est pas nécessaire à l'affichage : le
      // décompte vient du commentaire, l'état du bouton de sa propre réaction.
      await assertFails(getDoc(reaction(parent, UID.otherParent)));
    });

    it('un membre actif réagit à un commentaire', async () => {
      await assertSucceeds(
        setDoc(
          doc(
            parent.firestore(),
            'posts',
            'post-own-published',
            'comments',
            'comment-de-la-fcpe',
            'reactions',
            UID.parent,
          ),
          reactionDocument({ commentId: 'comment-de-la-fcpe' }),
        ),
      );
    });

    it('on ne réagit pas sous l’identité d’un autre', async () => {
      await assertFails(
        setDoc(
          doc(
            parent.firestore(),
            'posts',
            'post-own-published',
            'comments',
            'comment-de-la-fcpe',
            'reactions',
            UID.otherParent,
          ),
          reactionDocument({ uid: UID.otherParent, commentId: 'comment-de-la-fcpe' }),
        ),
      );
    });

    it('un emoji hors de la liste fermée est refusé', async () => {
      // La liste est en dur dans les règles, et doit rester identique à
      // `REACTION_EMOJIS` : une règle ne peut pas importer de constante.
      await assertFails(
        setDoc(
          doc(
            parent.firestore(),
            'posts',
            'post-own-published',
            'comments',
            'comment-de-la-fcpe',
            'reactions',
            UID.parent,
          ),
          reactionDocument({ emoji: '🍕', commentId: 'comment-de-la-fcpe' }),
        ),
      );
    });

    it('un compte en attente ne réagit pas', async () => {
      await assertFails(
        setDoc(
          doc(
            pending.firestore(),
            'posts',
            'post-own-published',
            'comments',
            'comment-de-la-fcpe',
            'reactions',
            UID.parent,
          ),
          reactionDocument({ commentId: 'comment-de-la-fcpe' }),
        ),
      );
    });

    it('un membre retire sa propre réaction', async () => {
      await assertSucceeds(deleteDoc(reaction(parent, UID.parent)));
    });

    it('personne ne retire la réaction d’un autre', async () => {
      await assertFails(deleteDoc(reaction(parent, UID.otherParent)));
    });
  });

  describe('Messages', () => {
    it('un membre actif lit un message visible', async () => {
      await assertSucceeds(
        getDoc(doc(parent.firestore(), 'channels', 'channel-1', 'messages', 'message-du-parent')),
      );
    });

    it('un compte en attente ne lit aucun message', async () => {
      await assertFails(
        getDoc(doc(pending.firestore(), 'channels', 'channel-1', 'messages', 'message-du-parent')),
      );
    });

    it('un membre actif écrit un message', async () => {
      await assertSucceeds(
        setDoc(
          doc(parent.firestore(), 'channels', 'channel-1', 'messages', 'message-nouveau'),
          messageDocument(),
        ),
      );
    });

    it('on n’écrit pas un message sous une autre identité', async () => {
      await assertFails(
        setDoc(
          doc(parent.firestore(), 'channels', 'channel-1', 'messages', 'message-usurpe'),
          messageDocument({ authorId: UID.otherParent }),
        ),
      );
    });

    it('l’auteur modifie le corps de son message', async () => {
      await assertSucceeds(
        updateDoc(
          doc(parent.firestore(), 'channels', 'channel-1', 'messages', 'message-du-parent'),
          { body: 'Bonjour, texte corrigé.' },
        ),
      );
    });

    it('l’auteur retire son propre message', async () => {
      await assertSucceeds(
        updateDoc(
          doc(parent.firestore(), 'channels', 'channel-1', 'messages', 'message-du-parent'),
          { status: 'deleted' },
        ),
      );
    });

    // Les quatre tests suivants reproduisent, pour les messages, la faille qui
    // existait sur les commentaires : `allow update` n'exigeait rien sur le
    // document écrit, et Firestore évalue le document **entier** après fusion.
    it('l’auteur ne peut pas réécrire son message sous une autre identité', async () => {
      await assertFails(
        updateDoc(
          doc(parent.firestore(), 'channels', 'channel-1', 'messages', 'message-du-parent'),
          { authorId: UID.otherParent, authorName: 'Quelqu’un d’autre' },
        ),
      );
    });

    it('l’auteur ne peut pas s’attribuer un rôle', async () => {
      await assertFails(
        updateDoc(
          doc(parent.firestore(), 'channels', 'channel-1', 'messages', 'message-du-parent'),
          { authorRole: 'admin' },
        ),
      );
    });

    it('l’auteur ne peut pas rattacher son message à un autre canal', async () => {
      await assertFails(
        updateDoc(
          doc(parent.firestore(), 'channels', 'channel-1', 'messages', 'message-du-parent'),
          { channelId: 'channel-2' },
        ),
      );
    });

    it('l’auteur ne peut pas effacer un signalement', async () => {
      await assertFails(
        updateDoc(doc(parent.firestore(), 'channels', 'channel-1', 'messages', 'message-signale'), {
          reportCount: 0,
        }),
      );
    });

    it('un modérateur masque le message d’un autre', async () => {
      await assertSucceeds(
        updateDoc(
          doc(moderator.firestore(), 'channels', 'channel-1', 'messages', 'message-du-parent'),
          { status: 'hidden' },
        ),
      );
    });

    it('un modérateur ne peut pas réécrire le corps', async () => {
      // La modération masque, elle ne réécrit pas les propos d'un parent.
      await assertFails(
        updateDoc(
          doc(moderator.firestore(), 'channels', 'channel-1', 'messages', 'message-du-parent'),
          { body: 'Propos remplacés.' },
        ),
      );
    });

    it('un modérateur ne peut pas changer l’auteur', async () => {
      await assertFails(
        updateDoc(
          doc(moderator.firestore(), 'channels', 'channel-1', 'messages', 'message-du-parent'),
          { authorId: UID.moderator },
        ),
      );
    });

    it('un parent ne masque pas le message d’un autre', async () => {
      await assertFails(
        updateDoc(
          doc(parent.firestore(), 'channels', 'channel-1', 'messages', 'message-de-la-fcpe'),
          { status: 'hidden' },
        ),
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
