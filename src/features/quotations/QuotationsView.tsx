import React, { useState, useEffect, useMemo } from 'react';
import {
  Quotation,
  QuotationLineItem,
  QuotationStatus,
  ServiceCategory,
  LineItemCategory,
  Client,
  TaxMode,
  QuotationRevision,
} from '../../types';
import {
  quotationRepository,
  clientRepository,
  settingsRepository,
  invoiceRepository,
  projectRepository,
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
  generateQuotationPdf,
  downloadPdfBlob,
  printPdfBlob,
  sharePdfBlob,
} from '../../services/pdfGenerator';
import {
  FileSpreadsheet,
  Plus,
  Search,
  Filter,
  Download,
  Printer,
  Share2,
  Copy,
  History,
  Trash2,
  Edit2,
  CheckCircle2,
  XCircle,
  Send,
  Eye,
  FileCheck,
  Briefcase,
  Receipt,
  HelpCircle,
} from 'lucide-react';

interface QuotationsViewProps {
  initialClientId?: string;
  onNavigateToInvoice?: (invoiceId: string) => void;
  onNavigateToProject?: (projectId: string) => void;
}

export const QuotationsView: React.FC<QuotationsViewProps> = ({
  initialClientId,
  onNavigateToInvoice,
  onNavigateToProject,
}) => {
  const { showToast } = useToast();
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Active Editor State
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingQuotation, setEditingQuotation] = useState<Quotation | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string>('');

  // Line item scratch pad
  const [lineItems, setLineItems] = useState<QuotationLineItem[]>([]);
  const [itemCategory, setItemCategory] = useState<LineItemCategory>('Materials');
  const [itemDesc, setItemDesc] = useState('');
  const [itemQty, setItemQty] = useState(1);
  const [itemUnit, setItemUnit] = useState('meters');
  const [itemUnitPricePHP, setItemUnitPricePHP] = useState(0);

  // Revision History Modal
  const [selectedQuoteForRevisions, setSelectedQuoteForRevisions] = useState<Quotation | null>(null);
  const [revisions, setRevisions] = useState<QuotationRevision[]>([]);
  const [revisionReason, setRevisionReason] = useState('');
  const [isRevisionModalOpen, setIsRevisionModalOpen] = useState(false);

  // Deletion confirm
  const [quoteToDelete, setQuoteToDelete] = useState<Quotation | null>(null);

  // PDF Preview & Busy states
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const serviceCategories: ServiceCategory[] = [
    'Electric Fence Installation',
    'Automatic Gate Installation',
    'Maintenance Service',
    'CCTV & Security Systems',
    'Access Control & Intercom',
    'Integrated Perimeter Security',
    'Other Service',
  ];

  const lineItemCategories: LineItemCategory[] = [
    'Materials',
    'Labor',
    'Mobilization',
    'Contingency',
    'Equipment/Tools',
    'Additional',
  ];

  const commonUnits = ['meters', 'sets', 'pcs', 'lots', 'hours', 'units', 'rolls', 'days'];

  const loadData = async () => {
    try {
      setLoading(true);
      const [quotesData, clientsData] = await Promise.all([
        quotationRepository.getAll(),
        clientRepository.getAll(),
      ]);
      setQuotations(quotesData);
      setClients(clientsData);
    } catch (err) {
      showToast('Failed to load quotations', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Open editor if initialClientId was passed from client screen
  useEffect(() => {
    if (initialClientId && clients.length > 0) {
      handleCreateQuotation(initialClientId);
    }
  }, [initialClientId, clients]);

  // Compute live totals for editor
  const editorTotals = useMemo(() => {
    const sumLineTotals = lineItems.reduce((acc, item) => acc + item.totalCentavos, 0);
    const taxMode = editingQuotation?.taxMode || 'EXCLUSIVE';
    const taxRate = editingQuotation?.taxRatePercent ?? 12;
    return calculateTotals(sumLineTotals, taxMode, taxRate);
  }, [lineItems, editingQuotation?.taxMode, editingQuotation?.taxRatePercent]);

  // Filtered list
  const filteredQuotations = useMemo(() => {
    return quotations.filter((q) => {
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !query ||
        q.quotationNumber.toLowerCase().includes(query) ||
        q.clientName.toLowerCase().includes(query) ||
        q.projectTitle.toLowerCase().includes(query);

      const matchesStatus = statusFilter === 'ALL' || q.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [quotations, searchQuery, statusFilter]);

  const handleCreateQuotation = async (preselectedClientId?: string) => {
    const settings = await settingsRepository.getSettings();
    const newDocNum = await getNextDocumentNumber(settings.quotationPrefix || 'Q-');

    const targetClientId = preselectedClientId || (clients.length > 0 ? clients[0].id : '');
    const client = clients.find((c) => c.id === targetClientId);

    const today = new Date();
    const expiry = new Date();
    expiry.setDate(today.getDate() + (settings.defaultQuotationValidityDays || 30));

    const todayStr = today.toISOString().split('T')[0];
    const expiryStr = expiry.toISOString().split('T')[0];

    const newQuotation: Quotation = {
      id: '',
      quotationNumber: newDocNum,
      revisionNumber: 0,
      clientId: client ? client.id : '',
      clientName: client ? client.name : '',
      clientContact: client ? client.contactNumber : '',
      clientAddress: client ? client.address : '',
      projectTitle: 'Perimeter Security Installation',
      serviceCategory: 'Electric Fence Installation',
      scopeOfWork: 'Supply and installation of 8-strand electric fence perimeter system, heavy-duty energizer with backup battery, sirens, strobe lights, and digital keypad controller.',
      termsAndConditions: settings.defaultPaymentTerms,
      notes: settings.defaultQuotationNotes,
      issueDate: todayStr,
      expiryDate: expiryStr,
      status: 'Draft',
      lineItems: [
        {
          id: Math.random().toString(36).substring(2, 9),
          category: 'Materials',
          description: 'High-Tensile Aluminum Electric Fence Wire (1.6mm)',
          quantity: 200,
          unit: 'meters',
          unitPriceCentavos: toCentavos(45),
          totalCentavos: calculateLineTotal(200, toCentavos(45)),
        },
        {
          id: Math.random().toString(36).substring(2, 9),
          category: 'Materials',
          description: 'Heavy-Duty Security Energizer with Strobe & Siren (12V DC Battery Included)',
          quantity: 1,
          unit: 'sets',
          unitPriceCentavos: toCentavos(24500),
          totalCentavos: calculateLineTotal(1, toCentavos(24500)),
        },
        {
          id: Math.random().toString(36).substring(2, 9),
          category: 'Labor',
          description: 'Complete Technical Installation, Bracket Mounts, Wiring & Commissioning',
          quantity: 1,
          unit: 'lots',
          unitPriceCentavos: toCentavos(12000),
          totalCentavos: calculateLineTotal(1, toCentavos(12000)),
        },
      ],
      subtotalCentavos: 0,
      taxRatePercent: settings.taxRatePercent,
      taxCentavos: 0,
      grandTotalCentavos: 0,
      taxMode: settings.taxMode,
      createdAt: today.toISOString(),
      updatedAt: today.toISOString(),
    };

    setEditingQuotation(newQuotation);
    setSelectedClientId(newQuotation.clientId);
    setLineItems(newQuotation.lineItems);
    setIsEditorOpen(true);
  };

  const handleEditQuotation = (quotation: Quotation) => {
    setEditingQuotation({ ...quotation });
    setSelectedClientId(quotation.clientId);
    setLineItems([...quotation.lineItems]);
    setIsEditorOpen(true);
  };

  const handleClientChange = (clientId: string) => {
    setSelectedClientId(clientId);
    const client = clients.find((c) => c.id === clientId);
    if (client && editingQuotation) {
      setEditingQuotation({
        ...editingQuotation,
        clientId: client.id,
        clientName: client.name,
        clientContact: client.contactNumber,
        clientAddress: client.address,
      });
    }
  };

  const handleAddLineItem = () => {
    if (!itemDesc.trim()) {
      showToast('Line item description is required', 'error');
      return;
    }
    if (itemQty <= 0) {
      showToast('Quantity must be greater than zero', 'error');
      return;
    }
    if (itemUnitPricePHP < 0) {
      showToast('Unit price cannot be negative', 'error');
      return;
    }

    const priceCentavos = toCentavos(itemUnitPricePHP);
    const lineTotal = calculateLineTotal(itemQty, priceCentavos);

    const newItem: QuotationLineItem = {
      id: Math.random().toString(36).substring(2, 9),
      category: itemCategory,
      description: itemDesc.trim(),
      quantity: Number(itemQty),
      unit: itemUnit,
      unitPriceCentavos: priceCentavos,
      totalCentavos: lineTotal,
    };

    setLineItems((prev) => [...prev, newItem]);
    setItemDesc('');
    setItemQty(1);
    setItemUnitPricePHP(0);
  };

  const handleRemoveLineItem = (id: string) => {
    setLineItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleSaveQuotation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingQuotation) return;

    if (!editingQuotation.clientId) {
      showToast('Please select or specify a client', 'error');
      return;
    }
    if (lineItems.length === 0) {
      showToast('At least one cost breakdown line item is required', 'error');
      return;
    }

    try {
      const fullQuotation: Quotation = {
        ...editingQuotation,
        id: editingQuotation.id || Math.random().toString(36).substring(2, 9),
        lineItems,
        subtotalCentavos: editorTotals.subtotalCentavos,
        taxCentavos: editorTotals.taxCentavos,
        grandTotalCentavos: editorTotals.grandTotalCentavos,
        taxMode: editorTotals.taxMode,
        taxRatePercent: editorTotals.taxRatePercent,
      };

      await quotationRepository.save(fullQuotation);
      showToast('Quotation saved successfully', 'success');
      setIsEditorOpen(false);
      setEditingQuotation(null);
      await loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save quotation', 'error');
    }
  };

  const handleDuplicateQuotation = async (original: Quotation) => {
    try {
      const settings = await settingsRepository.getSettings();
      const newDocNum = await getNextDocumentNumber(settings.quotationPrefix || 'Q-');

      const duplicate: Quotation = {
        ...original,
        id: Math.random().toString(36).substring(2, 9),
        quotationNumber: newDocNum,
        revisionNumber: 0,
        status: 'Draft',
        projectTitle: `${original.projectTitle} (Copy)`,
        issueDate: new Date().toISOString().split('T')[0],
        convertedToInvoiceId: undefined,
        convertedToProjectId: undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await quotationRepository.save(duplicate);
      showToast(`Quotation duplicated as ${newDocNum}`, 'success');
      await loadData();
    } catch {
      showToast('Failed to duplicate quotation', 'error');
    }
  };

  // Revision creation workflow
  const handleOpenRevisionModal = async (quotation: Quotation) => {
    setSelectedQuoteForRevisions(quotation);
    setRevisionReason('');
    const revs = await quotationRepository.getRevisions(quotation.id);
    setRevisions(revs);
    setIsRevisionModalOpen(true);
  };

  const handleCreateNewRevision = async () => {
    if (!selectedQuoteForRevisions) return;
    if (!revisionReason.trim()) {
      showToast('Please enter a revision reason or summary of changes', 'error');
      return;
    }

    try {
      await quotationRepository.createRevision(selectedQuoteForRevisions.id, revisionReason);
      showToast(`Created Revision for ${selectedQuoteForRevisions.quotationNumber}`, 'success');
      setIsRevisionModalOpen(false);
      await loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Revision failed', 'error');
    }
  };

  // Convert Accepted Quotation to Billing Invoice
  const handleConvertToInvoice = async (quotation: Quotation) => {
    try {
      const settings = await settingsRepository.getSettings();
      const invNum = await getNextDocumentNumber(settings.invoicePrefix || 'INV-');

      const todayStr = new Date().toISOString().split('T')[0];
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 15);
      const dueDateStr = dueDate.toISOString().split('T')[0];

      const newInvoice = await invoiceRepository.save({
        id: Math.random().toString(36).substring(2, 9),
        invoiceNumber: invNum,
        quotationId: quotation.id,
        quotationNumber: quotation.quotationNumber,
        clientId: quotation.clientId,
        clientName: quotation.clientName,
        clientContact: quotation.clientContact,
        clientAddress: quotation.clientAddress,
        issueDate: todayStr,
        dueDate: dueDateStr,
        title: `Installation Billing - ${quotation.projectTitle}`,
        lineItems: quotation.lineItems.map((li) => ({
          id: li.id,
          description: `[${li.category}] ${li.description}`,
          quantity: li.quantity,
          unit: li.unit,
          unitPriceCentavos: li.unitPriceCentavos,
          totalCentavos: li.totalCentavos,
        })),
        subtotalCentavos: quotation.subtotalCentavos,
        taxRatePercent: quotation.taxRatePercent,
        taxCentavos: quotation.taxCentavos,
        grandTotalCentavos: quotation.grandTotalCentavos,
        paidAmountCentavos: 0,
        remainingBalanceCentavos: quotation.grandTotalCentavos,
        status: 'Issued',
        taxMode: quotation.taxMode,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Update quotation link
      quotation.convertedToInvoiceId = newInvoice.id;
      quotation.status = 'Accepted';
      await quotationRepository.save(quotation);

      showToast(`Invoice ${invNum} created from quotation!`, 'success');
      await loadData();

      if (onNavigateToInvoice) {
        onNavigateToInvoice(newInvoice.id);
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to generate invoice', 'error');
    }
  };

  // Convert Accepted Quotation to Project
  const handleConvertToProject = async (quotation: Quotation) => {
    try {
      const settings = await settingsRepository.getSettings();
      const prjNum = await getNextDocumentNumber(settings.projectPrefix || 'PRJ-');

      const newProject = await projectRepository.save({
        id: Math.random().toString(36).substring(2, 9),
        projectNumber: prjNum,
        clientId: quotation.clientId,
        clientName: quotation.clientName,
        name: quotation.projectTitle,
        serviceCategory: quotation.serviceCategory,
        siteAddress: quotation.clientAddress,
        description: quotation.scopeOfWork,
        scopeOfWork: quotation.scopeOfWork,
        quotationId: quotation.id,
        quotationNumber: quotation.quotationNumber,
        startDate: new Date().toISOString().split('T')[0],
        status: 'Ongoing',
        progressNotes: [
          {
            id: Math.random().toString(36).substring(2, 9),
            timestamp: new Date().toISOString(),
            author: 'Operations Admin',
            text: `Project initiated from accepted quotation ${quotation.quotationNumber}.`,
            statusChange: 'Ongoing',
          },
        ],
        totalQuotedCentavos: quotation.grandTotalCentavos,
        totalInvoicedCentavos: 0,
        totalPaidCentavos: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      quotation.convertedToProjectId = newProject.id;
      quotation.status = 'Accepted';
      await quotationRepository.save(quotation);

      showToast(`Project ${prjNum} created from quotation!`, 'success');
      await loadData();

      if (onNavigateToProject) {
        onNavigateToProject(newProject.id);
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to create project', 'error');
    }
  };

  // PDF Generation triggers
  const handleDownloadPdf = async (quotation: Quotation) => {
    try {
      setIsGeneratingPdf(true);
      const settings = await settingsRepository.getSettings();
      const pdfBytes = await generateQuotationPdf(quotation, settings);
      downloadPdfBlob(pdfBytes, `${quotation.quotationNumber}_Quotation.pdf`);
      showToast('PDF downloaded successfully', 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to generate PDF', 'error');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handlePrintPdf = async (quotation: Quotation) => {
    try {
      setIsGeneratingPdf(true);
      const settings = await settingsRepository.getSettings();
      const pdfBytes = await generateQuotationPdf(quotation, settings);
      printPdfBlob(pdfBytes);
    } catch {
      showToast('Failed to print PDF', 'error');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleSharePdf = async (quotation: Quotation) => {
    try {
      setIsGeneratingPdf(true);
      const settings = await settingsRepository.getSettings();
      const pdfBytes = await generateQuotationPdf(quotation, settings);
      await sharePdfBlob(
        pdfBytes,
        `${quotation.quotationNumber}_Quotation.pdf`,
        `Formal Quotation ${quotation.quotationNumber}`
      );
    } catch {
      showToast('Share failed', 'error');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & New Quotation Button */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Quotations & Estimates
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Build itemized proposals, calculate taxes, manage revisions, and export offline PDFs.
          </p>
        </div>

        <button
          onClick={() => handleCreateQuotation()}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs sm:text-sm font-semibold shadow-lg shadow-blue-600/30 transition"
        >
          <Plus className="w-4 h-4" />
          <span>New Quotation</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-stretch md:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by quote #, client name, or project title..."
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-800/80 border border-slate-700 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 shrink-0">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="ALL">All ({quotations.length})</option>
            <option value="Draft">Draft</option>
            <option value="Sent">Sent</option>
            <option value="Accepted">Accepted</option>
            <option value="Declined">Declined</option>
            <option value="Expired">Expired</option>
          </select>
        </div>
      </div>

      {/* Quotations List */}
      <div className="space-y-3">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm rounded-2xl bg-slate-900 border border-slate-800">
            Loading quotations...
          </div>
        ) : filteredQuotations.length === 0 ? (
          <div className="p-12 text-center rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
            <FileSpreadsheet className="w-10 h-10 text-slate-600 mx-auto" />
            <h3 className="text-base font-bold text-white">No quotations found</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Draft your first installation proposal with itemized materials and labor costs.
            </p>
            <button
              onClick={() => handleCreateQuotation()}
              className="mt-2 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 text-xs font-semibold text-white hover:bg-blue-500"
            >
              <Plus className="w-4 h-4" />
              <span>Create Quotation</span>
            </button>
          </div>
        ) : (
          filteredQuotations.map((quotation) => (
            <div
              key={quotation.id}
              className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-base font-bold text-white">{quotation.quotationNumber}</span>
                    {quotation.revisionNumber > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px] font-bold">
                        Rev {quotation.revisionNumber}
                      </span>
                    )}
                    {getStatusBadge(quotation.status)}
                    <span className="text-xs text-slate-400">• {quotation.serviceCategory}</span>
                  </div>
                  <h4 className="text-sm font-semibold text-slate-200 mt-1">
                    {quotation.projectTitle}
                  </h4>
                  <p className="text-xs text-slate-400">
                    Client: <strong className="text-slate-300">{quotation.clientName}</strong> •
                    Issued: {quotation.issueDate} • Valid Until: {quotation.expiryDate}
                  </p>
                </div>

                <div className="text-left sm:text-right">
                  <div className="text-lg font-black text-white">
                    {formatCurrency(quotation.grandTotalCentavos)}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Subtotal: {formatCurrency(quotation.subtotalCentavos)}
                    {quotation.taxCentavos > 0 && ` | VAT: ${formatCurrency(quotation.taxCentavos)}`}
                  </p>
                </div>
              </div>

              {/* Action Buttons Toolbar */}
              <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* PDF Operations */}
                  <button
                    onClick={() => handleDownloadPdf(quotation)}
                    disabled={isGeneratingPdf}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-800/80 text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-700 transition"
                    title="Download PDF"
                  >
                    <Download className="w-3.5 h-3.5 text-blue-400" />
                    <span>PDF</span>
                  </button>
                  <button
                    onClick={() => handlePrintPdf(quotation)}
                    className="p-1.5 rounded-xl border border-slate-700 bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700"
                    title="Print Document"
                  >
                    <Printer className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleSharePdf(quotation)}
                    className="p-1.5 rounded-xl border border-slate-700 bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700"
                    title="Share via Tablet"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                  </button>

                  {/* Duplicate */}
                  <button
                    onClick={() => handleDuplicateQuotation(quotation)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-700 bg-slate-800/80 text-xs text-slate-300 hover:text-white hover:bg-slate-700"
                    title="Duplicate Quotation"
                  >
                    <Copy className="w-3.5 h-3.5 text-amber-400" />
                    <span className="hidden sm:inline">Duplicate</span>
                  </button>

                  {/* Revision History */}
                  <button
                    onClick={() => handleOpenRevisionModal(quotation)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-700 bg-slate-800/80 text-xs text-slate-300 hover:text-white hover:bg-slate-700"
                    title="Revision History"
                  >
                    <History className="w-3.5 h-3.5 text-purple-400" />
                    <span className="hidden sm:inline">Revisions</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {/* Status Action Workflow */}
                  {quotation.status === 'Draft' && (
                    <button
                      onClick={async () => {
                        quotation.status = 'Sent';
                        await quotationRepository.save(quotation);
                        showToast(`Quotation marked as Sent`, 'success');
                        await loadData();
                      }}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-600/20 text-blue-300 border border-blue-500/30 text-xs font-semibold hover:bg-blue-600/30"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Mark Sent</span>
                    </button>
                  )}

                  {quotation.status !== 'Accepted' && quotation.status !== 'Declined' && (
                    <button
                      onClick={async () => {
                        quotation.status = 'Accepted';
                        await quotationRepository.save(quotation);
                        showToast(`Quotation marked as Accepted!`, 'success');
                        await loadData();
                      }}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold hover:bg-emerald-600/30"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Mark Accepted</span>
                    </button>
                  )}

                  {/* Once Accepted: Convert to Invoice & Project triggers */}
                  {quotation.status === 'Accepted' && !quotation.convertedToInvoiceId && (
                    <button
                      onClick={() => handleConvertToInvoice(quotation)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md"
                    >
                      <Receipt className="w-3.5 h-3.5" />
                      <span>Generate Invoice</span>
                    </button>
                  )}

                  {quotation.status === 'Accepted' && !quotation.convertedToProjectId && (
                    <button
                      onClick={() => handleConvertToProject(quotation)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md"
                    >
                      <Briefcase className="w-3.5 h-3.5" />
                      <span>Start Project</span>
                    </button>
                  )}

                  {/* Edit */}
                  <button
                    onClick={() => handleEditQuotation(quotation)}
                    className="p-1.5 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:text-white"
                    title="Edit Quotation"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => setQuoteToDelete(quotation)}
                    className="p-1.5 rounded-xl border border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
                    title="Delete Quotation"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Quotation Editor Modal */}
      {isEditorOpen && editingQuotation && (
        <Modal
          isOpen={isEditorOpen}
          onClose={() => setIsEditorOpen(false)}
          title={`Quotation Builder — ${editingQuotation.quotationNumber}`}
          subtitle="Configure items, labor, mobilization, taxes, and client terms"
          maxWidth="4xl"
        >
          <form onSubmit={handleSaveQuotation} className="space-y-6">
            {/* Top metadata grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-2xl bg-slate-800/40 border border-slate-700/60">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Select Client *
                </label>
                <select
                  required
                  value={selectedClientId}
                  onChange={(e) => handleClientChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">-- Choose a Client --</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.contactNumber || 'No phone'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Service Category *
                </label>
                <select
                  value={editingQuotation.serviceCategory}
                  onChange={(e) =>
                    setEditingQuotation({
                      ...editingQuotation,
                      serviceCategory: e.target.value as ServiceCategory,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  {serviceCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Quotation Status
                </label>
                <select
                  value={editingQuotation.status}
                  onChange={(e) =>
                    setEditingQuotation({
                      ...editingQuotation,
                      status: e.target.value as QuotationStatus,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="Draft">Draft</option>
                  <option value="Sent">Sent</option>
                  <option value="Accepted">Accepted</option>
                  <option value="Declined">Declined</option>
                  <option value="Expired">Expired</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Project / Service Title *
                </label>
                <input
                  type="text"
                  required
                  value={editingQuotation.projectTitle}
                  onChange={(e) =>
                    setEditingQuotation({ ...editingQuotation, projectTitle: e.target.value })
                  }
                  placeholder="e.g. 100m Perimeter Electric Fence & Automatic Sliding Gate"
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Tax Calculation Mode
                </label>
                <select
                  value={editingQuotation.taxMode}
                  onChange={(e) =>
                    setEditingQuotation({
                      ...editingQuotation,
                      taxMode: e.target.value as TaxMode,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="EXCLUSIVE">VAT Exclusive (Add 12% to subtotal)</option>
                  <option value="INCLUSIVE">VAT Inclusive (Subtotal backed out)</option>
                  <option value="NON_VAT">Non-VAT (0% Tax)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Issue Date
                </label>
                <input
                  type="date"
                  required
                  value={editingQuotation.issueDate}
                  onChange={(e) =>
                    setEditingQuotation({ ...editingQuotation, issueDate: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Valid Until
                </label>
                <input
                  type="date"
                  required
                  value={editingQuotation.expiryDate}
                  onChange={(e) =>
                    setEditingQuotation({ ...editingQuotation, expiryDate: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Client Installation Address
                </label>
                <input
                  type="text"
                  value={editingQuotation.clientAddress || ''}
                  onChange={(e) =>
                    setEditingQuotation({ ...editingQuotation, clientAddress: e.target.value })
                  }
                  placeholder="Site location"
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white"
                />
              </div>
            </div>

            {/* Scope of Work */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Scope of Work & Technical Specifications
              </label>
              <textarea
                rows={2}
                value={editingQuotation.scopeOfWork}
                onChange={(e) =>
                  setEditingQuotation({ ...editingQuotation, scopeOfWork: e.target.value })
                }
                className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white"
                placeholder="Detailed breakdown of work to be performed..."
              />
            </div>

            {/* Line Items Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Itemized Cost Breakdown ({lineItems.length} items)
                </h4>
              </div>

              {/* Add item bar */}
              <div className="p-3.5 rounded-2xl bg-slate-800/80 border border-slate-700/80 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-semibold text-slate-400 mb-1">
                    Category
                  </label>
                  <select
                    value={itemCategory}
                    onChange={(e) => setItemCategory(e.target.value as LineItemCategory)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                  >
                    {lineItemCategories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-4">
                  <label className="block text-[10px] font-semibold text-slate-400 mb-1">
                    Description / Material Specs
                  </label>
                  <input
                    type="text"
                    value={itemDesc}
                    onChange={(e) => setItemDesc(e.target.value)}
                    placeholder="e.g. Centurion D5 Smart Gate Motor"
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-semibold text-slate-400 mb-1">
                    Qty & Unit
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0.1"
                      step="any"
                      value={itemQty}
                      onChange={(e) => setItemQty(parseFloat(e.target.value) || 0)}
                      className="w-16 px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white text-center"
                    />
                    <select
                      value={itemUnit}
                      onChange={(e) => setItemUnit(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                    >
                      {commonUnits.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-[10px] font-semibold text-slate-400 mb-1">
                    Unit Price (PHP ₱)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={itemUnitPricePHP}
                    onChange={(e) => setItemUnitPricePHP(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                  />
                </div>

                <div className="sm:col-span-1">
                  <button
                    type="button"
                    onClick={handleAddLineItem}
                    className="w-full py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Items Table */}
              <div className="rounded-xl border border-slate-800 overflow-hidden">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-800/90 text-slate-400 uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="p-2.5">Category</th>
                      <th className="p-2.5">Description</th>
                      <th className="p-2.5 text-center">Qty</th>
                      <th className="p-2.5 text-right">Unit Price</th>
                      <th className="p-2.5 text-right">Total</th>
                      <th className="p-2.5 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {lineItems.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-800/40">
                        <td className="p-2.5 font-semibold text-slate-400">{item.category}</td>
                        <td className="p-2.5 font-medium text-white">{item.description}</td>
                        <td className="p-2.5 text-center">
                          {item.quantity} {item.unit}
                        </td>
                        <td className="p-2.5 text-right font-mono">
                          {formatCurrency(item.unitPriceCentavos)}
                        </td>
                        <td className="p-2.5 text-right font-bold text-white font-mono">
                          {formatCurrency(item.totalCentavos)}
                        </td>
                        <td className="p-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveLineItem(item.id)}
                            className="p-1 rounded text-rose-400 hover:bg-rose-500/10"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals Summary */}
              <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="text-xs text-slate-400">
                  <p>• All computations are evaluated using integer centavos for accuracy.</p>
                  <p>• Selected Tax Mode: <strong className="text-slate-200">{editorTotals.taxMode}</strong></p>
                </div>

                <div className="w-full sm:w-64 space-y-1.5 text-xs text-slate-300">
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span className="font-mono font-semibold text-white">
                      {formatCurrency(editorTotals.subtotalCentavos)}
                    </span>
                  </div>

                  {editorTotals.taxMode !== 'NON_VAT' && (
                    <div className="flex justify-between">
                      <span>VAT ({editorTotals.taxRatePercent}%):</span>
                      <span className="font-mono font-semibold text-white">
                        {formatCurrency(editorTotals.taxCentavos)}
                      </span>
                    </div>
                  )}

                  <div className="pt-2 border-t border-slate-700 flex justify-between text-sm font-bold text-white">
                    <span>Grand Total:</span>
                    <span className="text-blue-400 font-mono">
                      {formatCurrency(editorTotals.grandTotalCentavos)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Terms and Notes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Payment Terms & Mobilization Schedule
                </label>
                <textarea
                  rows={3}
                  value={editingQuotation.termsAndConditions}
                  onChange={(e) =>
                    setEditingQuotation({
                      ...editingQuotation,
                      termsAndConditions: e.target.value,
                    })
                  }
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Notes & Exclusions
                </label>
                <textarea
                  rows={3}
                  value={editingQuotation.notes || ''}
                  onChange={(e) =>
                    setEditingQuotation({ ...editingQuotation, notes: e.target.value })
                  }
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white"
                />
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 shadow-md"
              >
                Save Quotation
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Revision History Modal */}
      {isRevisionModalOpen && selectedQuoteForRevisions && (
        <Modal
          isOpen={isRevisionModalOpen}
          onClose={() => setIsRevisionModalOpen(false)}
          title={`Revision History: ${selectedQuoteForRevisions.quotationNumber}`}
          subtitle="Create formal revisions without rewriting original contract history"
          maxWidth="lg"
        >
          <div className="space-y-4">
            <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60 space-y-2">
              <label className="block text-xs font-semibold text-white">
                Create New Revision (Rev {selectedQuoteForRevisions.revisionNumber + 1})
              </label>
              <textarea
                rows={2}
                value={revisionReason}
                onChange={(e) => setRevisionReason(e.target.value)}
                placeholder="Reason for revision (e.g. Added 20m of wiring, revised gate motor model to Smart D10)..."
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={handleCreateNewRevision}
                className="px-3.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-xs font-semibold text-white"
              >
                Snapshot Current & Increment to Rev {selectedQuoteForRevisions.revisionNumber + 1}
              </button>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase text-slate-400">Past Saved Revisions</h4>
              {revisions.length === 0 ? (
                <p className="text-xs text-slate-500 italic p-3 rounded-lg bg-slate-800/30">
                  This quotation is currently at its original baseline (Revision 0).
                </p>
              ) : (
                revisions.map((rev) => (
                  <div
                    key={rev.id}
                    className="p-3 rounded-xl bg-slate-800/60 border border-slate-700 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white">Revision {rev.revisionNumber}</span>
                      <span className="text-slate-400 text-[10px]">
                        {new Date(rev.createdAt).toLocaleString()} by {rev.createdBy}
                      </span>
                    </div>
                    {rev.reason && <p className="text-slate-300 italic">{rev.reason}</p>}
                    <p className="text-[11px] text-blue-400 font-mono">
                      Snapshot Total: {formatCurrency(rev.snapshot.grandTotalCentavos)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Confirmation */}
      {quoteToDelete && (
        <ConfirmDialog
          isOpen={!!quoteToDelete}
          onClose={() => setQuoteToDelete(null)}
          onConfirm={async () => {
            try {
              await quotationRepository.delete(quoteToDelete.id);
              showToast('Quotation deleted successfully', 'success');
              setQuoteToDelete(null);
              await loadData();
            } catch (err: unknown) {
              showToast(err instanceof Error ? err.message : 'Cannot delete quotation', 'error');
            }
          }}
          title="Delete Quotation"
          message={`Are you sure you want to delete ${quoteToDelete.quotationNumber}? If this quotation has already been converted to an invoice, deletion is prevented to protect financial integrity.`}
          confirmLabel="Delete Quotation"
        />
      )}
    </div>
  );
};
