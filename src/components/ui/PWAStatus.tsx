import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export const PWAStatus: React.FC = () => {
  const [dismissed, setDismissed] = useState(false);
  const [registrationError, setRegistrationError] = useState(false);
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError() {
      setRegistrationError(true);
    },
  });

  if (needRefresh) {
    return (
      <div className="fixed right-4 top-4 z-50 flex max-w-sm items-center gap-3 rounded-xl border border-blue-400/40 bg-slate-900 px-4 py-3 text-xs text-slate-100 shadow-2xl">
        <RefreshCw className="h-4 w-4 shrink-0 text-blue-400" aria-hidden="true" />
        <span className="flex-1">A new SentinelOps version is ready.</span>
        <button
          type="button"
          onClick={() => updateServiceWorker(true)}
          className="whitespace-nowrap rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-500"
        >
          Load update
        </button>
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          aria-label="Dismiss update notification"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  if (offlineReady && !dismissed) {
    return (
      <div className="fixed right-4 top-4 z-50 flex max-w-sm items-center gap-3 rounded-xl border border-emerald-400/40 bg-slate-900 px-4 py-3 text-xs text-slate-100 shadow-2xl">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
        <span className="flex-1">Offline startup is ready.</span>
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            setOfflineReady(false);
          }}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          aria-label="Dismiss offline readiness notification"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  if (registrationError) {
    return (
      <div className="fixed right-4 top-4 z-50 flex max-w-sm items-center gap-3 rounded-xl border border-amber-400/40 bg-slate-900 px-4 py-3 text-xs text-slate-100 shadow-2xl">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
        <span className="flex-1">Offline setup could not finish. Reconnect and reload to retry.</span>
        <button
          type="button"
          onClick={() => setRegistrationError(false)}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          aria-label="Dismiss offline setup warning"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return null;
};