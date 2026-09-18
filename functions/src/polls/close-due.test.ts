/**
 * Clôture automatique des sondages échus.
 *
 * ## Ce que ces tests ajoutent
 *
 * Le module affirme trois choses que rien d'autre ne mesure :
 *
 *  - un sondage **sans** échéance n'est jamais ramené par la requête, donc
 *    jamais clos tout seul. C'est une règle de Firestore — une inégalité écarte
 *    les documents qui ne portent pas le champ — et c'est elle qui réserve la
 *    clôture d'un sondage sans date à la FCPE. Un faux qui traiterait l'absence
 *    comme une valeur très petite aurait l'air de tout aussi bien marcher, tout
 *    en prouvant le contraire ;
 *  - un **brouillon** échu n'est pas clos. Ce n'est pas du rangement : la règle
 *    de lecture ouvre aux parents les statuts `open` et `closed`, donc clore un
 *    brouillon le **publierait** à toute l'organisation ;
 *  - la clôture **préserve** le sondage. `merge: true` n'est pas une commodité :
 *    sans lui, l'écriture remplacerait le document, et la question
 *    disparaîtrait.
 *
 * `maintenant` est passé plutôt que lu d'une horloge : un test qui place une
 * échéance « juste avant » et « juste après » la borne ne peut pas le faire
 * contre l'horloge réelle sans devenir instable.
 */
import { describe, expect, it } from 'vitest';

import { COLLECTIONS } from '../lib/paths.js';
import { base, type FauxDocument } from '../test-helpers/faux-firestore.js';
import { closeDuePolls } from './close-due.js';

const MAINTENANT = new Date('2026-06-01T20:00:00Z');
const PASSEE = new Date('2026-06-01T19:59:00Z');
const A_VENIR = new Date('2026-06-01T20:01:00Z');

/** Sondages présents en base. La forme complète du document n'est pas le sujet. */
function sondagesDe(entrees: readonly Partial<FauxDocument>[]): FauxDocument[] {
  return entrees.map((entree, index) => ({
    id: `poll-${index}`,
    question: 'Faut-il maintenir la kermesse ?',
    status: 'open',
    ...entree,
  }));
}

describe('closeDuePolls', () => {
  it('clôt un sondage dont l’échéance est passée, sans perdre le sondage', async () => {
    const { faux, db } = base({
      [COLLECTIONS.polls]: sondagesDe([{ id: 'poll-echu', endsAt: PASSEE }]),
    });

    const rapport = await closeDuePolls(db, MAINTENANT);

    expect(rapport).toEqual({ examined: 1, closed: 1 });

    const [sondage] = faux.restants(COLLECTIONS.polls);
    expect(sondage?.status).toBe('closed');
    expect(sondage?.closedAt).toEqual(MAINTENANT);
    // `merge: true` : la question est toujours là. Sans lui, clore un sondage
    // le perdrait — la règle refuserait l'écriture, mais le document serait
    // remplacé du même coup.
    expect(sondage?.question).toBe('Faut-il maintenir la kermesse ?');
  });

  it('et le témoin : même forme, échéance à venir, rien n’est touché', async () => {
    const { faux, db } = base({
      [COLLECTIONS.polls]: sondagesDe([{ id: 'poll-a-venir', endsAt: A_VENIR }]),
    });

    const rapport = await closeDuePolls(db, MAINTENANT);

    expect(rapport).toEqual({ examined: 0, closed: 0 });
    expect(faux.restants(COLLECTIONS.polls)[0]?.status).toBe('open');
  });

  it('ne clôt jamais un sondage sans échéance', async () => {
    // Un champ absent ne satisfait pas `endsAt <= maintenant` : c'est la règle
    // de Firestore, et c'est elle qui laisse un sondage sans date de clôture
    // ouvert jusqu'à ce que la FCPE le close à la main.
    const { faux, db } = base({
      [COLLECTIONS.polls]: sondagesDe([{ id: 'poll-sans-echeance' }]),
    });

    const rapport = await closeDuePolls(db, MAINTENANT);

    expect(rapport).toEqual({ examined: 0, closed: 0 });
    expect(faux.restants(COLLECTIONS.polls)[0]?.status).toBe('open');
  });

  it('ne clôt pas un brouillon échu, car le clore le publierait', async () => {
    // La règle de lecture ouvre aux parents `open` **et** `closed` : un
    // brouillon clos deviendrait lisible par toute l'organisation, ce que
    // `notify: false` sert précisément à éviter.
    const { faux, db } = base({
      [COLLECTIONS.polls]: sondagesDe([{ id: 'poll-brouillon', status: 'draft', endsAt: PASSEE }]),
    });

    const rapport = await closeDuePolls(db, MAINTENANT);

    expect(rapport).toEqual({ examined: 0, closed: 0 });
    expect(faux.restants(COLLECTIONS.polls)[0]?.status).toBe('draft');
  });

  it('ne réécrit pas la clôture d’un sondage déjà clos', async () => {
    // `closedAt` est un fait : le déplacer changerait l'heure affichée, et le
    // déclencheur de notification y verrait une transition — donc un second
    // envoi à la même audience.
    const dejaClos = new Date('2026-05-01T12:00:00Z');
    const { faux, db } = base({
      [COLLECTIONS.polls]: sondagesDe([
        { id: 'poll-clos', status: 'closed', endsAt: PASSEE, closedAt: dejaClos },
      ]),
    });

    const rapport = await closeDuePolls(db, MAINTENANT);

    expect(rapport).toEqual({ examined: 0, closed: 0 });
    expect(faux.restants(COLLECTIONS.polls)[0]?.closedAt).toEqual(dejaClos);
  });

  it('borne son passage, et reprend au suivant', async () => {
    // Sans borne, une reprise après une panne longue ferait un seul passage
    // très long, interrompu au milieu sans que rien ne dise où. Et c'est cette
    // borne qui rend deux passages concurrents impossibles, donc l'écriture
    // idempotente sans transaction.
    const { faux, db } = base({
      [COLLECTIONS.polls]: sondagesDe(
        Array.from({ length: 25 }, (_, index) => ({ id: `poll-${index}`, endsAt: PASSEE })),
      ),
    });

    await expect(closeDuePolls(db, MAINTENANT)).resolves.toEqual({ examined: 20, closed: 20 });
    await expect(closeDuePolls(db, MAINTENANT)).resolves.toEqual({ examined: 5, closed: 5 });

    const restants = faux.restants(COLLECTIONS.polls);
    expect(restants).toHaveLength(25);
    expect(restants.every((sondage) => sondage.status === 'closed')).toBe(true);
  });
});
