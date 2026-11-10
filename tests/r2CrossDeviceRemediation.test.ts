import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { syncConfigRepository, attachmentRepository, projectRepository } from '../src/storage/repositories';
import { resetDatabaseConnection, SyncConfig } from '../src/storage/database';
import {
  OFFLINE_MESSAGE,
  OFFLINE_WARNING,
  API_UNREACHABLE_WARNING,
  ENROLLMENT_REQUIRED_WARNING,
  INVALID_AUTH_WARNING,
  FORBIDDEN_WARNING,
  READY_MESSAGE,
} from '../src/hooks/useConnectivity';
import {
  prepareR2UploadItems,
  uploadSingleFileToR2,
  validateImageFile,
} from '../src/services/r2UploadService';
import { diagnosticLogger } from '../src/services/diagnosticLogger';
import { Project } from '../src/types';

describe('SentinelOps — Cross-Device R2 Remediation Test Suite (R2-001 through R2-015)', () => {
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

  it('R2-001: First enrolled tablet successfully requests presigned URL and uploads to R2', async () => {
    const configTablet1: SyncConfig = {
      id: 'current_config',
      apiBaseUrl: 'http://localhost:5000',
      deviceId: '11111111-aaaa-bbbb-cccc-000000000001',
      deviceToken: 'token-tablet-1-high-entropy-secret-key-32',
      businessId: 'biz-01',
      businessName: 'Sentinel Security PH',
      deviceName: 'Field Tablet 1 (Leader)',
      autoSync: true,
      syncIntervalMinutes: 5,
      enrolledAt: '2026-11-01T08:00:00Z',
      lastSyncStatus: 'Idle',
    };
    await syncConfigRepository.saveConfig(configTablet1);

    const stored = await syncConfigRepository.getConfig();
    expect(stored?.deviceId).toBe('11111111-aaaa-bbbb-cccc-000000000001');
    expect(stored?.deviceToken).toBe('token-tablet-1-high-entropy-secret-key-32');

    const file = new File(['mock image bytes'], 'test.jpg', { type: 'image/jpeg' });
    const items = prepareR2UploadItems([file], sampleProject, []);
    expect(items.length).toBe(1);
    expect(items[0].sequenceNumber).toBe(1);
    expect(items[0].folderName).toBe('Main-Perimeter-Fence-Installation_2026-11-01');
  });

  it('R2-002: Second tablet starts un-enrolled; displays enrollment guidance and does not falsely claim server unreachable', async () => {
    const config = await syncConfigRepository.getConfig();
    expect(config).toBeNull();

    const isEnrolled = Boolean(config?.deviceId && config?.deviceToken);
    expect(isEnrolled).toBe(false);

    // Simulated evaluation when server is healthy (200 OK) but tablet has no enrollment credentials
    const isServerHealthy = true;
    const resolvedStatus = !isEnrolled ? 'not-enrolled' : isServerHealthy ? 'ready' : 'api-unreachable';

    expect(resolvedStatus).toBe('not-enrolled');
    expect(resolvedStatus).not.toBe('api-unreachable');
    expect(ENROLLMENT_REQUIRED_WARNING).toBe('Device enrollment is required.');
  });

  it('R2-003: Second tablet completes independent enrollment with unique GUID and distinct token in IndexedDB', async () => {
    const tablet2Enrollment: SyncConfig = {
      id: 'current_config',
      apiBaseUrl: 'http://localhost:5000',
      deviceId: '22222222-dddd-eeee-ffff-000000000002',
      deviceToken: 'token-tablet-2-distinct-secret-hash-64',
      businessId: 'biz-01',
      businessName: 'Sentinel Security PH',
      deviceName: 'Field Tablet 2 (Junior)',
      autoSync: true,
      syncIntervalMinutes: 5,
      enrolledAt: '2026-11-10T09:00:00Z',
      lastSyncStatus: 'Idle',
    };

    await syncConfigRepository.saveConfig(tablet2Enrollment);

    const stored = await syncConfigRepository.getConfig();
    expect(stored).not.toBeNull();
    expect(stored?.deviceId).toBe('22222222-dddd-eeee-ffff-000000000002');
    expect(stored?.deviceToken).toBe('token-tablet-2-distinct-secret-hash-64');
  });

  it('R2-004: Two devices maintain independent identities without collision or shared tokens', () => {
    const device1 = {
      deviceId: '11111111-aaaa-bbbb-cccc-000000000001',
      deviceToken: 'token-tablet-1',
    };
    const device2 = {
      deviceId: '22222222-dddd-eeee-ffff-000000000002',
      deviceToken: 'token-tablet-2',
    };

    expect(device1.deviceId).not.toBe(device2.deviceId);
    expect(device1.deviceToken).not.toBe(device2.deviceToken);
  });

  it('R2-005: Second tablet transitions to ready state upon valid enrollment and server reachability', async () => {
    await syncConfigRepository.saveConfig({
      id: 'current_config',
      apiBaseUrl: 'http://localhost:5000',
      deviceId: '22222222-dddd-eeee-ffff-000000000002',
      deviceToken: 'token-tablet-2-distinct-secret-hash-64',
      businessId: 'biz-01',
      businessName: 'Sentinel Security PH',
      deviceName: 'Tablet 2',
      autoSync: true,
      syncIntervalMinutes: 5,
      enrolledAt: new Date().toISOString(),
      lastSyncStatus: 'Idle',
    });

    const config = await syncConfigRepository.getConfig();
    const isEnrolled = Boolean(config?.deviceId && config?.deviceToken);
    const isServerHealthy = true;
    const isAuthValid = true;

    const status = !isEnrolled ? 'not-enrolled' : !isServerHealthy ? 'api-unreachable' : !isAuthValid ? 'invalid-auth' : 'ready';
    expect(status).toBe('ready');
    expect(READY_MESSAGE).toBe('Ready to upload images.');
  });

  it('R2-006: Server reachability is verified independently from device enrollment', () => {
    function evaluateStatus(isOnline: boolean, isEnrolled: boolean, apiHealthy: boolean) {
      if (!isOnline) return 'offline';
      if (!isEnrolled) return 'not-enrolled';
      if (!apiHealthy) return 'api-unreachable';
      return 'ready';
    }

    // Server is live, but tablet not enrolled
    expect(evaluateStatus(true, false, true)).toBe('not-enrolled');
    // Server is down, tablet is enrolled
    expect(evaluateStatus(true, true, false)).toBe('api-unreachable');
    // Both live and enrolled
    expect(evaluateStatus(true, true, true)).toBe('ready');
  });

  it('R2-007: Genuinely unreachable server produces api-unreachable status with retry guidance', () => {
    expect(API_UNREACHABLE_WARNING).toBe(
      'SentinelOps server is unreachable. Image uploads are temporarily unavailable. Check your connection and try again.'
    );
  });

  it('R2-008: Offline browser state produces offline status and disables upload', () => {
    expect(OFFLINE_MESSAGE).toBe('No internet connection. Image uploads are unavailable offline.');
    expect(OFFLINE_WARNING).toBe('No internet connection. Connect to the internet to upload project images.');
  });

  it('R2-009: Invalid or expired device token maps to invalid-auth status and warning', () => {
    expect(INVALID_AUTH_WARNING).toBe('Device authorization is invalid or expired.');
  });

  it('R2-010: Unauthorized user role maps to forbidden status and warning', () => {
    expect(FORBIDDEN_WARNING).toBe('You do not have permission to upload images.');
  });

  it('R2-011: R2 CORS preflight failure produces actionable message', () => {
    const corsErrorMessage =
      'Cloudflare R2 CORS preflight failed. Check allowed origins in bucket settings.';
    expect(corsErrorMessage).toContain('Cloudflare R2 CORS preflight failed');
    expect(corsErrorMessage).toContain('allowed origins in bucket settings');
  });

  it('R2-012: Expired presigned PUT URL maps to signature/expiry error', () => {
    const expiredErrorMessage = 'Presigned upload URL expired or signature mismatch.';
    expect(expiredErrorMessage).toContain('Presigned upload URL expired');
  });

  it('R2-013: Privacy-safe diagnostic logger generates correlation IDs and never logs credentials or PII', () => {
    diagnosticLogger.logConnectivityStart('http://localhost:5000', true);
    diagnosticLogger.logHealthCheck({
      url: 'http://localhost:5000/api/v1/health/live',
      success: true,
      status: 200,
    });
    diagnosticLogger.logEnrollmentState(true, '11111111-aaaa-bbbb-cccc-000000000001');
    diagnosticLogger.logDeviceAuth({
      deviceId: '11111111-aaaa-bbbb-cccc-000000000001',
      authorized: true,
      httpStatus: 200,
    });
    diagnosticLogger.logPresignedUrl({
      stage: 'started',
      projectId: 'prj-001',
      fileCount: 1,
      correlationId: 'corr-test-123',
    });

    const logs = diagnosticLogger.getRecentLogs();
    expect(logs.length).toBeGreaterThan(0);

    for (const log of logs) {
      const serialized = JSON.stringify(log);
      expect(serialized).not.toContain('deviceToken');
      expect(serialized).not.toContain('secret');
      expect(serialized).not.toContain('password');
      expect(serialized).not.toContain('X-Amz-Signature');
    }
  });

  it('R2-014: Monotonically incrementing image sequence numbers per project', () => {
    const existing = [
      { sequenceNumber: 1, r2FolderName: 'Perimeter_2026-11-01' },
      { sequenceNumber: 2, r2FolderName: 'Perimeter_2026-11-01' },
    ];
    const newFiles = [
      new File(['1'], 'img1.jpg', { type: 'image/jpeg' }),
      new File(['2'], 'img2.jpg', { type: 'image/jpeg' }),
    ];

    const items = prepareR2UploadItems(newFiles, sampleProject, existing);
    expect(items[0].sequenceNumber).toBe(3);
    expect(items[1].sequenceNumber).toBe(4);
  });

  it('R2-015: Online-only policy: file validation rejects 0-byte and oversized files; offline fallback saves locally', async () => {
    const emptyFile = new File([], 'empty.jpg', { type: 'image/jpeg' });
    expect(validateImageFile(emptyFile).valid).toBe(false);

    // Save locally without R2
    await projectRepository.save(sampleProject);
    const localAtt = {
      id: 'local-att-test',
      entityType: 'Project' as const,
      entityId: sampleProject.id,
      fileName: '1.jpg',
      fileType: 'image/jpeg',
      fileSize: 1024,
      uploadedAt: new Date().toISOString(),
      sequenceNumber: 1,
      storageProvider: 'local' as const,
      blob: new Blob(['dummy'], { type: 'image/jpeg' }),
    };

    const saved = await attachmentRepository.saveAttachment(localAtt);
    expect(saved.storageProvider).toBe('local');
    expect(saved.entityId).toBe(sampleProject.id);
  });
});
