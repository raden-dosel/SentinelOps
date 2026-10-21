import React, { useState, useEffect } from 'react';
import { AppSettings, AuditEvent, TaxMode } from '../../types';
import {
  settingsRepository,
  auditRepository,
  userRepository,
  syncConfigRepository,
  syncConflictRepository,
  syncOutboxRepository,
} from '../../storage/repositories';
import { clearAllDatabaseData, SyncConfig, SyncConflictRecord } from '../../storage/database';
import {
  exportJsonBackup,
  exportZipBackup,
  validateBackupFile,
  restoreBackupData,
  dryRunBackupMigration,
  mergeBackupData,
  getStorageEstimate,
  RestorePreview,
  DryRunMigrationReport,
} from '../../services/backupService';
import { syncCoordinator, SyncCoordinatorState } from '../../services/syncCoordinator';
import { hashPassword, generateSalt } from '../../services/security';
import { useAuth } from '../../app/providers/AuthContext';
import { useToast } from '../../app/providers/ToastContext';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import {
  Settings,
  Building,
  Receipt,
  FileSpreadsheet,
  Lock,
  Database,
  History,
  Download,
  Upload,
  HardDrive,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  KeyRound,
  Cloud,
  CloudOff,
  Smartphone,
  ShieldCheck,
  Check,
  Radio,
  FileText,
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const { session, logout } = useAuth();
  const { showToast } = useToast();

  const [activeSection, setActiveSection] = useState<
    'business' | 'tax' | 'quotation' | 'numbering' | 'security' | 'backup' | 'audit' | 'sync'
  >('business');

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditFilter, setAuditFilter] = useState('');
  const [loading, setLoading] = useState(true);

  // Sync state
  const [syncConfig, setSyncConfig] = useState<SyncConfig | null>(null);
  const [syncState, setSyncState] = useState<SyncCoordinatorState>(syncCoordinator.getState());
  const [conflicts, setConflicts] = useState<SyncConflictRecord[]>([]);
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [enrollServerUrl, setEnrollServerUrl] = useState('http://localhost:5000');
  const [enrollDeviceName, setEnrollDeviceName] = useState('Operations Tablet 1');
  const [enrollBusinessName, setEnrollBusinessName] = useState('Sentinel Security PH');
  const [enrollRegToken, setEnrollRegToken] = useState('');
  const [isDisconnectDialogOpen, setIsDisconnectDialogOpen] = useState(false);

  // Storage estimation
  const [storageUsage, setStorageUsage] = useState<{ usedBytes: number; quotaBytes: number; percentage: number }>({
    usedBytes: 0,
    quotaBytes: 0,
    percentage: 0,
  });

  // Password Change State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordChangeError, setPasswordChangeError] = useState('');
  const [passwordChangeSuccess, setPasswordChangeSuccess] = useState('');

  // Backup restore & dry run state
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [dryRunReport, setDryRunReport] = useState<DryRunMigrationReport | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isDryRunning, setIsDryRunning] = useState(false);
  const [isMerging, setIsMerging] = useState(false);

  // Clear data confirm
  const [isWipeDialogOpen, setIsWipeDialogOpen] = useState(false);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [currSettings, events, storage, cfg, confl] = await Promise.all([
        settingsRepository.getSettings(),
        auditRepository.getAll(),
        getStorageEstimate(),
        syncConfigRepository.getConfig(),
        syncConflictRepository.getAll(),
      ]);
      setSettings(currSettings);
      setAuditEvents(events);
      setStorageUsage(storage);
      setSyncConfig(cfg);
      setConflicts(confl);
      if (currSettings?.businessName && !cfg) {
        setEnrollBusinessName(currSettings.businessName);
      }
    } catch (e) {
      console.error(e);
      showToast('Failed to load settings', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    const unsub = syncCoordinator.subscribe((state) => {
      setSyncState(state);
    });
    return unsub;
  }, []);

  const handleEnrollDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollServerUrl.trim() || !enrollDeviceName.trim()) {
      showToast('Please provide server URL and device name', 'error');
      return;
    }
    try {
      setIsEnrolling(true);
      const cfg = await syncCoordinator.enrollDevice({
        apiBaseUrl: enrollServerUrl.trim(),
        deviceName: enrollDeviceName.trim(),
        businessName: enrollBusinessName.trim() || settings?.businessName || 'SentinelOps Business',
        registrationToken: enrollRegToken.trim(),
      });
      setSyncConfig(cfg);
      showToast('Tablet enrolled successfully! Synchronizing initial dataset...', 'success');
      await loadAll();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Enrollment failed', 'error');
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleDisconnectDevice = async () => {
    try {
      await syncCoordinator.disconnectDevice();
      setSyncConfig(null);
      setIsDisconnectDialogOpen(false);
      showToast('Device unlinked from cloud sync. Local records preserved.', 'info');
      await loadAll();
    } catch {
      showToast('Failed to unlink device', 'error');
    }
  };

  const handleManualSync = async () => {
    try {
      setIsManualSyncing(true);
      const success = await syncCoordinator.triggerSync();
      if (success) {
        showToast('Synchronization completed successfully!', 'success');
      } else {
        showToast('Sync completed with warnings or error. Check status badge.', 'info');
      }
      const [cfg, confl] = await Promise.all([
        syncConfigRepository.getConfig(),
        syncConflictRepository.getAll(),
      ]);
      setSyncConfig(cfg);
      setConflicts(confl);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Manual sync failed', 'error');
    } finally {
      setIsManualSyncing(false);
    }
  };

  const handleResolveConflict = async (operationId: string) => {
    try {
      await syncConflictRepository.resolveConflict(operationId);
      const confl = await syncConflictRepository.getAll();
      setConflicts(confl);
      showToast('Conflict dismissed. Authoritative server revision retained.', 'success');
    } catch {
      showToast('Failed to resolve conflict', 'error');
    }
  };

  const handleToggleAutoSync = async () => {
    if (!syncConfig) return;
    const updated: SyncConfig = {
      ...syncConfig,
      autoSync: !syncConfig.autoSync,
    };
    await syncConfigRepository.saveConfig(updated);
    setSyncConfig(updated);
    showToast(`Auto-sync ${updated.autoSync ? 'enabled' : 'disabled'}`, 'info');
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    try {
      const saved = await settingsRepository.saveSettings(settings, session?.fullName || 'Admin');
      setSettings(saved);
      showToast('Settings saved successfully', 'success');
    } catch {
      showToast('Failed to save settings', 'error');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordChangeError('');
    setPasswordChangeSuccess('');

    if (newPassword.length < 6) {
      setPasswordChangeError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordChangeError('New passwords do not match.');
      return;
    }

    try {
      const user = await userRepository.getUserByUsername(session?.username || 'admin');
      if (!user) throw new Error('User not found');

      const salt = generateSalt(16);
      const newHash = await hashPassword(newPassword, salt);
      user.passwordHash = `${salt}:${newHash}`;
      user.salt = salt;
      await userRepository.saveUser(user);

      setPasswordChangeSuccess('Master password changed successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      showToast('Master password updated', 'success');
    } catch (err: unknown) {
      setPasswordChangeError(err instanceof Error ? err.message : 'Password change failed.');
    }
  };

  const handleBackupJson = async () => {
    try {
      await exportJsonBackup(session?.fullName || 'Admin');
      showToast('JSON backup exported', 'success');
    } catch {
      showToast('Backup export failed', 'error');
    }
  };

  const handleBackupZip = async () => {
    try {
      await exportZipBackup(session?.fullName || 'Admin');
      showToast('Full ZIP backup with attachments exported', 'success');
    } catch {
      showToast('ZIP backup failed', 'error');
    }
  };

  const handleFileSelectedForRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setRestoreFile(file);
    setDryRunReport(null);
    const preview = await validateBackupFile(file);
    setRestorePreview(preview);

    if (preview.valid && preview.previewData) {
      try {
        setIsDryRunning(true);
        const report = await dryRunBackupMigration(preview.previewData);
        setDryRunReport(report);
      } catch (err: unknown) {
        console.error('Dry run failed', err);
      } finally {
        setIsDryRunning(false);
      }
    }
  };

  const handleExecuteRestore = async () => {
    if (!restorePreview || !restorePreview.previewData) return;

    try {
      setIsRestoring(true);
      await restoreBackupData(restorePreview.previewData, restoreFile || undefined, session?.fullName || 'Admin');
      showToast('Database restored successfully from backup!', 'success');
      setRestorePreview(null);
      setRestoreFile(null);
      setDryRunReport(null);
      await loadAll();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Restore failed', 'error');
    } finally {
      setIsRestoring(false);
    }
  };

  const handleExecuteMerge = async () => {
    if (!restorePreview || !restorePreview.previewData) return;

    try {
      setIsMerging(true);
      const { addedCount, updatedCount } = await mergeBackupData(restorePreview.previewData, session?.fullName || 'Admin');
      showToast(`Merged ${addedCount} new records and updated ${updatedCount} existing records without data loss.`, 'success');
      setRestorePreview(null);
      setRestoreFile(null);
      setDryRunReport(null);
      await loadAll();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Merge failed', 'error');
    } finally {
      setIsMerging(false);
    }
  };

  const handleWipeDatabase = async () => {
    try {
      await clearAllDatabaseData();
      showToast('All local records cleared', 'info');
      setIsWipeDialogOpen(false);
      logout();
      window.location.reload();
    } catch {
      showToast('Failed to clear database', 'error');
    }
  };

  // Filtered audit events
  const filteredAuditEvents = auditEvents.filter((ev) => {
    if (!auditFilter) return true;
    const q = auditFilter.toLowerCase();
    return (
      ev.action.toLowerCase().includes(q) ||
      ev.entityType.toLowerCase().includes(q) ||
      (ev.entityLabel && ev.entityLabel.toLowerCase().includes(q)) ||
      ev.actorName.toLowerCase().includes(q)
    );
  });

  if (loading || !settings) {
    return <div className="p-8 text-center text-slate-400">Loading settings...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Settings Navigation Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-slate-800 scrollbar-none">
        <button
          onClick={() => setActiveSection('business')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition ${
            activeSection === 'business'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Building className="w-4 h-4" />
          <span>Business Profile</span>
        </button>

        <button
          onClick={() => setActiveSection('tax')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition ${
            activeSection === 'tax'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Receipt className="w-4 h-4" />
          <span>Tax & VAT</span>
        </button>

        <button
          onClick={() => setActiveSection('quotation')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition ${
            activeSection === 'quotation'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Quotation Terms</span>
        </button>

        <button
          onClick={() => setActiveSection('security')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition ${
            activeSection === 'security'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Lock className="w-4 h-4" />
          <span>Security & Lock</span>
        </button>

        <button
          onClick={() => setActiveSection('backup')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition ${
            activeSection === 'backup'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>Backup & Storage</span>
        </button>

        <button
          onClick={() => setActiveSection('audit')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition ${
            activeSection === 'audit'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Audit Log ({auditEvents.length})</span>
        </button>

        <button
          onClick={() => setActiveSection('sync')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition ${
            activeSection === 'sync'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Cloud className="w-4 h-4" />
          <span>Sync & Multi-Tablet</span>
          {conflicts.length > 0 && (
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
          )}
        </button>
      </div>

      {/* 1. Business Profile Section */}
      {activeSection === 'business' && (
        <form onSubmit={handleSaveSettings} className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Building className="w-4 h-4 text-blue-400" />
            <span>Business Branding & Contact Information</span>
          </h3>
          <p className="text-xs text-slate-400">
            These details appear on generated Quotation and Billing PDFs issued to your clients.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Official Business Name *
              </label>
              <input
                type="text"
                required
                value={settings.businessName}
                onChange={(e) => setSettings({ ...settings, businessName: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Trading / Brand Name
              </label>
              <input
                type="text"
                value={settings.tradingName}
                onChange={(e) => setSettings({ ...settings, tradingName: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Tagline / Service Specialty
              </label>
              <input
                type="text"
                value={settings.tagline}
                onChange={(e) => setSettings({ ...settings, tagline: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Tax Identification Number (TIN)
              </label>
              <input
                type="text"
                value={settings.tinNumber}
                onChange={(e) => setSettings({ ...settings, tinNumber: e.target.value })}
                placeholder="123-456-789-000"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Operations Hotline / Mobile Number *
              </label>
              <input
                type="tel"
                required
                value={settings.contactNumber}
                onChange={(e) => setSettings({ ...settings, contactNumber: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Official Business Email *
              </label>
              <input
                type="email"
                required
                value={settings.email}
                onChange={(e) => setSettings({ ...settings, email: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Business Address
              </label>
              <input
                type="text"
                value={settings.address}
                onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                City / Municipality
              </label>
              <input
                type="text"
                value={settings.city}
                onChange={(e) => setSettings({ ...settings, city: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Province / Region
              </label>
              <input
                type="text"
                value={settings.region}
                onChange={(e) => setSettings({ ...settings, region: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800 flex justify-end">
            <button
              type="submit"
              className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 font-bold text-xs text-white shadow-md"
            >
              Save Business Profile
            </button>
          </div>
        </form>
      )}

      {/* 2. Tax & VAT Configuration */}
      {activeSection === 'tax' && (
        <form onSubmit={handleSaveSettings} className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Receipt className="w-4 h-4 text-emerald-400" />
            <span>Taxation & Currency Settings</span>
          </h3>
          <p className="text-xs text-slate-400">
            Configure how value-added tax is calculated on quotes and invoices. Note: Local commercial invoices do not substitute for official BIR registration.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Default Tax Calculation Mode
              </label>
              <select
                value={settings.taxMode}
                onChange={(e) => setSettings({ ...settings, taxMode: e.target.value as TaxMode })}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white"
              >
                <option value="EXCLUSIVE">VAT Exclusive (Add 12% to subtotal)</option>
                <option value="INCLUSIVE">VAT Inclusive (Subtotal backed out from price)</option>
                <option value="NON_VAT">Non-VAT (0% Tax Rate)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Tax Rate Percentage (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={settings.taxRatePercent}
                onChange={(e) => setSettings({ ...settings, taxRatePercent: parseFloat(e.target.value) || 0 })}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Currency Code
              </label>
              <input
                type="text"
                disabled
                value="PHP"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700 text-sm text-slate-400 cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Currency Symbol
              </label>
              <input
                type="text"
                disabled
                value="₱"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700 text-sm text-slate-400 cursor-not-allowed"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800 flex justify-end">
            <button
              type="submit"
              className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 font-bold text-xs text-white shadow-md"
            >
              Save Tax Settings
            </button>
          </div>
        </form>
      )}

      {/* 3. Quotation Defaults Section */}
      {activeSection === 'quotation' && (
        <form onSubmit={handleSaveSettings} className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-purple-400" />
            <span>Default Quotation Terms & Conditions</span>
          </h3>

          <div className="space-y-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Default Quotation Validity (Days)
              </label>
              <input
                type="number"
                min="1"
                max="365"
                value={settings.defaultQuotationValidityDays}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    defaultQuotationValidityDays: parseInt(e.target.value) || 30,
                  })
                }
                className="w-full sm:w-48 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Default Payment Milestone Terms
              </label>
              <textarea
                rows={3}
                value={settings.defaultPaymentTerms}
                onChange={(e) => setSettings({ ...settings, defaultPaymentTerms: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Default Warranty Clause
              </label>
              <textarea
                rows={3}
                value={settings.defaultWarrantyTerms}
                onChange={(e) => setSettings({ ...settings, defaultWarrantyTerms: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Standard Inclusions & Exclusions
              </label>
              <textarea
                rows={3}
                value={settings.defaultQuotationNotes}
                onChange={(e) => setSettings({ ...settings, defaultQuotationNotes: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800 flex justify-end">
            <button
              type="submit"
              className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 font-bold text-xs text-white shadow-md"
            >
              Save Quotation Defaults
            </button>
          </div>
        </form>
      )}

      {/* 4. Security & Auto-Lock Section */}
      {activeSection === 'security' && (
        <div className="space-y-6">
          {/* Auto Lock Configuration */}
          <form onSubmit={handleSaveSettings} className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-400" />
              <span>Tablet Auto-Lock & Session Inactivity</span>
            </h3>
            <p className="text-xs text-slate-400">
              Locks the application interface when the tablet is left unattended to protect financial records.
            </p>

            <div className="w-full sm:w-64 pt-2">
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Auto-Lock Timeout
              </label>
              <select
                value={settings.autoLockMinutes}
                onChange={(e) => setSettings({ ...settings, autoLockMinutes: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white"
              >
                <option value="5">5 Minutes</option>
                <option value="10">10 Minutes</option>
                <option value="15">15 Minutes (Recommended)</option>
                <option value="30">30 Minutes</option>
                <option value="0">Never (Disable Auto-Lock)</option>
              </select>
            </div>

            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold text-xs text-white"
            >
              Save Lock Timeout
            </button>
          </form>

          {/* Change Master Password */}
          <form onSubmit={handleChangePassword} className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-blue-400" />
              <span>Change Master Password</span>
            </h3>

            {passwordChangeError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                {passwordChangeError}
              </div>
            )}
            {passwordChangeSuccess && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
                {passwordChangeSuccess}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  New Master Password
                </label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  required
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="Repeat new password"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white"
                />
              </div>
            </div>

            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 font-semibold text-xs text-white"
            >
              Update Password
            </button>
          </form>
        </div>
      )}

      {/* 5. Backup, Storage & Data Portability */}
      {activeSection === 'backup' && (
        <div className="space-y-6">
          {/* Storage Quota Card */}
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-blue-400" />
              <span>Tablet Local Storage Estimate</span>
            </h3>

            <div className="space-y-2">
              <div className="flex justify-between text-xs text-slate-300">
                <span>
                  Storage Used: <strong>{(storageUsage.usedBytes / (1024 * 1024)).toFixed(2)} MB</strong>
                </span>
                <span>
                  Available Quota: <strong>{(storageUsage.quotaBytes / (1024 * 1024 * 1024)).toFixed(1)} GB</strong>
                </span>
              </div>
              <div className="w-full h-3 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full"
                  style={{ width: `${Math.max(2, storageUsage.percentage)}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-500">
                Data persists in IndexedDB. Regular manual exports to USB or Google Drive are strongly advised.
              </p>
            </div>
          </div>

          {/* Export Backups */}
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Download className="w-4 h-4 text-emerald-400" />
              <span>Export Full Offline Backup</span>
            </h3>
            <p className="text-xs text-slate-400">
              Download your complete client registry, quotations, invoices, payments, and site photo attachments.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                onClick={handleBackupJson}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 border border-slate-700 shadow-sm"
              >
                <Download className="w-4 h-4 text-blue-400" />
                <span>Export JSON Database Snapshot</span>
              </button>

              <button
                onClick={handleBackupZip}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white shadow-md shadow-blue-600/30"
              >
                <Download className="w-4 h-4 text-white" />
                <span>Export Full ZIP Archive (with Photos)</span>
              </button>
            </div>
          </div>

          {/* Restore from Backup */}
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Upload className="w-4 h-4 text-purple-400" />
              <span>Restore Database from Backup</span>
            </h3>
            <p className="text-xs text-slate-400">
              Restore verified records from a previously exported .json or .zip archive. An audit check verifies file integrity before replacing any data.
            </p>

            <div className="pt-2">
              <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-purple-500/40 bg-purple-500/10 hover:bg-purple-500/20 text-xs font-bold text-purple-300">
                <Upload className="w-4 h-4" />
                <span>Select .JSON or .ZIP Backup File</span>
                <input
                  type="file"
                  accept=".json,.zip"
                  onChange={handleFileSelectedForRestore}
                  className="hidden"
                />
              </label>
            </div>

            {/* Verification Preview Card */}
            {restorePreview && (
              <div className="p-4 rounded-xl bg-slate-800/80 border border-slate-700 space-y-3">
                {restorePreview.valid && restorePreview.manifest ? (
                  <>
                    <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Valid SentinelOps Backup File Verified (Schema v{restorePreview.manifest.schemaVersion})</span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="p-2 rounded-lg bg-slate-900 text-slate-300">
                        Clients: <strong>{restorePreview.manifest.recordCounts.clients}</strong>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-900 text-slate-300">
                        Quotations: <strong>{restorePreview.manifest.recordCounts.quotations}</strong>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-900 text-slate-300">
                        Invoices: <strong>{restorePreview.manifest.recordCounts.invoices}</strong>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-900 text-slate-300">
                        Payments: <strong>{restorePreview.manifest.recordCounts.payments}</strong>
                      </div>
                    </div>

                    {/* Dry Run Analysis Report */}
                    {isDryRunning && (
                      <p className="text-xs text-blue-400 animate-pulse">Running pre-migration dry-run analysis...</p>
                    )}

                    {dryRunReport && (
                      <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-200">Dry-Run Migration Audit:</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              dryRunReport.recommendation === 'SAFE_TO_MERGE'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            }`}
                          >
                            {dryRunReport.recommendation === 'SAFE_TO_MERGE'
                              ? '✓ Non-Destructive Merge Safe'
                              : '⚠ Review Conflicts Before Merge'}
                          </span>
                        </div>

                        {dryRunReport.duplicateIds.length > 0 && (
                          <p className="text-[11px] text-slate-400">
                            • Existing records to be updated: <strong>{dryRunReport.duplicateIds.length}</strong>
                          </p>
                        )}

                        {dryRunReport.documentNumberCollisions.length > 0 && (
                          <div className="p-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] space-y-1">
                            <span className="font-bold">Numbering Collisions:</span>
                            {dryRunReport.documentNumberCollisions.slice(0, 3).map((col, idx) => (
                              <div key={idx}>• {col}</div>
                            ))}
                            {dryRunReport.documentNumberCollisions.length > 3 && (
                              <div>+ {dryRunReport.documentNumberCollisions.length - 3} more...</div>
                            )}
                          </div>
                        )}

                        {dryRunReport.missingRelations.length > 0 && (
                          <div className="p-2 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px] space-y-1">
                            <span className="font-bold">Relational Integrity Warnings:</span>
                            {dryRunReport.missingRelations.slice(0, 2).map((rel, idx) => (
                              <div key={idx}>• {rel}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <button
                        onClick={handleExecuteMerge}
                        disabled={isMerging || isRestoring}
                        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white shadow-md disabled:opacity-50"
                        title="Merge backup records into existing local database without deleting current records"
                      >
                        {isMerging ? 'Merging Records...' : 'Safe Merge (Preserve Local)'}
                      </button>

                      <button
                        onClick={handleExecuteRestore}
                        disabled={isRestoring || isMerging}
                        className="px-4 py-2 rounded-xl bg-purple-600/90 hover:bg-purple-600 text-xs font-bold text-white shadow-md disabled:opacity-50"
                        title="Replace all local records with backup archive"
                      >
                        {isRestoring ? 'Replacing Data...' : 'Full Restore (Clean Replace)'}
                      </button>

                      <button
                        onClick={() => {
                          setRestorePreview(null);
                          setRestoreFile(null);
                          setDryRunReport(null);
                        }}
                        className="text-xs text-slate-400 hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-rose-400 text-xs font-medium">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{restorePreview.error || 'Invalid backup file'}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Danger Zone: Wipe Data */}
          <div className="p-6 rounded-2xl bg-rose-950/20 border border-rose-900/50 space-y-4">
            <h3 className="text-base font-bold text-rose-400 flex items-center gap-2">
              <Trash2 className="w-4 h-4" />
              <span>Danger Zone — Reset Database</span>
            </h3>
            <p className="text-xs text-slate-400">
              Clears all local records from IndexedDB to reset SentinelOps to a fresh state. Ensure you have exported a backup first.
            </p>
            <button
              onClick={() => setIsWipeDialogOpen(true)}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white shadow-sm"
            >
              Clear All Local Data
            </button>
          </div>
        </div>
      )}

      {/* 6. Audit Trail Section */}
      {activeSection === 'audit' && (
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <History className="w-4 h-4 text-blue-400" />
                <span>Security Audit Log</span>
              </h3>
              <p className="text-xs text-slate-400">
                Immutable record of logins, quotation issuances, billing payments, and record updates.
              </p>
            </div>

            <input
              type="text"
              value={auditFilter}
              onChange={(e) => setAuditFilter(e.target.value)}
              placeholder="Filter audit actions..."
              className="px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white"
            />
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto divide-y divide-slate-800">
            {filteredAuditEvents.length === 0 ? (
              <p className="text-xs text-slate-500 italic p-4 text-center">No audit records found.</p>
            ) : (
              filteredAuditEvents.map((ev) => (
                <div key={ev.id} className="pt-2 text-xs flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white">{ev.action}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-slate-800 text-slate-300">
                        {ev.entityType}
                      </span>
                    </div>
                    {ev.entityLabel && <p className="text-slate-300 mt-0.5">{ev.entityLabel}</p>}
                    <span className="text-[10px] text-slate-500">
                      Actor: {ev.actorName} ({ev.actorId})
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 shrink-0">
                    {new Date(ev.timestamp).toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 7. Sync & Multi-Tablet Subsystem Section */}
      {activeSection === 'sync' && (
        <div className="space-y-6">
          {/* Header Description */}
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Cloud className="w-5 h-5 text-blue-400" />
              <span>Multi-Tablet Synchronization & Central Server</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              SentinelOps is designed offline-first. All client inquiries, quotes, issued invoices, and progress photos are stored instantly in local IndexedDB. When connected to your centralized SentinelOps ASP.NET Core & PostgreSQL server, the sync coordinator automatically pushes outbox batches and pulls remote team changes.
            </p>
          </div>

          {/* Sync Status & Active Device Overview */}
          {syncConfig ? (
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      syncState.status === 'Synced'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : syncState.status === 'Syncing'
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : syncState.status === 'Conflict'
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : syncState.status === 'Offline'
                        ? 'bg-slate-800 text-slate-400 border border-slate-700'
                        : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {syncState.status === 'Offline' ? (
                      <CloudOff className="w-5 h-5" />
                    ) : syncState.status === 'Syncing' ? (
                      <RefreshCw className="w-5 h-5 animate-spin" />
                    ) : (
                      <Cloud className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-sm sm:text-base">
                        Status: {syncState.status}
                      </span>
                      {syncConfig.autoSync && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold">
                          Auto-Sync Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">
                      {syncState.lastSuccessfulSyncAt
                        ? `Last synchronized: ${new Date(syncState.lastSuccessfulSyncAt).toLocaleString()}`
                        : 'No successful sync yet.'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleManualSync}
                    disabled={isManualSyncing || !syncState.isOnline}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-bold text-white shadow-md shadow-blue-600/30 transition"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isManualSyncing ? 'animate-spin' : ''}`} />
                    <span>{isManualSyncing ? 'Syncing...' : 'Sync Now'}</span>
                  </button>

                  <button
                    onClick={handleToggleAutoSync}
                    className={`px-3 py-2 rounded-xl text-xs font-bold border transition ${
                      syncConfig.autoSync
                        ? 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                        : 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                    }`}
                  >
                    {syncConfig.autoSync ? 'Pause Auto' : 'Enable Auto'}
                  </button>
                </div>
              </div>

              {/* Identity & Metadata Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
                  <span className="text-[11px] text-slate-400 block mb-1">Business Organization</span>
                  <span className="font-bold text-white text-sm">{syncConfig.businessName}</span>
                  <span className="block text-[10px] text-slate-500 truncate mt-0.5" title={syncConfig.businessId}>
                    ID: {syncConfig.businessId}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
                  <span className="text-[11px] text-slate-400 block mb-1">Device Name</span>
                  <span className="font-bold text-white text-sm">{syncConfig.deviceName}</span>
                  <span className="block text-[10px] text-slate-500 truncate mt-0.5" title={syncConfig.deviceId}>
                    Device ID: {syncConfig.deviceId}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
                  <span className="text-[11px] text-slate-400 block mb-1">Server Endpoint</span>
                  <span className="font-bold text-white text-xs truncate block">{syncConfig.apiBaseUrl}</span>
                  <span className="block text-[10px] text-emerald-400 mt-0.5">TLS / API v1</span>
                </div>

                <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
                  <span className="text-[11px] text-slate-400 block mb-1">Durable Outbox Queue</span>
                  <span className="font-bold text-white text-sm">{syncState.pendingCount} Pending</span>
                  <span className="block text-[10px] text-slate-500 mt-0.5">
                    {syncState.pendingCount === 0 ? 'All local mutations pushed' : 'Awaiting server push'}
                  </span>
                </div>
              </div>

              {/* Disconnect Action */}
              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => setIsDisconnectDialogOpen(true)}
                  className="text-xs text-rose-400 hover:text-rose-300 font-semibold transition"
                >
                  Unlink Tablet from Server...
                </button>
              </div>
            </div>
          ) : (
            /* Enrollment Form */
            <form onSubmit={handleEnrollDevice} className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-blue-400" />
                <h4 className="text-sm font-bold text-white">Enroll This Device to SentinelOps Central Server</h4>
              </div>
              <p className="text-xs text-slate-400">
                Enter your SentinelOps Web API endpoint and registration credentials to securely pair this tablet.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Central API Base URL *
                  </label>
                  <input
                    type="url"
                    required
                    value={enrollServerUrl}
                    onChange={(e) => setEnrollServerUrl(e.target.value)}
                    placeholder="https://sentinelops-api.yourcompany.com or http://192.168.1.100:5000"
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    For private office LAN setups, enter your local host IP/port. For cloud setups, enter your HTTPS API domain.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Business / Company Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={enrollBusinessName}
                    onChange={(e) => setEnrollBusinessName(e.target.value)}
                    placeholder="e.g. Sentinel Security PH"
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Tablet / Device Label *
                  </label>
                  <input
                    type="text"
                    required
                    value={enrollDeviceName}
                    onChange={(e) => setEnrollDeviceName(e.target.value)}
                    placeholder="e.g. Operations Tablet 1 (Pasig)"
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Device Registration / Invitation Key *
                  </label>
                  <input
                    type="password"
                    required
                    value={enrollRegToken}
                    onChange={(e) => setEnrollRegToken(e.target.value)}
                    placeholder="Enter registration token issued by administrator"
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Matches the server's <code>Sync:RegistrationToken</code> configuration.
                  </p>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={isEnrolling}
                  className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-bold text-xs text-white shadow-md shadow-blue-600/30 transition flex items-center gap-2"
                >
                  {isEnrolling && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isEnrolling ? 'Enrolling Tablet...' : 'Connect & Enroll Tablet'}</span>
                </button>
              </div>
            </form>
          )}

          {/* Sync Conflict Resolution Panel */}
          {conflicts.length > 0 && (
            <div className="p-6 rounded-2xl bg-amber-950/20 border border-amber-900/50 space-y-4">
              <div className="flex items-center gap-2 text-amber-400">
                <AlertTriangle className="w-5 h-5" />
                <h4 className="text-sm font-bold">Concurrent Sync Conflicts Detected ({conflicts.length})</h4>
              </div>
              <p className="text-xs text-slate-400">
                The records below were modified on another tablet while offline. The authoritative server revision was applied locally. You can inspect the local changes and dismiss the conflict warning.
              </p>

              <div className="space-y-3">
                {conflicts.map((confl) => (
                  <div
                    key={confl.operationId}
                    className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white">
                        {confl.entityType} ({confl.entityId.slice(0, 8)}...)
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {new Date(confl.occurredAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-slate-300">{confl.message}</p>
                    <div className="flex justify-end pt-1">
                      <button
                        onClick={() => handleResolveConflict(confl.operationId)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700"
                      >
                        Dismiss & Keep Server Version
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Disconnect Device Confirmation Dialog */}
      {isDisconnectDialogOpen && (
        <ConfirmDialog
          isOpen={isDisconnectDialogOpen}
          onClose={() => setIsDisconnectDialogOpen(false)}
          onConfirm={handleDisconnectDevice}
          title="Unlink Tablet from Server Sync"
          message="Are you sure you want to disconnect this device from cloud sync? All clients, quotes, invoices, and photos currently stored on this tablet will remain intact and usable offline."
          confirmLabel="Unlink Device"
          variant="warning"
        />
      )}

      {/* Wipe Confirmation Dialog */}
      {isWipeDialogOpen && (
        <ConfirmDialog
          isOpen={isWipeDialogOpen}
          onClose={() => setIsWipeDialogOpen(false)}
          onConfirm={handleWipeDatabase}
          title="Reset Entire Database"
          message="WARNING: This will erase all clients, quotations, invoices, payments, and site photo attachments stored locally on this tablet. Ensure you have exported a ZIP backup before proceeding. Are you absolutely certain?"
          confirmLabel="Erase All Data"
          variant="danger"
        />
      )}
    </div>
  );
};
