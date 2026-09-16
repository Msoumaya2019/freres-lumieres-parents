/**
 * Libellés en français et couleurs associées.
 *
 * Centralisés ici pour deux raisons :
 *  1. une seule source de vérité entre le mobile et l'admin ;
 *  2. la préparation d'une future internationalisation : il suffira de
 *     dupliquer ce fichier en `labels.en.ts` et d'indexer par locale.
 */
import type {
  AudienceType,
  ChannelType,
  ClassLevel,
  CollectiveIssueStatus,
  DocumentCategory,
  EventType,
  ModerationReason,
  ModerationStatus,
  NotificationCategory,
  PollStatus,
  PostCategory,
  ReportCategory,
  ReportStatus,
  SchoolLevel,
  UserRole,
  UserStatus,
} from '@fl/types';

/** Couleurs sémantiques utilisées par les pastilles et étiquettes. */
export interface BadgeStyle {
  /** Couleur de texte / d'icône. */
  readonly color: string;
  /** Couleur de fond (version très claire). */
  readonly background: string;
}

/** Palette d'étiquettes, alignée sur les jetons de thème (voir `theme.ts`). */
export const BADGE_COLORS = {
  neutral: { color: '#4B5563', background: '#F3F4F6' },
  info: { color: '#1D4ED8', background: '#E0E7FF' },
  success: { color: '#15803D', background: '#DCFCE7' },
  warning: { color: '#B45309', background: '#FEF3C7' },
  danger: { color: '#B91C1C', background: '#FEE2E2' },
  accent: { color: '#7C3AED', background: '#EDE9FE' },
  teal: { color: '#0F766E', background: '#CCFBF1' },
} as const satisfies Record<string, BadgeStyle>;

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  parent: 'Parent',
  fcpe: 'Membre FCPE',
  moderator: 'Modérateur',
  admin: 'Administrateur',
};

export const USER_ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  parent: "Accès aux informations de l'école et aux discussions collectives.",
  fcpe: 'Accès supplémentaire aux outils de la FCPE et aux signalements.',
  moderator: 'Peut masquer des contenus et traiter les signalements.',
  admin: 'Contrôle total, gestion des comptes et des paramètres.',
};

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  pending: 'En attente de validation',
  active: 'Actif',
  suspended: 'Suspendu',
  rejected: 'Refusé',
};

export const USER_STATUS_BADGES: Record<UserStatus, BadgeStyle> = {
  pending: BADGE_COLORS.warning,
  active: BADGE_COLORS.success,
  suspended: BADGE_COLORS.danger,
  rejected: BADGE_COLORS.neutral,
};

export const SCHOOL_LEVEL_LABELS: Record<SchoolLevel, string> = {
  maternelle: 'Maternelle',
  elementaire: 'Élémentaire',
  primaire: 'Primaire (maternelle + élémentaire)',
};

export const CLASS_LEVEL_LABELS: Record<ClassLevel, string> = {
  PS: 'Petite section',
  MS: 'Moyenne section',
  GS: 'Grande section',
  CP: 'CP',
  CE1: 'CE1',
  CE2: 'CE2',
  CM1: 'CM1',
  CM2: 'CM2',
  ULIS: 'ULIS',
  autre: 'Autre',
};

/** Libellé court, pour les puces et filtres compacts. */
export const CLASS_LEVEL_SHORT_LABELS: Record<ClassLevel, string> = {
  PS: 'PS',
  MS: 'MS',
  GS: 'GS',
  CP: 'CP',
  CE1: 'CE1',
  CE2: 'CE2',
  CM1: 'CM1',
  CM2: 'CM2',
  ULIS: 'ULIS',
  autre: 'Autre',
};

export const POST_CATEGORY_LABELS: Record<PostCategory, string> = {
  information: 'Information',
  urgent: 'Urgent',
  cantine: 'Cantine',
  periscolaire: 'Périscolaire',
  travaux: 'Travaux',
  sortie_scolaire: 'Sortie scolaire',
  fcpe: 'FCPE',
  mairie: 'Mairie',
  evenement: 'Événement',
  conseil_ecole: "Conseil d'école",
  autre: 'Autre',
};

