/**
 * Conversion de la valeur d'un filtre de journal en filtre interrogeable.
 *
 * ## Pourquoi cette fonction vit hors de l'écran
 *
 * Elle est la seule chose qui décide **quelles actions le filtre sait
 * reconnaître**, et cette décision doit être mesurable sans monter un DOM :
 * `apps/admin` n'a ni jsdom ni bibliothèque de rendu, et en ajouter deux pour
 * une assertion serait disproportionné. Sortie de l'écran, elle s'éprouve
 * directement, action par action.
 *
 * ## Le défaut qu'elle évite
 *
 * Si le menu proposait une action que cette fonction ne reconnaît pas, le
 * `<select>` afficherait une option, la requête partirait sur « tout le
 * journal », et l'écran présenterait le journal entier sous l'étiquette d'un
 * filtre — le pire des résultats pour un outil d'investigation, parce qu'il est
 * silencieux. Les deux côtés lisent donc la **même** liste, `AUDITED_ACTIONS`.
 */
import type { AdminLogFilter } from '@fl/firebase';
import { AUDITED_ACTIONS } from '@fl/shared';

/**
 * Traduit la valeur brute d'un `<select>` en filtre.
 *
 * La valeur vient du DOM, donc d'une chaîne quelconque : on la confronte à la
 * liste des actions **auditées** au lieu de la transtyper. C'est cette liste, et
 * elle seule, qui décide de ce que le filtre sait reconnaître — le repository,
 * lui, accepte tout le vocabulaire, parce qu'il décrit la collection et non ce
 * que cet écran propose.
 *
 * Une valeur inattendue — champ modifié à la main, version future de
 * l'interface — retombe sur « tout le journal » plutôt que de construire un
 * filtre invalide. Ce repli est sûr, et c'est aussi pourquoi
 * `audit-filter.test.ts` éprouve la reconnaissance **action par action** : une
 * action auditée que cette fonction ne reconnaîtrait pas ferait afficher le
 * journal entier sous l'étiquette d'un filtre, et rien ne le signalerait.
 */
export function toFilter(value: string): AdminLogFilter {
  const action = AUDITED_ACTIONS.find((candidate) => candidate === value);
  return action ? { kind: 'action', action } : { kind: 'all' };
}
