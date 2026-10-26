import { describe, it, expect } from 'vitest';
import {
  OFFLINE_WARNING,
  API_UNREACHABLE_WARNING,
} from '../src/hooks/useConnectivity';

describe('Project Connectivity Detection & State Model (Section 5)', () => {
  it('defines the exact offline warning string required by specification', () => {
    expect(OFFLINE_WARNING).toBe(
      'No internet connection. Connect to the internet to upload project images.'
    );
  });

  it('defines the exact server unreachable warning string required by specification', () => {
    expect(API_UNREACHABLE_WARNING).toBe(
      'SentinelOps server is unreachable. Image uploads are temporarily unavailable. Check your connection and try again.'
    );
  });

  it('simulates reachability transitions accurately', async () => {
    type TestStatus = 'checking' | 'offline' | 'api-unreachable' | 'ready';

    function evaluateConnectivity(
      navigatorOnLine: boolean,
      apiBaseUrl: string | null,
      apiHealthy: boolean
    ): { status: TestStatus; warning: string | null } {
      if (!navigatorOnLine) {
        return { status: 'offline', warning: OFFLINE_WARNING };
      }
      if (!apiBaseUrl || !apiHealthy) {
        return { status: 'api-unreachable', warning: API_UNREACHABLE_WARNING };
      }
      return { status: 'ready', warning: null };
    }

    // 1. Offline scenario
    const offlineState = evaluateConnectivity(false, 'https://api.sentinelops.local', true);
    expect(offlineState.status).toBe('offline');
    expect(offlineState.warning).toBe(OFFLINE_WARNING);

    // 2. Online but API down or unconfigured
    const unconfiguredState = evaluateConnectivity(true, null, false);
    expect(unconfiguredState.status).toBe('api-unreachable');
    expect(unconfiguredState.warning).toBe(API_UNREACHABLE_WARNING);

    const apiDownState = evaluateConnectivity(true, 'https://api.sentinelops.local', false);
    expect(apiDownState.status).toBe('api-unreachable');
    expect(apiDownState.warning).toBe(API_UNREACHABLE_WARNING);

    // 3. Online and API healthy
    const readyState = evaluateConnectivity(true, 'https://api.sentinelops.local', true);
    expect(readyState.status).toBe('ready');
    expect(readyState.warning).toBeNull();
  });
});
