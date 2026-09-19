/**
 * Tenue en accord de la liste des actions auditées et de ses écrivains.
 *
 * ## Le défaut que ce test existe pour interdire
 *
 * Le filtre de l'écran d'audit proposait **dix-sept** actions, dont **sept**
 * seulement étaient écrites. Les dix autres ne pouvaient rien retourner, et une
 * page vide se lit « il ne s'est jamais rien passé ». Aucune compilation ne
 * protestait : `AdminAction` est un vocabulaire, et le fait qu'un mot du
 * vocabulaire ne serve jamais ne se voit nulle part.
 *
 * Deux tables portent ces noms, et rien ne les tenait ensemble :
 * `AUDITED_ACTIONS` dans `@fl/shared` — ce que le filtre propose — et
 * `ADMIN_ACTIONS` dans `./paths.ts` — ce que le serveur écrit. La première est
 * recopiée dans la seconde pour la même raison que les collections : `@fl/firebase`
 * embarque le SDK client, hors de question dans une Cloud Function. La
 * contrepartie est identique — **une table recopiée diverge en silence** — et
 * c'est ce que ce fichier mesure, comme `paths.test.ts` le fait pour les
 * collections.
 *
 * ## Les deux sens, et la moitié qui compte vraiment
 *
 * L'égalité dans les deux sens est la partie facile. La partie qui aurait
 * attrapé le défaut est la seconde : **chaque clé de la table doit être
 * réellement utilisée** par un fichier autre que celui qui la déclare. Sans
 * elle, l'égalité serait satisfaite par une table dont personne ne se sert —
 * une valeur déclarée dans `paths.ts` s'y trouve toujours elle-même, donc un
 * simple balayage de la table se validerait tout seul.
 *
 * ## Ce que ce test ne voit pas, et qu'il faut savoir
 *
 * Il vérifie qu'une clé est **citée**, pas qu'elle est atteinte : un écrivain
 * qui nommerait l'action par une chaîne en clair (`action: 'user.approve'`)
 * passerait le contrôle des clés tout en contournant la table. Chercher la
 * chaîne en clair attraperait aussi les commentaires qui la mentionnent, ce qui
 * rendrait le test faux dès qu'on documenterait une action — un contrôle
 * fragile vaut moins que pas de contrôle. La convention est de passer par la
 * table, et le type `AuditedAction` garantit qu'une action écrite existe au
 * vocabulaire ; c'est l'usage de la table qui reste tenu par la revue.
 *
 * Ce test est pur : ni émulateur, ni Java.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUDITED_ACTIONS } from '@fl/shared';

import { ADMIN_ACTIONS } from './paths.js';

/** Fichier qui sert de repère pour reconnaître la racine du dépôt. */
const MARQUEUR = ['functions', 'src', 'lib', 'paths.ts'];

/** Le fichier de la table, relativement à `functions/src`. */
const FICHIER_TABLE = ['lib', 'paths.ts'];

/**
 * Remonte l'arborescence jusqu'à la racine du dépôt.
 *
 * On ne peut pas se fier au répertoire courant : `npm run test -w @fl/functions`
 * s'exécute depuis le paquet, alors qu'un lancement depuis la racine s'exécute
 * depuis la racine. Même logique que `findRepoRoot` dans `paths.test.ts` — la
 * duplication est assumée, et pour la même raison : `@fl/testing` est le harnais
 * des émulateurs, l'importer ici traînerait `@firebase/rules-unit-testing` dans
 * les tests des fonctions.
 */
function findRepoRoot(startDirectory: string = process.cwd()): string {
  let directory = resolve(startDirectory);

  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(directory, ...MARQUEUR))) return directory;

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  throw new Error(
    `Racine du dépôt introuvable depuis « ${startDirectory} » : aucun ` +
      `${MARQUEUR.join('/')} dans les répertoires parents.`,
  );
}

const RACINE_FONCTIONS = join(findRepoRoot(), 'functions', 'src');
const FICHIER_DE_LA_TABLE = join(RACINE_FONCTIONS, ...FICHIER_TABLE);

/** Tous les fichiers `.ts` d'un dossier, récursivement. */
function fichiersSource(dossier: string): string[] {
  const trouves: string[] = [];

  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, entree.name);

    if (entree.isDirectory()) {
      trouves.push(...fichiersSource(chemin));
    } else if (entree.name.endsWith('.ts') && !entree.name.endsWith('.test.ts')) {
      trouves.push(chemin);
    }
  }

  return trouves;
}

/**
 * Sources susceptibles d'employer la table : tout `functions/src`, sauf le
 * fichier qui la déclare et sauf les tests. Un test qui cite une action ne
 * prouve pas qu'un écrivain l'écrit — `send-notification.test.ts` cite
 * `notificationSend` précisément pour vérifier que la fonction le fait.
 */
const sources = fichiersSource(RACINE_FONCTIONS).filter((chemin) => chemin !== FICHIER_DE_LA_TABLE);

const corpus = sources.map((chemin) => readFileSync(chemin, 'utf8')).join('\n');

describe('actions auditées et écrivains', () => {
  it('la table serveur n’est pas vide', () => {
    // Sans cette assertion, une table vidée rendrait les égalités ci-dessous
    // vertes en comparant deux listes vides.
    expect(Object.keys(ADMIN_ACTIONS).length).toBeGreaterThan(0);
  });

  it('la table serveur et la liste partagée portent exactement les mêmes actions', () => {
    // Les deux sens : une action proposée par le filtre mais qu'aucun écrivain
    // ne connaît, et une action écrite par le serveur mais absente du filtre.
    expect(Object.values(ADMIN_ACTIONS).sort()).toEqual([...AUDITED_ACTIONS].sort());
  });

  it('le balayage trouve bien les écrivains, et pas seulement un dossier vide', () => {
    // Un chemin déplacé ferait passer le test suivant sur un corpus vide : il
    // ne trouverait aucune clé, mais ne trouverait aucun manque non plus. Les
    // deux fichiers qui écrivent réellement dans `adminLogs` servent de témoins.
    expect(sources).toContain(join(RACINE_FONCTIONS, 'callable', 'admin-users.ts'));
    expect(sources).toContain(join(RACINE_FONCTIONS, 'callable', 'send-notification.ts'));
    expect(corpus.length).toBeGreaterThan(0);
  });

  it('chaque clé de la table est employée par un fichier autre que celui qui la déclare', () => {
    for (const cle of Object.keys(ADMIN_ACTIONS)) {
      // Un échec ici veut dire l'une de deux choses, et il faut trancher :
      // la clé est morte — le cas de `userExportData` et `settingsUpdate` — ou
      // l'écrivain nomme l'action sans passer par la table.
      expect(corpus).toContain(`ADMIN_ACTIONS.${cle}`);
    }
  });
});
