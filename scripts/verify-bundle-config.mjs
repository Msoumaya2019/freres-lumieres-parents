#!/usr/bin/env node
/**
 * Vérifie qu'un bundle livré contient la configuration Firebase attendue.
 *
 * ## Pourquoi ce contrôle existe
 *
 * Metro remplace `process.env.EXPO_PUBLIC_*` par sa valeur pendant la phase
 * « Bundle React Native code and images », **à l'intérieur de `xcodebuild`**.
 * Les déclarer seulement sur l'étape `expo prebuild` ne sert donc à rien : le
 * binaire se compile, s'installe, s'ouvre, et n'affiche **aucune donnée**. Le
 * défaut ne se voit qu'après installation, sur un téléphone — c'est-à-dire
 * après la livraison.
 *
 * Le contrôle tourne donc **après empaquetage**, sur le bundle réellement
 * embarqué, et il est le seul endroit où cette erreur se voit avant l'iPhone.
 *
 * ## Deux encodages, parce qu'un bundle Hermes n'en utilise pas qu'un
 *
 * Dans une table de chaînes Hermes, une chaîne purement ASCII est rangée en
 * ASCII, mais une chaîne contenant **un seul caractère hors ASCII** est rangée
 * en **UTF-16LE**. Une recherche en UTF-8 dans une application française
 * conclut donc à tort à l'absence — et l'absence, ici, est précisément ce qu'on
 * refuse.
 *
 * ## Un témoin, parce qu'une absence ne prouve rien
 *
 * Une recherche qui ne trouve rien ne dit pas si la valeur manque ou si la
 * lecture est cassée. Le témoin est une chaîne ASCII dont la présence est
 * certaine : s'il manque aussi, c'est le **contrôle** qui est en cause, et le
 * rapport doit le dire au lieu d'accuser le paquet.
 *
 * ## Ce que le script n'écrit jamais
 *
 * La valeur trouvée. Le journal d'un dépôt public ne doit pas devenir la fuite
 * — même pour des valeurs qui ne sont pas des secrets. Préfixe et longueur
 * suffisent à reconnaître une valeur.
 *
 * Usage : `node scripts/verify-bundle-config.mjs <bundle>`
 * Les valeurs attendues sont lues dans l'environnement.
 */

import { readFileSync, statSync } from 'node:fs';

/**
 * Valeurs que l'application exige pour fonctionner.
 *
 * Les six premières sont celles de `validateFirebaseConfig` dans
 * `@fl/firebase` : les oublier ici rendrait le contrôle complaisant, les
 * ajouter sans les y ajouter le rendrait faux. Le slug d'organisation n'est pas
 * une valeur de sécurité — un slug erroné ne donne aucun droit — mais il est
 * nécessaire à l'inscription, donc à une application complète.
 */
const REQUIRED_VARIABLES = [
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
  'EXPO_PUBLIC_DEFAULT_ORG_SLUG',
];

/**
 * Témoin ASCII, présent dans tout bundle de cette application.
 *
 * C'est la constante `PREFIX` de `apps/mobile/src/lib/env.ts`, employée pour
 * composer les messages de configuration manquante. Elle est en clair dans le
 * bundle et ne peut pas disparaître par minification : elle est passée à une
 * fonction.
 */
const CONTROL_WITNESS = 'EXPO_PUBLIC_';

/** En dessous de cette taille, ce n'est pas un bundle. */
const MIN_BUNDLE_BYTES = 100_000;

/** L'encodage dans lequel la chaîne a été trouvée, ou `null`. */
function findEncoding(bytes, value) {
  if (bytes.includes(Buffer.from(value, 'utf8'))) return 'utf-8';

  // « utf16le », et non « utf-16le » : Node refuse l'étiquette avec un tiret
  // par `ERR_UNKNOWN_ENCODING`. Le défaut ne se voit que sur une valeur non
  // ASCII — c'est-à-dire précisément le cas que cette branche existe pour
  // couvrir, et jamais celui qu'on essaie en premier.
  if (bytes.includes(Buffer.from(value, 'utf16le'))) return 'utf-16';

  return null;
}

/** Préfixe et longueur : de quoi reconnaître une valeur sans la publier. */
function describe(value) {
  return `${value.slice(0, 6)}… (${value.length} caractères)`;
}

function main() {
  const [, , bundlePath] = process.argv;

  if (!bundlePath) {
    console.error('usage : node scripts/verify-bundle-config.mjs <bundle>');
    return 2;
  }

  let bytes;

  try {
    if (!statSync(bundlePath).isFile()) {
      console.error(`::error::${bundlePath} n'est pas un fichier.`);
      return 1;
    }

    bytes = readFileSync(bundlePath);
  } catch (error) {
    console.error(`::error::bundle illisible (${bundlePath}) : ${error.message}`);
    return 1;
  }

  console.log(`bundle : ${bundlePath} (${bytes.length} octets)`);

  // Le contrôle négatif du contrôle : un fichier vide, un chemin faux ou une
  // extraction ratée rendraient un rapport entièrement négatif, c'est-à-dire
  // vert. Le témoin est vérifié **en premier**, pour que le verdict porte sur
  // la lecture avant de porter sur le paquet.
  if (bytes.length < MIN_BUNDLE_BYTES) {
    console.error(`::error::${bytes.length} octets : trop petit pour un bundle.`);
    return 1;
  }

  if (findEncoding(bytes, CONTROL_WITNESS) === null) {
    console.error(
      `::error::le témoin « ${CONTROL_WITNESS} » est absent des deux encodages : ` +
        "c'est la lecture du bundle qui est en cause, pas la configuration.",
    );
    return 1;
  }

  const missing = [];

  for (const name of REQUIRED_VARIABLES) {
    const value = process.env[name];

    // Une recherche de chaîne vide réussit toujours : sans ce refus, le
    // contrôle serait vert sans avoir rien comparé.
    if (typeof value !== 'string' || value.length === 0) {
      console.error(`::error::${name} n'est pas défini : le contrôle ne peut rien comparer.`);
      return 1;
    }

    const encoding = findEncoding(bytes, value);

    if (encoding === null) {
      missing.push(name);
      console.error(`  ABSENT   ${name.padEnd(42)} ${describe(value)}`);
    } else {
      console.log(`  ${encoding.padEnd(8)} ${name.padEnd(42)} ${describe(value)}`);
    }
  }

  if (missing.length > 0) {
    console.error('');
    console.error(
      `::error::${missing.length} valeur(s) absente(s) du bundle : ${missing.join(', ')}.`,
    );
    console.error(
      'Le binaire se compilerait et ne montrerait aucune donnée. ' +
        'Vérifier que les variables sont déclarées au niveau du **job**, ' +
        'et non de l’étape `expo prebuild`.',
    );
    return 1;
  }

  console.log('');
  console.log(
    `${REQUIRED_VARIABLES.length} valeurs sur ${REQUIRED_VARIABLES.length} dans le bundle.`,
  );
  return 0;
}

process.exitCode = main();