export const POST_CATEGORY_BADGES: Record<PostCategory, BadgeStyle> = {
  information: BADGE_COLORS.info,
  urgent: BADGE_COLORS.danger,
  cantine: BADGE_COLORS.warning,
  periscolaire: BADGE_COLORS.accent,
  travaux: BADGE_COLORS.neutral,
  sortie_scolaire: BADGE_COLORS.teal,
  fcpe: BADGE_COLORS.info,
  mairie: BADGE_COLORS.neutral,
  evenement: BADGE_COLORS.accent,
  conseil_ecole: BADGE_COLORS.teal,
  autre: BADGE_COLORS.neutral,
};

/** Icône (nom de glyphe) associée à chaque catégorie, résolue côté application. */
export const POST_CATEGORY_ICONS: Record<PostCategory, string> = {
  information: 'info',
  urgent: 'alert-triangle',
  cantine: 'utensils',
  periscolaire: 'sun',
  travaux: 'hammer',
  sortie_scolaire: 'bus',
  fcpe: 'users',
  mairie: 'building',
  evenement: 'calendar-heart',
  conseil_ecole: 'school',
  autre: 'file-text',
};

export const AUDIENCE_TYPE_LABELS: Record<AudienceType, string> = {
  all: 'Tous les parents',
  school: 'Une école',
  level: 'Un niveau',
  class: 'Une classe',
  fcpe: 'Membres FCPE uniquement',
};

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  urgent: 'Alertes urgentes',
  publications: 'Nouvelles publications',
  discussions: 'Discussions entre parents',
  sondages: 'Sondages',
  signalements: 'Suivi de mes signalements',
  agenda: 'Agenda et rappels',
  vie_fcpe: 'Vie de la FCPE',
};

export const NOTIFICATION_CATEGORY_DESCRIPTIONS: Record<NotificationCategory, string> = {
  urgent: "Informations critiques concernant l'école. Ne peut pas être désactivé.",
  publications: 'Nouveaux articles publiés par la FCPE ou la mairie.',
  discussions: 'Nouveaux messages et réponses dans les discussions.',
  sondages: 'Nouveaux sondages ouverts à votre participation.',
  signalements: 'Changement de statut sur les signalements que vous avez déposés.',
  agenda: "Rappels avant les événements de l'agenda.",
  vie_fcpe: 'Comptes rendus, réunions et actualités de la FCPE.',
};

export const CHANNEL_TYPE_LABELS: Record<ChannelType, string> = {
  general: 'Général',
  school: 'École',
  level: 'Niveau',
  theme: 'Thématique',
  fcpe: 'Espace FCPE',
};

export const POLL_STATUS_LABELS: Record<PollStatus, string> = {
  draft: 'Brouillon',
  open: 'Ouvert',
  closed: 'Clôturé',
  archived: 'Archivé',
};

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  cantine: 'Cantine',
  securite: 'Sécurité',
  harcelement: 'Harcèlement',
  periscolaire: 'Périscolaire',
  locaux: 'Locaux',
  enseignement: 'Enseignement',
  transport: 'Transport',
  autre: 'Autre',
};

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  received: 'Reçu',
  in_progress: 'Pris en charge par la FCPE',
  forwarded_school: "Transmis à l'école",
  forwarded_city: 'Transmis à la mairie',
  resolved: 'Résolu',
  closed: 'Clôturé',
};

export const REPORT_STATUS_BADGES: Record<ReportStatus, BadgeStyle> = {
  received: BADGE_COLORS.neutral,
  in_progress: BADGE_COLORS.info,
  forwarded_school: BADGE_COLORS.accent,
  forwarded_city: BADGE_COLORS.accent,
  resolved: BADGE_COLORS.success,
  closed: BADGE_COLORS.neutral,
};

