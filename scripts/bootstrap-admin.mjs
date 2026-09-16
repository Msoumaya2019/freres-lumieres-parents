/**
 * Création du premier administrateur.
 *
 * ## Le problème que ce script résout
 *
 * Valider un compte est une action réservée aux rôles `fcpe`, `moderator` et
 * `admin`. Sur une base vide, personne ne détient ces rôles — et les Custom
 * Claims, qui les portent, ne peuvent être écrits que par l'Admin SDK. Il faut
 * donc une intervention hors application pour amorcer le système. C'est le
 * rôle de ce script, et c'est la seule opération de tout le projet qui
 * contourne les règles de sécurité.
 *
 * ## Idempotence
 *
 * Relancer le script sur une adresse existante met à jour le profil et les
 * droits sans créer de doublon. Il sert donc aussi à réparer un compte
 * administrateur dont les claims auraient été perdus.
 *
 * ## Usage
 *
 *     export GOOGLE_APPLICATION_CREDENTIALS=/chemin/compte-de-service.json
 *     node scripts/bootstrap-admin.mjs --email direction@exemple.fr \
 *       --first-name Camille --last-name Durand
 *
 * Le mot de passe est lu dans `BOOTSTRAP_ADMIN_PASSWORD` — préférable à
 * `--password`, qui reste visible dans l'historique du shell et dans la liste
 * des processus.
 *
 * Sur les émulateurs (FIRESTORE_EMULATOR_HOST défini), aucun identifiant
 * n'est nécessaire.
 */
import { FieldValue } from 'firebase-admin/firestore';

import {
  DEFAULT_ORG_ID,
  auth,
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
// Aides
// ---------------------------------------------------------------------------

function requireArg(args, name, humanName) {
  const value = args[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${humanName} manquant. Utilisez --${name} <valeur>.`);
  }
  return value.trim();
}

/** Résout le mot de passe, en privilégiant la variable d'environnement. */
function resolvePassword(args) {
  const fromEnv = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;

  if (typeof args.password === 'string' && args.password.length > 0) {
    log.warn(
      'Mot de passe fourni en argument : il figure dans l’historique du shell.\n' +
        '    Préférez BOOTSTRAP_ADMIN_PASSWORD.',
    );
    return args.password;
  }

  throw new Error(
    'Mot de passe manquant.\n' +
      '  Définissez BOOTSTRAP_ADMIN_PASSWORD, ou passez --password <valeur>.',
  );
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

await run(async () => {
  const args = parseArgs();
  const projectId = resolveProjectId(args);

  const email = requireArg(args, 'email', 'Adresse e-mail').toLowerCase();
  const password = resolvePassword(args);
  const firstName = requireArg(args, 'first-name', 'Prénom');
  const lastName = requireArg(args, 'last-name', 'Nom');
  const orgId = typeof args.org === 'string' ? args.org : DEFAULT_ORG_ID;

  const shared = await loadShared();

  // Le mot de passe est validé par le même schéma que le formulaire
  // d'inscription : inutile de créer un compte que le client refuserait.
  const passwordCheck = shared.passwordSchema.safeParse(password);
  if (!passwordCheck.success) {
    throw new Error(
      `Mot de passe refusé : ${passwordCheck.error.issues[0]?.message ?? 'règle non respectée'}`,
    );
  }

  if (!shared.emailSchema.safeParse(email).success) {
    throw new Error(`Adresse e-mail invalide : « ${email} ».`);
  }

  await confirmTarget({
    projectId,
    description:
      `créer ou réparer l’administrateur ${email} (${firstName} ${lastName}) ` +
      `dans l’organisation ${orgId}`,
    args,
  });

  initAdmin(projectId);
  const firestore = db();
  const authService = auth();

  // --- Compte Firebase Auth -------------------------------------------------
  log.step('Compte Firebase Auth');

  let user;
  try {
    user = await authService.getUserByEmail(email);
    log.info(`Compte existant réutilisé (uid ${user.uid}).`);
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;

    user = await authService.createUser({
      email,
      password,
      displayName: `${firstName} ${lastName}`,
      // L'opérateur connaît l'adresse : exiger une vérification par e-mail
      // n'apporterait rien et bloquerait l'accès à l'interface.
      emailVerified: true,
    });
    log.ok(`Compte créé (uid ${user.uid}).`);
  }

  // --- Profil Firestore -----------------------------------------------------
  log.step('Profil et droits');

  const orgIds = [orgId];

  // Les clés d'audience viennent de la même fonction que celle utilisée par
  // les Cloud Functions : un administrateur doit voir exactement ce que le
  // serveur lui attribuerait.
  const audienceKeys = shared.buildUserAudienceKeys({
    orgIds,
    schoolIds: [],
    levels: [],
    classIds: [],
    role: 'admin',
  });

  await firestore.doc(`users/${user.uid}`).set(
    {
      id: user.uid,
      firstName,
      lastName,
      email,
      role: 'admin',
      // Compte actif d'emblée : il n'y a personne pour valider le premier
      // administrateur, et c'est précisément ce que ce script contourne.
      status: 'active',
      orgId,
      orgIds,
      schoolIds: [],
      levels: [],
      classIds: [],
      audienceKeys,
      notificationPrefs: { enabled: true, disabledCategories: [] },
      consents: { privacyPolicy: true, communityRules: true, fcpeContact: false },
      approvedAt: FieldValue.serverTimestamp(),
      approvedBy: 'bootstrap-script',
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  log.ok(`Profil users/${user.uid} — rôle admin, statut actif.`);
  log.info(`Clés d’audience : ${audienceKeys.join(', ')}`);

  // --- Custom Claims --------------------------------------------------------
  log.step('Custom Claims');

  // Écrits explicitement plutôt que laissés aux déclencheurs Firestore : en
  // local, les Cloud Functions ne tournent pas forcément, et un
  // administrateur sans claims ne pourrait rien faire.
  await authService.setCustomUserClaims(user.uid, {
    role: 'admin',
    status: 'active',
    orgId,
    orgIds,
  });
  log.ok('Claims appliqués (role=admin, status=active).');

  console.log('');
  log.ok('Administrateur opérationnel.');
  log.info(
    usingEmulators()
      ? 'Cible : émulateurs locaux.'
      : 'Connectez-vous sur l’interface d’administration avec cette adresse.',
  );
  log.warn('Le mot de passe n’est affiché nulle part : conservez-le en lieu sûr.');
});
