#!/usr/bin/env node
/**
 * Contrôle statique des flux de travail GitHub Actions.
 *
 * ## Pourquoi ce contrôle existe
 *
 * Un flux de travail se teste normalement en le poussant — c'est-à-dire au pire
 * moment. Sur ce dépôt, `ios-unsigned.yml` réserve un exécuteur macOS pendant
 * une quinzaine de minutes : une faute de frappe dans un script `run:` ne se
 * paie pas en secondes, mais en un aller-retour complet, après l'installation
 * de Node et des dépendances.
 *
 * Deux familles de défauts, très inégales en coût :
 *
 * | Défaut                  | Ce qui se passe                    | Coût              |
 * | ----------------------- | ---------------------------------- | ----------------- |
 * | YAML mal formé          | Le flux ne démarre pas.            | Immédiat, bruyant |
 * | Script `run:` invalide  | Le flux échoue après l'installation | 15 min, silencieux |
 *
 * C'est la seconde qui justifie ce fichier, et elle ne se voit qu'en lisant le
 * script ligne à ligne — ce qu'un humain rate, et que `bash -n` attrape en deux
 * secondes.
 *
 * ## Portée : ce que ce contrôle voit, et ce qu'il ne voit pas
 *
 * `bash -n` **analyse sans évaluer** les expansions. Il attrape un `then`
 * manquant, un `fi` orphelin, une quote non fermée. Il **ne voit pas** une
 * expansion fautive : `${CHEMIN}` mal orthographié, `${!NOM}` sur une variable
 * absente, un `cd` vers un dossier inexistant. Ces fautes-là ne sont signalées
 * ni ici, ni par `tsc`, ni par ESLint — elles ne se voient qu'à l'exécution.
 *
 * Il ne vérifie pas non plus la *version* d'une action épinglée : le moteur
 * d'exécution est déclaré dans le manifeste de l'action, pas dans le fichier de
 * flux, et une version périmée ne casse que le jour où le flux tourne vraiment.
 *
 * Enfin, un `run:` multiligne s'exécute sous `bash -e` : la première commande en
 * échec termine le script, et les suivantes ne tournent jamais. Deux contrôles
 * enchaînés doivent donc s'écrire `cmd || code=1` puis `exit "$code"`. Ce
 * contrôle-ci ne peut pas le deviner — c'est un défaut d'exécution, pas de
 * syntaxe.
 *
 * ## La liste des flux est fermée, dans les deux sens
 *
 * Ce contrôle découvre ses sujets par `readdir`, et rien d'autre dans la chaîne
 * ne lit `.github/workflows` : un flux supprimé ne produirait aucun signal, et
 * le rapport resterait vert. C'est le seul défaut de ce fichier dont l'absence
 * d'un sujet donne un **vert trompeur**. La liste est donc nommée, et un fichier
 * ajouté mais non déclaré échoue lui aussi — sans quoi une garde qui refuserait
 * tout passerait pour concluante.
 *
 * Usage : `node scripts/check-workflows.mjs`
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

/** Dossier lu, relatif à la racine du dépôt. */
const DOSSIER = '.github/workflows';

/**
 * Liste **fermée** des flux attendus.
 *
 * Ajouter un flux impose de le déclarer ici : c'est le prix, et il est utile —
 * il force à se demander si le nouveau flux doit tourner dans les trois chaînes
 * ou seulement dans une.
 */
const FLUX_ATTENDUS = ['ci.yml', 'codeql.yml', 'ios-unsigned.yml', 'mobile-build.yml'];

/** Préfixes de chemins locaux cités par un script, à vérifier sur le disque. */
const RACINES_DE_CHEMIN = ['scripts/', '.github/'];

const defauts = [];
let verifications = 0;

/** Enregistre un défaut. Le marqueur ASCII est ce sur quoi un banc s'accroche. */
function defaut(marqueur, fichier, etape, message) {
  const emplacement = etape ? `${fichier} › ${etape}` : fichier;
  defauts.push(`${marqueur} ${emplacement} — ${message}`);
}

