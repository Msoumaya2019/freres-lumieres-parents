import { describe, expect, it } from 'vitest';
import { hasPermission } from './index';

describe('member permissions', () => {
  it('keeps public access outside the authenticated role model', () =>
    expect(hasPermission(null, 'accessFcpeArea')).toBe(false));
  it('limits FCPE members to member permissions', () => {
    expect(
      hasPermission({ role: 'fcpe', status: 'active' }, 'accessFcpeArea'),
    ).toBe(true);
    expect(
      hasPermission({ role: 'fcpe', status: 'active' }, 'manageRoles'),
    ).toBe(false);
  });
  it('denies pending memberships', () =>
    expect(
      hasPermission({ role: 'admin', status: 'pending' }, 'manageMembers'),
    ).toBe(false));
});
