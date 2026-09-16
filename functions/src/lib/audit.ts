/**
 * Journal d'audit.
 *
 * Toute action sensible doit laisser une trace **non falsifiable**. Les règles
 * Firestore interdisent toute écriture cliente dans `adminLogs` : seule une
 * Cloud Function peut y écrire. Un journal qu'un administrateur pourrait
 * modifier n'aurait aucune valeur en cas de litige.
 */
import { FieldValue } from 'firebase-admin/firestore';

import type { AdminAction, UserRole } from '@fl/types';

import { adminDb } from './admin.js';
import { COLLECTIONS } from './paths.js';

export interface AuditEntry {
  /** Identifiant de l'auteur de l'action. */
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  action: AdminAction;
  /** Type de la ressource visée : `user`, `post`, `report`… */
  targetType: string;
  targetId: string;
  /**
   * Contexte utile à l'audit. Pour un changement de rôle, on y place la
   * valeur avant et après : c'est ce qui permet de reconstituer l'historique.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Écrit une entrée d'audit.
 *
 * Ne lève jamais d'exception : un échec de journalisation ne doit pas faire
 * échouer l'action elle-même. L'erreur est journalisée côté serveur, ce qui
 * la rend visible dans les logs Cloud sans casser le parcours utilisateur.
 */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await adminDb()
      .collection(COLLECTIONS.adminLogs)
      .add({
        actorId: entry.actorId,
        actorName: entry.actorName,
        actorRole: entry.actorRole,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        metadata: entry.metadata ?? {},
        at: FieldValue.serverTimestamp(),
      });
  } catch (error) {
    console.error('[audit] Impossible d’écrire le journal d’audit', {
      action: entry.action,
      targetId: entry.targetId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Construit le contexte « avant / après » d'un changement de valeur. */
export function diffContext(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
): Record<string, { before: unknown; after: unknown }> {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const field of fields) {
    if (before[field] !== after[field]) {
      changes[field] = { before: before[field], after: after[field] };
    }
  }
  return changes;
}
