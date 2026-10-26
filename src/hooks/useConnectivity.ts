/**
 * SentinelOps - Network & API Reachability Detection Hook
 * Implements Section 5 of Project Connectivity Detection specification.
 *
 * Observable states:
 * - 'checking': initial or refreshed reachability check in progress
 * - 'offline': browser reports navigator.onLine === false
 * - 'api-unreachable': browser is online, but SentinelOps API liveness check failed/timed out
 * - 'ready': browser is online AND SentinelOps API responds healthy
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { syncConfigRepository } from '../storage/repositories';

export type ConnectivityStatus = 'checking' | 'offline' | 'api-unreachable' | 'ready';

export interface ConnectivityState {
  status: ConnectivityStatus;
  isOnline: boolean;
  isApiReachable: boolean;
  apiBaseUrl: string | null;
  lastCheckedAt: string | null;
  errorMessage: string | null;
  checkReachability: () => Promise<ConnectivityStatus>;
}

export const OFFLINE_WARNING =
  'No internet connection. Connect to the internet to upload project images.';

export const API_UNREACHABLE_WARNING =
  'SentinelOps server is unreachable. Image uploads are temporarily unavailable. Check your connection and try again.';

const REACHABILITY_TIMEOUT_MS = 6000;

export function useConnectivity(): ConnectivityState {
  const [status, setStatus] = useState<ConnectivityStatus>('checking');
  const [apiBaseUrl, setApiBaseUrl] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // Resolves the configured SentinelOps API base URL
  const resolveApiBaseUrl = useCallback(async (): Promise<string | null> => {
    try {
      const config = await syncConfigRepository.getConfig();
      if (config?.apiBaseUrl && config.apiBaseUrl.trim()) {
        return config.apiBaseUrl.replace(/\/+$/, '');
      }
    } catch {
      // IndexedDB read fallback
    }

    const envUrl = (import.meta as any)?.env?.VITE_API_BASE_URL;
    if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
      return envUrl.replace(/\/+$/, '');
    }

    return null;
  }, []);

  const checkReachability = useCallback(async (): Promise<ConnectivityStatus> => {
    // 1. Browser network heuristic check
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (isMountedRef.current) {
        setStatus('offline');
        setErrorMessage(OFFLINE_WARNING);
        setLastCheckedAt(new Date().toISOString());
      }
      return 'offline';
    }

    if (isMountedRef.current) {
      setStatus('checking');
    }

    // Cancel any in-flight check
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, REACHABILITY_TIMEOUT_MS);

    try {
      const targetBaseUrl = await resolveApiBaseUrl();
      if (isMountedRef.current) {
        setApiBaseUrl(targetBaseUrl);
      }

      if (!targetBaseUrl) {
        // No server endpoint configured
        clearTimeout(timeoutId);
        if (isMountedRef.current) {
          setStatus('api-unreachable');
          setErrorMessage(API_UNREACHABLE_WARNING);
          setLastCheckedAt(new Date().toISOString());
        }
        return 'api-unreachable';
      }

      // Check lightweight liveness endpoint: /api/v1/health/live
      const healthUrl = `${targetBaseUrl}/api/v1/health/live`;
      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: abortController.signal,
        cache: 'no-store', // Avoid stale service-worker or browser cache
        headers: {
          'Accept': 'application/json',
          'X-SentinelOps-Reachability-Check': 'true',
        },
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        if (isMountedRef.current) {
          setStatus('ready');
          setErrorMessage(null);
          setLastCheckedAt(new Date().toISOString());
        }
        return 'ready';
      } else {
        if (isMountedRef.current) {
          setStatus('api-unreachable');
          setErrorMessage(API_UNREACHABLE_WARNING);
          setLastCheckedAt(new Date().toISOString());
        }
        return 'api-unreachable';
      }
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (abortController.signal.aborted && !isMountedRef.current) {
        return 'checking';
      }
      if (isMountedRef.current) {
        setStatus('api-unreachable');
        setErrorMessage(API_UNREACHABLE_WARNING);
        setLastCheckedAt(new Date().toISOString());
      }
      return 'api-unreachable';
    }
  }, [resolveApiBaseUrl]);

  useEffect(() => {
    isMountedRef.current = true;

    // Initial check
    void checkReachability();

    // Browser network event listeners
    const handleOnline = () => {
      // Re-check reachability when network comes back online
      void checkReachability();
    };

    const handleOffline = () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (isMountedRef.current) {
        setStatus('offline');
        setErrorMessage(OFFLINE_WARNING);
        setLastCheckedAt(new Date().toISOString());
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkReachability();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [checkReachability]);

  return {
    status,
    isOnline: status !== 'offline',
    isApiReachable: status === 'ready',
    apiBaseUrl,
    lastCheckedAt,
    errorMessage,
    checkReachability,
  };
}
