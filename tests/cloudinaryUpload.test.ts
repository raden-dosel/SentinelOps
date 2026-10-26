import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  validateImageFile,
  prepareUploadItems,
} from '../src/services/cloudinaryUploadService';
import {
  projectRepository,
  attachmentRepository,
  syncOutboxRepository,
} from '../src/storage/repositories';
import { resetDatabaseConnection } from '../src/storage/database';
import { AttachmentRecord, Project } from '../src/types';

describe('Cloudinary Image Upload & Outbox Durability (Section 6 & 7)', () => {
  beforeEach(async () => {
    indexedDB = new IDBFactory();
    resetDatabaseConnection();
    await syncOutboxRepository.clearOutbox();
  });

  describe('File Validation Constraints', () => {
    it('validates supported image types (JPEG, PNG, WebP)', () => {
      const jpgFile = new File(['fake-jpg'], 'test.jpg', { type: 'image/jpeg' });
      const pngFile = new File(['fake-png'], 'test.png', { type: 'image/png' });
      const webpFile = new File(['fake-webp'], 'test.webp', { type: 'image/webp' });

      expect(validateImageFile(jpgFile).valid).toBe(true);
      expect(validateImageFile(pngFile).valid).toBe(true);
      expect(validateImageFile(webpFile).valid).toBe(true);
    });

    it('rejects unsupported file formats like executable or text files', () => {
      const exeFile = new File(['fake-exe'], 'virus.exe', { type: 'application/x-msdownload' });
      const txtFile = new File(['fake-txt'], 'notes.txt', { type: 'text/plain' });

      expect(validateImageFile(exeFile).valid).toBe(false);
      expect(validateImageFile(txtFile).valid).toBe(false);
    });

    it('rejects empty (0 byte) files', () => {
      const emptyFile = new File([], 'empty.jpg', { type: 'image/jpeg' });
      const result = validateImageFile(emptyFile);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('0 bytes');
    });

    it('rejects files exceeding 15 MB limit', () => {
      const bigFile = new File(['content'], 'big.jpg', { type: 'image/jpeg' });
      Object.defineProperty(bigFile, 'size', { value: 16 * 1024 * 1024 });

      const result = validateImageFile(bigFile);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('15 MB');
    });
  });

  describe('Batch Preparation & Pre-allocated Sequences', () => {
    const project: Project = {
      id: 'prj-batch-1',
      projectNumber: 'PRJ-2026-009',
      clientId: 'cli-1',
      clientName: 'Commercial Tower',
      name: 'Main Gate Access',
      serviceCategory: 'Automatic Gate Installation',
      siteAddress: 'Makati City',
      description: 'Motor installation',
      scopeOfWork: 'Turnover',
      startDate: '2026-10-26',
      status: 'Ongoing',
      progressNotes: [],
      createdAt: '2026-10-26T00:00:00Z',
      updatedAt: '2026-10-26T00:00:00Z',
    };

    it('pre-allocates consecutive numbers in selection order', () => {
      const files = [
        new File(['1'], 'cam1.jpg', { type: 'image/jpeg' }),
        new File(['2'], 'cam2.jpg', { type: 'image/jpeg' }),
        new File(['3'], 'cam3.jpg', { type: 'image/jpeg' }),
      ];

      const items = prepareUploadItems(files, project, []);
      expect(items.length).toBe(3);
      expect(items[0].sequenceNumber).toBe(1);
      expect(items[0].displayName).toBe('Main-Gate-Access_2026-10-26_1.jpg');

      expect(items[1].sequenceNumber).toBe(2);
      expect(items[1].displayName).toBe('Main-Gate-Access_2026-10-26_2.jpg');

      expect(items[2].sequenceNumber).toBe(3);
      expect(items[2].displayName).toBe('Main-Gate-Access_2026-10-26_3.jpg');
    });
  });

  describe('Durable Persistence & Outbox Enqueue', () => {
    it('persists attachment metadata and enqueues to syncOutbox without binary blob bloat', async () => {
      const attRecord: AttachmentRecord = {
        id: 'att-cloud-123',
        entityType: 'Project',
        entityId: 'prj-cloud-99',
        fileName: 'Main-Gate-Access_2026-10-26_1.jpg',
        fileType: 'image/jpeg',
        fileSize: 45000,
        uploadedAt: new Date().toISOString(),
        sequenceNumber: 1,
        cloudinaryPublicId: 'sentinelops/tenant1/projects/prj-cloud-99/att-cloud-123',
        cloudinaryUrl: 'https://res.cloudinary.com/test/image/upload/v1/test.jpg',
        storageProvider: 'cloudinary',
        blob: new Blob(['image bytes'], { type: 'image/jpeg' }),
      };

      const saved = await attachmentRepository.saveAttachment(attRecord);
      expect(saved.id).toBe('att-cloud-123');
      expect(saved.sequenceNumber).toBe(1);
      expect(saved.storageProvider).toBe('cloudinary');

      // Verify syncOutbox entry
      const pendingOps = await syncOutboxRepository.getPendingOperations();
      expect(pendingOps.length).toBe(1);

      const op = pendingOps[0];
      expect(op.entityType).toBe('Attachment');
      expect(op.entityId).toBe('att-cloud-123');
      expect(op.operation).toBe('upsert');

      // Verify payload contains metadata but NOT binary blob
      const payload: any = op.payload;
      expect(payload.id).toBe('att-cloud-123');
      expect(payload.cloudinaryPublicId).toBe('sentinelops/tenant1/projects/prj-cloud-99/att-cloud-123');
      expect(payload.cloudinaryUrl).toBe('https://res.cloudinary.com/test/image/upload/v1/test.jpg');
      expect(payload.sequenceNumber).toBe(1);
      expect(payload.blob).toBeUndefined(); // blob must never be serialized into syncOutbox!
    });

    it('preserves offline local-only attachment functionality', async () => {
      const localRecord: AttachmentRecord = {
        id: 'att-local-1',
        entityType: 'Project',
        entityId: 'prj-local-1',
        fileName: 'site-photo.jpg',
        fileType: 'image/jpeg',
        fileSize: 12000,
        uploadedAt: new Date().toISOString(),
        storageProvider: 'local',
        blob: new Blob(['local data'], { type: 'image/jpeg' }),
      };

      const saved = await attachmentRepository.saveAttachment(localRecord);
      expect(saved.id).toBe('att-local-1');
      expect(saved.storageProvider).toBe('local');
      expect(saved.sequenceNumber).toBe(1); // auto assigned in transaction
    });
  });
});
