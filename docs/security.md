# Sécurité et confidentialité

## Menaces couvertes dès la Phase 2

- Auto‑promotion de rôle : refusée par les règles; mutation via Function admin uniquement.
- Compte pending/suspended : contenu et participation refusés grâce au claim `status`.
- Lecture FCPE directe : audience et collection privée protégées côté règles.
- Lecture des signalements : auteur, modérateur/admin, ou FCPE seulement après partage explicite.
- Vote multiple : identifiant déterministe et mise à jour interdite.
- Upload arbitraire : chemins, propriétaires, types MIME et tailles contrôlés.
- Secret dans le dépôt : `.gitignore` strict et uniquement `.env.example`.
- Falsification du périmètre scolaire à l’inscription : écoles/niveaux revalidés côté Function et classe optionnelle recoupée avec son organisation.
- Réinscription d’un compte existant : les claims sont reconstruits depuis le profil serveur existant, jamais depuis les nouvelles données clientes.

## Dépôt public

Les clés de configuration Firebase côté client identifient le projet mais n’accordent aucun privilège; la sécurité repose sur Auth, App Check et les Rules. En revanche, service accounts, P12, provisioning profiles, tokens Expo/GitHub, clés Play et clés Apple sont strictement interdits.

Avant chaque publication : vérifier `git status`, l’historique, les artefacts et les logs. Activer sur GitHub les alertes Dependabot, le secret scanning et la protection de branche. CodeQL est configuré.

## RGPD

- Données enfant minimales : établissement, niveau, classe optionnelle, libellé facultatif.
- Pas de publicité ni de tracking publicitaire.
- Analytics et Crashlytics ne sont pas activés; ils nécessiteront information/consentement et revue de minimisation.
- `deleteUserData` supprime Auth, profil et profils enfants. L’anonymisation du contenu public et le nettoyage complet Storage seront finalisés avant activation en production.
- Les `adminLogs` sont append-only côté serveur; durée de conservation à fixer avec la politique de confidentialité.

## App Check

App Check sera activé en mode monitoring en développement, puis enforcement après observation des métriques. Les émulateurs utilisent des debug tokens qui ne doivent pas être commités. L’activation mobile interviendra avec les configurations natives de la Phase 5, avant toute production.

## Limites connues de Phase 2

App Check n’est pas encore enforced et aucun environnement Firebase réel n’est configuré. L’identité, l’inscription et l’administration des comptes sont couvertes par un test d’intégration Emulator Suite; les contenus, notifications et suppressions complètes restent à valider dans leurs phases fonctionnelles. Le garde de routes Next.js est une aide d’interface uniquement : les Rules et Functions restent les frontières d’autorisation.
