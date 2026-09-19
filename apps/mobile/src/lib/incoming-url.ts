/**
 * Filtrer les URL que le système remet à l'application.
 *
 * ## Pourquoi cette règle est écrite ici, et pas dans le fichier du routeur
 *
 * Expo Router analyse la requête d'une URL entrante avec `query-string`, qui
 * décode chaque valeur par `decode-uri-component@0.2.2` — la version
 * qu'installe `expo-router@57`. Cette version a un repli dont le coût grimpe
 * avec le nombre de séquences `%XX` qui ne forment pas d'UTF-8 valide. Mesuré
 * sur cette machine, sur le chemin réel (`query-string.parse`), pour une valeur
 * de `%C3` répété :
 *
 * | séquences | longueur de la requête | durée |
 * | --------- | ---------------------- | ----- |
 * | 32        | 98 caractères          | 47 ms |
 * | 64        | 194 caractères         | 246 ms |
 * | 128       | 386 caractères         | 1 124 ms |
 * | 256       | 770 caractères         | 7 308 ms |
 *
 * Quelques centaines de caractères suffisent donc à figer l'application
 * (GHSA-vcc3-ghjq-m6fr, CVE-2026-45822). La correction amont n'est pas
 * installable : `0.5.0` est un module ESM à export par défaut, et
 * `query-string@7` en fait un `require` nu, qui rendrait un objet au lieu
 * d'une fonction.
 *
 * ## Pourquoi refuser la requête suffit, et ne coûte rien
 *
 * `parseQueryParams` n'appelle `queryString.parse` que si le chemin contient
 * un `?` — `path.split('?')[1]` — et il le fait sur le chemin **brut** : un
 * `%3F` encodé ne devient jamais une requête. Fermer la requête retire donc le
 * décodeur vulnérable du chemin, entièrement.
 *
 * Et cela ne coûte rien, parce que c'est déjà la règle du lien profond : le
 * motif de `parseDeeplink` n'accepte aucune requête, donc aucun lien que
 * l'application écrit n'en porte. La garde est cette règle-là, appliquée un
 * cran plus tôt — pas un plafond de longueur arbitraire.
 *
 * Le module ne connaît ni Expo ni le routeur : il reçoit une valeur non fiable
 * et rend une décision. C'est ce qui le rend éprouvable sans appareil.
 */

/**
 * L'URL à remettre au routeur, ou `null` pour annuler la navigation.
 *
 * `null` — et non la chaîne vide — parce que c'est le retour **falsy** qui
 * annule : `link/linking.js` ne rappelle son auditeur que `if (href)`.
 *
 * Une chaîne vide rend `null` elle aussi. Ce n'est pas une URL à ouvrir, et
 * Expo Router s'en sert déjà pour dire « aucune » (`getInitialURL` rend `''`
 * hors navigateur) : les deux valeurs sont donc fausses de la même façon, et
 * `null` dit mieux ce qu'on veut dire.
 */
export function filtreUrlEntrante(url: unknown): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  return url.includes('?') ? null : url;
}
