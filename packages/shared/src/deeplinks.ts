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
 */

/** Schéma d'URL déclaré dans `apps/mobile/app.json` (`expo.scheme`). */
export const APP_SCHEME = 'frereslumieres';

/** Écrans qu'un lien profond peut viser. */
export type DeeplinkTargetType = 'post' | 'channel' | 'poll' | 'event' | 'report';

/**
 * Construit le lien profond d'un contenu.
 *
 * La forme est `{schéma}://{type}/{id}`. L'identifiant est celui du document
 * Firestore : il est alphanumérique, donc utilisable tel quel dans une URL.
 */
export function buildDeeplink(target: { type: DeeplinkTargetType; id: string }): string {
  return `${APP_SCHEME}://${target.type}/${target.id}`;
}
