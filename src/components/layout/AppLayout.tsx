import React, { useState } from 'react';
import { useAuth } from '../../app/providers/AuthContext';
import { PWAInstallButton } from '../ui/PWAInstallButton';
import { OfflineIndicator } from '../ui/OfflineIndicator';
import { SyncStatusWidget } from '../ui/SyncStatusWidget';
import {
  Shield,
  LayoutDashboard,
  Users,
  FileSpreadsheet,
  Receipt,
  FolderGit2,
  Settings,
  Lock,
  LogOut,
  Menu,
  X,
  Plus,
  Moon,
  Sun,
  ShieldCheck,
} from 'lucide-react';

export type NavigationTab =
  | 'dashboard'
  | 'clients'
  | 'quotations'
  | 'projects'
  | 'billing'
  | 'settings';

interface AppLayoutProps {
  currentTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  onQuickAction?: (action: 'new_client' | 'new_quotation' | 'new_project' | 'new_invoice') => void;
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  currentTab,
  onSelectTab,
  onQuickAction,
  children,
}) => {
  const { session, lockSession, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems: { id: NavigationTab; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
    { id: 'clients', label: 'Clients & CRM', icon: <Users className="w-5 h-5" /> },
    { id: 'quotations', label: 'Quotations', icon: <FileSpreadsheet className="w-5 h-5" /> },
    { id: 'projects', label: 'Projects', icon: <FolderGit2 className="w-5 h-5" /> },
    { id: 'billing', label: 'Billing & Payments', icon: <Receipt className="w-5 h-5" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-5 h-5" /> },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col md:flex-row antialiased selection:bg-blue-600 selection:text-white">
      <OfflineIndicator />

      {/* Sidebar for Tablets Landscape & Desktop */}
      <aside className="hidden md:flex flex-col w-64 lg:w-72 bg-slate-900 border-r border-slate-800/80 shrink-0 select-none">
        {/* Brand */}
        <div className="p-5 flex items-center justify-between border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-md shadow-blue-600/30">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-black text-lg tracking-tight text-white">SentinelOps</span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-sm bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  PWA
                </span>
              </div>
              <p className="text-[10px] font-medium text-slate-400">Security Installation Ops</p>
            </div>
          </div>
        </div>

        {/* Quick Actions Panel */}
        {onQuickAction && (
          <div className="p-3.5 mx-3 mt-3 rounded-2xl bg-slate-800/50 border border-slate-700/40">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 px-1">
              Quick Actions
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onQuickAction('new_quotation')}
                className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-semibold shadow-md transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Quotation</span>
              </button>
              <button
                onClick={() => onQuickAction('new_client')}
                className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl bg-slate-700/80 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-semibold transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Client</span>
              </button>
            </div>
          </div>
        )}

        {/* Main Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl font-semibold text-sm transition-all text-left ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <span className={isActive ? 'text-white' : 'text-slate-400'}>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Footer Session Controls */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-900/60 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-blue-400 shrink-0">
              {session?.fullName?.charAt(0) || 'A'}
            </div>
            <div className="min-w-0 truncate">
              <p className="text-xs font-bold text-white truncate">{session?.fullName || 'Admin'}</p>
              <p className="text-[10px] text-slate-400 truncate">Local Vault Auth</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={lockSession}
              title="Lock Session"
              className="p-2 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition"
            >
              <Lock className="w-4 h-4" />
            </button>
            <button
              onClick={logout}
              title="Log Out"
              className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex items-center justify-between px-4 sm:px-6 py-3.5 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-white capitalize">
                {currentTab === 'billing' ? 'Billing & Payments' : currentTab}
              </h1>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                SentinelOps • Perimeter & Automation Operations
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <SyncStatusWidget onOpenSyncSettings={() => onSelectTab('settings')} />
            <PWAInstallButton />

            <button
              onClick={lockSession}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 text-xs font-semibold text-slate-300 hover:text-amber-400 hover:border-amber-500/40 transition"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Lock</span>
            </button>
          </div>
        </header>

        {/* Dynamic Screen View */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto pb-24 md:pb-10">
          {children}
        </main>

        {/* Mobile Bottom Navigation Bar (Thumb friendly for tablet portrait & mobile) */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 px-2 py-1.5 flex items-center justify-around">
          {navItems.map((item) => {
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`flex flex-col items-center gap-1 py-1.5 px-2 rounded-xl transition ${
                  isActive ? 'text-blue-400 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className={`p-1 rounded-lg ${isActive ? 'bg-blue-600/15' : ''}`}>
                  {item.icon}
                </div>
                <span className="text-[10px]">{item.label.split(' ')[0]}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-72 bg-slate-900 border-r border-slate-800 flex flex-col p-4 z-10">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Shield className="w-6 h-6 text-blue-500" />
                <span className="font-bold text-white text-base">SentinelOps</span>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="mt-4 space-y-1.5 flex-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    onSelectTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-left transition ${
                    currentTab === item.id
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>

            <div className="pt-4 border-t border-slate-800 space-y-2">
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  lockSession();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
              >
                <Lock className="w-4 h-4" />
                <span>Lock Vault Session</span>
              </button>
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  logout();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-rose-400 bg-rose-500/10 hover:bg-rose-500/20"
              >
                <LogOut className="w-4 h-4" />
                <span>Log Out</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
