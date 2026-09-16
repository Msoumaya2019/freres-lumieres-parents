/**
 * Repository des publications et des commentaires.
 *
 * Contient la requête la plus importante de l'application : le fil
 * d'actualité. Elle tient en **une seule requête indexée** grâce aux clés
 * d'audience dénormalisées (voir `docs/02-data-model.md` § 4).
 */
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

import { buildAudienceKeys, isReactionEmoji, postInputSchema, type PostInput } from '@fl/shared';
import type { Comment, ContentStatus, Post, PostCategory, UserRole } from '@fl/types';

import { invalidArgument, toAppError } from '../errors.js';
import { paginate, type FirestorePage } from '../pagination.js';
import { COLLECTIONS, paths } from '../paths.js';

/** Tailles de page — voir `PAGE_SIZES` dans `@fl/shared`. */
const FEED_PAGE_SIZE = 10;
const COMMENTS_PAGE_SIZE = 20;
const ADMIN_POSTS_PAGE_SIZE = 20;

export interface FeedParams {
  orgId: string;
  /** Clés d'audience de l'utilisateur, calculées depuis son profil. */
  audienceKeys: readonly string[];
  /**
   * Filtre par catégorie, appliqué **par la requête** et non après coup.
   *
   * Filtrer côté client sur la page déjà chargée donnerait un état vide
   * trompeur : « aucune publication en cantine » alors que la page suivante en
   * contient. Le filtre doit donc faire partie de la requête, ce qui impose
   * l'index composite correspondant (`firestore.indexes.json`).
   */
  category?: PostCategory;
  cursor?: QueryDocumentSnapshot | null;
  pageSize?: number;
}

export interface AdminPostsParams {
  orgId: string;
  cursor?: QueryDocumentSnapshot | null;
  pageSize?: number;
}

export interface CreatePostParams {
  orgId: string;
  schoolId?: string;
  authorId: string;
  authorName: string;
  authorRole: UserRole;
  /**
   * Identifiant à donner à la publication, obtenu par `newPostId()`.
   *
   * Sans lui, Firestore en génère un — ce qui interdit d'envoyer des pièces
   * jointes **avant** la création. Leur chemin contient en effet l'identifiant
   * de la publication (`orgs/{orgId}/posts/{postId}/…`), et les règles Storage
   * ne vérifient pas que le document existe : le pré-générer permet donc de
   * créer la publication complète du premier coup, photos comprises.
   *
   * C'est nécessaire parce que `publishedAt` est **figé** par les règles et
   * posé à la création. Un brouillon intermédiaire, publié après l'envoi des
   * photos, porterait la date du brouillon — et une publication datée de la
   * veille passerait sous les yeux des parents sans qu'ils comprennent
   * pourquoi.
   */
  postId?: string;
  input: PostInput;
}

