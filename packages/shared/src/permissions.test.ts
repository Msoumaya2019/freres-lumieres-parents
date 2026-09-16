import { describe, expect, it } from 'vitest';

import {
  ALL_PERMISSIONS,
  PERMISSION_MATRIX,
  ROLE_PERMISSIONS,
  hasPermission,
} from './permissions.js';
import { MANDATORY_NOTIFICATION_CATEGORIES } from './constants.js';

describe('matrice de permissions', () => {
  it('déclare chaque permission pour au moins un rôle', () => {
    for (const [permission, roles] of Object.entries(PERMISSION_MATRIX)) {
      expect(roles.length, `${permission} n'est accordée à aucun rôle`).toBeGreaterThan(0);
    }
  });

  it('ne donne aucune permission d’administration à un parent', () => {
    const parentPermissions = ROLE_PERMISSIONS.parent;
    const forbidden = [
      'post.create',
      'post.delete.any',
      'user.approve',
      'user.role.change',
      'user.delete',
      'settings.update',
      'audit.read',
      'moderation.queue.read',
      'fcpe.access',
      'report.read.any',
    ] as const;

    for (const permission of forbidden) {
      expect(
        parentPermissions.has(permission),
        `un parent ne doit pas pouvoir « ${permission} »`,
      ).toBe(false);
    }
  });

  it('réserve les actions les plus sensibles à l’administrateur', () => {
    const adminOnly = [
      'user.approve',
      'user.role.change',
      'user.delete',
      'user.export',
      'settings.update',
      'audit.read',
      'channel.create',
      'channel.delete',
    ] as const;

    for (const permission of adminOnly) {
      expect(PERMISSION_MATRIX[permission]).toEqual(['admin']);
    }
  });

  it('autorise un modérateur à masquer du contenu mais pas à supprimer un compte', () => {
    expect(hasPermission('moderator', 'comment.hide.any')).toBe(true);
    expect(hasPermission('moderator', 'message.hide.any')).toBe(true);
    expect(hasPermission('moderator', 'user.suspend')).toBe(true);
    expect(hasPermission('moderator', 'user.delete')).toBe(false);
    expect(hasPermission('moderator', 'user.role.change')).toBe(false);
  });

  it('autorise la FCPE à publier et à répondre aux signalements', () => {
    expect(hasPermission('fcpe', 'post.create')).toBe(true);
    expect(hasPermission('fcpe', 'report.read.any')).toBe(true);
    expect(hasPermission('fcpe', 'report.reply.internal')).toBe(true);
    expect(hasPermission('fcpe', 'poll.create')).toBe(true);
  });

  it('autorise tous les rôles validés à participer aux discussions et aux sondages', () => {
    for (const role of ['parent', 'fcpe', 'moderator', 'admin'] as const) {
      expect(hasPermission(role, 'comment.create')).toBe(true);
      expect(hasPermission(role, 'message.create')).toBe(true);
      expect(hasPermission(role, 'poll.vote')).toBe(true);
      expect(hasPermission(role, 'report.create')).toBe(true);
      expect(hasPermission(role, 'council.item.propose')).toBe(true);
    }
  });

  it('refuse tout pour un rôle absent ou inconnu', () => {
    expect(hasPermission(undefined, 'comment.create')).toBe(false);
    expect(hasPermission(null, 'post.create')).toBe(false);
  });

  it('couvre l’ensemble des permissions déclarées sans doublon', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    expect(ALL_PERMISSIONS.length).toBeGreaterThan(40);
  });
});

describe('catégories de notifications', () => {
  it('protège les alertes urgentes', () => {
    expect(MANDATORY_NOTIFICATION_CATEGORIES).toContain('urgent');
  });
});
