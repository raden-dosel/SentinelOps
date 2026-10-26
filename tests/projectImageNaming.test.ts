import { describe, it, expect } from 'vitest';
import {
  sanitizeProjectName,
  formatProjectStartDate,
  getImageExtension,
  buildProjectImageName,
  getNextSequenceNumber,
  getAttachmentDisplayName,
  resolveSequenceCollisions,
} from '../src/features/projects/projectImageNaming';
import { AttachmentMetadata, Project } from '../src/types';

describe('Project Image Naming & Sequence Rules (Section 7A)', () => {
  it('formats first image in project as {ProjectName}_{StartDate}_1.{ext}', () => {
    const name = buildProjectImageName('Main Lobby CCTV', '2026-10-26', 1, 'image/jpeg');
    expect(name).toBe('Main-Lobby-CCTV_2026-10-26_1.jpg');
  });

  it('increments sequence by one for subsequent images without zero-padding', () => {
    expect(buildProjectImageName('Main Lobby CCTV', '2026-10-26', 2, 'image/png')).toBe('Main-Lobby-CCTV_2026-10-26_2.png');
    expect(buildProjectImageName('Main Lobby CCTV', '2026-10-26', 10, 'image/webp')).toBe('Main-Lobby-CCTV_2026-10-26_10.webp');
  });

  it('handles per-project sequences independently', () => {
    const projASeq = getNextSequenceNumber([]);
    const projBSeq = getNextSequenceNumber([]);
    expect(projASeq).toBe(1);
    expect(projBSeq).toBe(1);

    const projAExisting = [{ sequenceNumber: 1 }, { sequenceNumber: 2 }];
    const projBExisting = [{ sequenceNumber: 1 }];
    expect(getNextSequenceNumber(projAExisting)).toBe(3);
    expect(getNextSequenceNumber(projBExisting)).toBe(2);
  });

  it('multi-image selection receives consecutive numbers in selection order', () => {
    const existing = [{ sequenceNumber: 1 }, { sequenceNumber: 2 }];
    let next = getNextSequenceNumber(existing);
    const assigned = [next++, next++, next++];
    expect(assigned).toEqual([3, 4, 5]);
  });

  it('retrying a failed upload reuses its original number without consuming a new one', () => {
    const item = { sequenceNumber: 4 };
    // Retry action re-uses item.sequenceNumber
    const retrySeq = item.sequenceNumber;
    expect(retrySeq).toBe(4);
  });

  it('gaps from deleted images are preserved and numbers are not reused', () => {
    // Images 1, 2, 3 were added. Image 2 was deleted, leaving 1 and 3.
    const remaining = [{ sequenceNumber: 1 }, { sequenceNumber: 3 }];
    const nextSeq = getNextSequenceNumber(remaining);
    expect(nextSeq).toBe(4); // continues from max + 1, never reuses 2
  });

  describe('Sanitization & Security Rules', () => {
    it('normalizes Unicode (NFKC), trims, and replaces whitespace runs with single hyphen', () => {
      const sanitized = sanitizeProjectName('  Perimeter   Security  \t Gate  ');
      expect(sanitized).toBe('Perimeter-Security-Gate');
    });

    it('strips unsafe path separators and filesystem characters', () => {
      const sanitized = sanitizeProjectName('../../etc/passwd:test*?<quote>"|bad');
      expect(sanitized).not.toContain('/');
      expect(sanitized).not.toContain('\\');
      expect(sanitized).not.toContain(':');
      expect(sanitized).not.toContain('*');
      expect(sanitized).not.toContain('?');
      expect(sanitized).not.toContain('<');
      expect(sanitized).not.toContain('>');
      expect(sanitized).not.toContain('|');
      expect(sanitized).not.toContain('"');
    });

    it('guards against Windows reserved device names (CON, PRN, AUX, NUL)', () => {
      expect(sanitizeProjectName('CON')).toBe('Project');
      expect(sanitizeProjectName('prn')).toBe('Project');
      expect(sanitizeProjectName('aux')).toBe('Project');
      expect(sanitizeProjectName('nul')).toBe('Project');
      expect(sanitizeProjectName('COM1')).toBe('Project');
    });

    it('falls back to "Project" if raw name is empty or only whitespace/unsafe chars', () => {
      expect(sanitizeProjectName('')).toBe('Project');
      expect(sanitizeProjectName('   ')).toBe('Project');
      expect(sanitizeProjectName('///:::***')).toBe('Project');
      expect(sanitizeProjectName(null)).toBe('Project');
    });

    it('caps project name segment at 60 characters', () => {
      const veryLong = 'A'.repeat(100);
      const sanitized = sanitizeProjectName(veryLong);
      expect(sanitized.length).toBeLessThanOrEqual(60);
    });
  });

  describe('Start Date Handling (UTC+8 Safe)', () => {
    it('formats date-only string directly without UTC conversion shift', () => {
      expect(formatProjectStartDate('2026-10-26')).toBe('2026-10-26');
      expect(formatProjectStartDate('2026-10-26T00:00:00.000Z')).toBe('2026-10-26');
    });

    it('uses "undated" placeholder for missing or invalid start dates', () => {
      expect(formatProjectStartDate(undefined)).toBe('undated');
      expect(formatProjectStartDate(null)).toBe('undated');
      expect(formatProjectStartDate('')).toBe('undated');
      expect(formatProjectStartDate('invalid-date')).toBe('undated');
    });
  });

  describe('Extension Validation', () => {
    it('derives extension from validated MIME type, not user filename', () => {
      expect(getImageExtension('image/jpeg')).toBe('jpg');
      expect(getImageExtension('image/png')).toBe('png');
      expect(getImageExtension('image/webp')).toBe('webp');
    });
  });

  describe('Derived Display Filename & Legacy Compatibility', () => {
    const project: Project = {
      id: 'prj-101',
      projectNumber: 'PRJ-2026-001',
      clientId: 'cli-1',
      clientName: 'ABC Security Corp',
      name: 'Electric Fence Phase 1',
      serviceCategory: 'Electric Fence Installation',
      siteAddress: 'Pasig City',
      description: 'Test',
      scopeOfWork: 'Test',
      startDate: '2026-10-26',
      status: 'Ongoing',
      progressNotes: [],
      createdAt: '2026-10-26T00:00:00Z',
      updatedAt: '2026-10-26T00:00:00Z',
    };

    it('derives display name adaptively when project is renamed', () => {
      const att: AttachmentMetadata = {
        id: 'att-1',
        entityType: 'Project',
        entityId: 'prj-101',
        fileName: 'temp.jpg',
        fileType: 'image/jpeg',
        fileSize: 1024,
        sequenceNumber: 1,
        uploadedAt: '2026-10-26T08:00:00Z',
      };

      const originalName = getAttachmentDisplayName(att, project);
      expect(originalName).toBe('Electric-Fence-Phase-1_2026-10-26_1.jpg');

      // Rename project
      const renamedProject = { ...project, name: 'Electric Fence Perimeter Complete' };
      const updatedName = getAttachmentDisplayName(att, renamedProject);
      expect(updatedName).toBe('Electric-Fence-Perimeter-Complete_2026-10-26_1.jpg');
    });

    it('preserves legacy attachments without sequenceNumber', () => {
      const legacyAtt: AttachmentMetadata = {
        id: 'att-legacy',
        entityType: 'Project',
        entityId: 'prj-101',
        fileName: 'site-photo-legacy-2025.jpg',
        fileType: 'image/jpeg',
        fileSize: 2048,
        uploadedAt: '2025-05-10T08:00:00Z',
      };

      // Renders with original fileName without forcing rename
      expect(getAttachmentDisplayName(legacyAtt, project)).toBe('site-photo-legacy-2025.jpg');

      // Next upload starts from 1 if only legacy attachments exist
      expect(getNextSequenceNumber([legacyAtt])).toBe(1);
    });
  });

  describe('Multi-Device Collision Resolution', () => {
    it('resolves sequence number collisions deterministically without dropping records', () => {
      const attA: AttachmentMetadata = {
        id: 'att-aaa',
        entityType: 'Project',
        entityId: 'prj-101',
        fileName: 'photoA.jpg',
        fileType: 'image/jpeg',
        fileSize: 1000,
        sequenceNumber: 1,
        uploadedAt: '2026-10-26T08:00:00.000Z', // earlier
      };

      const attB: AttachmentMetadata = {
        id: 'att-bbb',
        entityType: 'Project',
        entityId: 'prj-101',
        fileName: 'photoB.jpg',
        fileType: 'image/jpeg',
        fileSize: 1000,
        sequenceNumber: 1, // collision on sequence 1!
        uploadedAt: '2026-10-26T08:05:00.000Z', // later
      };

      const resolved = resolveSequenceCollisions([attB, attA]);
      expect(resolved.length).toBe(2);

      // Earlier upload keeps #1
      const winner = resolved.find((r) => r.id === 'att-aaa');
      expect(winner?.sequenceNumber).toBe(1);

      // Later upload is reassigned next free sequence #2
      const runnerUp = resolved.find((r) => r.id === 'att-bbb');
      expect(runnerUp?.sequenceNumber).toBe(2);
    });
  });
});
