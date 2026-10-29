import React, { useState, useEffect, useMemo } from 'react';
import {
  Invoice,
  Payment,
  PaymentMethod,
  Client,
  InvoiceStatus,
  InvoiceLineItem,
} from '../../types';
import {
  invoiceRepository,
  paymentRepository,
  clientRepository,
  settingsRepository,
} from '../../storage/repositories';
import { getNextDocumentNumber } from '../../storage/database';
import { getStatusBadge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../app/providers/ToastContext';
import {
  toCentavos,
  fromCentavos,
  calculateLineTotal,
  calculateTotals,
  formatCurrency,
} from '../../domain/calculations';
import {
  generateInvoicePdf,
  generatePaymentReceiptPdf,
  downloadPdfBlob,
  printPdfBlob,
  sharePdfBlob,
} from '../../services/pdfGenerator';
import {
  Receipt,
  Plus,
  Search,
  Filter,
  Download,
  Printer,
  Share2,
  DollarSign,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  Clock,
  Eye,
  CreditCard,
  Building,
} from 'lucide-react';

interface BillingViewProps {
  initialInvoiceId?: string;
}

export const BillingView: React.FC<BillingViewProps> = ({ initialInvoiceId }) => {
  const { showToast } = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  // Active view tab: Invoices list or Payment records list
  const [activeTab, setActiveTab] = useState<'invoices' | 'payments'>('invoices');

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Create / Edit Invoice Modal
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Partial<Invoice> | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [invoiceLineItems, setInvoiceLineItems] = useState<InvoiceLineItem[]>([]);
  const [newItemDesc, setNewItemDesc] = useState('');
  const [newItemQty, setNewItemQty] = useState(1);
  const [newItemUnit, setNewItemUnit] = useState('lots');
  const [newItemPricePHP, setNewItemPricePHP] = useState(0);

  // Payment Recording Modal
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [targetInvoiceForPayment, setTargetInvoiceForPayment] = useState<Invoice | null>(null);
  const [paymentAmountPHP, setPaymentAmountPHP] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Bank Transfer - BDO');
  const [paymentRef, setPaymentRef] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [receivedBy, setReceivedBy] = useState('Admin');
  const [paymentNotes, setPaymentNotes] = useState('');

  // Void Invoice Modal
  const [isVoidModalOpen, setIsVoidModalOpen] = useState(false);
  const [invoiceToVoid, setInvoiceToVoid] = useState<Invoice | null>(null);
  const [voidReason, setVoidReason] = useState('');

  // Reverse Payment Modal
  const [paymentToReverse, setPaymentToReverse] = useState<Payment | null>(null);
  const [reversalReason, setReversalReason] = useState('');

  // Invoice Details Modal
  const [inspectingInvoice, setInspectingInvoice] = useState<Invoice | null>(null);
  const [inspectingInvoicePayments, setInspectingInvoicePayments] = useState<Payment[]>([]);

  const paymentMethods: PaymentMethod[] = [
    'Cash',
    'Bank Transfer - BDO',
    'Bank Transfer - BPI',
    'Bank Transfer - Metrobank',
    'GCash',
    'Maya',
    'Check',
    'Credit/Debit Card',
    'Other',
  ];

  const loadData = async () => {
    try {
      setLoading(true);
      const [invData, payData, cliData] = await Promise.all([
        invoiceRepository.getAll(),
        paymentRepository.getAll(),
        clientRepository.getAll(),
      ]);
      setInvoices(invData);
      setPayments(payData);
      setClients(cliData);
    } catch {
      showToast('Failed to load billing records', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filtered invoices
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.clientName.toLowerCase().includes(q) ||
        inv.title.toLowerCase().includes(q);

      const matchesStatus = statusFilter === 'ALL' || inv.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [invoices, searchQuery, statusFilter]);

  // Filtered payments
  const filteredPayments = useMemo(() => {
    return payments.filter((p) => {
      const q = searchQuery.toLowerCase().trim();
      return (
        !q ||
        p.paymentNumber.toLowerCase().includes(q) ||
        p.invoiceNumber.toLowerCase().includes(q) ||
        p.clientName.toLowerCase().includes(q) ||
        (p.referenceNumber && p.referenceNumber.toLowerCase().includes(q))
      );
    });
  }, [payments, searchQuery]);

  // Standalone Invoice Creation
  const handleOpenCreateInvoice = async () => {
    const settings = await settingsRepository.getSettings();
    const invNum = await getNextDocumentNumber(settings.invoicePrefix || 'INV-');
    const today = new Date();
    const dueDate = new Date();
    dueDate.setDate(today.getDate() + 15);

    const targetClient = clients[0];

    const newInv: Partial<Invoice> = {
      invoiceNumber: invNum,
      clientId: targetClient ? targetClient.id : '',
      clientName: targetClient ? targetClient.name : '',
      clientContact: targetClient ? targetClient.contactNumber : '',
      clientAddress: targetClient ? targetClient.address : '',
      title: 'Security Maintenance / Service Work',
      issueDate: today.toISOString().split('T')[0],
      dueDate: dueDate.toISOString().split('T')[0],
      taxMode: settings.taxMode,
      taxRatePercent: settings.taxRatePercent,
      status: 'Issued',
    };

    const initialItem: InvoiceLineItem = {
      id: Math.random().toString(36).substring(2, 9),
      description: 'Routine Perimeter Fence Energizer & Sensor Inspection',
      quantity: 1,
      unit: 'lots',
      unitPriceCentavos: toCentavos(4500),
      totalCentavos: toCentavos(4500),
    };

    setEditingInvoice(newInv);
    setSelectedClientId(targetClient ? targetClient.id : '');
    setInvoiceLineItems([initialItem]);
    setIsInvoiceModalOpen(true);
  };

  const handleAddInvoiceItem = () => {
    if (!newItemDesc.trim()) {
      showToast('Item description is required', 'error');
      return;
    }
    if (newItemQty <= 0) {
      showToast('Quantity must be greater than zero', 'error');
      return;
    }
    const priceCentavos = toCentavos(newItemPricePHP);
    const lineTotal = calculateLineTotal(newItemQty, priceCentavos);

    const item: InvoiceLineItem = {
      id: Math.random().toString(36).substring(2, 9),
      description: newItemDesc.trim(),
      quantity: newItemQty,
      unit: newItemUnit,
      unitPriceCentavos: priceCentavos,
      totalCentavos: lineTotal,
    };

    setInvoiceLineItems((prev) => [...prev, item]);
    setNewItemDesc('');
    setNewItemQty(1);
    setNewItemPricePHP(0);
  };

  const handleSaveInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInvoice || !selectedClientId) {
      showToast('Client is required', 'error');
      return;
    }
    if (invoiceLineItems.length === 0) {
      showToast('At least one line item is required', 'error');
      return;
    }

    const client = clients.find((c) => c.id === selectedClientId);
    const sumLines = invoiceLineItems.reduce((acc, it) => acc + it.totalCentavos, 0);
    const totals = calculateTotals(sumLines, editingInvoice.taxMode || 'EXCLUSIVE', editingInvoice.taxRatePercent ?? 12);

    try {
      const fullInvoice: Invoice = {
        id: editingInvoice.id || Math.random().toString(36).substring(2, 9),
        invoiceNumber: editingInvoice.invoiceNumber || 'INV-000',
        clientId: selectedClientId,
        clientName: client?.name || editingInvoice.clientName || '',
        clientContact: client?.contactNumber || editingInvoice.clientContact || '',
        clientAddress: client?.address || editingInvoice.clientAddress || '',
        title: editingInvoice.title || 'Security Work Invoice',
        issueDate: editingInvoice.issueDate || new Date().toISOString().split('T')[0],
        dueDate: editingInvoice.dueDate || new Date().toISOString().split('T')[0],
        lineItems: invoiceLineItems,
        subtotalCentavos: totals.subtotalCentavos,
        taxRatePercent: totals.taxRatePercent,
        taxCentavos: totals.taxCentavos,
        grandTotalCentavos: totals.grandTotalCentavos,
        paidAmountCentavos: editingInvoice.paidAmountCentavos || 0,
        remainingBalanceCentavos: totals.grandTotalCentavos - (editingInvoice.paidAmountCentavos || 0),
        status: (editingInvoice.status as InvoiceStatus) || 'Issued',
        taxMode: totals.taxMode,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await invoiceRepository.save(fullInvoice);
      showToast('Invoice saved successfully', 'success');
      setIsInvoiceModalOpen(false);
      setEditingInvoice(null);
      await loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save invoice', 'error');
    }
  };

  // Payment Recording
  const handleOpenRecordPayment = (inv: Invoice) => {
    setTargetInvoiceForPayment(inv);
    setPaymentAmountPHP(fromCentavos(inv.remainingBalanceCentavos));
    setPaymentMethod('Bank Transfer - BDO');
    setPaymentRef('');
    setPaymentDate(new Date().toISOString().split('T')[0]);
    setPaymentNotes('');
    setIsPaymentModalOpen(true);
  };

  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetInvoiceForPayment) return;

    if (paymentAmountPHP <= 0) {
      showToast('Payment amount must be greater than zero', 'error');
      return;
    }

    const amountCentavos = toCentavos(paymentAmountPHP);
    if (amountCentavos > targetInvoiceForPayment.remainingBalanceCentavos) {
      showToast(
        `Payment cannot exceed outstanding balance of ₱${(targetInvoiceForPayment.remainingBalanceCentavos / 100).toFixed(2)}`,
        'error'
      );
      return;
    }

    try {
      const settings = await settingsRepository.getSettings();
      const payNum = await getNextDocumentNumber(settings.paymentPrefix || 'PAY-');

      const savedPayment = await paymentRepository.recordPayment({
        paymentNumber: payNum,
        invoiceId: targetInvoiceForPayment.id,
        invoiceNumber: targetInvoiceForPayment.invoiceNumber,
        clientId: targetInvoiceForPayment.clientId,
        clientName: targetInvoiceForPayment.clientName,
        amountCentavos,
        paymentDate,
        paymentMethod,
        referenceNumber: paymentRef,
        receivedBy,
        notes: paymentNotes,
      });

      showToast(`Payment ${payNum} of ${formatCurrency(amountCentavos)} recorded!`, 'success');
      setIsPaymentModalOpen(false);
      setTargetInvoiceForPayment(null);
      await loadData();

      // Offer to download receipt immediately
      const confirmReceipt = window.confirm('Payment recorded successfully! Would you like to generate and download the Collection Receipt PDF now?');
      if (confirmReceipt) {
        const inv = await invoiceRepository.getById(savedPayment.invoiceId);
        if (inv) {
          const pdfBytes = await generatePaymentReceiptPdf(savedPayment, inv, settings);
          downloadPdfBlob(pdfBytes, `${savedPayment.paymentNumber}_Receipt.pdf`);
        }
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Payment recording failed', 'error');
    }
  };

  // Inspect invoice and view applied payments
  const handleInspectInvoice = async (inv: Invoice) => {
    setInspectingInvoice(inv);
    const invoicePayments = await paymentRepository.getByInvoiceId(inv.id);
    setInspectingInvoicePayments(invoicePayments);
  };

  // Void Invoice
  const handleExecuteVoid = async () => {
    if (!invoiceToVoid) return;
    if (!voidReason.trim()) {
      showToast('Void reason is required', 'error');
      return;
    }

    try {
      await invoiceRepository.voidInvoice(invoiceToVoid.id, voidReason);
      showToast(`Invoice ${invoiceToVoid.invoiceNumber} has been voided.`, 'success');
      setIsVoidModalOpen(false);
      setInvoiceToVoid(null);
      setVoidReason('');
      await loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Cannot void invoice', 'error');
    }
  };

  // Reverse Payment
  const handleExecutePaymentReversal = async () => {
    if (!paymentToReverse) return;
    if (!reversalReason.trim()) {
      showToast('Reversal reason is required', 'error');
      return;
    }

    try {
      await paymentRepository.reversePayment(paymentToReverse.id, reversalReason);
      showToast(`Payment ${paymentToReverse.paymentNumber} reversed. Invoice balance restored.`, 'success');
      setPaymentToReverse(null);
      setReversalReason('');
      await loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Cannot reverse payment', 'error');
    }
  };

  // PDF Generators
  const handleDownloadInvoicePdf = async (inv: Invoice) => {
    try {
      const settings = await settingsRepository.getSettings();
      const pdfBytes = await generateInvoicePdf(inv, settings);
      downloadPdfBlob(pdfBytes, `${inv.invoiceNumber}_Invoice.pdf`);
      showToast('Invoice PDF downloaded', 'success');
    } catch {
      showToast('Failed to generate Invoice PDF', 'error');
    }
  };

  const handlePrintInvoicePdf = async (inv: Invoice) => {
    try {
      const settings = await settingsRepository.getSettings();
      const pdfBytes = await generateInvoicePdf(inv, settings);
      printPdfBlob(pdfBytes);
    } catch {
      showToast('Print failed', 'error');
    }
  };

  const handleShareInvoicePdf = async (inv: Invoice) => {
    try {
      const settings = await settingsRepository.getSettings();
      const pdfBytes = await generateInvoicePdf(inv, settings);
      const shared = await sharePdfBlob(
        pdfBytes,
        `${inv.invoiceNumber}_Invoice.pdf`,
        `Billing Invoice ${inv.invoiceNumber}`,
        `${inv.invoiceNumber} for ${inv.clientName}\n${inv.title}\nTotal: ${formatCurrency(inv.grandTotalCentavos)}\nBalance Due: ${formatCurrency(inv.remainingBalanceCentavos)}`
      );
      if (shared) showToast('Invoice PDF is ready to share or download; summary was copied when supported', 'success');
      else showToast('Sharing cancelled. No message was sent.', 'info');
    } catch {
      showToast('Share failed', 'error');
    }
  };

  const handleDownloadReceiptPdf = async (payment: Payment) => {
    try {
      const inv = await invoiceRepository.getById(payment.invoiceId);
      if (!inv) throw new Error('Invoice not found');
      const settings = await settingsRepository.getSettings();
      const pdfBytes = await generatePaymentReceiptPdf(payment, inv, settings);
      downloadPdfBlob(pdfBytes, `${payment.paymentNumber}_Receipt.pdf`);
      showToast('Receipt PDF downloaded', 'success');
    } catch {
      showToast('Failed to generate receipt PDF', 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Billing, Invoices & Collections
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Track receivables, issue billing statements, collect partial payments, and generate commercial receipts.
          </p>
        </div>

        <button
          onClick={handleOpenCreateInvoice}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs sm:text-sm font-semibold shadow-lg shadow-blue-600/30 transition"
        >
          <Plus className="w-4 h-4" />
          <span>New Standalone Invoice</span>
        </button>
      </div>

      {/* Tabs Switcher: Invoices vs Payments */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('invoices')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition ${
            activeTab === 'invoices'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Receipt className="w-4 h-4" />
          <span>Invoices ({invoices.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('payments')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition ${
            activeTab === 'payments'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <DollarSign className="w-4 h-4" />
          <span>Recorded Payments ({payments.length})</span>
        </button>
      </div>

      {/* Search & Filter Bar */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-stretch md:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              activeTab === 'invoices'
                ? 'Search by invoice #, client name, or title...'
                : 'Search by receipt #, ref #, or client...'
            }
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-800/80 border border-slate-700 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {activeTab === 'invoices' && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-400 shrink-0">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
            >
              <option value="ALL">All Statuses ({invoices.length})</option>
              <option value="Issued">Issued</option>
              <option value="Partially Paid">Partially Paid</option>
              <option value="Paid">Paid</option>
              <option value="Overdue">Overdue</option>
              <option value="Draft">Draft</option>
              <option value="Void">Void</option>
            </select>
          </div>
        )}
      </div>

      {/* Invoices Tab View */}
      {activeTab === 'invoices' && (
        <div className="space-y-3">
          {loading ? (
            <div className="p-8 text-center text-slate-400 text-sm rounded-2xl bg-slate-900 border border-slate-800">
              Loading invoices...
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <Receipt className="w-10 h-10 text-slate-600 mx-auto" />
              <h3 className="text-base font-bold text-white">No invoices found</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Generate invoices directly from accepted quotations or create a standalone billing statement.
              </p>
            </div>
          ) : (
            filteredInvoices.map((inv) => (
              <div
                key={inv.id}
                className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="text-base font-bold text-white">{inv.invoiceNumber}</span>
                      {getStatusBadge(inv.status)}
                      {inv.quotationNumber && (
                        <span className="text-xs text-blue-400">From {inv.quotationNumber}</span>
                      )}
                    </div>
                    <h4 className="text-sm font-semibold text-slate-200 mt-1">{inv.title}</h4>
                    <p className="text-xs text-slate-400">
                      Billed to: <strong className="text-slate-300">{inv.clientName}</strong> •
                      Issued: {inv.issueDate} • Due: <span className={inv.status === 'Overdue' ? 'text-rose-400 font-bold' : ''}>{inv.dueDate}</span>
                    </p>
                  </div>

                  <div className="text-left sm:text-right">
                    <div className="text-lg font-black text-white">
                      {formatCurrency(inv.grandTotalCentavos)}
                    </div>
                    <div className="text-xs font-semibold mt-0.5">
                      {inv.remainingBalanceCentavos > 0 ? (
                        <span className="text-rose-400">
                          Balance Due: {formatCurrency(inv.remainingBalanceCentavos)}
                        </span>
                      ) : (
                        <span className="text-emerald-400">Fully Paid ✓</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Progress bar of payment */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-slate-400 font-medium">
                    <span>Paid: {formatCurrency(inv.paidAmountCentavos)}</span>
                    <span>
                      {Math.round((inv.paidAmountCentavos / (inv.grandTotalCentavos || 1)) * 100)}% Settled
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        inv.status === 'Paid' ? 'bg-emerald-500' : 'bg-blue-500'
                      }`}
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round((inv.paidAmountCentavos / (inv.grandTotalCentavos || 1)) * 100)
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Actions Bar */}
                <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleDownloadInvoicePdf(inv)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-800/80 text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-700"
                    >
                      <Download className="w-3.5 h-3.5 text-blue-400" />
                      <span>Invoice PDF</span>
                    </button>
                    <button
                      onClick={() => handlePrintInvoicePdf(inv)}
                      className="p-1.5 rounded-xl border border-slate-700 bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700"
                      title="Print Invoice"
                    >
                      <Printer className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleShareInvoicePdf(inv)}
                      className="p-1.5 rounded-xl border border-slate-700 bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700"
                      title="Share Invoice"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleInspectInvoice(inv)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-700 bg-slate-800/80 text-xs text-slate-300 hover:text-white"
                    >
                      <Eye className="w-3.5 h-3.5 text-slate-400" />
                      <span>History</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Record Payment Button */}
                    {inv.status !== 'Paid' && inv.status !== 'Void' && (
                      <button
                        onClick={() => handleOpenRecordPayment(inv)}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 active:scale-95 transition"
                      >
                        <DollarSign className="w-3.5 h-3.5" />
                        <span>Record Payment</span>
                      </button>
                    )}

                    {/* Void Invoice Button */}
                    {inv.status !== 'Void' && inv.paidAmountCentavos === 0 && (
                      <button
                        onClick={() => {
                          setInvoiceToVoid(inv);
                          setIsVoidModalOpen(true);
                        }}
                        className="p-1.5 rounded-xl border border-slate-700 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 text-xs"
                        title="Void Invoice"
                      >
                        Void
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Recorded Payments Tab View */}
      {activeTab === 'payments' && (
        <div className="space-y-3">
          {filteredPayments.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <DollarSign className="w-10 h-10 text-slate-600 mx-auto" />
              <h3 className="text-base font-bold text-white">No payment transactions recorded</h3>
              <p className="text-xs text-slate-400">
                Payments recorded against invoices will appear here with printable collection receipts.
              </p>
            </div>
          ) : (
            filteredPayments.map((p) => (
              <div
                key={p.id}
                className={`p-4 rounded-2xl bg-slate-900 border transition flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  p.isReversed ? 'border-rose-900/50 opacity-75' : 'border-slate-800'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-sm">{p.paymentNumber}</span>
                    {p.isReversed ? (
                      <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[10px] font-bold">
                        REVERSED
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold">
                        VALID COLLECTION
                      </span>
                    )}
                    <span className="text-xs text-slate-400">for Invoice {p.invoiceNumber}</span>
                  </div>

                  <p className="text-xs text-slate-300 mt-1">
                    Client: <strong className="text-white">{p.clientName}</strong> • Date: {p.paymentDate}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <CreditCard className="w-3.5 h-3.5 text-blue-400" />
                      {p.paymentMethod}
                    </span>
                    {p.referenceNumber && <span>Ref #: {p.referenceNumber}</span>}
                    {p.receivedBy && <span>Received By: {p.receivedBy}</span>}
                  </div>

                  {p.isReversed && p.reversalReason && (
                    <p className="text-[11px] text-rose-400 mt-1 italic">
                      Reversal Reason: {p.reversalReason}
                    </p>
                  )}
                </div>

                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-3 shrink-0">
                  <div className="text-left sm:text-right">
                    <span className="text-base font-black text-emerald-400 font-mono">
                      +{formatCurrency(p.amountCentavos)}
                    </span>
                    <p className="text-[10px] text-slate-500">
                      Balance left: {formatCurrency(p.remainingBalanceAfterPaymentCentavos)}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {!p.isReversed && (
                      <>
                        <button
                          onClick={() => handleDownloadReceiptPdf(p)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs font-semibold text-slate-200 hover:text-white"
                          title="Download Receipt PDF"
                        >
                          <Download className="w-3 h-3 text-blue-400" />
                          <span>Receipt</span>
                        </button>
                        <button
                          onClick={() => {
                            setPaymentToReverse(p);
                            setReversalReason('');
                          }}
                          className="px-2.5 py-1.5 rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 text-xs font-semibold"
                          title="Reverse Payment"
                        >
                          Reverse
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Record Payment Modal */}
      {isPaymentModalOpen && targetInvoiceForPayment && (
        <Modal
          isOpen={isPaymentModalOpen}
          onClose={() => setIsPaymentModalOpen(false)}
          title={`Record Payment — ${targetInvoiceForPayment.invoiceNumber}`}
          subtitle={`Client: ${targetInvoiceForPayment.clientName} • Balance Due: ₱${(targetInvoiceForPayment.remainingBalanceCentavos / 100).toFixed(2)}`}
          maxWidth="md"
        >
          <form onSubmit={handleSavePayment} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Payment Amount (PHP ₱) *
              </label>
              <input
                type="number"
                min="1"
                step="0.01"
                max={fromCentavos(targetInvoiceForPayment.remainingBalanceCentavos)}
                required
                value={paymentAmountPHP}
                onChange={(e) => setPaymentAmountPHP(parseFloat(e.target.value) || 0)}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-base font-bold text-white focus:outline-none focus:border-blue-500"
              />
              <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
                <span>Maximum Allowed: ₱{(targetInvoiceForPayment.remainingBalanceCentavos / 100).toFixed(2)}</span>
                <button
                  type="button"
                  onClick={() => setPaymentAmountPHP(fromCentavos(targetInvoiceForPayment.remainingBalanceCentavos))}
                  className="text-blue-400 hover:underline"
                >
                  Pay Full Balance
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Payment Method *
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  {paymentMethods.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Payment Date *
                </label>
                <input
                  type="date"
                  required
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Transaction Ref / Check Number
                </label>
                <input
                  type="text"
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  placeholder="e.g. GCash Ref # 10293848"
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Received By (Staff / Owner)
                </label>
                <input
                  type="text"
                  value={receivedBy}
                  onChange={(e) => setReceivedBy(e.target.value)}
                  placeholder="Admin Officer"
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Payment Notes / Acknowledgment Memo
              </label>
              <textarea
                rows={2}
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder="e.g. 50% mobilization downpayment for electric fence materials..."
                className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsPaymentModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 shadow-md"
              >
                Record Payment & Update Invoice
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Standalone Invoice Modal */}
      {isInvoiceModalOpen && editingInvoice && (
        <Modal
          isOpen={isInvoiceModalOpen}
          onClose={() => setIsInvoiceModalOpen(false)}
          title={`Create Invoice — ${editingInvoice.invoiceNumber}`}
          subtitle="Direct billing for security repairs, emergency callouts, or additional services"
          maxWidth="3xl"
        >
          <form onSubmit={handleSaveInvoice} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Client *
                </label>
                <select
                  required
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white"
                >
                  <option value="">-- Select Client --</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Invoice Subject / Title *
                </label>
                <input
                  type="text"
                  required
                  value={editingInvoice.title || ''}
                  onChange={(e) => setEditingInvoice({ ...editingInvoice, title: e.target.value })}
                  placeholder="e.g. Gate Motor Sensor Replacement & Maintenance"
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Issue Date
                </label>
                <input
                  type="date"
                  required
                  value={editingInvoice.issueDate || ''}
                  onChange={(e) => setEditingInvoice({ ...editingInvoice, issueDate: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Due Date
                </label>
                <input
                  type="date"
                  required
                  value={editingInvoice.dueDate || ''}
                  onChange={(e) => setEditingInvoice({ ...editingInvoice, dueDate: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white"
                />
              </div>
            </div>

            {/* Line items for invoice */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <span className="block text-xs font-bold uppercase text-slate-300">
                Invoice Line Items ({invoiceLineItems.length})
              </span>

              {/* Add item row */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 bg-slate-800/60 p-2.5 rounded-xl border border-slate-700">
                <input
                  type="text"
                  placeholder="Service / part description"
                  value={newItemDesc}
                  onChange={(e) => setNewItemDesc(e.target.value)}
                  className="sm:col-span-6 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                />
                <input
                  type="number"
                  min="1"
                  value={newItemQty}
                  onChange={(e) => setNewItemQty(parseFloat(e.target.value) || 1)}
                  className="sm:col-span-2 px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white text-center"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Price"
                  value={newItemPricePHP}
                  onChange={(e) => setNewItemPricePHP(parseFloat(e.target.value) || 0)}
                  className="sm:col-span-3 px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white text-right"
                />
                <button
                  type="button"
                  onClick={handleAddInvoiceItem}
                  className="sm:col-span-1 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-bold text-white"
                >
                  Add
                </button>
              </div>

              {/* List */}
              <div className="space-y-1">
                {invoiceLineItems.map((item, idx) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-slate-800/40 border border-slate-700/60 text-xs"
                  >
                    <div>
                      <span className="font-semibold text-white">{item.description}</span>
                      <span className="text-slate-400 ml-2">
                        ({item.quantity} {item.unit} @ ₱{(item.unitPriceCentavos / 100).toFixed(2)})
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white">
                        ₱{(item.totalCentavos / 100).toFixed(2)}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setInvoiceLineItems((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="text-rose-400 p-1 hover:bg-rose-500/10 rounded"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsInvoiceModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500"
              >
                Save & Issue Invoice
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Inspect Invoice & Payment History Modal */}
      {inspectingInvoice && (
        <Modal
          isOpen={!!inspectingInvoice}
          onClose={() => setInspectingInvoice(null)}
          title={`Invoice Ledger: ${inspectingInvoice.invoiceNumber}`}
          subtitle={`${inspectingInvoice.clientName} — ${inspectingInvoice.title}`}
          maxWidth="lg"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-slate-800/60 border border-slate-700 text-xs">
              <div>
                <span className="text-slate-400 block">Total Billed:</span>
                <span className="font-bold text-white text-sm">
                  {formatCurrency(inspectingInvoice.grandTotalCentavos)}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Total Settled:</span>
                <span className="font-bold text-emerald-400 text-sm">
                  {formatCurrency(inspectingInvoice.paidAmountCentavos)}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Outstanding:</span>
                <span className="font-bold text-rose-400 text-sm">
                  {formatCurrency(inspectingInvoice.remainingBalanceCentavos)}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase text-slate-400">
                Payment Collections Against This Invoice
              </h4>
              {inspectingInvoicePayments.length === 0 ? (
                <p className="text-xs text-slate-500 italic p-3 rounded-lg bg-slate-800/30">
                  No payment records logged for this invoice yet.
                </p>
              ) : (
                inspectingInvoicePayments.map((p) => (
                  <div
                    key={p.id}
                    className="p-3 rounded-xl bg-slate-800/60 border border-slate-700 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">{p.paymentNumber}</span>
                        {p.isReversed ? (
                          <span className="text-[10px] text-rose-400 font-bold">REVERSED</span>
                        ) : (
                          <span className="text-[10px] text-emerald-400 font-bold">PAID</span>
                        )}
                      </div>
                      <p className="text-slate-400 text-[11px] mt-0.5">
                        {p.paymentDate} via {p.paymentMethod} {p.referenceNumber && `(${p.referenceNumber})`}
                      </p>
                    </div>

                    <div className="text-right">
                      <span className="font-bold text-emerald-400 text-sm">
                        +{formatCurrency(p.amountCentavos)}
                      </span>
                      {!p.isReversed && (
                        <button
                          onClick={() => handleDownloadReceiptPdf(p)}
                          className="block text-[11px] text-blue-400 hover:underline mt-0.5"
                        >
                          Download Receipt
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Void Invoice Confirmation Modal */}
      {isVoidModalOpen && invoiceToVoid && (
        <Modal
          isOpen={isVoidModalOpen}
          onClose={() => setIsVoidModalOpen(false)}
          title={`Void Invoice: ${invoiceToVoid.invoiceNumber}`}
          maxWidth="sm"
        >
          <div className="space-y-4">
            <p className="text-xs text-slate-300">
              Voiding cancels this billing document and preserves an audit trail. Please enter the operational reason for voiding:
            </p>
            <textarea
              rows={3}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g. Quotation canceled by HOA board prior to work start..."
              className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsVoidModalOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteVoid}
                className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white"
              >
                Void Invoice
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reverse Payment Modal */}
      {paymentToReverse && (
        <Modal
          isOpen={!!paymentToReverse}
          onClose={() => setPaymentToReverse(null)}
          title={`Reverse Payment: ${paymentToReverse.paymentNumber}`}
          maxWidth="sm"
        >
          <div className="space-y-4">
            <p className="text-xs text-slate-300">
              Reversing this payment of <strong className="text-white">{formatCurrency(paymentToReverse.amountCentavos)}</strong> will reinstate the balance on invoice <strong>{paymentToReverse.invoiceNumber}</strong>.
            </p>
            <textarea
              rows={3}
              value={reversalReason}
              onChange={(e) => setReversalReason(e.target.value)}
              placeholder="e.g. Bouncing check, bank transfer disputed, or duplicate entry..."
              className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPaymentToReverse(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecutePaymentReversal}
                className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white"
              >
                Reverse Payment
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
