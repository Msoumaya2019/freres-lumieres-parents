/**
 * Configuration des tests sur émulateur.
 *
 * ## Pourquoi ce fichier existe
 *
 * Le `beforeAll` de chaque fichier de tests installe le fichier de règles dans
 * l'émulateur : il le lit sur le disque et le transmet, ce qui demande à la
 * JVM de l'émulateur de **compiler** l'ensemble des règles. Trois fichiers de
 * tests s'exécutent en parallèle, donc trois compilations simultanées.
 *
 * Le délai par défaut de Vitest pour un hook est de **10 secondes**. Il suffit
 * sur une JVM déjà chaude, et pas au premier lancement ou lorsque les trois
 * compilations se disputent le processeur. Le symptôme est trompeur :
 * `beforeAll` expire, `testEnv` reste indéfini, et l'erreur qui remonte est
 * celle de `afterAll` — un message qui ne dit rien de la cause. C'est ce qui a
 * rendu ce défaut difficile à diagnostiquer, et c'est aussi ce qui a fait
 * passer une instabilité de l'environnement pour un échec des règles.
 *
 * Le délai est donc porté à 60 secondes. Ce n'est pas masquer un défaut : un
 * émulateur Java qui compile trois jeux de règles en parallèle prend
 * légitimement plus de dix secondes, et aucun test ne dure aussi longtemps une
 * fois les règles installées.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    hookTimeout: 60_000,
  },
});
