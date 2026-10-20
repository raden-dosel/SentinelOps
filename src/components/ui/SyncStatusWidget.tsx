import React, { useState, useEffect } from 'react';
import { syncCoordinator, SyncCoordinatorState } from '../../services/syncCoordinator';
import {
  Cloud,
  CloudOff,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';

interface SyncStatusWidgetProps {
  onOpenSyncSettings?: () => void;
}

export const SyncStatusWidget: React.FC<SyncStatusWidgetProps> = ({ onOpenSyncSettings }) => {
  const [state, setState] = useState<SyncCoordinatorState>(syncCoordinator.getState());
  const [isManualSyncing, setIsManualSyncing] = useState(false);

  useEffect(() => {
    syncCoordinator.initialize();
    const unsubscribe = syncCoordinator.subscribe((newState) => {
      setState(newState);
    });
    return unsubscribe;
  }, []);

  const handleSyncClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (state.status === 'Not configured') {
      if (onOpenSyncSettings) onOpenSyncSettings();
      return;
    }
    setIsManualSyncing(true);
    try {
      await syncCoordinator.triggerSync();
    } finally {
      setIsManualSyncing(false);
    }
  };

  const renderBadge = () => {
    switch (state.status) {
      case 'Not configured':
        return (
          <button
            onClick={handleSyncClick}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-800/80 text-[11px] font-semibold text-slate-400 hover:text-white hover:border-blue-500 transition"
            title="Configure Cloud Sync & Multi-Tablet Networking"
          >
            <Cloud className="w-3.5 h-3.5 text-slate-500" />
            <span className="hidden sm:inline">Sync: Local Only</span>
          </button>
        );

      case 'Offline':
        return (
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] font-semibold text-amber-300"
            title="Tablet is offline. All changes are securely enqueued in IndexedDB outbox."
          >
            <CloudOff className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">
              Offline {state.pendingCount > 0 ? `(${state.pendingCount})` : ''}
            </span>
          </div>
        );

      case 'Syncing':
        return (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/30 text-[11px] font-semibold text-blue-300">
            <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />
            <span className="hidden sm:inline">Syncing...</span>
          </div>
        );

      case 'Conflict':
        return (
          <button
            onClick={handleSyncClick}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-[11px] font-bold text-amber-300 hover:bg-amber-500/30"
            title="Sync conflicts detected. Tap to inspect."
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 animate-bounce" />
            <span>Conflict Detected</span>
          </button>
        );

      case 'Error':
      case 'ResyncRequired':
        return (
          <button
            onClick={handleSyncClick}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/25"
            title={state.lastError || 'Sync failed. Tap to retry.'}
          >
            <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
            <span>{state.status === 'ResyncRequired' ? 'Resync Needed' : 'Sync Error'}</span>
          </button>
        );

      case 'Pending':
        return (
          <button
            onClick={handleSyncClick}
            disabled={isManualSyncing}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-600/20 border border-blue-500/30 text-[11px] font-semibold text-blue-300 hover:bg-blue-600/30"
            title="Pending changes to push. Tap to sync."
          >
            <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${isManualSyncing ? 'animate-spin' : ''}`} />
            <span>{state.pendingCount} Pending</span>
          </button>
        );

      case 'Synced':
      default:
        return (
          <button
            onClick={handleSyncClick}
            disabled={isManualSyncing}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-800/80 text-[11px] font-semibold text-slate-300 hover:text-white transition"
            title={
              state.lastSuccessfulSyncAt
                ? `Last synced at ${new Date(state.lastSuccessfulSyncAt).toLocaleTimeString()}`
                : 'Synced'
            }
          >
            {isManualSyncing ? (
              <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span className="hidden sm:inline">Synced</span>
          </button>
        );
    }
  };

  return <div className="inline-flex items-center">{renderBadge()}</div>;
};
