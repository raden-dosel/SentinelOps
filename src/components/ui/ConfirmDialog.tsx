import React from 'react';
import { Modal } from './Modal';
import { AlertTriangle, AlertCircle, Info } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  isLoading?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  isLoading = false,
}) => {
  const icon = {
    danger: <AlertTriangle className="w-6 h-6 text-rose-500" />,
    warning: <AlertCircle className="w-6 h-6 text-amber-500" />,
    info: <Info className="w-6 h-6 text-blue-500" />,
  }[variant];

  const btnStyle = {
    danger: 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-950/50',
    warning: 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-950/50',
    info: 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-950/50',
  }[variant];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="md">
      <div className="space-y-4">
        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60 shrink-0">
            {icon}
          </div>
          <p className="text-sm text-slate-300 leading-relaxed pt-1">{message}</p>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white transition"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`px-5 py-2 rounded-xl text-sm font-semibold shadow-lg transition active:scale-95 disabled:opacity-50 ${btnStyle}`}
          >
            {isLoading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
};