/**
 * Remplace les expressions GitHub par une valeur inerte.
 *
 * Ce n'est **pas** pour éviter un faux positif de `bash -n` : mesuré, `bash -n`
 * tolère `${{ … }}`. C'est une question de **fidélité** — GitHub substitue ces
 * expressions avant de confier le script au shell, donc analyser le texte
 * substitué, c'est analyser ce que le shell verra réellement.
 */
function neutraliser(script) {
  return script.replace(/\$\{\{[^}]*\}\}/g, 'VALEUR');
}

/** Retire les commentaires shell, pour ne pas confondre une prose et un chemin. */
function sansCommentaires(script) {
  return script
    .split('\n')
    .filter((ligne) => !/^\s*#/.test(ligne))
    .join('\n');
}

/** Une action est épinglée si elle porte un SHA de commit de 40 caractères. */
function estEpinglee(uses) {
  if (uses.startsWith('./') || uses.startsWith('docker://')) return true;
  return /^[^@\s]+@[0-9a-f]{40}$/.test(uses);
}

/** Tous les chemins locaux cités par un script. */
function cheminsCites(script) {
  const trouves = new Set();

  for (const racine of RACINES_DE_CHEMIN) {
    const motif = new RegExp(`(?:^|[\\s"'(])(${racine}[A-Za-z0-9._/-]+)`, 'g');

    for (const correspondance of script.matchAll(motif)) {
      trouves.add(correspondance[1].replace(/[.,;:]+$/, ''));
    }
  }

  return [...trouves];
}

/** Les noms d'entrées déclarées par `workflow_dispatch` et `workflow_call`. */
function entreesDeclarees(declencheur) {
  if (typeof declencheur !== 'object' || declencheur === null) return new Set();

  const noms = new Set();

  for (const evenement of ['workflow_dispatch', 'workflow_call']) {
    const bloc = declencheur[evenement];

    if (typeof bloc !== 'object' || bloc === null) continue;

    for (const nom of Object.keys(bloc.inputs ?? {})) noms.add(nom);
  }

  return noms;
}

/**
 * Vérifie les expressions `steps.X.outputs.Y` et `inputs.X` d'une étape.
 *
 * Le contrôle porte sur **l'étape entière**, et non sur son seul `run:` : une
 * sortie se lit aussi bien dans un `with:` que dans un script. Ne regarder que
 * les scripts laissait passer `retention-days: ${{ inputs.retention }}` — un
 * défaut trouvé par le banc de falsification, pas par la relecture.
 *
 * `steps.X.outputs.Y` ne peut viser qu'une étape **déjà passée** : une référence
 * à une étape définie plus bas vaut la chaîne vide à l'exécution, sans erreur —
 * donc un binaire construit sans sa configuration.
 *
 * Et si l'étape précède bien, elle doit **écrire** cette sortie : un nom mal
 * orthographié vaut la chaîne vide de la même façon. Le contrôle lit donc les
 * `echo "nom=valeur" >> "$GITHUB_OUTPUT"` du producteur, et se tait lorsque
 * aucun nom n'a pu être lu — repli fermé, pour ne pas accuser une étape qui
 * écrit ses sorties autrement.
 *
 * Renvoie le nombre de références examinées, pour que le rapport puisse dire
 * combien de choses il a regardées.
 */
function verifierReferences(etape, contexte) {
  const serialise = JSON.stringify(etape);
  let compte = 0;

  for (const [, id, sortie] of serialise.matchAll(
    /\$\{\{\s*steps\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_-]+)\s*\}\}/g,
  )) {
    compte += 1;

    const dejaVue = contexte.identifiantsVus.has(id);

    // Aucune étape ne porte cet identifiant : la sortie vaudra la chaîne vide.
    if (!dejaVue && !contexte.identifiantsTous.has(id)) {
      defaut(
        '[sortie-inconnue]',
        contexte.fichier,
        contexte.emplacement,
        `\`steps.${id}.outputs.${sortie}\` : aucune étape ne porte l'identifiant « ${id} ».`,
      );
      continue;
    }

    // L'étape existe, mais elle est **définie plus bas** : à l'exécution, sa
    // sortie vaut encore la chaîne vide.
    if (!dejaVue) {
      defaut(
        '[sortie-avant-producteur]',
        contexte.fichier,
        contexte.emplacement,
        `\`steps.${id}.outputs.${sortie}\` est lue avant l'étape qui la produit.`,
      );
      continue;
    }

    // L'étape existe et précède : reste à savoir si elle **écrit** cette sortie.
    // Un nom mal orthographié vaut la chaîne vide, sans erreur — c'est le même
    // défaut, une étape plus loin.
    const producteur = contexte.parIdentifiant.get(id);

    if (typeof producteur?.run === 'string') {
      // Sorties qu'une étape `run:` déclare : `echo "nom=valeur"` ou
      // `printf 'nom=valeur'`, redirigés vers `$GITHUB_OUTPUT`.
      const declarees = new Set(
        [...producteur.run.matchAll(/(?:echo|printf)[^\n]*["']([A-Za-z0-9_-]+)=/g)].map(
          (m) => m[1],
        ),
      );

      // Repli **fermé** : si rien n'a pu être lu, on ne juge pas. Une étape qui
      // écrit ses sorties autrement n'est pas accusée à tort, et le build reste
      // seul juge.
      if (declarees.size > 0 && !declarees.has(sortie)) {
        defaut(
          '[sortie-non-declaree]',
          contexte.fichier,
          contexte.emplacement,
          `\`steps.${id}.outputs.${sortie}\` : l'étape « ${id} » n'écrit que ${[...declarees].join(', ')}.`,
        );
      }
    }
  }

  for (const [, entree] of serialise.matchAll(/\$\{\{\s*inputs\.([A-Za-z0-9_-]+)\s*\}\}/g)) {
    compte += 1;

    if (!contexte.entrees.has(entree)) {
      defaut(
        '[entree-inconnue]',
        contexte.fichier,
        contexte.emplacement,
        `\`inputs.${entree}\` n'est déclarée par aucun déclencheur.`,
      );
    }
  }

  return compte;
}

/** Analyse un flux de travail. `contexte` porte ce qui n'est pas dans le YAML. */
function analyser(fichier, source, contexte) {
  let document;

  try {
    document = parse(source);
  } catch (erreur) {
    defaut('[yaml-invalide]', fichier, null, `le YAML ne s'analyse pas : ${erreur.message}`);
    return;
  }

  verifications += 1;

  if (typeof document !== 'object' || document === null) {
    defaut('[yaml-invalide]', fichier, null, 'le document ne contient pas de correspondance.');
    return;
  }

  // `on:` lu comme le booléen `true` est un défaut de schéma YAML 1.1. Lue avec
  // le schéma 1.2 de `yaml`, la clé ressort en chaîne — le contrôle porte donc
  // sur le type, sans supposer l'analyseur.
  const declencheur = document.on;

  if (declencheur === undefined) {
    defaut(
      '[declencheur-absent]',
      fichier,
      null,
      'aucune clé `on:` : le flux ne se déclenchera jamais.',
    );
  } else if (typeof declencheur !== 'string' && typeof declencheur !== 'object') {
    defaut('[declencheur-invalide]', fichier, null, `\`on:\` vaut ${JSON.stringify(declencheur)}.`);
  } else if (declencheur === null) {
    defaut('[declencheur-invalide]', fichier, null, '`on:` est vide.');
  }

  verifications += 1;

  const entrees = entreesDeclarees(declencheur);
  const travaux = document.jobs;

  if (typeof travaux !== 'object' || travaux === null) {
    defaut('[travaux-absents]', fichier, null, 'aucun travail déclaré.');
    return;
  }

  const permissionsGlobales = document.permissions;

  for (const [nomTravail, travail] of Object.entries(travaux)) {
    if (typeof travail !== 'object' || travail === null) {
      defaut('[travail-invalide]', fichier, nomTravail, 'le travail n’est pas une correspondance.');
      continue;
    }

    // `runs-on` peut être une expression, mais il doit être là : sans lui, GitHub
    // refuse le flux, et le message ne nomme pas toujours le travail fautif.
    if (travail['runs-on'] === undefined) {
      defaut('[runs-on-absent]', fichier, nomTravail, 'aucune clé `runs-on:`.');
    }

    verifications += 1;

    // Sans `permissions`, le jeton reçoit des droits plus larges que nécessaire.
    if (permissionsGlobales === undefined && travail.permissions === undefined) {
      defaut(
        '[permissions-absentes]',
        fichier,
        nomTravail,
        'ni `permissions:` global, ni `permissions:` de travail.',
      );
    }

    verifications += 1;

    const etapes = travail.steps;

    if (!Array.isArray(etapes) || etapes.length === 0) {
      defaut('[etapes-absentes]', fichier, nomTravail, 'aucune étape.');
      continue;
    }

    const identifiantsVus = new Set();
    const identifiantsTous = new Set(
      etapes.map((e) => e?.id).filter((id) => typeof id === 'string'),
    );
    // Les étapes par identifiant, pour pouvoir lire ce que le producteur d'une
    // sortie écrit réellement.
    const parIdentifiant = new Map(
      etapes.filter((e) => typeof e?.id === 'string').map((e) => [e.id, e]),
    );

    for (const [index, etape] of etapes.entries()) {
      const nom = etape?.name ?? `étape ${index + 1}`;

      if (typeof etape !== 'object' || etape === null) {
        defaut(
          '[etape-invalide]',
          fichier,
          `${nomTravail} › ${nom}`,
          'l’étape n’est pas une correspondance.',
        );
        continue;
      }

      const aUses = typeof etape.uses === 'string';
      const aRun = typeof etape.run === 'string';

      // Une étape qui ne fait rien est presque toujours un `run:` renommé en
      // `with:` par erreur — et elle passe inaperçue, puisqu'elle réussit.
      if (!aUses && !aRun) {
        defaut('[etape-vide]', fichier, `${nomTravail} › ${nom}`, 'ni `uses:` ni `run:`.');
      }

      if (aUses && aRun) {
        defaut('[etape-ambigue]', fichier, `${nomTravail} › ${nom}`, '`uses:` et `run:` ensemble.');
      }

      verifications += 1;

      if (aUses && !estEpinglee(etape.uses)) {
        defaut(
          '[action-non-epinglee]',
          fichier,
          `${nomTravail} › ${nom}`,
          `\`${etape.uses}\` n'est pas épinglée à un SHA de commit.`,
        );
      }

      if (aUses) verifications += 1;

      // Le dossier de travail est relatif à la racine du dépôt. Un dossier absent
      // fait échouer l'étape en une seconde, mais seulement sur l'exécuteur.
      if (typeof etape['working-directory'] === 'string') {
        const dossier = etape['working-directory'];

        if (!existsSync(join(contexte.racine, dossier))) {
          defaut(
            '[chemin-inexistant]',
            fichier,
            `${nomTravail} › ${nom}`,
            `\`working-directory: ${dossier}\` n'existe pas.`,
          );
        }

        verifications += 1;
      }

      // Avant le script, et pour **toutes** les étapes : une étape qui n'a qu'un
      // `uses:` peut elle aussi lire la sortie d'une autre.
      verifications += verifierReferences(etape, {
        fichier,
        emplacement: `${nomTravail} › ${nom}`,
        identifiantsVus,
        identifiantsTous,
        parIdentifiant,
        entrees,
      });

      if (!aRun) {
        if (typeof etape.id === 'string') identifiantsVus.add(etape.id);
        continue;
      }

      const script = etape.run;
      const analyse = neutraliser(script);

      // Le shell par défaut d'un `run:` sous Linux et macOS est `bash -e`. Une
      // étape qui déclare un autre shell est signalée plutôt qu'analysée à tort.
      if (typeof etape.shell === 'string' && !/^bash/.test(etape.shell)) {
        defaut(
          '[shell-non-analyse]',
          fichier,
          `${nomTravail} › ${nom}`,
          `shell « ${etape.shell} » : ce contrôle n'analyse que bash.`,
        );
      }

      const resultat = spawnSync('bash', ['-n'], { input: analyse, encoding: 'utf8' });

      if (resultat.error) {
        defaut(
          '[bash-absent]',
          fichier,
          `${nomTravail} › ${nom}`,
          `impossible de lancer \`bash -n\` : ${resultat.error.message}`,
        );
      } else if (resultat.status !== 0) {
        const detail = (resultat.stderr ?? '').trim().split('\n').slice(-2).join(' / ');
        defaut(
          '[script-invalide]',
          fichier,
          `${nomTravail} › ${nom}`,
          `refusé par \`bash -n\` : ${detail}`,
        );
      }

      verifications += 1;

      for (const chemin of cheminsCites(sansCommentaires(script))) {
        if (!existsSync(join(contexte.racine, chemin))) {
          defaut(
            '[chemin-inexistant]',
            fichier,
            `${nomTravail} › ${nom}`,
            `le script cite \`${chemin}\`, absent du dépôt.`,
          );
        }

        verifications += 1;
      }

      if (typeof etape.id === 'string') identifiantsVus.add(etape.id);
    }

    // `needs.X` doit nommer un travail du même fichier.
    const texteTravail = JSON.stringify(travail);

    for (const [, besoin] of texteTravail.matchAll(/needs\.([A-Za-z0-9_-]+)\./g)) {
      if (!(besoin in travaux)) {
        defaut(
          '[besoin-inconnu]',
          fichier,
          nomTravail,
          `\`needs.${besoin}\` : aucun travail de ce nom dans le fichier.`,
        );
      }

      verifications += 1;
    }
  }

  // Une variable de dépôt absente vaut la chaîne vide, sans erreur. Elle doit
  // donc être vérifiée dans un script, sinon le binaire se construit muet.
  const scripts = Object.values(travaux)
    .flatMap((t) => (Array.isArray(t?.steps) ? t.steps : []))
    .filter((e) => typeof e?.run === 'string')
    .map((e) => e.run)
    .join('\n');

  const variables = new Set();

  for (const [, nom] of source.matchAll(/\$\{\{\s*vars\.([A-Za-z0-9_-]+)\s*\}\}/g)) {
    variables.add(nom);
  }

  for (const nom of variables) {
    // La variable est utilisée dans un `env:` ; elle doit aussi apparaître dans
    // un script, c'est-à-dire dans un contrôle de présence.
    if (!scripts.includes(nom)) {
      defaut(
        '[variable-non-verifiee]',
        fichier,
        null,
        `\`vars.${nom}\` est employée sans être vérifiée dans un script : une variable non renseignée vaut la chaîne vide, sans erreur.`,
      );
    }

    verifications += 1;
  }
}

function main() {
  const racine = process.cwd();
  const dossier = join(racine, DOSSIER);

  let fichiers;

  try {
    fichiers = readdirSync(dossier)
      .filter((nom) => nom.endsWith('.yml') || nom.endsWith('.yaml'))
      .sort(); // `readdirSync` ne garantit aucun ordre : trier rend les rapports comparables.
  } catch (erreur) {
    console.error(`::error::${DOSSIER} est illisible : ${erreur.message}`);
    return 1;
  }

  for (const nom of FLUX_ATTENDUS) {
    if (!fichiers.includes(nom)) {
      defaut('[flux-absent]', nom, null, 'flux attendu absent du dossier.');
    }

    verifications += 1;
  }

  for (const nom of fichiers) {
    if (!FLUX_ATTENDUS.includes(nom)) {
      defaut('[flux-non-declare]', nom, null, 'flux présent mais non déclaré dans FLUX_ATTENDUS.');
    }

    verifications += 1;
  }

  for (const nom of fichiers) {
    analyser(nom, readFileSync(join(dossier, nom), 'utf8'), { racine });
  }

  if (defauts.length > 0) {
    console.error(`${defauts.length} défaut(s) :`);
    console.error('');

    for (const ligne of defauts) console.error(`  ${ligne}`);

    console.error('');
    console.error(`${verifications} vérifications sur ${fichiers.length} flux de travail.`);
    return 1;
  }

  console.log(
    `${verifications} vérifications sur ${fichiers.length} flux de travail — aucun défaut.`,
  );
  return 0;
}

process.exitCode = main();