export interface PostRepository {
  /** Fil d'actualité paginé, filtré par les règles ET par les clés d'audience. */
  fetchFeed(params: FeedParams): Promise<FirestorePage<Post>>;
  /**
   * Publications publiées d'une organisation, pour l'administration.
   *
   * Différente du fil, et pas seulement par confort : `fetchFeed` filtre sur
   * `audienceKeys`, donc une publication destinée au seul niveau CM2
   * n'apparaîtrait pas pour un membre de la FCPE dont les enfants sont en CE1.
   * Or c'est exactement ce que l'administration doit voir : tout ce qui a été
   * publié, quel qu'en soit le ciblage.
   *
   * La requête contraint `orgId` et `status`, les deux champs sur lesquels la
   * règle `list` s'appuie — sans quoi Firestore refuserait la requête entière
   * (voir `firestore.rules`, « les règles ne sont pas des filtres »).
   *
   * Elle ne peut pas, en revanche, remonter les brouillons : une règle de
   * requête doit être démontrable à partir des contraintes, et `status ==
   * 'published'` est la seule qui le soit. Un brouillon s'ouvre par son
   * identifiant, jamais par une liste.
   */
  fetchForAdmin(params: AdminPostsParams): Promise<FirestorePage<Post>>;
  /** Publications épinglées, affichées en tête du fil. */
  fetchPinned(orgId: string): Promise<Post[]>;
  /** Détail d'une publication. */
  get(postId: string): Promise<Post | null>;
  /** Crée une publication. Valide les données et calcule les clés d'audience. */
  create(params: CreatePostParams): Promise<string>;
  /**
   * Identifiant d'une publication qui n'existe pas encore.
   *
   * N'écrit rien et ne consomme aucune lecture : Firestore génère
   * l'identifiant côté client. Il sert à envoyer les pièces jointes **avant**
   * la création du document, en les rangeant déjà à leur place définitive.
   */
  newPostId(): string;
  /** Met à jour une publication existante. */
  update(postId: string, input: Partial<PostInput>): Promise<void>;
  /** Épingle ou désépingle une publication. */
  setPinned(postId: string, pinned: boolean): Promise<void>;
  /**
   * Change le statut éditorial d'une publication.
   *
   * Distinct de `update()`, qui ne transporte que les champs du formulaire et
   * dont le `status` est borné à `draft | published`. Masquer une publication
   * est un acte de modération, pas une édition : la règle l'autorise d'ailleurs
   * à d'autres rôles que l'auteur, et le type doit le refléter plutôt que
   * d'obliger l'appelant à contourner `PostInput`.
   */
  setStatus(postId: string, status: ContentStatus): Promise<void>;
  /** Charge une page de commentaires, du plus récent au plus ancien. */
  fetchComments(
    postId: string,
    cursor?: QueryDocumentSnapshot | null,
  ): Promise<FirestorePage<Comment>>;
  /** Ajoute un commentaire. Le compteur est tenu par une Cloud Function. */
  addComment(params: {
    postId: string;
    authorId: string;
    authorName: string;
    authorRole: UserRole;
    body: string;
    parentId?: string;
  }): Promise<string>;
  /**
   * Réactions de l'utilisateur courant, pour les commentaires demandés.
   *
   * Une lecture par commentaire, et non une requête de groupe : le décompte
   * affiché vient du commentaire lui-même (`reactions`), il ne reste donc qu'à
   * savoir ce que **moi** j'ai choisi. Une requête de groupe exigerait un index
   * supplémentaire et une règle `match /{path=**}/...` pour un gain marginal
   * sur vingt commentaires.
   */
  fetchMyReactions(
    postId: string,
    commentIds: readonly string[],
    uid: string,
  ): Promise<Map<string, string>>;
  /**
   * Pose, bascule ou retire une réaction.
   *
   * Aucun compteur n'est écrit ici : le commentaire n'est modifiable que par son
   * auteur, et laisser le client fixer un décompte reviendrait à le laisser
   * mentir. Une Cloud Function recalcule `reactions` depuis cette
   * sous-collection.
   */
  setReaction(params: {
    postId: string;
    commentId: string;
    uid: string;
    emoji: string;
    active: boolean;
  }): Promise<void>;
}

