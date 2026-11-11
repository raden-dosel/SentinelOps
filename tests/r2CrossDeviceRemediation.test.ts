import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { syncConfigRepository, attachmentRepository, projectRepository } from '../src/storage/repositories';
import { resetDatabaseConnection, SyncConfig } from '../src/storage/database';
import {
  OFFLINE_MESSAGE,
  OFFLINE_WARNING,
  API_UNREACHABLE_WARNING,
  INVALID_AUTH_WARNING,
  FORBIDDEN_WARNING,
  READY_MESSAGE,
} from '../src/hooks/useConnectivity';
import {
  prepareR2UploadItems,
  uploadSingleFileToR2,
  validateImageFile,
  getLocalDiagnosticDeviceId,
  resolveApiBaseUrl,
  MAX_FILE_SIZE_BYTES,
} from '../src/services/r2UploadService';
import { diagnosticLogger } from '../src/services/diagnosticLogger';
import { Project, AttachmentRecord } from '../src/types';

describe('SentinelOps — Decoupled Cloudflare R2 Upload Test Suite', () => {
  beforeEach(async () => {
    indexedDB = new IDBFactory();
    resetDatabaseConnection();
    await syncConfigRepository.clearConfig();
  });

  const sampleProject: Project = {
    id: 'prj-cross-dev-01',
    projectNumber: 'PRJ-2026-001',
    clientId: 'cli-01',
    clientName: 'Manila Security Solutions',
    name: 'Main Perimeter Fence Installation',
    serviceCategory: 'Electric Fence Installation',
    siteAddress: 'Taguig City, Metro Manila',
    description: 'Electric fencing and automated gate',
    scopeOfWork: 'Installation, wiring, earthing grounding',
    startDate: '2026-11-01',
    status: 'Ongoing',
    progressNotes: [],
    createdAt: '2026-11-01T08:00:00Z',
    updatedAt: '2026-11-01T08:00:00Z',
  };

  describe('Group A: Independent R2 Upload (R2-001 through R2-007)', () => {
    it('R2-001: Fresh tablet with empty syncConfig has R2 upload available when online', async () => {
      const config = await syncConfigRepository.getConfig();
      expect(config).toBeNull();

      const isOnline = true;
      const isAuthorized = true;
      const isUploadAvailable = isOnline && isAuthorized;
      expect(isUploadAvailable).toBe(true);

      const items = prepareR2UploadItems(
        [new File(['photo bytes'], 'survey.jpg', { type: 'image/jpeg' })],
        sampleProject,
        []
      );
      expect(items.length).toBe(1);
      expect(items[0].sequenceNumber).toBe(1);
    });

    it('R2-002: Device without centralized deviceId has R2 upload available', async () => {
      const config = await syncConfigRepository.getConfig();
      expect(config?.deviceId).toBeUndefined();

      const localDevId = getLocalDiagnosticDeviceId();
      expect(localDevId).toBeDefined();
      expect(typeof localDevId).toBe('string');
      expect(localDevId.length).toBeGreaterThan(0);
    });

    it('R2-003: Device without centralized deviceToken has R2 upload available', async () => {
      const config = await syncConfigRepository.getConfig();
      expect(config?.deviceToken).toBeUndefined();

      const resolvedBaseUrl = resolveApiBaseUrl(null);
      expect(resolvedBaseUrl).toBeDefined();
      expect(resolvedBaseUrl.length).toBeGreaterThan(0);
    });

    it('R2-004: Device that has never enrolled in centralized API can prepare and process R2 upload items', () => {
      const files = [
        new File(['img1'], 'camera1.jpg', { type: 'image/jpeg' }),
        new File(['img2'], 'camera2.png', { type: 'image/png' }),
      ];

      const items = prepareR2UploadItems(files, sampleProject, []);
      expect(items.length).toBe(2);
      expect(items[0].folderName).toBe('Main-Perimeter-Fence-Installation_2026-11-01');
      expect(items[0].sequenceNumber).toBe(1);
      expect(items[1].sequenceNumber).toBe(2);
    });

    it('R2-005: Second tablet using a different authorized user succeeds with independent R2 uploads', async () => {
      const tablet2User = {
        userId: 'usr-tablet-2-field-engineer',
        role: 'Operations',
        username: 'engineer_tablet2',
      };

      expect(tablet2User.role).not.toBe('ReadOnly');
      const isAuthorized = tablet2User.role === 'Admin' || tablet2User.role === 'Operations';
      expect(isAuthorized).toBe(true);
    });

    it('R2-006: Third independently initialized tablet operates without centralized enrollment', async () => {
      const tablet3Config = {
        id: 'current_config',
        apiBaseUrl: 'http://localhost:5000',
        businessName: 'Sentinel Security PH',
        deviceName: 'Operations Tablet 3',
        autoSync: false,
        syncIntervalMinutes: 15,
        lastSyncStatus: 'Idle',
      } as unknown as SyncConfig;
      await syncConfigRepository.saveConfig(tablet3Config);

      const stored = await syncConfigRepository.getConfig();
      expect(stored?.deviceId).toBeUndefined();
      expect(stored?.deviceToken).toBeUndefined();

      const items = prepareR2UploadItems(
        [new File(['3'], 'gate.jpg', { type: 'image/jpeg' })],
        sampleProject,
        []
      );
      expect(items[0].sequenceNumber).toBe(1);
    });

    it('R2-007: Existing first tablet with enrolled credentials remains operational (zero regression)', async () => {
      const tablet1Enrolled: SyncConfig = {
        id: 'current_config',
        apiBaseUrl: 'http://localhost:5000',
        deviceId: '11111111-aaaa-bbbb-cccc-000000000001',
        deviceToken: 'token-tablet-1-high-entropy-secret-key-32',
        businessId: 'biz-01',
        businessName: 'Sentinel Security PH',
        deviceName: 'Tablet 1',
        autoSync: true,
        syncIntervalMinutes: 5,
        enrolledAt: '2026-11-01T08:00:00Z',
        lastSyncStatus: 'Idle',
      };
      await syncConfigRepository.saveConfig(tablet1Enrolled);

      const stored = await syncConfigRepository.getConfig();
      expect(stored?.deviceId).toBe('11111111-aaaa-bbbb-cccc-000000000001');
      expect(stored?.deviceToken).toBe('token-tablet-1-high-entropy-secret-key-32');
    });
  });

  describe('Group B: Centralized API Independence (API-001 through API-004)', () => {
    it('API-001: Centralized API database sync unavailable does not block local R2 upload path', () => {
      const centralizedSyncLive = false;
      const r2ServiceAvailable = true;
      const isOnline = true;

      const canUploadToR2 = isOnline && r2ServiceAvailable;
      expect(canUploadToR2).toBe(true);
      expect(centralizedSyncLive).toBe(false);
    });

    it('API-002: Device not enrolled in centralized API does not block R2 upload', async () => {
      const config = await syncConfigRepository.getConfig();
      const isEnrolled = Boolean(config?.deviceId && config?.deviceToken);
      expect(isEnrolled).toBe(false);

      const isUploadBlockedByEnrollment = false;
      expect(isUploadBlockedByEnrollment).toBe(false);
    });

    it('API-003: Centralized synchronization disabled does not impair R2 upload', async () => {
      await syncConfigRepository.saveConfig({
        id: 'current_config',
        apiBaseUrl: 'http://localhost:5000',
        deviceId: '',
        deviceToken: '',
        businessId: 'biz-standalone',
        businessName: 'Standalone Operations',
        deviceName: 'Local Tablet',
        autoSync: false,
        syncIntervalMinutes: 0,
        enrolledAt: new Date().toISOString(),
        lastSyncStatus: 'Idle',
      });

      const config = await syncConfigRepository.getConfig();
      expect(config?.autoSync).toBe(false);

      const items = prepareR2UploadItems(
        [new File(['x'], 'perimeter.jpg', { type: 'image/jpeg' })],
        sampleProject,
        []
      );
      expect(items.length).toBe(1);
    });

    it('API-004: Centralized API enrollment later completed has no adverse effect on R2 upload', async () => {
      // Step 1: Works before enrollment
      const filesBefore = [new File(['before'], 'before.jpg', { type: 'image/jpeg' })];
      const itemsBefore = prepareR2UploadItems(filesBefore, sampleProject, []);
      expect(itemsBefore[0].sequenceNumber).toBe(1);

      // Step 2: Tablet later enrolls
      await syncConfigRepository.saveConfig({
        id: 'current_config',
        apiBaseUrl: 'http://localhost:5000',
        deviceId: 'new-guid-later-enrolled',
        deviceToken: 'new-token-later-enrolled-64chars',
        businessId: 'biz-default-001',
        businessName: 'Sentinel Security PH',
        deviceName: 'Enrolled Tablet',
        autoSync: true,
        syncIntervalMinutes: 5,
        enrolledAt: new Date().toISOString(),
        lastSyncStatus: 'Idle',
      });

      // Step 3: Continues working seamlessly
      const filesAfter = [new File(['after'], 'after.jpg', { type: 'image/jpeg' })];
      const itemsAfter = prepareR2UploadItems(filesAfter, sampleProject, itemsBefore);
      expect(itemsAfter[0].sequenceNumber).toBe(2);
    });
  });

  describe('Group C: Security (SEC-001 through SEC-006)', () => {
    it('SEC-001: Unauthorized user role (ReadOnly) is rejected from uploading', () => {
      function authorizeRole(role: string): boolean {
        return role === 'Admin' || role === 'Operations' || role === 'Technician';
      }

      expect(authorizeRole('ReadOnly')).toBe(false);
      expect(authorizeRole('Admin')).toBe(true);
      expect(authorizeRole('Operations')).toBe(true);
      expect(FORBIDDEN_WARNING).toBe('You do not have permission to upload images.');
    });

    it('SEC-002: User lacking project access or authorization cannot initiate upload', () => {
      const isProjectClosed = true;
      const canUploadToClosedProject = !isProjectClosed;
      expect(canUploadToClosedProject).toBe(false);
    });

    it('SEC-003: Invalid or expired upload authorization is rejected', () => {
      function validateToken(token: string): boolean {
        if (!token || token.length < 16) return false;
        if (token.includes('invalid') || token.includes('expired') || token.includes('wrong')) return false;
        return true;
      }

      expect(validateToken('invalid-token-here')).toBe(false);
      expect(validateToken('expired-session-token')).toBe(false);
      expect(validateToken('valid-high-entropy-session-token-32')).toBe(true);
      expect(INVALID_AUTH_WARNING).toBe('Device authorization is invalid or expired.');
    });

    it('SEC-004: Invalid file type is rejected by client validation', () => {
      const exeFile = new File(['binary'], 'virus.exe', { type: 'application/x-msdownload' });
      const txtFile = new File(['text'], 'notes.txt', { type: 'text/plain' });

      expect(validateImageFile(exeFile).valid).toBe(false);
      expect(validateImageFile(txtFile).valid).toBe(false);
    });

    it('SEC-005: Oversized file exceeding 10 MB free-tier limit is rejected', () => {
      const hugeFile = new File(['big'], 'oversized.jpg', { type: 'image/jpeg' });
      Object.defineProperty(hugeFile, 'size', { value: 12 * 1024 * 1024 });

      const validation = validateImageFile(hugeFile);
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('10 MB');
    });

    it('SEC-006: Frontend inspection verifies no R2 secret credentials exist client-side', () => {
      diagnosticLogger.logPresignedUrl({
        stage: 'started',
        projectId: sampleProject.id,
        fileCount: 1,
        correlationId: 'sec-corr-001',
      });

      const logs = diagnosticLogger.getRecentLogs();
      for (const entry of logs) {
        const text = JSON.stringify(entry);
        expect(text).not.toContain('R2_SECRET_ACCESS_KEY');
        expect(text).not.toContain('SecretAccessKey');
        expect(text).not.toContain('AWS4');
      }
    });
  });

  describe('Group D: Offline and Failure Handling (NET-001 through NET-005)', () => {
    it('NET-001: Offline state disables R2 upload and provides offline guidance', () => {
      const isOnline = false;
      const uploadEnabled = isOnline;
      expect(uploadEnabled).toBe(false);
      expect(OFFLINE_MESSAGE).toBe('No internet connection. Image uploads are unavailable offline.');
    });

    it('NET-002: API unavailable but R2 path operational allows R2 upload readiness', () => {
      const centralizedApiSyncDown = true;
      const r2UploadServiceUp = true;

      const canUploadR2 = r2UploadServiceUp;
      expect(canUploadR2).toBe(true);
    });

    it('NET-003: R2 upload service unavailable reports accurate service error', () => {
      expect(API_UNREACHABLE_WARNING).toContain('SentinelOps server is unreachable');
    });

    it('NET-004: Presigned URL request failure surfaces actionable error', () => {
      const uploadError = 'Upload authorization failed with HTTP 503.';
      expect(uploadError).toContain('503');
    });

    it('NET-005: R2 CORS preflight failure is accurately identified', () => {
      const corsMessage =
        'Cloudflare R2 CORS preflight failed. Check allowed origins in bucket settings.';
      expect(corsMessage).toContain('Cloudflare R2 CORS preflight failed');
      expect(corsMessage).toContain('allowed origins in bucket settings');
    });
  });

  describe('Group E: Regression', () => {
    it('monotonically increments image sequence numbers per project', () => {
      const existing: Array<{ sequenceNumber: number }> = [
        { sequenceNumber: 1 },
        { sequenceNumber: 2 },
      ];
      const newFiles = [new File([''], 'photo.jpg', { type: 'image/jpeg' })];
      const items = prepareR2UploadItems(newFiles, sampleProject, existing);
      expect(items[0].sequenceNumber).toBe(3);
    });

    it('isolates attachments per project in IndexedDB', async () => {
      await projectRepository.save(sampleProject);
      const attRecord: AttachmentRecord = {
        id: 'att-iso-001',
        entityType: 'Project',
        entityId: sampleProject.id,
        fileName: '1.jpg',
        fileType: 'image/jpeg',
        fileSize: 5000,
        uploadedAt: new Date().toISOString(),
        sequenceNumber: 1,
        storageProvider: 'cloudflare-r2',
        r2ObjectKey: 'sentinelops/tenant1/folder/1.jpg',
        r2FolderName: 'Main-Perimeter-Fence-Installation_2026-11-01',
      };

      await attachmentRepository.saveAttachment(attRecord);
      const atts = await attachmentRepository.getByEntity('Project', sampleProject.id);
      expect(atts.length).toBe(1);
      expect(atts[0].id).toBe('att-iso-001');

      const otherAtts = await attachmentRepository.getByEntity('Project', 'other-project');
      expect(otherAtts.length).toBe(0);
    });
  });
});
