import { describe, expect, it } from 'vitest';
import { hasPermission, ROLE_PERMISSIONS } from './index';

describe('role permissions', () => {
  it('gives parents only parent capabilities', () => {
    expect(
      hasPermission({ role: 'parent', status: 'active' }, 'createReport'),
    ).toBe(true);
    expect(
      hasPermission({ role: 'parent', status: 'active' }, 'manageRoles'),
    ).toBe(false);
  });

  it('blocks every non-active account regardless of role', () => {
    expect(
      hasPermission({ role: 'admin', status: 'suspended' }, 'manageUsers'),
    ).toBe(false);
    expect(
      hasPermission({ role: 'admin', status: 'pending' }, 'manageUsers'),
    ).toBe(false);
  });

  it('keeps role inheritance explicit', () => {
    expect(ROLE_PERMISSIONS.moderator).toContain('accessFcpeArea');
    expect(ROLE_PERMISSIONS.admin).toContain('manageSettings');
  });
});
