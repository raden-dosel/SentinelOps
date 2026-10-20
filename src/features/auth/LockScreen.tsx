import React, { useState } from 'react';
import { useAuth } from '../../app/providers/AuthContext';
import { Shield, Lock, LogOut } from 'lucide-react';

export const LockScreen: React.FC = () => {
  const { session, unlock, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsVerifying(true);

    try {
      const ok = await unlock(password);
      if (!ok) {
        setError('Incorrect password. Please try again.');
      }
    } catch {
      setError('Unlock failed.');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/95 backdrop-blur-md text-slate-100 animate-in fade-in duration-200">
      <div className="w-full max-w-sm rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl p-8 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4">
          <Lock className="w-7 h-7 text-amber-400" />
        </div>

        <h2 className="text-xl font-bold text-white">Session Locked</h2>
        <p className="text-xs text-slate-400 mt-1 mb-6">
          Logged in as <strong className="text-slate-200">{session?.fullName || session?.username}</strong>
        </p>

        {error && (
          <div className="mb-4 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleUnlock} className="space-y-4">
          <input
            type="password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password to unlock..."
            className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 text-center"
          />

          <button
            type="submit"
            disabled={isVerifying}
            className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 font-semibold text-xs text-white shadow-lg transition"
          >
            {isVerifying ? 'Checking...' : 'Resume Session'}
          </button>
        </form>

        <button
          onClick={logout}
          className="mt-6 inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-rose-400 transition"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Switch account or Log out</span>
        </button>
      </div>
    </div>
  );
};
