/**
 * Le point par lequel le système remet une URL à l'application.
 *
 * ## Pourquoi ce fichier existe
 *
 * Expo Router analyse la requête d'une URL entrante avec `query-string`, qui
 * décode chaque valeur par `decode-uri-component@0.2.2`. Cette version a un
 * repli dont le coût grimpe avec le nombre de séquences `%XX` qui ne forment
 * pas d'UTF-8 valide : mesuré, une requête de 770 caractères coûte 7,3 s de
 * processeur, et un lien forgé suffit donc à figer l'application
 * (GHSA-vcc3-ghjq-m6fr, CVE-2026-45822).
 *
 * `redirectSystemPath` est le seul point qui précède cette analyse :
 * `getLinkingConfig.js` l'appelle sur l'URL de lancement, `link/linking.js`
 * sur chaque URL reçue ensuite. Et un retour falsy **annule** la navigation —
 * `if (href) listener(href)`.
 *
 * ## Ce que ce filtre ne peut pas casser
 *
 * Il n'est appelé que pour une URL **venue du système**. La navigation interne
 * ne passe pas par ici, et un lien profond que l'application écrit ne porte
 * jamais de requête : le motif de `parseDeeplink` n'en accepte aucune.
 *
 * Un seul effet de bord connu, et il est en développement : sous Expo Go, Expo
 * Router peut composer l'URL racine avec la requête du lien `exp://` saisi
 * (`parseExpoGoUrlFromListener`). Une telle URL est refusée, et l'application
 * démarre alors sur son écran d'accueil — ce qu'elle fait déjà quand elle est
 * lancée sans lien.
 *
 * La règle elle-même, et sa table de mesures, sont dans
 * `src/lib/incoming-url.ts` : ce fichier n'est que le branchement.
 */
import { filtreUrlEntrante } from '@/lib/incoming-url';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  return filtreUrlEntrante(path);
}
