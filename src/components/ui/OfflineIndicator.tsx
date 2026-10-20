import React from 'react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { WifiOff, Wifi } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2.5 rounded-xl bg-amber-500/95 px-3.5 py-2 text-xs font-semibold text-slate-950 shadow-xl backdrop-blur border border-amber-400">
      <WifiOff className="w-4 h-4 text-slate-950 animate-pulse" />
      <span>Offline Mode — All changes persist locally in IndexedDB</span>
    </div>
  );
};
