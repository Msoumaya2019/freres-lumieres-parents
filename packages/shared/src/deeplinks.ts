/**
 * Liens profonds de l'application.
 *
 * ## Pourquoi ils sont ici, et pas écrits à la main de chaque côté
 *
 * Le serveur **construit** le lien, l'application le **reconnaît**. Deux
 * chaînes écrites à la main de part et d'autre divergeraient sans que rien ne
 * le signale : un lien profond faux n'échoue pas, il ouvre l'écran d'accueil.
 * C'est le pire des symptômes, parce qu'il ressemble à un fonctionnement
 * normal — la notification s'ouvre, simplement pas sur le contenu annoncé.
 *
 * Le schéma n'est donc pas recopié : il est **vérifié** contre
 * `apps/mobile/app.json` par `deeplinks.test.ts`, qui lit le fichier sur le
 * disque. Changer le schéma d'un côté sans l'autre fait échouer la suite.
 *
 * ## Construire ne suffit pas : il faut savoir relire
 *
 * `buildDeeplink` a longtemps été la seule moitié écrite. Le serveur glissait
 * donc un lien dans chaque notification, et l'application ne le lisait nulle
 * part : un tap ouvrait l'application sur son écran d'accueil. La promesse
 * « le lien ouvre directement le contenu concerné » était fausse, et rien ne
 * le signalait — pas d'erreur, pas d'écran vide, juste le mauvais écran.
 *
 * `parseDeeplink` est l'autre moitié, et elle **échoue fermée** : tout ce
 * qu'elle ne reconnaît pas formellement rend `null`, et l'appelant n'ouvre
 * alors rien. Une chaîne venue d'une notification est une entrée non fiable —
 * elle transite par un service tiers et par le système d'exploitation.
 */

/** Schéma d'URL déclaré dans `apps/mobile/app.json` (`expo.scheme`). */
export const APP_SCHEME = 'frereslumieres';

/**
 * Écrans qu'un lien profond peut viser.
 *
 * La liste est la source du type, et non l'inverse : ajouter un écran sans
 * toucher au type est impossible, et le test de couverture exige que chaque
 * entrée soit soit ouvrable, soit déclarée sans route avec sa raison.
 */
export const DEEPLINK_TARGET_TYPES = [
  'post',
  'channel',
  'poll',
  'event',
  'report',
] as const satisfies readonly string[];

export type DeeplinkTargetType = (typeof DEEPLINK_TARGET_TYPES)[number];

export interface DeeplinkTarget {
  type: DeeplinkTargetType;
  id: string;
}

/**
 * Route de l'application qui ouvre un contenu, par type de cible.
 *
 * Seuls les types présents ici sont **ouvrables**. Un type absent rend `null`,
 * et le tap laisse alors l'application sur son écran d'accueil : c'est
 * préférable à une navigation vers un écran qui n'existe pas.
 */
export const DEEPLINK_ROUTES: Partial<Record<DeeplinkTargetType, string>> = {
  post: '/post',
  poll: '/sondage',
  channel: '/discussion',
};

/**
 * Types reconnus par `parseDeeplink` mais **sans écran** pour les ouvrir.
 *
 * La raison est écrite, et le test l'exige : une exception muette devient une
 * exception qu'on oublie. Le jour où l'écran existe, il faut retirer la ligne
 * — sinon le test échoue, et c'est voulu.
 */
export const TYPES_SANS_ROUTE: Partial<Record<DeeplinkTargetType, string>> = {
  event: "l'écran de l'agenda n'existe pas encore (phase 9)",
  report: "l'écran des signalements n'existe pas encore (phase 7)",
};

/** Vrai si la chaîne est un type de cible connu. */
function estTypeCible(valeur: string): valeur is DeeplinkTargetType {
  return (DEEPLINK_TARGET_TYPES as readonly string[]).includes(valeur);
}

/**
 * Forme acceptée : `{schéma}://{type}/{id}`, et rien d'autre.
 *
 * Volontairement stricte, sans `i` : un schéma ou un type en majuscules n'est
 * pas ce que `buildDeeplink` produit, donc le tolérer reviendrait à accepter
 * une chaîne qu'on n'a pas écrite. Pas de requête, pas de fragment, pas de
 * segment supplémentaire : `id` est le dernier morceau, un point c'est tout.
 */
const MOTIF_LIEN = new RegExp(`^${APP_SCHEME}://([a-z]+)/([A-Za-z0-9_-]{1,128})$`);

/**
 * Relit un lien profond. Rend `null` pour tout ce qui n'est pas exactement de
 * la forme attendue — mauvais schéma, type inconnu, identifiant vide, chaîne
 * absente ou d'un autre type que `string`.
 *
 * L'identifiant est borné aux caractères d'un identifiant Firestore : il finit
 * dans un chemin de route, et rien n'oblige une notification à être bien
 * formée. Accepter un `/` ou un `..` y ouvrirait une traversée.
 */
export function parseDeeplink(url: unknown): DeeplinkTarget | null {
  if (typeof url !== 'string') return null;

  const correspondance = MOTIF_LIEN.exec(url);
  if (!correspondance) return null;

  const [, type, id] = correspondance;
  if (!type || !id) return null;
  if (!estTypeCible(type)) return null;

  return { type, id };
}

/**
 * Construit le lien profond d'un contenu.
 *
 * La forme est `{schéma}://{type}/{id}`. L'identifiant est celui du document
 * Firestore : il est alphanumérique, donc utilisable tel quel dans une URL.
 */
export function buildDeeplink(target: DeeplinkTarget): string {
  return `${APP_SCHEME}://${target.type}/${target.id}`;
}

/**
 * Chemin de route à ouvrir pour un lien profond, ou `null` s'il n'y a rien à
 * ouvrir. C'est la seule fonction que l'application appelle : elle ne voit ni
 * le schéma, ni la table des routes.
 */
export function routeForDeeplink(url: unknown): string | null {
  const cible = parseDeeplink(url);
  if (!cible) return null;

  const base = DEEPLINK_ROUTES[cible.type];
  if (!base) return null;

  return `${base}/${cible.id}`;
}
