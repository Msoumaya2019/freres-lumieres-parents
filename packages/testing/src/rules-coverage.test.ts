/**
 * Garde de couverture des règles de lecture.
 *
 * ## Le défaut qu'elle empêche
 *
 * La collection `users` a été lisible en entier, toutes organisations
 * confondues, parce que sa règle de lecture ne référençait **aucun champ du
 * document** : `isSelf(uid) || (isActive() && (isFcpe() || isModerator()))` est
 * satisfaite par Firestore pour n'importe quelle requête. Le même défaut
 * existait sur `reports` et `moderationReports`, et `fcpeTasks` était illisible
 * à cause de `request.resource` employé sur une lecture.
 *
 * Quatre défauts, découverts en lisant le fichier de règles — c'est-à-dire par
 * chance. Aucun test ne les signalait, parce qu'aucun test n'existait sur ces
 * collections. Et rien n'obligeait à en écrire.
 *
 * ## Ce que fait cette garde
 *
 * Elle lit `firebase/firestore.rules` et exige, pour **chaque collection de
 * premier niveau dotée d'une règle de lecture**, l'une des deux choses
 * suivantes :
 *
 *  - la règle compare l'organisation du document à celle du lecteur
 *    (`orgId()`, directement ou par l'helper `canReadOrgContent()`) ; ou
 *  - la collection figure dans `SANS_CLOISONNEMENT`, avec la raison écrite.
 *
 * L'omission cesse donc d'être silencieuse : elle devient une justification à
 * rédiger, et à relire. Une exception qui ne correspond plus à aucune collection
 * fait aussi échouer le test, pour qu'une table d'exceptions ne survive pas au
 * code qu'elle excusait.
 *
 * ## Pourquoi lire le fichier plutôt qu'interroger l'émulateur
 *
 * Une garde qui interrogerait l'émulateur ne pourrait vérifier que les
 * collections pour lesquelles un fixture existe — or c'est précisément l'absence
 * de fixture qui a laissé passer les quatre défauts. Lire le texte des règles
 * couvre **toutes** les collections, y compris celles qu'aucun écran n'utilise
 * encore. Ce test ne remplace pas les tests d'émulateur : il vérifie que la
 * frontière est *écrite*, pas qu'elle *fonctionne*.
 *
 * ## Ce qu'elle ne couvre pas, et pourquoi
 *
 * Les sous-collections (`posts/comments`, `channels/messages`,
 * `reports/replies`, `collectiveIssues/supporters`, `events/participants`…) sont
 * hors de son périmètre : leurs documents ne portent pas d'`orgId`, donc la
 * seule réponse serait de toutes les déclarer en exception, ce qui n'apprendrait
 * rien. Leur situation est décrite dans `docs/04-security.md` § 10, et c'est un
 * changement de modèle qui les réglera — pas une ligne de règle.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findRepoRoot } from './env.js';

/**
 * Collections de premier niveau dont la lecture n'est **pas** cloisonnée par
 * organisation, avec la raison. Toute autre collection lisible doit comparer
 * `orgId()`.
 *
 * Cette table est le cœur de la garde : elle transforme une omission en
 * décision écrite. Y ajouter une entrée est un acte volontaire, relu en revue.
 */
const SANS_CLOISONNEMENT: Readonly<Record<string, string>> = {
  organizations:
    'Lecture ouverte aux comptes connectés, et non aux seuls comptes actifs : ' +
    'l’inscription résout l’organisation par son slug avant que le compte ' +
    'n’existe. Aucune donnée personnelle : un nom, une ville, un slug.',
  schools:
    'Même raison : le formulaire d’inscription doit proposer les établissements ' +
    'à un compte encore `pending`. Ce sont des noms d’écoles.',
  classes: 'Même raison que les établissements. Ce sont des noms de classes.',
  deviceTokens:
    'Aucun lecteur client (`allow read: if false`) : l’index des appareils ' +
    'n’est lu que par les Cloud Functions. Il n’y a donc pas de frontière à ' +
    'poser ici.',
  counters:
    'Agrégats seuls, sans donnée personnelle, et l’identifiant du document ' +
    '**est** l’identifiant d’organisation : la contrainte s’écrirait ' +
    '`counterId == orgId()`. Frontière manquante, décision en cours — ' +
    '`docs/04-security.md` § 10.',
  highlights:
    'Même situation que `counters`, et corrigée en même temps que lui : les ' +
    'deux se traitent d’un bloc, pas séparément.',
  adminLogs:
    '`AdminLog` ne porte aucun `orgId` dans le modèle : la frontière demande ' +
    'd’ajouter le champ, de l’écrire dans `writeAuditLog` et de traiter les ' +
    'entrées déjà écrites. Sans conséquence tant qu’une seule organisation ' +
    'existe — `docs/04-security.md` § 10.',
};

/**
 * Helper partagé qui porte la comparaison d'organisation pour les contenus
 * publiés par la FCPE. Les collections qui passent par lui sont cloisonnées
 * sans écrire `orgId()` dans leur propre bloc — d'où sa vérification séparée,
 * sans laquelle la garde aurait une porte dérobée.
 */
const HELPER_CLOISONNE = 'canReadOrgContent';