/**
 * Description affichée sous chaque étape de la timeline d'un signalement,
 * pour rendre le parcours compréhensible par tous les parents.
 */
export const REPORT_STATUS_HELP: Record<ReportStatus, string> = {
  received: 'Votre signalement a bien été enregistré. La FCPE en a été informée.',
  in_progress: 'Un membre de la FCPE a pris le dossier en charge et le vérifie.',
  forwarded_school: "Le dossier a été transmis à la direction de l'école.",
  forwarded_city: 'Le dossier a été transmis aux services de la mairie.',
  resolved: 'Une solution a été apportée. N’hésitez pas à nous confirmer que tout va bien.',
  closed: 'Le dossier est clos. Il reste consultable dans votre espace.',
};

export const COLLECTIVE_ISSUE_STATUS_LABELS: Record<CollectiveIssueStatus, string> = {
  open: 'En cours de recueil',
  in_progress: 'En cours',
  forwarded_school: "Transmis à l'école",
  forwarded_city: 'Transmis à la mairie',
  validated: 'Validé',
  resolved: 'Résolu',
  rejected: 'Non retenu',
};

export const COLLECTIVE_ISSUE_STATUS_BADGES: Record<CollectiveIssueStatus, BadgeStyle> = {
  open: BADGE_COLORS.info,
  in_progress: BADGE_COLORS.warning,
  forwarded_school: BADGE_COLORS.accent,
  forwarded_city: BADGE_COLORS.accent,
  validated: BADGE_COLORS.success,
  resolved: BADGE_COLORS.success,
  rejected: BADGE_COLORS.neutral,
};

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  conseil_ecole: "Conseil d'école",
  reunion: 'Réunion',
  sortie: 'Sortie scolaire',
  vacances: 'Vacances scolaires',
  kermesse: 'Kermesse',
  election: 'Élection',
  evenement_fcpe: 'Événement FCPE',
  evenement_scolaire: 'Événement scolaire',
  autre: 'Autre',
};

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  compte_rendu: 'Compte rendu',
  flyer: 'Flyer',
  menu: 'Menu de cantine',
  reglement: 'Règlement',
  document_mairie: 'Document mairie',
  document_fcpe: 'Document FCPE',
  autre: 'Autre',
};

export const MODERATION_REASON_LABELS: Record<ModerationReason, string> = {
  spam: 'Spam ou publicité',
  insulte: 'Insulte ou agressivité',
  harcelement: 'Harcèlement',
  hors_sujet: 'Hors sujet',
  donnees_personnelles: 'Données personnelles divulguées',
  contenu_choquant: 'Contenu choquant',
  autre: 'Autre motif',
};

export const MODERATION_STATUS_LABELS: Record<ModerationStatus, string> = {
  open: 'À traiter',
  in_review: 'En cours',
  resolved: 'Traité',
  dismissed: 'Rejeté',
};

export const ATTENDANCE_LABELS = {
  going: 'Je participe',
  not_going: 'Je ne participe pas',
  maybe: 'Peut-être',
} as const;

export const ISSUE_SUPPORT_LABELS = {
  concerned: 'Je suis concerné',
  for: 'Je suis favorable',
  against: 'Je suis défavorable',
} as const;

/** Libellé lisible d'une clé d'audience, utilisé dans les écrans d'administration. */
export function audienceLabel(audience: {
  type: AudienceType;
  level?: ClassLevel | undefined;
  classId?: string | undefined;
}): string {
  switch (audience.type) {
    case 'all':
      return AUDIENCE_TYPE_LABELS.all;
    case 'school':
      return "Toute l'école";
    case 'level':
      return audience.level ? `Niveau ${CLASS_LEVEL_SHORT_LABELS[audience.level]}` : 'Un niveau';
    case 'class':
      return 'Une classe';
    case 'fcpe':
      return AUDIENCE_TYPE_LABELS.fcpe;
  }
}
