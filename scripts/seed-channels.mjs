/**
 * Canaux de discussion par défaut.
 *
 * ## Pourquoi un script, et pas la console Firebase
 *
 * Les treize canaux viennent de `DEFAULT_CHANNELS`, dans `@fl/shared` — la
 * **même** liste que celle que l'écran Discussions remplace. Deux copies
 * divergeraient, et l'écran annoncerait un canal que la base ne contient pas.
 *
 * ## Idempotence, et ce que relancer ne doit pas écraser
 *
 * Les identifiants sont déterministes (`general`, `niveau-cp`, …) et les
 * écritures utilisent `set` avec fusion : relancer met à jour sans dupliquer.
 *
 * Mais `stats` et `createdAt` ne sont écrits **qu'à la création**. La fusion
 * de Firestore descend dans les objets imbriqués : réécrire `stats` remettrait
 * `messageCount` à zéro à chaque exécution, et le canal perdrait son compteur
 * de messages — un effet de bord qu'aucune erreur ne signalerait.
 *
 * ## L'audience est calculée, jamais écrite à la main
 *
 * `audienceKeys` vient de `buildAudienceKeys`, la même fonction que pour les
 * publications et les sondages. Le script **refuse** un canal dont l'audience
 * ne produit aucune clé : un tel canal ne serait reçu par personne, et
 * l'écran l'afficherait quand même.
 *
 * ## Usage
 *
 *     npm run build:packages          # requis : le script utilise @fl/shared
 *     node scripts/seed-channels.mjs
 *     node scripts/seed-channels.mjs --project freres-lumieres-dev
 *
 * Sur les émulateurs (FIRESTORE_EMULATOR_HOST défini), aucun identifiant
 * n'est nécessaire.
 */
import { FieldValue } from 'firebase-admin/firestore';

import {
  DEFAULT_ORG_ID,
  confirmTarget,
  db,
  initAdmin,
  loadShared,
  log,
  parseArgs,
  resolveProjectId,
  run,
  usingEmulators,
} from './lib/cli.mjs';

await run(async () => {
  const args = parseArgs();
  const projectId = resolveProjectId(args);
  const shared = await loadShared();

  const channels = shared.DEFAULT_CHANNELS;

  await confirmTarget({
    projectId,
    description: `créer ou mettre à jour ${channels.length} canaux de discussion`,
    args,
  });

  initAdmin(projectId);
  const firestore = db();
  const now = FieldValue.serverTimestamp();

  let created = 0;
  let updated = 0;

  for (const channel of channels) {
    const audienceKeys = shared.buildAudienceKeys(channel.audience, DEFAULT_ORG_ID);

    if (audienceKeys.length === 0) {
      throw new Error(
        `Canal « ${channel.id} » : son audience ne produit aucune clé. ` +
          'Personne ne le recevrait, et l’écran l’afficherait quand même.',
      );
    }

    const reference = firestore.doc(`channels/${channel.id}`);
    const exists = (await reference.get()).exists;

    await reference.set(
      {
        id: channel.id,
        orgId: DEFAULT_ORG_ID,
        name: channel.name,
        description: channel.description,
        type: channel.type,
        // `level` n'est pas un doublon de `audience.level` : c'est le champ que
        // l'écran lit pour grouper, et il n'existe que sur les canaux de niveau.
        ...(channel.audience.level ? { level: channel.audience.level } : {}),
        audience: channel.audience,
        audienceKeys,
        order: channel.order,
        // Aucun canal par défaut n'est en lecture seule ; le drapeau existe
        // pour les archives et les annonces, et l'écran le respecte.
        readOnly: false,
        status: 'published',
        // Voir l'en-tête : ces deux champs ne sont écrits qu'à la création.
        ...(exists ? {} : { stats: { messageCount: 0 }, createdAt: now }),
        updatedAt: now,
      },
      { merge: true },
    );

    if (exists) updated += 1;
    else created += 1;

    log.ok(
      `${String(channel.order).padStart(2, ' ')}. ${channel.name} — ${audienceKeys.join(', ')}`,
    );
  }

  console.log('');
  log.ok(`${created} créé(s), ${updated} mis à jour.`);
  log.info(
    usingEmulators()
      ? 'Cible : émulateurs locaux.'
      : 'Les canaux sont lisibles par les comptes validés de l’organisation.',
  );
});
