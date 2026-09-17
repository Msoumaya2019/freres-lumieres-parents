import { describe, expect, it } from 'vitest';
import { documentSchema, schoolCouncilSchema } from './index';

const timestamp = { seconds: 1_789_000_000, nanoseconds: 0 };

describe('public content validation', () => {
  it('accepts a bounded public document', () => {
    expect(
      documentSchema.safeParse({
        id: 'flyer-1',
        organizationId: 'freres-lumieres',
        title: 'Flyer de bienvenue',
        category: 'flyer',
        year: 2026,
        audience: { type: 'all', ids: [] },
        storagePath: 'documents/flyer-1/flyer.png',
        contentType: 'image/png',
        sizeBytes: 1_024,
        published: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      }).success,
    ).toBe(true);
  });

  it('rejects oversized or unsupported public files', () => {
    const base = {
      id: 'document-1',
      organizationId: 'freres-lumieres',
      title: 'Document',
      category: 'other',
      year: 2026,
      audience: { type: 'all', ids: [] },
      storagePath: 'documents/document-1/file.exe',
      published: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    expect(
      documentSchema.safeParse({
        ...base,
        contentType: 'application/octet-stream',
        sizeBytes: 11 * 1024 * 1024,
      }).success,
    ).toBe(false);
  });

  it('rejects unbounded council agenda data', () => {
    expect(
      schoolCouncilSchema.safeParse({
        id: 'council-1',
        organizationId: 'freres-lumieres',
        schoolId: 'elementary',
        title: 'Conseil d’école',
        scheduledAt: timestamp,
        publicAgenda: Array.from(
          { length: 31 },
          (_, index) => `Point ${index}`,
        ),
        publicDecisions: [],
        publicDocumentIds: [],
        audience: { type: 'school', ids: ['elementary'] },
        published: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      }).success,
    ).toBe(false);
  });
});
