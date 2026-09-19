/**
 * Données de référence : organisation, établissements, classes.
 *
 * ## Pourquoi un script plutôt qu'une saisie manuelle
 *
 * Le formulaire d'inscription propose l'école, le niveau et la classe de
 * chaque enfant. Ces listes viennent de Firestore. Sans elles, personne ne
 * peut s'inscrire — et les recréer à la main dans la console Firebase est
 * exactement le genre de manipulation qu'on oublie de refaire sur le second
 * environnement.
 *
 * ## Idempotence
 *
 * Les identifiants sont déterministes et les écritures utilisent `set` avec
 * fusion : relancer le script met à jour sans dupliquer. Il peut donc être
 * exécuté sans réfléchir après une modification de l'année scolaire.
 *
 * ## Usage
 *
 *     npm run build:packages          # requis : le script utilise @fl/shared
 *     node scripts/seed-reference-data.mjs
 *     node scripts/seed-reference-data.mjs --project freres-lumieres-dev
 *     node scripts/seed-reference-data.mjs --academic-year 2027-2028
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

// ---------------------------------------------------------------------------
// Données de référence
// ---------------------------------------------------------------------------

/**
 * Elles vivent dans `@fl/shared`, et non ici.
 *
 * Elles y étaient, et les canaux de discussion par défaut s'adressent à une
 * **école** ou à un **niveau** : deux tables recopiées auraient divergé en
 * silence, et un canal de niveau aurait visé une école inexistante sans que
 * rien ne le signale. Une seule source, lue par ce script **et** par
 * `DEFAULT_CHANNELS`.
 *
 * Modifier `REFERENCE_SCHOOLS` suffit : les identifiants de classes en
 * découlent, donc ajouter un niveau crée la classe correspondante sans autre
 * intervention.
 */

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

await run(async () => {
  const args = parseArgs();
  const projectId = resolveProjectId(args);
  const shared = await loadShared();
  const academicYear =
    typeof args['academic-year'] === 'string' ? args['academic-year'] : shared.getAcademicYear();

  const schools = shared.REFERENCE_SCHOOLS;
  const organization = shared.REFERENCE_ORG;

  if (!/^\d{4}-\d{4}$/.test(academicYear)) {
    throw new Error(`Année scolaire invalide : « ${academicYear} ». Format attendu : 2026-2027.`);
  }

  const classCount = schools.reduce((total, school) => total + school.levels.length, 0);

  await confirmTarget({
    projectId,
    description:
      `créer ou mettre à jour 1 organisation, ${schools.length} écoles et ` +
      `${classCount} classes (année ${academicYear})`,
    args,
  });

  initAdmin(projectId);
  const firestore = db();
  const now = FieldValue.serverTimestamp();

  // --- Organisation --------------------------------------------------------
  log.step('Organisation');
  await firestore
    .doc(`organizations/${DEFAULT_ORG_ID}`)
    .set(
      { id: DEFAULT_ORG_ID, ...organization, slug: DEFAULT_ORG_ID, updatedAt: now },
      { merge: true },
    );
  log.ok(`${organization.name} (${DEFAULT_ORG_ID})`);

  // --- Établissements et classes -------------------------------------------
  for (const school of schools) {
    log.step(school.name);

    const levels = school.levels.map((entry) => entry.code);

    await firestore.doc(`schools/${school.id}`).set(
      {
        id: school.id,
        orgId: DEFAULT_ORG_ID,
        name: school.name,
        level: school.level,
        classLevels: levels,
        active: true,
        updatedAt: now,
      },
      { merge: true },
    );
    log.ok(`École enregistrée — niveaux : ${levels.join(', ')}`);

    // Écriture groupée : soit toutes les classes existent, soit aucune. Une
    // école à moitié peuplée produirait un formulaire d'inscription proposant
    // des niveaux sans classe, ce qui est pire que pas de niveau du tout.
    const batch = firestore.batch();

    for (const entry of school.levels) {
      const id = shared.classIdFor(school.id, entry.code);
      batch.set(
        firestore.doc(`classes/${id}`),
        {
          id,
          orgId: DEFAULT_ORG_ID,
          schoolId: school.id,
          name: entry.label,
          level: entry.code,
          academicYear,
          updatedAt: now,
        },
        { merge: true },
      );
    }

    await batch.commit();
    log.ok(`${school.levels.length} classes — année ${academicYear}`);
  }

  console.log('');
  log.ok('Données de référence en place.');
  log.info(
    usingEmulators()
      ? 'Cible : émulateurs locaux.'
      : 'Étape suivante : node scripts/bootstrap-admin.mjs',
  );
});
