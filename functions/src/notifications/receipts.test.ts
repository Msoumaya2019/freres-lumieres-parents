/**
 * Ce que le passage des reçus doit faire, dans l'ordre où il doit le faire.
 *
 * ## Pourquoi ces vérifications lisent la source
 *
 * `readPendingReceipts` ne fait que trois choses : interroger Firestore,
 * appeler le réseau, écrire. Les éprouver par le comportement demanderait un
 * émulateur, une horloge simulée et un service Expo simulé — beaucoup de
 * machines pour vérifier quatre décisions qui tiennent en une ligne chacune.
 *
 * ## Les quatre décisions, et ce que chacune empêche
 *
 * 1. **`deliveredCount` vient des reçus, jamais des tickets.** C'est la raison
 *    d'être de tout l'incrément : le champ comptait des messages *acceptés* en
 *    s'intitulant *remis*. Écrire `ticketIds.length` à cet endroit ne casserait
 *    rien, ne lèverait rien, et rétablirait exactement le mensonge.
 * 2. **Le délai de quinze minutes est respecté.** Relire trop tôt ne rend pas
 *    des erreurs : le service omet simplement les reçus qu'il n'a pas encore, et
 *    tout serait compté `pending` — un envoi paraîtrait n'avoir rien remis alors
 *    qu'il a tout remis.
 * 3. **La mise à jour de l'historique vient en dernier.** Le déclencheur
 *    s'exécute au moins une fois. Si le document était marqué « relu » avant la
 *    purge, une reprise après incident ne relirait plus rien et laisserait des
 *    jetons morts en place, pour toujours.
 * 4. **Un refus d'authentification interrompt le passage**, et lui seul. Le
 *    jeton est refusé pour tous les envois : insister produirait vingt fois la
 *    même erreur, et le passage de l'heure suivante la reproduirait. Un échec
 *    ordinaire, au contraire, laisse le document à reprendre — le `break` ne
 *    doit donc pas l'englober.
 */
import { describe, expect, it } from 'vitest';

import { corpsDeLaFonction, lireSource } from '../test-helpers/source.js';

const CHEMIN_RECUS = ['functions', 'src', 'notifications', 'receipts.ts'];
const SOURCE = lireSource(CHEMIN_RECUS);

/** Position d'un motif dans le fichier, ou échec explicite s'il est absent. */
function position(motif: string): number {
  const index = SOURCE.indexOf(motif);

  if (index === -1) {
    throw new Error(
      `Motif « ${motif} » introuvable dans ${CHEMIN_RECUS.join('/')}. ` +
        'Le format a changé : adapter ce test plutôt que le neutraliser.',
    );
  }

  return index;
}

describe('readPendingReceipts', () => {
  it('n’examine que les envois dont les reçus sont mûrs', () => {
    const corps = corpsDeLaFonction(SOURCE, 'readPendingReceipts', CHEMIN_RECUS);

    // `sentAt <= maintenant - 15 min`. Retirer l'échéance ferait relire des
    // envois de la seconde précédente, et tout serait compté `pending`.
    expect(corps).toContain("where('receiptsChecked', '==', false)");
    expect(corps).toContain("where('sentAt', '<=', echeance)");
    expect(corps).toContain('DELAI_RECUS_MS');
  });

  it('tient le délai de quinze minutes depuis une constante nommée', () => {
    // Un `15 * 60 * 1000` écrit dans la requête serait vrai aussi ; la constante
    // dit *pourquoi* ce nombre, et c'est elle qui est relue le jour où le
    // service change sa recommandation.
    expect(SOURCE).toContain('export const DELAI_RECUS_MS = 15 * 60 * 1000;');
  });

  it('compte des remises relues, pas des tickets acceptés', () => {
    const corps = corpsDeLaFonction(SOURCE, 'relireUnEnvoi', CHEMIN_RECUS);

    expect(corps).toContain('deliveredCount: recus.delivered');
    expect(corps).not.toContain('deliveredCount: ticketIds.length');
  });

  it('laisse l’envoi à reprendre quand la relecture échoue', () => {
    // La contrepartie du test précédent : marquer « relu » dans le `catch`
    // effacerait la reprise, et l'envoi garderait `deliveredCount: null` pour
    // toujours — sans que rien ne signale qu'on a renoncé.
    const corps = corpsDeLaFonction(SOURCE, 'readPendingReceipts', CHEMIN_RECUS);
    const rattrapage = corps.slice(corps.indexOf('} catch'));

    expect(corps).toContain('} catch (error) {');
    expect(rattrapage).not.toContain('receiptsChecked');
  });

  it('purge et supprime avant de marquer l’envoi comme relu', () => {
    // L'ordre, et il n'est pas cosmétique : le déclencheur peut s'exécuter deux
    // fois. Marquer d'abord rendrait la seconde exécution inutile, et tout ce
    // qui suit la marque serait perdu sans recours.
    const purge = position('await purgeDeviceTokens(');
    const suppression = position('batch.delete(document.ref)');
    const marquage = position('await ref.update(');

    expect(purge).toBeLessThan(marquage);
    expect(suppression).toBeLessThan(marquage);
  });

  it('retrouve le jeton d’un ticket mort, et signale celui qui manque', () => {
    // Un reçu ne porte pas de jeton : la table des tickets est le seul pont.
    // Un identifiant mort sans jeton connu est journalisé, jamais ignoré —
    // sinon la seule conséquence visible serait un jeton qui revient à chaque
    // envoi, sans qu'aucune trace ne dise pourquoi.
    const corps = corpsDeLaFonction(SOURCE, 'relireUnEnvoi', CHEMIN_RECUS);

    expect(corps).toContain("where('notificationId', '==', ref.id)");
    expect(corps).toContain('jetonParTicket.get(ticketId)');
    // Et ce qu'on empile est bien le **jeton**, pas l'identifiant : les
    // confondre ferait supprimer un document qui n'existe pas, donc ne
    // supprimerait rien, tout en annonçant une purge réussie.
    expect(corps).toContain('jetonsMorts.push(token)');
    expect(corps).toContain('Ticket mort sans jeton connu');
  });

  it('interrompt le passage sur un refus d’authentification, et lui seul', () => {
    // Un jeton refusé vaut pour **tous** les envois : insister produirait vingt
    // fois la même erreur, et le passage de l'heure suivante la reproduirait
    // indéfiniment. Un échec ordinaire, lui, doit laisser le document à
    // reprendre — le `break` ne doit donc pas l'englober.
    const corps = corpsDeLaFonction(SOURCE, 'readPendingReceipts', CHEMIN_RECUS);
    const rattrapage = corps.slice(corps.indexOf('} catch'));

    expect(rattrapage).toContain('instanceof PushCredentialsError');
    expect(rattrapage).toContain('break;');
    expect(rattrapage).toContain("logger.error('[notifications] Reçus non relus'");
  });
});
