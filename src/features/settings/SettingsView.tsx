import React, { useState, useEffect } from 'react';
import { AppSettings, AuditEvent, TaxMode } from '../../types';
import {
  settingsRepository,
  auditRepository,
  userRepository,
} from '../../storage/repositories';
import { clearAllDatabaseData } from '../../storage/database';
import {
  exportJsonBackup,
  exportZipBackup,
  validateBackupFile,
  restoreBackupData,
  getStorageEstimate,
  RestorePreview,
} from '../../services/backupService';
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
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const { session, logout } = useAuth();
  const { showToast } = useToast();

  const [activeSection, setActiveSection] = useState<
    'business' | 'tax' | 'quotation' | 'numbering' | 'security' | 'backup' | 'audit'
  >('business');

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditFilter, setAuditFilter] = useState('');
  const [loading, setLoading] = useState(true);

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

  // Backup restore state
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  // Clear data confirm
  const [isWipeDialogOpen, setIsWipeDialogOpen] = useState(false);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [currSettings, events, storage] = await Promise.all([
        settingsRepository.getSettings(),
        auditRepository.getAll(),
        getStorageEstimate(),
      ]);
      setSettings(currSettings);
      setAuditEvents(events);
      setStorageUsage(storage);
    } catch (e) {
      console.error(e);
      showToast('Failed to load settings', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

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
    const preview = await validateBackupFile(file);
    setRestorePreview(preview);
  };

  const handleExecuteRestore = async () => {
    if (!restorePreview || !restorePreview.previewData) return;

    try {
      setIsRestoring(true);
      await restoreBackupData(restorePreview.previewData, restoreFile || undefined, session?.fullName || 'Admin');
      showToast('Database restored successfully from backup!', 'success');
      setRestorePreview(null);
      setRestoreFile(null);
      await loadAll();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Restore failed', 'error');
    } finally {
      setIsRestoring(false);
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
                      <span>Valid SentinelOps Backup File Verified</span>
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

                    <div className="flex items-center gap-3 pt-2">
                      <button
                        onClick={handleExecuteRestore}
                        disabled={isRestoring}
                        className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-bold text-white shadow-md"
                      >
                        {isRestoring ? 'Restoring Data...' : 'Confirm & Restore Records'}
                      </button>
                      <button
                        onClick={() => {
                          setRestorePreview(null);
                          setRestoreFile(null);
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
