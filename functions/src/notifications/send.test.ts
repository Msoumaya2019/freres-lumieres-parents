/**
 * Ce que la requête d'envoi ne doit pas contraindre, ce que le journal ne doit
 * pas affirmer, et ce qui doit interrompre un envoi.
 *
 * ## Les trois décisions que ce test tient
 *
 * **La requête.** `queryTokensByAudience` lit les jetons d'une audience. Elle ne
 * contraint **pas** `enabled`, et c'est une décision, pas un oubli : une
 * contrainte à cet endroit écarte un appareil éteint **avant**
 * `filterRecipients`, qui ne peut alors plus rien pour lui. Un parent ayant coupé
 * les notifications de son téléphone ne recevrait plus aucune alerte urgente —
 * exactement le cas que l'exception doit couvrir.
 *
 * **Le journal.** À l'écriture, `deliveredCount` vaut `null`, jamais un nombre :
 * à cet instant on sait ce que le service a **accepté**, pas ce qu'il a remis.
 * C'est le défaut que tout cet incrément corrige — un champ intitulé
 * « delivered » qui comptait des acceptations. Le remettre à `accepted` ne
 * casserait rien, ne lèverait rien, et remettrait en place exactement le
 * mensonge qu'on vient de retirer.
 *
 * **Le refus d'authentification.** Un jeton d'accès Expo refusé doit interrompre
 * l'envoi, et l'erreur doit remonter. La compter en échec écrirait « 412
 * appareils injoignables » là où il n'y a qu'un secret expiré — le compte rendu
 * serait faux dans le sens qui rassure, puisqu'il désignerait les parents au lieu
 * de la configuration.
 *
 * ## Pourquoi il lit la source au lieu d'appeler les fonctions
 *
 * `send.ts` importe `firebase-admin` et `firebase-functions` : l'importer
 * demanderait un émulateur et une application initialisée. Or ce qui est
 * vérifié ici n'est pas un comportement mais une **forme de code** — une requête
 * sans contrainte, un champ écrit à `null`. Même choix que `paths.test.ts`, qui
 * compare deux tables de collections sans jamais importer le SDK client.
 *
 * Ce test est pur : ni émulateur, ni Java.
 */
import { describe, expect, it } from 'vitest';

import { corpsDeLaFonction, lireSource } from '../test-helpers/source.js';

const CHEMIN_SEND = ['functions', 'src', 'notifications', 'send.ts'];
const SOURCE = lireSource(CHEMIN_SEND);

describe('queryTokensByAudience', () => {
  it('ne contraint pas l’interrupteur de l’appareil', () => {
    // La décision : `enabled` est écarté par `filterRecipients`, qui fait passer
    // les alertes obligatoires outre. Le contraindre ici rendrait la requête
    // sourde à cette exception, et personne ne le verrait — l'appareil éteint
    // serait simplement absent de la liste, indiscernable d'un appareil qui
    // n'existe pas.
    expect(corpsDeLaFonction(SOURCE, 'queryTokensByAudience', CHEMIN_SEND)).not.toContain(
      "where('enabled'",
    );
  });

  it('contraint l’organisation et l’audience', () => {
    // La contrepartie, et elle est nécessaire : le test précédent passerait
    // aussi sur une fonction vidée de son corps.
    const corps = corpsDeLaFonction(SOURCE, 'queryTokensByAudience', CHEMIN_SEND);

    expect(corps).toContain("where('orgId', '==', orgId)");
    expect(corps).toContain("where('audienceKeys', 'array-contains-any', lot)");
  });
});

describe('writeNotificationLog', () => {
  it('n’annonce aucune remise avant de l’avoir relue', () => {
    const corps = corpsDeLaFonction(SOURCE, 'writeNotificationLog', CHEMIN_SEND);

    expect(corps).toContain('deliveredCount: rienARelire ? 0 : null');
  });

  it('laisse l’envoi à relire tant qu’un ticket peut l’être', () => {
    // L'autre moitié de la décision, et sans elle la première serait un vœu :
    // un document marqué « déjà relu » ne serait jamais repris, et
    // `deliveredCount` resterait `null` pour toujours.
    const corps = corpsDeLaFonction(SOURCE, 'writeNotificationLog', CHEMIN_SEND);

    expect(corps).toContain('receiptsChecked: rienARelire');
    expect(corps).toContain('ticketIds: comptes.tickets.map((ticket) => ticket.id)');
  });

  it('n’écrit pas la table des tickets si l’historique a échoué', () => {
    // Des tickets sans document d'historique ne seraient jamais relus — le
    // passage des reçus part de l'historique — et resteraient en base
    // indéfiniment. La garde est dans `sendToAudience`, pas dans le journal.
    const corps = corpsDeLaFonction(SOURCE, 'sendToAudience', CHEMIN_SEND);

    expect(corps).toContain('if (historiqueEcrit)');
    expect(corps).toContain('writePushTickets(');
  });
});

describe('sendToAudience, sur un jeton d’accès refusé', () => {
  it('nomme la panne au lieu de la compter', () => {
    // Le défaut que tout cet incrément corrige : un `401` se comptait comme une
    // audience injoignable — « 412 appareils » au lieu de « jeton expiré ». Le
    // message doit dire lequel des deux, sans quoi aucune alerte de journal ne
    // peut s'y accrocher, et la panne reste invisible.
    const corps = corpsDeLaFonction(SOURCE, 'sendToAudience', CHEMIN_SEND);

    expect(corps).toContain('instanceof PushCredentialsError');
    expect(corps).toContain('logger.error');
    expect(corps).toContain('Jeton d’accès Expo refusé');
  });

  it('relance l’erreur, pour qu’aucun historique ne soit écrit', () => {
    // Lever n'est pas une coquetterie : c'est ce qui empêche l'écriture du
    // document d'historique **et** du `notifiedAt`. Sans la relance, le journal
    // annoncerait un envoi complet et la publication serait marquée notifiée —
    // donc jamais reprise, même après remplacement du secret.
    const corps = corpsDeLaFonction(SOURCE, 'sendToAudience', CHEMIN_SEND);
    const rattrapage = corps.slice(corps.indexOf('} catch'));

    expect(rattrapage).toContain('throw error;');
  });
});
