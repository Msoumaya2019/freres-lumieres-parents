/**
 * L'ordre des vérifications, et ce qui est écrit quand l'envoi échoue.
 *
 * ## Pourquoi ce test lit la source
 *
 * `send-notification.ts` importe `firebase-functions` et l'Admin SDK :
 * l'appeler demanderait un émulateur, une application initialisée et un jeton
 * d'accès Expo valide. Or ce qui est vérifié ici n'est pas un comportement mais
 * un **ordre** et une **présence** — deux choses qu'un test d'exécution ne
 * saurait pas distinguer d'un heureux hasard.
 *
 * ## La décision qui ne se voit jamais
 *
 * Le journal d'audit est écrit **aussi** quand l'envoi est interrompu. Le seul
 * cas qui interrompt un envoi est un jeton d'accès Expo refusé : sans cette
 * écriture, une tentative d'annonce urgente à huit cents téléphones ne
 * laisserait aucune trace attribuable — le pire moment pour ne pas savoir qui a
 * essayé. Un test d'exécution exigerait de fabriquer ce `401` ; la lecture de
 * la source l'exige sans rien simuler.
 *
 * ## La contrepartie
 *
 * Un test de présence passerait sur un fichier qui contient les mots sans rien
 * faire. Les deux contrôles de structure ci-dessous — l'ordre des appels, et le
 * fait que l'écriture est **dans** le rattrapage — sont là pour ça.
 */
import { describe, expect, it } from 'vitest';

import { corpsDeLaFonction, lireSource } from '../test-helpers/source.js';

const CHEMIN = ['functions', 'src', 'callable', 'send-notification.ts'];
const SOURCE = lireSource(CHEMIN);
const CORPS = corpsDeLaFonction(SOURCE, 'sendManualNotification', CHEMIN);

describe('sendManualNotification, ordre des vérifications', () => {
  it('identifie l’appelant en base avant tout le reste', () => {
    expect(CORPS).toContain('await resolveCaller(request.auth)');
  });

  it('vérifie la permission avant de valider l’entrée', () => {
    // Un appelant sans droit n'a pas à apprendre, par un message d'erreur
    // détaillé, quelle forme d'entrée est attendue : valider d'abord
    // renseignerait sur le schéma.
    const permission = CORPS.indexOf("hasPermission(caller.role, 'notification.send')");
    const validation = CORPS.indexOf('notificationSendSchema.safeParse');

    expect(permission).toBeGreaterThan(-1);
    expect(validation).toBeGreaterThan(-1);
    expect(permission).toBeLessThan(validation);
  });

  it('refuse une audience qui ne désigne personne', () => {
    // Le plan rend `null` plutôt qu'un envoi à zéro appareil, et la fonction
    // doit le dire. Sans cette branche, `plan.orgId` serait lu sur `null` et
    // l'appelant recevrait une erreur interne au lieu d'une explication.
    expect(CORPS).toContain('if (!plan)');
    expect(CORPS).toContain("'failed-precondition'");
  });

  it('n’invente pas de portée : l’organisation vient de l’appelant', () => {
    // `notificationSendSchema` ne porte pas d'`orgId`, et la fonction ne doit
    // pas en chercher un dans la requête.
    expect(CORPS).toContain('orgId: caller.orgId');
    expect(CORPS).not.toContain('request.data.orgId');
  });
});

describe('sendManualNotification, journal d’audit', () => {
  it('écrit une trace même quand l’envoi est interrompu', () => {
    const rattrapage = CORPS.slice(CORPS.indexOf('} catch (error) {'));
    const finDuRattrapage = rattrapage.indexOf('throw error;');

    expect(CORPS).toContain('} catch (error) {');
    expect(finDuRattrapage).toBeGreaterThan(-1);
    expect(rattrapage.slice(0, finDuRattrapage)).toContain('writeAuditLog');
  });

  it('relance l’erreur, pour que l’appelant sache que rien n’est parti', () => {
    // La contrepartie : un rattrapage qui journalise et se tait rendrait un
    // succès à l'écran d'administration alors qu'aucun message n'est parti.
    const rattrapage = CORPS.slice(CORPS.indexOf('} catch (error) {'));
    expect(rattrapage).toContain('throw error;');
  });

  it('désigne l’organisation, qui existe avant comme après', () => {
    // Désigner le document d'historique serait plus précis, mais il n'existe
    // pas à l'instant où l'envoi échoue : `targetId` doit tenir dans les deux
    // branches, et un identifiant mort dans un journal d'audit est pire qu'une
    // référence plus large.
    expect(CORPS).toContain("targetType: 'organization'");
    expect(CORPS).toContain('targetId: caller.orgId');
  });

  it('note l’issue dans les métadonnées, et pas seulement le succès', () => {
    expect(CORPS).toContain("issue: 'interrompu'");
    expect(CORPS).toContain("issue: 'envoyé'");
  });

  it('nomme l’action sous son nom d’audit', () => {
    expect(CORPS).toContain('action: ADMIN_ACTIONS.notificationSend');
  });
});
