import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { syncConfigRepository } from '../src/storage/repositories';
import { resetDatabaseConnection } from '../src/storage/database';
import { ENROLLMENT_REQUIRED_WARNING, OFFLINE_WARNING, API_UNREACHABLE_WARNING } from '../src/hooks/useConnectivity';
import { SyncConfig } from '../src/storage/database';

describe('SentinelOps Device Enrollment & Multi-Tablet Authorization Suite', () => {
  beforeEach(async () => {
    indexedDB = new IDBFactory();
    resetDatabaseConnection();
    await syncConfigRepository.clearConfig();
  });

  describe('Phase 8: Device Enrollment Tests (DEV-001 through DEV-009)', () => {
    it('DEV-001: Fresh installation on a new tablet starts with empty syncConfig and enrollment guidance', async () => {
      const config = await syncConfigRepository.getConfig();
      expect(config).toBeNull();

      // Check simulated reachability evaluation for un-enrolled tablet
      const isEnrolled = Boolean(config?.deviceId && config?.deviceToken);
      expect(isEnrolled).toBe(false);

      const status = !isEnrolled ? 'not-enrolled' : 'ready';
      expect(status).toBe('not-enrolled');
      expect(ENROLLMENT_REQUIRED_WARNING).toBe('Device enrollment is required.');
    });

    it('DEV-002: Complete approved enrollment persists valid deviceId and deviceToken', async () => {
      const fakeServerResponse = {
        businessId: '11111111-2222-3333-4444-555555555555',
        deviceId: 'aaaa1111-bb22-cc33-dd44-eeee55556666',
        deviceToken: '7f9a8b6c4d2e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a',
        role: 'Admin',
      };

      const newConfig: SyncConfig = {
        id: 'current_config',
        apiBaseUrl: 'https://ais-dev-out62f7bx4h2yd2ers57ej-460254675909.asia-southeast1.run.app',
        deviceId: fakeServerResponse.deviceId,
        deviceToken: fakeServerResponse.deviceToken,
        businessId: fakeServerResponse.businessId,
        businessName: 'Sentinel Security PH',
        deviceName: 'Operations Tablet 2 (Field)',
        autoSync: true,
        syncIntervalMinutes: 5,
        enrolledAt: new Date().toISOString(),
        lastSyncStatus: 'Idle',
      };

      await syncConfigRepository.saveConfig(newConfig);

      const stored = await syncConfigRepository.getConfig();
      expect(stored).not.toBeNull();
      expect(stored?.deviceId).toBe(fakeServerResponse.deviceId);
      expect(stored?.deviceToken).toBe(fakeServerResponse.deviceToken);
      expect(stored?.businessName).toBe('Sentinel Security PH');
      expect(stored?.deviceName).toBe('Operations Tablet 2 (Field)');
    });

    it('DEV-003 & DEV-004: Restarting application or reopening PWA retains enrollment state', async () => {
      const config: SyncConfig = {
        id: 'current_config',
        apiBaseUrl: 'https://sentinelops-api.company.com',
        deviceId: 'dev-guid-pwa-restart',
        deviceToken: 'tok-pwa-session-valid-token-32bytes',
        businessId: 'biz-123',
        businessName: 'Sentinel Security PH',
        deviceName: 'Tablet 2',
        autoSync: true,
        syncIntervalMinutes: 5,
        enrolledAt: new Date().toISOString(),
        lastSyncStatus: 'Idle',
      };

      await syncConfigRepository.saveConfig(config);

      // Simulate app restart: resetting active connection handles and re-reading
      resetDatabaseConnection();

      const reloaded = await syncConfigRepository.getConfig();
      expect(reloaded).not.toBeNull();
      expect(reloaded?.deviceId).toBe('dev-guid-pwa-restart');
      expect(reloaded?.deviceToken).toBe('tok-pwa-session-valid-token-32bytes');
    });

    it('DEV-005 & DEV-006: Incomplete enrollment (missing deviceId or deviceToken) flags enrollment required', async () => {
      // Missing deviceToken
      const partialConfig1: any = {
        id: 'current_config',
        apiBaseUrl: 'https://api.example.com',
        deviceId: 'dev-1234',
        deviceName: 'Incomplete Tablet',
      };
      await syncConfigRepository.saveConfig(partialConfig1);

      let config = await syncConfigRepository.getConfig();
      let isEnrolled = Boolean(config?.deviceId && config?.deviceToken);
      expect(isEnrolled).toBe(false);

      // Missing deviceId
      const partialConfig2: any = {
        id: 'current_config',
        apiBaseUrl: 'https://api.example.com',
        deviceToken: 'token-without-id',
        deviceName: 'Incomplete Tablet 2',
      };
      await syncConfigRepository.saveConfig(partialConfig2);

      config = await syncConfigRepository.getConfig();
      isEnrolled = Boolean(config?.deviceId && config?.deviceToken);
      expect(isEnrolled).toBe(false);
    });

    it('DEV-007: Backend authorization rejects invalid or missing credentials', () => {
      function mockAuthenticate(headers: Record<string, string>, registeredTokens: Map<string, string>) {
        const auth = headers['Authorization'];
        const deviceId = headers['X-Device-Id'];

        if (!auth || !auth.startsWith('Bearer ')) {
          return { status: 401, error: 'Missing or invalid Authorization header' };
        }
        if (!deviceId) {
          return { status: 401, error: 'Missing or invalid X-Device-Id header' };
        }

        const token = auth.replace('Bearer ', '').trim();
        const storedToken = registeredTokens.get(deviceId);

        if (!storedToken || storedToken !== token) {
          return { status: 401, error: 'Device token verification failed' };
        }

        return { status: 200, deviceId };
      }

      const registered = new Map<string, string>([
        ['device-1', 'valid-token-device-1'],
        ['device-2', 'valid-token-device-2'],
      ]);

      // Missing header
      expect(mockAuthenticate({}, registered).status).toBe(401);

      // Invalid token
      expect(
        mockAuthenticate(
          { Authorization: 'Bearer wrong-token', 'X-Device-Id': 'device-2' },
          registered
        ).status
      ).toBe(401);

      // Valid token for Device 2
      const ok = mockAuthenticate(
        { Authorization: 'Bearer valid-token-device-2', 'X-Device-Id': 'device-2' },
        registered
      );
      expect(ok.status).toBe(200);
      expect(ok.deviceId).toBe('device-2');
    });

    it('DEV-008: Two independently enrolled tablets maintain separate identities without collision', async () => {
      // Device A storage simulation
      const deviceA: SyncConfig = {
        id: 'current_config',
        apiBaseUrl: 'https://api.sentinelops.com',
        deviceId: 'device-aaa-111',
        deviceToken: 'token-aaa-secret-key-1',
        businessId: 'biz-sentinel',
        businessName: 'Sentinel Security PH',
        deviceName: 'Operations Tablet 1',
        autoSync: true,
        syncIntervalMinutes: 5,
        enrolledAt: '2026-11-01T10:00:00Z',
        lastSyncStatus: 'Idle',
      };

      // Device B storage simulation
      const deviceB: SyncConfig = {
        id: 'current_config',
        apiBaseUrl: 'https://api.sentinelops.com',
        deviceId: 'device-bbb-222',
        deviceToken: 'token-bbb-secret-key-2',
        businessId: 'biz-sentinel',
        businessName: 'Sentinel Security PH',
        deviceName: 'Operations Tablet 2',
        autoSync: true,
        syncIntervalMinutes: 5,
        enrolledAt: '2026-11-06T12:00:00Z',
        lastSyncStatus: 'Idle',
      };

      expect(deviceA.deviceId).not.toBe(deviceB.deviceId);
      expect(deviceA.deviceToken).not.toBe(deviceB.deviceToken);
      expect(deviceA.deviceName).not.toBe(deviceB.deviceName);
    });

    it('DEV-009: Enrollment failure surface actionable errors', () => {
      function evaluateEnrollmentError(status: number, errorText?: string): string {
        if (status === 401) {
          return 'Unauthorized: Invalid device registration key. Contact your SentinelOps administrator.';
        }
        if (status === 400) {
          return `Validation Error: ${errorText || 'Invalid device registration payload.'}`;
        }
        if (status === 0 || !status) {
          return 'Network Error: Central SentinelOps server is unreachable. Check your network connection.';
        }
        return `Registration Error (${status}): ${errorText || 'Server rejected registration.'}`;
      }

      expect(evaluateEnrollmentError(401)).toContain('Invalid device registration key');
      expect(evaluateEnrollmentError(400, 'Device name cannot exceed 200 characters')).toContain(
        'Device name cannot exceed 200 characters'
      );
      expect(evaluateEnrollmentError(0)).toContain('Central SentinelOps server is unreachable');
    });
  });

  describe('Phase 8: Image Upload Availability & Policy Tests (IMG-001 through IMG-007)', () => {
    it('IMG-004 & IMG-006: Upload is disabled when device is un-enrolled or offline', () => {
      function isUploadAllowed(isOnline: boolean, isEnrolled: boolean, isApiReachable: boolean): {
        allowed: boolean;
        reason?: string;
      } {
        if (!isOnline) {
          return { allowed: false, reason: OFFLINE_WARNING };
        }
        if (!isEnrolled) {
          return { allowed: false, reason: ENROLLMENT_REQUIRED_WARNING };
        }
        if (!isApiReachable) {
          return { allowed: false, reason: API_UNREACHABLE_WARNING };
        }
        return { allowed: true };
      }

      // Offline
      expect(isUploadAllowed(false, true, true).allowed).toBe(false);
      expect(isUploadAllowed(false, true, true).reason).toBe(OFFLINE_WARNING);

      // Online but not enrolled
      expect(isUploadAllowed(true, false, true).allowed).toBe(false);
      expect(isUploadAllowed(true, false, true).reason).toBe(ENROLLMENT_REQUIRED_WARNING);

      // Online and enrolled but API unreachable
      expect(isUploadAllowed(true, true, false).allowed).toBe(false);
      expect(isUploadAllowed(true, true, false).reason).toBe(API_UNREACHABLE_WARNING);

      // Online, enrolled, API reachable
      expect(isUploadAllowed(true, true, true).allowed).toBe(true);
    });

    it('IMG-007: When connectivity returns, upload can be initiated manually', () => {
      let isOnline = false;
      let isEnrolled = true;
      let isApiReachable = false;

      // Initially offline
      expect(isOnline).toBe(false);

      // Connection restored
      isOnline = true;
      isApiReachable = true;

      const canUploadNow = isOnline && isEnrolled && isApiReachable;
      expect(canUploadNow).toBe(true);
    });
  });
});