export function createPostRepository(db: Firestore): PostRepository {
  const postsCollection = collection(db, COLLECTIONS.posts);

  function mapPost(snapshot: QueryDocumentSnapshot): Post {
    return { ...(snapshot.data() as Omit<Post, 'id'>), id: snapshot.id };
  }

  function mapComment(snapshot: QueryDocumentSnapshot): Comment {
    return { ...(snapshot.data() as Omit<Comment, 'id'>), id: snapshot.id };
  }

  function fetchFeed(params: FeedParams): Promise<FirestorePage<Post>> {
    const { orgId, audienceKeys, category, cursor = null, pageSize = FEED_PAGE_SIZE } = params;

    if (audienceKeys.length === 0) {
      // Échec fermé : sans clé d'audience, aucune publication n'est visible.
      // Cela se produit uniquement pour un compte sans rattachement.
      return Promise.resolve({ items: [], nextCursor: null, hasMore: false });
    }

    return paginate<Post>({
      pageSize,
      cursor,
      buildQuery: () =>
        query(
          postsCollection,
          where('orgId', '==', orgId),
          where('status', '==', 'published'),
          // Le cœur du dispositif : une seule requête pour toutes les
          // audiences, grâce aux clés dénormalisées.
          where('audienceKeys', 'array-contains-any', [...audienceKeys]),
          ...(category ? [where('category', '==', category)] : []),
          orderBy('publishedAt', 'desc'),
        ),
      mapDocument: mapPost,
    });
  }

  function fetchForAdmin(params: AdminPostsParams): Promise<FirestorePage<Post>> {
    const { orgId, cursor = null, pageSize = ADMIN_POSTS_PAGE_SIZE } = params;

    return paginate<Post>({
      pageSize,
      cursor,
      buildQuery: () =>
        query(
          postsCollection,
          where('orgId', '==', orgId),
          where('status', '==', 'published'),
          orderBy('publishedAt', 'desc'),
        ),
      mapDocument: mapPost,
    });
  }

  async function fetchPinned(orgId: string): Promise<Post[]> {
    try {
      const snapshot = await getDocs(
        query(
          postsCollection,
          where('orgId', '==', orgId),
          where('status', '==', 'published'),
          where('pinned', '==', true),
          orderBy('publishedAt', 'desc'),
          limit(3),
        ),
      );
      return snapshot.docs.map(mapPost);
    } catch (error) {
      throw toAppError(error);
    }
  }

  async function get(postId: string): Promise<Post | null> {
    try {
      const snapshot = await getDoc(doc(db, paths.post(postId)));
      if (!snapshot.exists()) return null;
      return { ...(snapshot.data() as Omit<Post, 'id'>), id: snapshot.id };
    } catch (error) {
      throw toAppError(error);
    }
  }

  /**
   * Identifiant d'une publication qui n'existe pas encore.
   *
   * `doc(collection)` fabrique un identifiant côté client : rien n'est écrit,
   * rien n'est lu. L'appelant peut donc ranger les pièces jointes à leur place
   * définitive avant que le document n'existe — c'est tout l'intérêt.
   */
  function newPostId(): string {
    return doc(postsCollection).id;
  }

  async function create(params: CreatePostParams): Promise<string> {
    const { orgId, schoolId, authorId, authorName, authorRole, postId, input } = params;

    const parsed = postInputSchema.safeParse(input);
    if (!parsed.success) {
      throw invalidArgument('Publication invalide.', {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const data = parsed.data;
    const audienceKeys = buildAudienceKeys(data.audience, orgId);

    if (audienceKeys.length === 0) {
      throw invalidArgument("L'audience de la publication est incomplète.");
    }

    try {
      const now = serverTimestamp();
      const payload = {
        orgId,
        ...(schoolId ? { schoolId } : {}),
        title: data.title,
        body: data.body,
        category: data.category,
        audience: data.audience,
        audienceKeys,
        attachments: data.attachments,
        ...(data.linkUrl ? { linkUrl: data.linkUrl } : {}),
        authorId,
        authorName,
        authorRole,
        commentsEnabled: data.commentsEnabled,
        pinned: data.pinned,
        status: data.status,
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
        // Les compteurs démarrent à zéro : les règles Firestore refusent
        // toute création qui tenterait de les fixer autrement.
        stats: { commentCount: 0, reactionCount: 0 },
      };

      // Avec un identifiant pré-généré, on écrit à une place connue d'avance —
      // c'est ce qui permet d'avoir envoyé les pièces jointes avant, à leur
      // chemin définitif. Sans lui, Firestore choisit l'identifiant, et il
      // faudrait créer d'abord puis compléter : deux écritures, un état
      // intermédiaire visible, et `publishedAt` figé trop tôt.
      if (postId) {
        await setDoc(doc(postsCollection, postId), payload);
        return postId;
      }

      const created = await addDoc(postsCollection, payload);
      return created.id;
    } catch (error) {
      throw toAppError(error);
    }
  }

  async function update(postId: string, input: Partial<PostInput>): Promise<void> {
    try {
      const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };

      if (input.title !== undefined) payload.title = input.title;
      if (input.body !== undefined) payload.body = input.body;
      if (input.category !== undefined) payload.category = input.category;
      if (input.commentsEnabled !== undefined) payload.commentsEnabled = input.commentsEnabled;
      if (input.pinned !== undefined) payload.pinned = input.pinned;
      if (input.attachments !== undefined) payload.attachments = input.attachments;
      // `linkUrl` est le seul champ facultatif modifiable : une chaîne vide
      // signifie « effacer le lien », et non « écrire une chaîne vide ».
      //
      // Sans ce test de vacuité, `deleteField()` était inatteignable : `??` ne
      // se déclenche que sur `null` / `undefined`, deux valeurs que
      // `exactOptionalPropertyTypes` interdit précisément de transmettre
      // explicitement. Un lien posé par erreur ne pouvait donc jamais être
      // retiré.
      if (input.linkUrl !== undefined) {
        payload.linkUrl = input.linkUrl ? input.linkUrl : deleteField();
      }
      if (input.status !== undefined) payload.status = input.status;

      if (input.audience !== undefined) {
        payload.audience = input.audience;
        // Les clés doivent être recalculées avec l'audience : les laisser
        // désynchronisées rendrait le contenu invisible ou trop visible.
        payload.audienceKeys = buildAudienceKeys(input.audience, (await getOrgId(postId)) ?? '');
      }

      await updateDoc(doc(db, paths.post(postId)), payload);
    } catch (error) {
      throw toAppError(error);
    }
  }

  async function getOrgId(postId: string): Promise<string | null> {
    const post = await get(postId);
    return post?.orgId ?? null;
  }

  async function setPinned(postId: string, pinned: boolean): Promise<void> {
    try {
      await updateDoc(doc(db, paths.post(postId)), { pinned, updatedAt: serverTimestamp() });
    } catch (error) {
      throw toAppError(error);
    }
  }

  async function setStatus(postId: string, status: ContentStatus): Promise<void> {
    try {
      await updateDoc(doc(db, paths.post(postId)), { status, updatedAt: serverTimestamp() });
    } catch (error) {
      throw toAppError(error);
    }
  }

  function fetchComments(
    postId: string,
    cursor: QueryDocumentSnapshot | null = null,
  ): Promise<FirestorePage<Comment>> {
    const commentsCollection = collection(db, paths.postComments(postId));

    return paginate<Comment>({
      pageSize: COMMENTS_PAGE_SIZE,
      cursor,
      buildQuery: () =>
        query(commentsCollection, where('status', '==', 'visible'), orderBy('createdAt', 'desc')),
      mapDocument: mapComment,
    });
  }

  async function addComment(params: {
    postId: string;
    authorId: string;
    authorName: string;
    authorRole: UserRole;
    body: string;
    parentId?: string;
  }): Promise<string> {
    const { postId, authorId, authorName, authorRole, body, parentId } = params;

    try {
      const now = serverTimestamp();
      const ref = await addDoc(collection(db, paths.postComments(postId)), {
        postId,
        authorId,
        authorName,
        authorRole,
        body,
        ...(parentId ? { parentId } : {}),
        replyCount: 0,
        reactions: {},
        status: 'visible',
        reportCount: 0,
        createdAt: now,
      });

      // Le compteur de la publication n'est **pas** incrémenté ici.
      //
      // La version précédente tentait `increment(1)` sur `stats.commentCount`,
      // mais `allow update` sur `posts/{postId}` exige `isFcpe()` : un parent
      // voyait donc son commentaire créé, puis la seconde écriture refusée, et
      // l'interface signalait un échec pour une action pourtant réussie. Le
      // compteur est maintenu par la Cloud Function de compteurs, qui écrit
      // avec l'Admin SDK et n'est pas soumise à ces règles.
      return ref.id;
    } catch (error) {
      throw toAppError(error);
    }
  }

  async function fetchMyReactions(
    postId: string,
    commentIds: readonly string[],
    uid: string,
  ): Promise<Map<string, string>> {
    try {
      const snapshots = await Promise.all(
        commentIds.map((commentId) =>
          getDoc(doc(db, paths.commentReaction(postId, commentId, uid))),
        ),
      );

      const mine = new Map<string, string>();
      commentIds.forEach((commentId, index) => {
        const snapshot = snapshots[index];
        const data = snapshot?.exists() ? snapshot.data() : null;
        if (data && typeof data.emoji === 'string') mine.set(commentId, data.emoji);
      });
      return mine;
    } catch (error) {
      throw toAppError(error);
    }
  }

  async function setReaction(params: {
    postId: string;
    commentId: string;
    uid: string;
    emoji: string;
    active: boolean;
  }): Promise<void> {
    const { postId, commentId, uid, emoji, active } = params;

    if (!isReactionEmoji(emoji)) {
      throw invalidArgument('Réaction inconnue.');
    }

    const ref = doc(db, paths.commentReaction(postId, commentId, uid));

    try {
      if (!active) {
        await deleteDoc(ref);
        return;
      }

      await setDoc(ref, {
        uid,
        postId,
        commentId,
        emoji,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      throw toAppError(error);
    }
  }

  return {
    fetchFeed,
    fetchForAdmin,
    fetchPinned,
    get,
    newPostId,
    create,
    update,
    setPinned,
    setStatus,
    fetchComments,
    addComment,
    fetchMyReactions,
    setReaction,
  };
}
