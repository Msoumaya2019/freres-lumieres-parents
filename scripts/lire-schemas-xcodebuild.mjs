#!/usr/bin/env node
/**
 * Lit la liste des schémas dans la sortie de `xcodebuild -list -json`.
 *
 * ## Pourquoi ce script existe
 *
 * `xcodebuild -list -json` n'écrit pas toujours du JSON pur sur sa sortie
 * standard : des avertissements et des lignes de contexte l'entourent, selon la
 * version d'Xcode et l'état du projet. Un `JSON.parse` direct échouerait, et
 * l'échec serait attribué à tort au projet.
 *
 * Le script cherche donc le premier `{` et le dernier `}`, et n'analyse que ce
 * qui est entre les deux.
 *
 * ## Pourquoi il ne sort jamais en erreur
 *
 * Il sert à **confirmer** un nom de schéma, pas à le choisir : le nom se déduit
 * du projet (`<Nom>.xcodeproj`), et `xcodebuild` reste seul juge. Un contrôle de
 * confort qui interrompt un build valide coûte plus cher que le défaut qu'il
 * surveille. Sur une entrée illisible, il n'imprime rien et le dit sur la sortie
 * d'erreur — l'appelant, lui, avertit au lieu d'échouer.
 *
 * Usage : `xcodebuild … -list -json | node scripts/lire-schemas-xcodebuild.mjs`
 */

let entree = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (morceau) => {
  entree += morceau;
});

process.stdin.on('end', () => {
  const debut = entree.indexOf('{');
  const fin = entree.lastIndexOf('}');

  if (debut < 0 || fin <= debut) {
    process.stderr.write('lire-schemas-xcodebuild : aucun objet JSON dans l’entrée.\n');
    return;
  }

  let document;

  try {
    document = JSON.parse(entree.slice(debut, fin + 1));
  } catch (erreur) {
    process.stderr.write(`lire-schemas-xcodebuild : JSON illisible — ${erreur.message}\n`);
    return;
  }

  const bloc = document.workspace ?? document.project ?? {};
  const schemas = Array.isArray(bloc.schemes) ? bloc.schemes : [];

  for (const schema of schemas) process.stdout.write(`${schema}\n`);
});
