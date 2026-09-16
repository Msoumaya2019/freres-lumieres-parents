/**
 * Définition des sections de l'interface d'administration.
 *
 * Une seule source de vérité, utilisée à la fois par la navigation latérale
 * et par les routes. Ajouter une section revient donc à ajouter une entrée
 * ici — impossible d'avoir un lien dans le menu qui ne mène nulle part, ou
 * une page accessible mais absente du menu.
 *
 * Chaque section déclare la permission minimale requise. Elle n'est pas une
 * protection (les Security Rules restent seules juges) mais évite d'afficher
 * un menu dont la moitié des entrées renverrait une erreur.
 */
import type { Permission } from '@fl/types';

export interface AdminSection {
  /** Segment d'URL : `/dashboard`, `/signalements`… */
  readonly slug: string;
  readonly label: string;
  readonly description: string;
  /** Permission minimale pour voir la section. */
  readonly permission: Permission;
  /** Phase du plan de développement où la section est implémentée. */
  readonly phase: string;
  /** Section entièrement fonctionnelle dès la Phase 1 ? */
  readonly implemented: boolean;
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    slug: 'dashboard',
    label: 'Tableau de bord',
    description: 'Vue d’ensemble de l’activité',
    permission: 'fcpe.access',
    phase: 'Phase 4',
    implemented: true,
  },
  {
    slug: 'publications',
    label: 'Publications',
    description: 'Créer, modifier et épingler les informations',
    permission: 'post.create',
    phase: 'Phase 3',
    implemented: true,
  },
  {
    slug: 'notifications',
    label: 'Notifications',
    description: 'Envoyer une notification ciblée, consulter l’historique',
    permission: 'notification.send',
    phase: 'Phase 5',
    implemented: false,
  },
  {
    slug: 'utilisateurs',
    label: 'Utilisateurs',
    description: 'Valider les inscriptions, gérer les rôles et les statuts',
    permission: 'user.read.any',
    phase: 'Phase 2',
    implemented: true,
  },
  {
    slug: 'moderation',
    label: 'Modération',
    description: 'Traiter les contenus signalés',
    permission: 'moderation.queue.read',
    phase: 'Phase 12',
    implemented: false,
  },
  {
    slug: 'signalements',
    label: 'Signalements',
    description: 'Suivre les problèmes remontés par les parents',
    permission: 'report.read.any',
    phase: 'Phase 7',
    implemented: false,
  },
  {
    slug: 'sondages',
    label: 'Sondages',
    description: 'Créer un sondage et suivre les résultats',
    permission: 'poll.create',
    phase: 'Phase 8',
    implemented: false,
  },
  {
    slug: 'agenda',
    label: 'Agenda',
    description: 'Conseils, réunions, sorties et vacances',
    permission: 'event.create',
    phase: 'Phase 9',
    implemented: false,
  },
  {
    slug: 'evenements',
    label: 'Événements',
    description: 'Inscriptions, bénévoles et participations',
    permission: 'event.create',
    phase: 'Phase 9',
    implemented: false,
  },
  {
    slug: 'documents',
    label: 'Documents',
    description: 'Comptes rendus, flyers, menus et règlements',
    permission: 'document.upload',
    phase: 'Phase 11',
    implemented: false,
  },
  {
    slug: 'conseils-ecole',
    label: 'Conseils d’école',
    description: 'Ordre du jour, questions des parents, réponses',
    permission: 'council.manage',
    phase: 'Phase 10',
    implemented: false,
  },
  {
    slug: 'fcpe',
    label: 'Espace FCPE',
    description: 'Discussions internes, tâches et documents privés',
    permission: 'fcpe.access',
    phase: 'Phase 10',
    implemented: false,
  },
  {
    slug: 'parametres',
    label: 'Paramètres',
    description: 'Organisation, écoles, classes et journaux d’audit',
    permission: 'settings.update',
    phase: 'Phase 4',
    implemented: false,
  },
] as const;

/** Retrouve une section par son segment d'URL. */
export function findSection(slug: string): AdminSection | undefined {
  return ADMIN_SECTIONS.find((section) => section.slug === slug);
}

/** Segments valides, utilisés pour générer les routes statiques. */
export const ADMIN_SECTION_SLUGS: readonly string[] = ADMIN_SECTIONS.map((section) => section.slug);

/**
 * Sections disposant de leur propre dossier de route.
 *
 * Elles sont **exclues** de la route générique `[section]`. Deux routes
 * capables de répondre au même chemin ne produisent **aucun avertissement** :
 * Next.js prérend le chemin des deux côtés et sert la route statique, qui
 * l'emporte. Le second rendu reste donc invisible à l'exécution — mais il est
 * bel et bien produit, et il sert un écran « bientôt disponible » pour une
 * section qui existe pourtant. Le seul endroit où l'écart se voit est la table
 * des routes du build.
 *
 * L'oubli n'est pas laissé à la vigilance : `sections.test.ts` compare cette
 * liste aux dossiers réellement présents sous `app/(dashboard)/`.
 */
export const DEDICATED_ROUTE_SLUGS: readonly string[] = ['publications', 'utilisateurs'];
