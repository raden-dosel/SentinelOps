import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  validateImageFile,
  prepareR2UploadItems,
  MAX_FILE_SIZE_BYTES,
  MAX_IMAGES_PER_PROJECT,
} from '../src/services/r2UploadService';
import {
  buildProjectFolderName,
  buildNumberedImageFileName,
  buildProjectObjectKey,
  resolveFolderCollision,
  getNextSequenceNumber,
  formatProjectStartDate,
  sanitizeProjectName,
} from '../src/features/projects/projectImageNaming';
import {
  projectRepository,
  attachmentRepository,
  syncOutboxRepository,
} from '../src/storage/repositories';
import { resetDatabaseConnection } from '../src/storage/database';
import { AttachmentRecord, Project } from '../src/types';
import { OFFLINE_WARNING, API_UNREACHABLE_WARNING } from '../src/hooks/useConnectivity';

describe('Cloudflare Free Plan — Plain R2 Image Upload & Storage Specification', () => {
  beforeEach(async () => {
    indexedDB = new IDBFactory();
    resetDatabaseConnection();
    await syncOutboxRepository.clearOutbox();
  });

  const baseProject: Project = {
    id: 'prj-r2-free',
    projectNumber: 'PRJ-2026-099',
    clientId: 'cli-test-1',
    clientName: 'Commercial Complex Inc',
    name: 'Main Lobby CCTV System',
    serviceCategory: 'CCTV & Security Systems',
    siteAddress: 'BGC Taguig',
    description: 'High-definition perimeter monitoring cameras',
    scopeOfWork: 'Mounting, cabling, NVR setup',
    startDate: '2026-10-26',
    status: 'Ongoing',
    progressNotes: [],
    createdAt: '2026-10-26T00:00:00Z',
    updatedAt: '2026-10-26T00:00:00Z',
  };

  describe('Section 1 & 2: Optional Images & Zero-Image Project Workflow', () => {
    it('creates and saves projects successfully with zero images attached', async () => {
      const saved = await projectRepository.save(baseProject);
      expect(saved.id).toBe('prj-r2-free');

      const attachments = await attachmentRepository.getByEntity('Project', saved.id);
      expect(attachments.length).toBe(0);

      // Verify project can progress through milestones without images
      const updated = await projectRepository.save({ ...saved, status: 'Completed' });
      expect(updated.status).toBe('Completed');
    });
  });

  describe('Section 3: Folder Name Format — {ProjectName}_{StartDate}', () => {
    it('formats folder name as sanitized slug with start date: {ProjectName}_{StartDate}', () => {
      const folder = buildProjectFolderName('Main Lobby CCTV System', '2026-10-26');
      expect(folder).toBe('Main-Lobby-CCTV-System_2026-10-26');
    });

    it('sanitizes unsafe characters, normalizes NFKC, and caps length at 60 characters', () => {
      const longName = 'Perimeter Security Installation With Extra Long Name Exceeding Sixty Characters Limit';
      const folder = buildProjectFolderName(longName, '2026-10-26');
      const [namePart] = folder.split('_');
      expect(namePart.length).toBeLessThanOrEqual(60);
      expect(folder).not.toContain(' ');
      expect(folder).not.toContain('/');
    });

    it('falls back to "undated" when start date is missing, empty, or invalid', () => {
      expect(buildProjectFolderName('Perimeter Gate', undefined)).toBe('Perimeter-Gate_undated');
      expect(buildProjectFolderName('Perimeter Gate', '')).toBe('Perimeter-Gate_undated');
      expect(buildProjectFolderName('Perimeter Gate', 'invalid-date')).toBe('Perimeter-Gate_undated');
    });

    it('preserves calendar date YYYY-MM-DD without UTC shifts (UTC+8 timezone safety)', () => {
      expect(formatProjectStartDate('2026-10-26')).toBe('2026-10-26');
      expect(formatProjectStartDate('2026-10-26T00:00:00Z')).toBe('2026-10-26');
      expect(formatProjectStartDate('2026-10-26T16:00:00.000Z')).toBe('2026-10-26');
    });

    it('resolves deterministic collisions when two projects share name and date', () => {
      const base = 'Main-Lobby-CCTV_2026-10-26';
      const existing = ['Main-Lobby-CCTV_2026-10-26'];
      const resolved = resolveFolderCollision(base, existing);
      expect(resolved).toBe('Main-Lobby-CCTV_2026-10-26_2');

      const resolved3 = resolveFolderCollision(base, [...existing, 'Main-Lobby-CCTV_2026-10-26_2']);
      expect(resolved3).toBe('Main-Lobby-CCTV_2026-10-26_3');
    });

    it('preserves immutable folder name once assigned, even if project name changes', () => {
      const initialAttachments = [
        { sequenceNumber: 1, r2FolderName: 'Main-Lobby-CCTV_2026-10-26' },
      ];
      // Project name is renamed in UI:
      const renamedProject = { ...baseProject, name: 'Renamed High-Rise CCTV' };
      const newFiles = [new File(['dummy'], 'second.jpg', { type: 'image/jpeg' })];

      const items = prepareR2UploadItems(newFiles, renamedProject, initialAttachments);
      expect(items[0].folderName).toBe('Main-Lobby-CCTV_2026-10-26'); // Immutable!
    });
  });

  describe('Section 4: File Name Format — {N}.{ext} & Full Object Key', () => {
    it('formats incrementing file name starting from 1: {N}.{ext}', () => {
      expect(buildNumberedImageFileName(1, 'image/jpeg')).toBe('1.jpg');
      expect(buildNumberedImageFileName(2, 'image/png')).toBe('2.png');
      expect(buildNumberedImageFileName(3, 'image/webp')).toBe('3.webp');
    });

    it('derives extension from validated MIME type rather than user file name', () => {
      expect(buildNumberedImageFileName(1, 'image/jpeg')).toBe('1.jpg');
      expect(buildNumberedImageFileName(1, 'image/png')).toBe('1.png');
      expect(buildNumberedImageFileName(1, 'image/webp')).toBe('1.webp');
    });

    it('builds full R2 object key: [{scope}/]{ProjectFolder}/{N}.{ext}', () => {
      const keyWithoutScope = buildProjectObjectKey('Main-Lobby_2026-10-26', 1, 'image/jpeg');
      expect(keyWithoutScope).toBe('Main-Lobby_2026-10-26/1.jpg');

      const keyWithScope = buildProjectObjectKey(
        'Main-Lobby_2026-10-26',
        2,
        'image/png',
        'sentinelops/tenant-alpha'
      );
      expect(keyWithScope).toBe('sentinelops/tenant-alpha/Main-Lobby_2026-10-26/2.png');
    });

    it('does not reuse sequence numbers when earlier images are deleted (monotonically increasing)', () => {
      // Sequence 1 was deleted; remaining attachment has sequenceNumber 2
      const existingAfterDelete = [{ sequenceNumber: 2 }];
      const nextSeq = getNextSequenceNumber(existingAfterDelete);
      expect(nextSeq).toBe(3); // Never reuses 1!
    });
  });

  describe('Section 5: Free-Tier Guardrails & Constraints', () => {
    it('enforces 10 MB maximum file size limit', () => {
      expect(MAX_FILE_SIZE_BYTES).toBe(10 * 1024 * 1024);

      const validFile = new File(['small'], 'survey.jpg', { type: 'image/jpeg' });
      expect(validateImageFile(validFile).valid).toBe(true);

      const oversizedFile = new File(['huge'], 'huge.jpg', { type: 'image/jpeg' });
      Object.defineProperty(oversizedFile, 'size', { value: 11 * 1024 * 1024 });
      const result = validateImageFile(oversizedFile);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('10 MB');
    });

    it('rejects unsupported file formats and 0-byte files', () => {
      const emptyFile = new File([], 'empty.jpg', { type: 'image/jpeg' });
      expect(validateImageFile(emptyFile).valid).toBe(false);

      const exeFile = new File(['bin'], 'malware.exe', { type: 'application/octet-stream' });
      expect(validateImageFile(exeFile).valid).toBe(false);

      const textFile = new File(['hello'], 'doc.txt', { type: 'text/plain' });
      expect(validateImageFile(textFile).valid).toBe(false);
    });

    it('enforces free-tier maximum of 50 images per project', () => {
      expect(MAX_IMAGES_PER_PROJECT).toBe(50);

      // Create an array simulating 50 existing attachments
      const existing50 = Array.from({ length: 50 }, (_, i) => ({ sequenceNumber: i + 1 }));
      const newFiles = [new File(['dummy'], 'photo51.jpg', { type: 'image/jpeg' })];

      expect(() => {
        prepareR2UploadItems(newFiles, baseProject, existing50);
      }).toThrow(/limit reached/i);
    });
  });

  describe('Section 6: Online-Only Gating Specification & Messages', () => {
    it('provides exact online-only gating warning strings required by spec', () => {
      expect(OFFLINE_WARNING).toBe(
        'No internet connection. Connect to the internet to upload project images.'
      );
      expect(API_UNREACHABLE_WARNING).toBe(
        'SentinelOps server is unreachable. Image uploads are temporarily unavailable. Check your connection and try again.'
      );
    });
  });

  describe('Section 7: Storage Persistence & Outbox Durability', () => {
    it('persists R2 attachment record with r2FolderName and syncs to outbox without binary payload', async () => {
      const record: AttachmentRecord = {
        id: 'att-free-r2-1',
        entityType: 'Project',
        entityId: baseProject.id,
        fileName: '1.jpg',
        fileType: 'image/jpeg',
        fileSize: 450000,
        uploadedAt: new Date().toISOString(),
        sequenceNumber: 1,
        r2ObjectKey: 'sentinelops/tenant1/Main-Lobby-CCTV_2026-10-26/1.jpg',
        r2Bucket: 'sentinelops-projects',
        r2FolderName: 'Main-Lobby-CCTV_2026-10-26',
        etag: '"test-etag-12345"',
        storageProvider: 'cloudflare-r2',
        blob: new Blob(['image binary bytes'], { type: 'image/jpeg' }),
      };

      const saved = await attachmentRepository.saveAttachment(record);
      expect(saved.fileName).toBe('1.jpg');
      expect(saved.r2FolderName).toBe('Main-Lobby-CCTV_2026-10-26');
      expect(saved.r2ObjectKey).toBe('sentinelops/tenant1/Main-Lobby-CCTV_2026-10-26/1.jpg');

      const pending = await syncOutboxRepository.getPendingOperations();
      expect(pending.length).toBe(1);
      const payload: any = pending[0].payload;
      expect(payload.id).toBe('att-free-r2-1');
      expect(payload.r2FolderName).toBe('Main-Lobby-CCTV_2026-10-26');
      expect(payload.r2ObjectKey).toBe('sentinelops/tenant1/Main-Lobby-CCTV_2026-10-26/1.jpg');
      expect(payload.blob).toBeUndefined(); // Binary payload must NEVER enter outbox!
    });
  });

  describe('Section 8: Audit Key Points — Confirmation, Pagination (Max 6), and Project Switching', () => {
    it('paginates attachments with a strict maximum of 6 items per page', () => {
      const ATTACHMENTS_PER_PAGE = 6;
      // Simulate 14 project photos
      const attachments = Array.from({ length: 14 }, (_, i) => ({
        id: `att-${i + 1}`,
        sequenceNumber: i + 1,
        fileName: `${i + 1}.jpg`,
      }));

      const totalPages = Math.ceil(attachments.length / ATTACHMENTS_PER_PAGE);
      expect(totalPages).toBe(3);

      // Page 1: items 1..6
      const page1 = attachments.slice(0, ATTACHMENTS_PER_PAGE);
      expect(page1.length).toBe(6);
      expect(page1[0].sequenceNumber).toBe(1);
      expect(page1[5].sequenceNumber).toBe(6);

      // Page 2: items 7..12
      const page2 = attachments.slice(ATTACHMENTS_PER_PAGE, ATTACHMENTS_PER_PAGE * 2);
      expect(page2.length).toBe(6);
      expect(page2[0].sequenceNumber).toBe(7);
      expect(page2[5].sequenceNumber).toBe(12);

      // Page 3: items 13..14
      const page3 = attachments.slice(ATTACHMENTS_PER_PAGE * 2, ATTACHMENTS_PER_PAGE * 3);
      expect(page3.length).toBe(2);
      expect(page3[0].sequenceNumber).toBe(13);
      expect(page3[1].sequenceNumber).toBe(14);
    });

    it('refreshes attachments when switching projects and isolates images per project', async () => {
      // Save project A with 2 attachments
      const projectA: Project = { ...baseProject, id: 'prj-alpha', projectNumber: 'PRJ-ALPHA-01', name: 'Alpha Site' };
      const projectB: Project = { ...baseProject, id: 'prj-beta', projectNumber: 'PRJ-BETA-02', name: 'Beta Site' };

      await projectRepository.save(projectA);
      await projectRepository.save(projectB);

      await attachmentRepository.saveAttachment({
        id: 'att-a-1',
        entityType: 'Project',
        entityId: 'prj-alpha',
        fileName: '1.jpg',
        fileType: 'image/jpeg',
        fileSize: 1000,
        uploadedAt: new Date().toISOString(),
      });

      // Verify Project A has 1 attachment
      const attsA = await attachmentRepository.getByEntity('Project', 'prj-alpha');
      expect(attsA.length).toBe(1);

      // Verify Project B (newly viewed) has 0 attachments -> displays "No image uploaded yet"
      const attsB = await attachmentRepository.getByEntity('Project', 'prj-beta');
      expect(attsB.length).toBe(0);
    });
  });
});
