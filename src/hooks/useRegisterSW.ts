import { useState, useEffect, useCallback } from 'react';

export interface RegisterSWOptions {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
  onRegisterError?: (error: unknown) => void;
}

/**
 * Robust service worker registration hook for SentinelOps PWA.
 * Safe across both production Workbox builds and development/iframe environments.
 */
export function useRegisterSW(options: RegisterSWOptions = {}) {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    // Only register actual service worker in production or when sw.js is served
    if (import.meta.env.PROD) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          options.onRegistered?.(reg);

          if (reg.waiting) {
            setNeedRefresh(true);
            options.onNeedRefresh?.();
            return;
          }

          reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                  setNeedRefresh(true);
                  options.onNeedRefresh?.();
                } else {
                  setOfflineReady(true);
                  options.onOfflineReady?.();
                }
              }
            });
          });
        })
        .catch((error) => {
          // Gracefully record registration error without throwing
          options.onRegisterError?.(error);
        });
    }
  }, []);

  const updateServiceWorker = useCallback(async (reloadPage = true) => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      } catch {
        // Safe fallback
      }
    }
    if (reloadPage && typeof window !== 'undefined') {
      window.location.reload();
    }
  }, []);

  return {
    offlineReady: [offlineReady, setOfflineReady] as [boolean, React.Dispatch<React.SetStateAction<boolean>>],
    needRefresh: [needRefresh, setNeedRefresh] as [boolean, React.Dispatch<React.SetStateAction<boolean>>],
    updateServiceWorker,
  };
}
