/**
 * Utilitaires communs aux scripts d'administration.
 *
 * Ces scripts écrivent dans une base Firebase réelle avec les droits de
 * l'Admin SDK — c'est-à-dire sans aucune règle de sécurité pour les arrêter.
 * Trois garde-fous sont donc appliqués systématiquement :
 *
 *  1. **La cible est annoncée avant toute écriture.** L'identifiant de projet
 *     est affiché, et le script s'arrête si l'on vise un projet dont le nom
 *     contient « prod » sans l'avoir demandé explicitement.
 *  2. **Les identifiants doivent être explicites.** En dehors des émulateurs,
 *     `GOOGLE_APPLICATION_CREDENTIALS` doit pointer vers un fichier de compte
 *     de service. Cela évite d'écrire par accident dans le projet auquel un
 *     `gcloud auth` oublié donnait accès.
 *  3. **Les scripts sont idempotents.** Les relancer ne duplique rien : c'est
 *     ce qui permet de les exécuter sans réfléchir après un changement de
 *     configuration.
 */
import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createInterface } from 'node:readline/promises';

/** Projet utilisé par défaut : celui de développement. */
export const DEFAULT_PROJECT_ID = 'freres-lumieres-dev';

/** Organisation créée par défaut. */
export const DEFAULT_ORG_ID = 'fcpe-montmagny';

// ---------------------------------------------------------------------------
// Sortie console
// ---------------------------------------------------------------------------

export const log = {
  step: (message) => console.log(`\n▸ ${message}`),
  ok: (message) => console.log(`  ✓ ${message}`),
  info: (message) => console.log(`  · ${message}`),
  skip: (message) => console.log(`  – ${message}`),
  warn: (message) => console.warn(`  ! ${message}`),
  fail: (message) => console.error(`  ✗ ${message}`),
};

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

/**
 * Analyse `--cle valeur` et `--drapeau`.
 *
 * Volontairement minimal : les scripts n'ont pas besoin d'une bibliothèque
 * d'analyse d'arguments, et une dépendance supplémentaire pour trente lignes
 * serait un mauvais échange.
 */
export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;

    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];

    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }

  return args;
}

// ---------------------------------------------------------------------------
// Cible et identifiants
// ---------------------------------------------------------------------------

/** Les émulateurs locaux sont-ils la cible ? */
export function usingEmulators() {
  return Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);
}

/**
 * Détermine le projet cible et refuse les cibles dangereuses par mégarde.
 *
 * Un script d'amorçage lancé sur le projet de production par erreur créerait
 * un administrateur que personne n'attend — et l'annuler demanderait de
 * comprendre ce qui s'est passé. Mieux vaut un refus explicite.
 */
export function resolveProjectId(args) {
  const projectId = typeof args.project === 'string' ? args.project : DEFAULT_PROJECT_ID;
  const looksLikeProduction = /prod/i.test(projectId);

  if (looksLikeProduction && args['confirm-production'] !== true) {
    throw new Error(
      `Le projet « ${projectId} » ressemble à un environnement de production.\n` +
        '  Relancez avec --confirm-production si c’est bien l’intention.',
    );
  }

  return projectId;
}

/** Initialise l'Admin SDK une seule fois, avec une cible explicite. */
export function initAdmin(projectId) {
  const existing = getApps()[0];
  if (existing) return existing;

  if (usingEmulators()) {
    // Les émulateurs n'appliquent aucune authentification : un identifiant de
    // projet quelconque suffit, et aucun fichier de compte de service n'est lu.
    return initializeApp({ projectId: projectId ?? 'demo-fl-local' });
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS n’est pas défini.\n' +
        '  Pointez-le vers un fichier de compte de service (Console Firebase >\n' +
        '  Paramètres du projet > Comptes de service), ou lancez les émulateurs\n' +
        '  (FIRESTORE_EMULATOR_HOST) pour travailler en local.',
    );
  }

  return initializeApp({
    credential: applicationDefault(),
    ...(projectId ? { projectId } : {}),
  });
}

/** Accès directs aux services, après initialisation. */
export const db = () => getFirestore();
export const auth = () => getAuth();

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

/** Demande une confirmation explicite avant une écriture. */
export async function confirm(question) {
  if (!process.stdin.isTTY) {
    // Sans terminal interactif (CI, redirection), on n'invente pas de réponse.
    throw new Error(
      'Confirmation impossible : aucune entrée interactive disponible.\n' +
        '  Ajoutez --yes pour confirmer explicitement dans un contexte automatisé.',
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`\n${question} [o/N] `);
    return /^(o|oui|y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/** Affiche la cible et demande confirmation, sauf si `--yes` a été fourni. */
export async function confirmTarget({ projectId, description, args }) {
  const mode = usingEmulators() ? 'émulateurs locaux' : 'projet Firebase distant';

  console.log('\n' + '─'.repeat(70));
  console.log(`  Cible   : ${projectId}  (${mode})`);
  console.log(`  Action  : ${description}`);
  console.log('─'.repeat(70));

  if (args.yes === true) {
    log.info('Confirmation implicite (--yes).');
    return;
  }

  const accepted = await confirm('Confirmer ?');
  if (!accepted) {
    throw new Error('Opération annulée.');
  }
}

// ---------------------------------------------------------------------------
// Logique partagée
// ---------------------------------------------------------------------------

/**
 * Charge `@fl/shared` depuis son dossier compilé.
 *
 * L'import est dynamique pour une seule raison : produire un message utile
 * quand le projet n'a pas encore été compilé. Une erreur `MODULE_NOT_FOUND`
 * brute enverrait l'utilisateur chercher un problème de dépendances, alors
 * qu'il manque simplement une étape de build.
 *
 * Conséquence à connaître : les scripts qui l'utilisent doivent être précédés
 * de `npm run build:packages`. C'est un prix assumé — `getAcademicYear` vit
 * dans `@fl/shared`, et deux copies de ce calcul (une dans les scripts, une
 * dans l'application) divergeraient en août, silencieusement, sur les données
 * réelles des familles.
 */
export async function loadShared() {
  try {
    return await import('@fl/shared');
  } catch {
    throw new Error(
      'Le paquet @fl/shared n’est pas compilé.\n' + '  Exécutez d’abord : npm run build:packages',
    );
  }
}

// ---------------------------------------------------------------------------
// Divers
// ---------------------------------------------------------------------------

/** Exécute un script en traduisant toute erreur en message lisible. */
export async function run(main) {
  try {
    await main();
    console.log('');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.fail(message);
    process.exitCode = 1;
  }
}