interface BlocDeCollection {
  readonly nom: string;
  readonly contenu: string;
}

/**
 * Extrait les blocs `match /<nom>/{...}` de premier niveau.
 *
 * ## Pourquoi les accolades des chemins sont retirées avant de compter
 *
 * Les accolades d'un chemin (`{database}`, `{organizationId}`) ne délimitent
 * aucun bloc. Les compter revient à croire que `match /organizations/{organizationId} {`
 * se referme juste après `{organizationId}` : la première version de cette garde
 * faisait exactement cela, et analysait des blocs vides — donc verts.
 *
 * ## Pourquoi pas une expression régulière
 *
 * Les règles contiennent des fonctions imbriquées (`function validPost() { … }`).
 * Une expression régulière non gourmande s'arrêterait à la première accolade
 * fermante, c'est-à-dire au milieu du bloc.
 */
function extraireCollections(rules: string): BlocDeCollection[] {
  const sansCommentaires = rules
    .split('\n')
    .map((ligne) => ligne.replace(/\/\/.*$/, ''))
    .join('\n');

  // Neutralise les accolades de chemin, y compris au milieu d'un chemin
  // (`match /databases/{database}/documents`).
  const prepare = sansCommentaires
    .replace(/match\s+\/([A-Za-z0-9_]+)\/\{[A-Za-z0-9_]+\}/g, 'match /$1/@')
    .replace(/\/\{[A-Za-z0-9_]+\}/g, '/@');

  const depart = prepare.indexOf('match /databases/@/documents');
  if (depart === -1) {
    throw new Error(
      'Bloc `match /databases/{database}/documents` introuvable : la garde ne ' +
        'peut pas analyser le fichier de règles.',
    );
  }

  const blocs: BlocDeCollection[] = [];
  let profondeur = 0;
  let courant: { nom: string; debut: number; profondeur: number } | null = null;

  for (let i = depart; i < prepare.length; i += 1) {
    const caractere = prepare[i];

    if (caractere === '{') {
      profondeur += 1;
      continue;
    }

    if (caractere === '}') {
      if (courant && profondeur === courant.profondeur) {
        blocs.push({ nom: courant.nom, contenu: prepare.slice(courant.debut, i) });
        courant = null;
      }
      profondeur -= 1;
      continue;
    }

    // Un `match /nom/@` ouvre un bloc. Seuls ceux de premier niveau sont
    // retenus : `profondeur` vaut alors 1, c'est-à-dire juste à l'intérieur de
    // `match /databases/@/documents {`.
    if (courant === null && profondeur === 1 && prepare.startsWith('match /', i)) {
      const nom = /^match \/([A-Za-z0-9_]+)\/@/.exec(prepare.slice(i, i + 80));
      if (nom?.[1]) {
        courant = { nom: nom[1], debut: i, profondeur: profondeur + 1 };
      }
    }
  }

  return blocs;
}

const RULES = readFileSync(join(findRepoRoot(), 'firebase', 'firestore.rules'), 'utf8');
const COLLECTIONS = extraireCollections(RULES);
const LISIBLES = COLLECTIONS.filter((bloc) => /\ballow\s+(read|get|list)\b/.test(bloc.contenu));

describe('Couverture des règles de lecture', () => {
  it('trouve des collections à analyser', () => {
    // Sans cette vérification, une analyse cassée rendrait tous les tests
    // suivants verts en ne trouvant rien — le pire des échecs, celui qui
    // rassure. C'est arrivé à la première version de ce fichier.
    expect(COLLECTIONS.length).toBeGreaterThanOrEqual(15);
    expect(LISIBLES.length).toBeGreaterThanOrEqual(15);
  });

  it('porte la comparaison d’organisation dans l’helper partagé', () => {
    const helper = /function canReadOrgContent\(\)\s*\{[\s\S]*?\n {4}\}/.exec(RULES);

    expect(helper, 'helper `canReadOrgContent` introuvable').not.toBeNull();
    expect(helper?.[0]).toContain('resource.data.orgId == orgId()');
  });

  it('cloisonne par organisation toute collection lisible non exceptée', () => {
    const fautives = LISIBLES.filter(
      (bloc) =>
        !bloc.contenu.includes('orgId()') &&
        !bloc.contenu.includes(HELPER_CLOISONNE) &&
        !(bloc.nom in SANS_CLOISONNEMENT),
    ).map((bloc) => bloc.nom);

    expect(fautives).toEqual([]);
  });

  it('justifie chaque exception, et n’en garde aucune d’obsolète', () => {
    const noms = new Set(COLLECTIONS.map((bloc) => bloc.nom));
    const orphelines = Object.keys(SANS_CLOISONNEMENT).filter((nom) => !noms.has(nom));

    expect(orphelines).toEqual([]);

    for (const [nom, raison] of Object.entries(SANS_CLOISONNEMENT)) {
      // Une exception sans raison écrite n'est pas une décision, c'est un oubli
      // déguisé : la table doit rester lisible par quelqu'un qui découvre le
      // projet.
      expect(raison.length, `raison trop courte pour « ${nom} »`).toBeGreaterThan(40);
    }
  });
});
