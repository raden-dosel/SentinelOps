import React, { useState } from 'react';
import { useAuth } from '../../app/providers/AuthContext';
import {
  Shield,
  KeyRound,
  User,
  Lock,
  HelpCircle,
  CheckCircle2,
  Copy,
  Download,
  Printer,
  AlertTriangle,
  ArrowRight,
  Check,
} from 'lucide-react';

export const SetupScreen: React.FC = () => {
  const { setupInitialUser, completeInitialSetup } = useAuth();
  const [step, setStep] = useState<'form' | 'recovery-codes'>('form');

  // Form inputs
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [securityQuestion, setSecurityQuestion] = useState(
    'What was the name of your first security client?'
  );
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Recovery codes display state
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [hasConfirmedSaved, setHasConfirmedSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!fullName.trim()) {
      setError('Please enter your full name or business owner name.');
      return;
    }
    if (!username.trim()) {
      setError('Please choose an administrative username.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (!/[A-Za-z]/.test(password) || !/[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
      setError('Password must contain letters and at least one number or special symbol.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!securityAnswer.trim()) {
      setError('Please provide an answer to your recovery security question.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await setupInitialUser({
        fullName,
        username,
        password,
        securityQuestion,
        securityAnswer,
      });
      setRecoveryCodes(result.rawRecoveryCodes);
      setStep('recovery-codes');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Setup failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyCodes = () => {
    const text = [
      '========================================',
      'SENTINELOPS EMERGENCY RECOVERY CODES',
      `Account: ${username}`,
      `Generated: ${new Date().toISOString()}`,
      '========================================',
      '',
      ...recoveryCodes.map((c, i) => `${i + 1}. ${c}`),
      '',
      'Each code is single-use. Store in a safe location.',
      '========================================',
    ].join('\n');

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDownloadCodes = () => {
    const text = [
      '========================================',
      'SENTINELOPS EMERGENCY RECOVERY CODES',
      `Account: ${username}`,
      `Generated: ${new Date().toISOString()}`,
      '========================================',
      '',
      ...recoveryCodes.map((c, i) => `${i + 1}. ${c}`),
      '',
      'Each code is single-use. Store in a safe, offline location.',
      '========================================',
    ].join('\n');

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sentinelops-recovery-codes-${username}-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintCodes = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>SentinelOps Emergency Recovery Codes</title>
          <style>
            body { font-family: monospace; padding: 24px; color: #111; }
            h2 { margin-bottom: 4px; }
            p { margin: 4px 0 16px 0; color: #555; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 16px 0; }
            .code { border: 1px solid #ccc; padding: 8px 12px; font-size: 14px; font-weight: bold; }
            .notice { margin-top: 24px; font-size: 11px; border-top: 1px solid #ddd; padding-top: 8px; color: #666; }
          </style>
        </head>
        <body>
          <h2>SentinelOps — Emergency Recovery Codes</h2>
          <p>Account: <strong>${username}</strong> | Generated: ${new Date().toLocaleString()}</p>
          <div class="grid">
            ${recoveryCodes.map((c, i) => `<div class="code">${i + 1}. ${c}</div>`).join('')}
          </div>
          <div class="notice">
            WARNING: Each recovery code can be used only once. Keep this sheet in a fireproof safe or locked drawer.
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const handleFinish = async () => {
    if (!hasConfirmedSaved) return;
    setIsLoading(true);
    try {
      await completeInitialSetup();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to finalize setup.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 sm:p-6 text-slate-100">
      <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden p-8 sm:p-10">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20 mb-4">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">SentinelOps</h1>
          <p className="text-xs uppercase tracking-widest text-blue-400 font-semibold mt-1">
            Offline-First Security Operations
          </p>
          <div className="mt-4 px-3.5 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300 flex items-center gap-2">
            <KeyRound className="w-3.5 h-3.5" />
            <span>
              {step === 'form' ? 'First-Run Administrator Setup' : 'Save Emergency Recovery Codes'}
            </span>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium">
            {error}
          </div>
        )}

        {step === 'form' ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Owner / Administrator Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Raden Dosel"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Local Username
              </label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Master Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 8 characters"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Confirm Password
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <p className="text-[11px] text-slate-400">
              Password must be at least 8 characters and include letters and at least one number or symbol.
            </p>

            <div className="pt-2 border-t border-slate-800">
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Security Recovery Question (Fallback)
              </label>
              <select
                value={securityQuestion}
                onChange={(e) => setSecurityQuestion(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="What was the name of your first security client?">
                  What was the name of your first security client?
                </option>
                <option value="What city was your security business founded in?">
                  What city was your security business founded in?
                </option>
                <option value="What was the model of your first gate automation motor?">
                  What was the model of your first gate automation motor?
                </option>
                <option value="What was the street name of your first workshop?">
                  What was the street name of your first workshop?
                </option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Recovery Answer
              </label>
              <div className="relative">
                <HelpCircle className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={securityAnswer}
                  onChange={(e) => setSecurityAnswer(e.target.value)}
                  placeholder="Your secret answer"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/50 text-[11px] text-slate-400 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-slate-300">
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
                <span>Multi-Factor Recovery Architecture:</span>
              </div>
              <p>
                In the next step, you will be issued 8 one-time emergency recovery codes. These allow you to recover your account even if you forget both your password and your security answer.
              </p>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-98 font-bold text-sm text-white shadow-xl shadow-blue-600/30 transition disabled:opacity-50 mt-2 flex items-center justify-center gap-2"
            >
              <span>{isLoading ? 'Creating Master Vault...' : 'Continue to Recovery Codes'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        ) : (
          <div className="space-y-5">
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs space-y-2">
              <div className="flex items-center gap-2 font-bold text-amber-300">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                <span>Important: Save Your Emergency Recovery Codes</span>
              </div>
              <p>
                Each code is <strong>single-use</strong>. If you ever forget both your master password and your security question answer, these codes are your only way to regain access offline.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 p-4 rounded-2xl bg-slate-950 border border-slate-800 font-mono text-sm text-center">
              {recoveryCodes.map((code, idx) => (
                <div
                  key={idx}
                  className="py-2 px-3 rounded-lg bg-slate-900 border border-slate-800/80 text-blue-300 font-bold select-all tracking-wider"
                >
                  {code}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopyCodes}
                className="flex-1 min-w-[120px] py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-2 transition"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied to Clipboard!' : 'Copy Codes'}</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadCodes}
                className="flex-1 min-w-[120px] py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-2 transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download .txt</span>
              </button>

              <button
                type="button"
                onClick={handlePrintCodes}
                className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-2 transition"
                title="Print recovery codes"
              >
                <Printer className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Print</span>
              </button>
            </div>

            <label className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-800/50 border border-slate-700/60 cursor-pointer">
              <input
                type="checkbox"
                checked={hasConfirmedSaved}
                onChange={(e) => setHasConfirmedSaved(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-xs text-slate-300 leading-relaxed">
                I have copied, downloaded, or printed my emergency recovery codes and understand they cannot be recovered if lost.
              </span>
            </label>

            <button
              type="button"
              disabled={!hasConfirmedSaved || isLoading}
              onClick={handleFinish}
              className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-98 font-bold text-sm text-white shadow-xl shadow-blue-600/30 transition disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isLoading ? 'Finalizing Setup...' : 'Enter SentinelOps Vault'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
