/**
 * Configuration des tests de l'application mobile.
 *
 * ## Pourquoi ce fichier existe
 *
 * Les fichiers de `app/` importent par l'alias `@/…`, déclaré dans les `paths`
 * de `tsconfig.json`. Deux lecteurs le comprennent déjà — `tsc` pour les types,
 * et Metro par l'intermédiaire du `tsconfig` d'Expo pour le paquet livré.
 * Vitest, lui, ne lit pas ce fichier : sans alias, un test qui importe un
 * module de `app/` échoue à la résolution.
 *
 * Le déclarer ici n'est pas une commodité. C'est ce qui permet d'éprouver le
 * **branchement réel** — `app/+native-intent.ts` importé pour de vrai — plutôt
 * qu'une copie de sa règle. Un contrôle qui n'appellerait que la fonction
 * laisserait le branchement disparaître en silence, et le lien forgé
 * recommencerait à figer l'application sans qu'aucun test ne rougisse.
 *
 * ## L'alias est écrit deux fois, et c'est mesuré
 *
 * `tsconfig.json` le déclare pour les types, ce fichier pour les tests. Deux
 * listes recopiées divergent en silence — sauf ici : si l'une des deux change,
 * l'import de `+native-intent.ts` cesse d'être résolu et la suite **échoue**.
 * Le défaut est donc bruyant, ce qui est la seule condition pour que la
 * duplication reste acceptable.
 */
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
