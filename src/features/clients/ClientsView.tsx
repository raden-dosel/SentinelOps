import React, { useState, useEffect, useMemo } from 'react';
import { Client, LeadStatus, LeadSource, Quotation, Invoice, Project } from '../../types';
import { clientRepository, quotationRepository, invoiceRepository, projectRepository } from '../../storage/repositories';
import { getStatusBadge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../app/providers/ToastContext';
import {
  Users,
  Search,
  Plus,
  Filter,
  Phone,
  Mail,
  MapPin,
  FileText,
  Briefcase,
  Receipt,
  MoreVertical,
  Edit2,
  Trash2,
  ArrowRight,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';

interface ClientsViewProps {
  onOpenQuotationBuilder?: (clientId: string) => void;
  onOpenProjectBuilder?: (clientId: string) => void;
}

export const ClientsView: React.FC<ClientsViewProps> = ({
  onOpenQuotationBuilder,
  onOpenProjectBuilder,
}) => {
  const { showToast } = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [sourceFilter, setSourceFilter] = useState<string>('ALL');

  // Modal States
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Partial<Client> | null>(null);
  const [selectedClientForDetails, setSelectedClientForDetails] = useState<Client | null>(null);

  // Linked records for detail view
  const [clientQuotations, setClientQuotations] = useState<Quotation[]>([]);
  const [clientInvoices, setClientInvoices] = useState<Invoice[]>([]);
  const [clientProjects, setClientProjects] = useState<Project[]>([]);

  // Deletion confirm dialog
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const leadStatuses: LeadStatus[] = [
    'New Inquiry',
    'Site Visit Scheduled',
    'Quotation Sent',
    'Won',
    'Lost',
  ];

  const leadSources: LeadSource[] = [
    'Referral',
    'Facebook',
    'Google Search',
    'Direct Call',
    'Website',
    'Subcontractor',
    'Walk-in',
    'Existing Customer',
    'Other',
  ];

  const loadClients = async () => {
    try {
      setLoading(true);
      const data = await clientRepository.getAll();
      setClients(data);
    } catch (err) {
      showToast('Failed to load clients', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClients();
  }, []);

  // Filtered clients list
  const filteredClients = useMemo(() => {
    return clients.filter((c) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        (c.contactNumber && c.contactNumber.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q)) ||
        (c.address && c.address.toLowerCase().includes(q));

      const matchesStatus = statusFilter === 'ALL' || c.leadStatus === statusFilter;
      const matchesSource = sourceFilter === 'ALL' || c.leadSource === sourceFilter;

      return matchesSearch && matchesStatus && matchesSource;
    });
  }, [clients, searchQuery, statusFilter, sourceFilter]);

  // Load details and linked records
  const handleSelectClient = async (client: Client) => {
    setSelectedClientForDetails(client);
    try {
      const [quotes, invs, projs] = await Promise.all([
        quotationRepository.getByClientId(client.id),
        invoiceRepository.getByClientId(client.id),
        projectRepository.getByClientId(client.id),
      ]);
      setClientQuotations(quotes);
      setClientInvoices(invs);
      setClientProjects(projs);
    } catch (e) {
      console.error(e);
    }
  };

  const handleOpenCreate = () => {
    setEditingClient({
      name: '',
      contactPerson: '',
      contactNumber: '',
      email: '',
      address: '',
      leadSource: 'Referral',
      leadStatus: 'New Inquiry',
      notes: '',
    });
    setIsEditModalOpen(true);
  };

  const handleOpenEdit = (client: Client) => {
    setEditingClient({ ...client });
    setIsEditModalOpen(true);
  };

  const handleSaveClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClient || !editingClient.name?.trim()) {
      showToast('Client name is required', 'error');
      return;
    }
    if (!editingClient.contactNumber?.trim() && !editingClient.email?.trim()) {
      showToast('Please provide at least a contact phone number or email', 'error');
      return;
    }

    // Duplicate check on creation
    if (!editingClient.id) {
      const duplicate = clients.find(
        (c) =>
          c.name.toLowerCase().trim() === editingClient.name?.toLowerCase().trim() ||
          (editingClient.contactNumber && c.contactNumber === editingClient.contactNumber)
      );
      if (duplicate) {
        const confirmDup = window.confirm(
          `Notice: A client with similar details (${duplicate.name} - ${duplicate.contactNumber}) already exists. Do you still want to proceed?`
        );
        if (!confirmDup) return;
      }
    }

    try {
      const saved = await clientRepository.save(
        editingClient as Omit<Client, 'id' | 'createdAt' | 'updatedAt'>
      );
      showToast(editingClient.id ? 'Client updated successfully' : 'Client created successfully', 'success');
      setIsEditModalOpen(false);
      setEditingClient(null);
      await loadClients();

      if (selectedClientForDetails && selectedClientForDetails.id === saved.id) {
        setSelectedClientForDetails(saved);
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save client', 'error');
    }
  };

  const handleDeleteClient = async () => {
    if (!clientToDelete) return;
    try {
      await clientRepository.delete(clientToDelete.id);
      showToast('Client deleted successfully', 'success');
      setClientToDelete(null);
      if (selectedClientForDetails?.id === clientToDelete.id) {
        setSelectedClientForDetails(null);
      }
      await loadClients();
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Cannot delete client');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Client CRM & Leads</h2>
          <p className="text-xs text-slate-400 mt-1">
            Manage inquiries, site visit schedules, proposals, and customer profiles.
          </p>
        </div>

        <button
          onClick={handleOpenCreate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs sm:text-sm font-semibold shadow-lg shadow-blue-600/30 transition"
        >
          <Plus className="w-4 h-4" />
          <span>Add New Client</span>
        </button>
      </div>

      {/* Search and Filters Bar */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-stretch md:items-center gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by client name, phone, email, or address..."
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-800/80 border border-slate-700/80 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Lead Status Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 shrink-0">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="ALL">All Statuses ({clients.length})</option>
            {leadStatuses.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </div>

        {/* Lead Source Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 shrink-0">Source:</span>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="ALL">All Sources</option>
            {leadSources.map((src) => (
              <option key={src} value={src}>
                {src}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Grid: Client List & Detail View */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left column: Clients List */}
        <div className={`space-y-3 ${selectedClientForDetails ? 'lg:col-span-5' : 'lg:col-span-12'}`}>
          {loading ? (
            <div className="p-8 text-center text-slate-400 text-sm rounded-2xl bg-slate-900 border border-slate-800">
              Loading client records...
            </div>
          ) : filteredClients.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <Users className="w-10 h-10 text-slate-600 mx-auto" />
              <h3 className="text-base font-bold text-white">No clients found</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                {searchQuery || statusFilter !== 'ALL'
                  ? 'No clients match your filter criteria. Try resetting search filters.'
                  : 'Get started by creating your first client record or lead inquiry.'}
              </p>
              <button
                onClick={handleOpenCreate}
                className="mt-2 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 text-xs font-semibold text-white hover:bg-blue-500"
              >
                <Plus className="w-4 h-4" />
                <span>Create Client</span>
              </button>
            </div>
          ) : (
            filteredClients.map((client) => {
              const isSelected = selectedClientForDetails?.id === client.id;
              return (
                <div
                  key={client.id}
                  onClick={() => handleSelectClient(client)}
                  className={`p-4 rounded-2xl border transition cursor-pointer ${
                    isSelected
                      ? 'bg-slate-800/90 border-blue-500/80 shadow-lg shadow-blue-500/10'
                      : 'bg-slate-900 border-slate-800 hover:border-slate-700 hover:bg-slate-850'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-white truncate">{client.name}</h4>
                        {getStatusBadge(client.leadStatus)}
                      </div>
                      {client.contactPerson && (
                        <p className="text-xs text-slate-400 mt-0.5">Attn: {client.contactPerson}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleOpenEdit(client)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                        title="Edit Client"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-300">
                    <div className="flex items-center gap-2 truncate">
                      <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span className="truncate">{client.contactNumber || 'No phone'}</span>
                    </div>
                    <div className="flex items-center gap-2 truncate">
                      <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span className="truncate">{client.address || 'No address'}</span>
                    </div>
                  </div>

                  <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-500 font-medium">
                    <span>Source: {client.leadSource}</span>
                    <span className="text-blue-400 flex items-center gap-1">
                      View details <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right column: Selected Client Detailed View */}
        {selectedClientForDetails && (
          <div className="lg:col-span-7 rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-6 animate-in fade-in duration-150">
            {/* Header info */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-xl font-bold text-white">{selectedClientForDetails.name}</h3>
                  {getStatusBadge(selectedClientForDetails.leadStatus)}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Lead Source: <strong className="text-slate-300">{selectedClientForDetails.leadSource}</strong> •
                  Added: {new Date(selectedClientForDetails.createdAt).toLocaleDateString()}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleOpenEdit(selectedClientForDetails)}
                  className="px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-800 text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-700"
                >
                  Edit Profile
                </button>
                <button
                  onClick={async () => {
                    const check = await clientRepository.canDelete(selectedClientForDetails.id);
                    if (!check.canDelete) {
                      setDeleteError(check.reason || 'Cannot delete client with linked records.');
                    } else {
                      setDeleteError(null);
                    }
                    setClientToDelete(selectedClientForDetails);
                  }}
                  className="p-1.5 rounded-xl border border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
                  title="Delete Client"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Contact & Location details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-slate-800/40 border border-slate-700/50 text-xs">
              <div>
                <span className="text-slate-500 block mb-1">Contact Phone:</span>
                <span className="font-semibold text-white flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-blue-400" />
                  {selectedClientForDetails.contactNumber || 'None'}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block mb-1">Email Address:</span>
                <span className="font-semibold text-white flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-blue-400" />
                  {selectedClientForDetails.email || 'None'}
                </span>
              </div>
              <div className="sm:col-span-2">
                <span className="text-slate-500 block mb-1">Site / Installation Address:</span>
                <span className="font-semibold text-white flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  {selectedClientForDetails.address || 'None'}
                </span>
              </div>
              {selectedClientForDetails.notes && (
                <div className="sm:col-span-2 pt-2 border-t border-slate-700/40">
                  <span className="text-slate-500 block mb-1">Operational Notes:</span>
                  <p className="text-slate-300 leading-relaxed whitespace-pre-wrap">
                    {selectedClientForDetails.notes}
                  </p>
                </div>
              )}
            </div>

            {/* Quick Create Buttons for this Client */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {onOpenQuotationBuilder && (
                <button
                  onClick={() => onOpenQuotationBuilder(selectedClientForDetails.id)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Draft Quotation for Client</span>
                </button>
              )}
              {onOpenProjectBuilder && (
                <button
                  onClick={() => onOpenProjectBuilder(selectedClientForDetails.id)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
                >
                  <Briefcase className="w-3.5 h-3.5" />
                  <span>Create Project</span>
                </button>
              )}
            </div>

            {/* Linked Quotations */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-blue-400" />
                  <span>Linked Quotations ({clientQuotations.length})</span>
                </h4>
              </div>
              {clientQuotations.length === 0 ? (
                <p className="text-xs text-slate-500 italic p-3 rounded-xl bg-slate-800/30 border border-slate-800">
                  No quotations created for this client yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {clientQuotations.map((q) => (
                    <div
                      key={q.id}
                      className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{q.quotationNumber}</span>
                          {getStatusBadge(q.status)}
                        </div>
                        <p className="text-slate-400 mt-0.5">{q.projectTitle}</p>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-blue-400 text-sm">
                          ₱{(q.grandTotalCentavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                        </span>
                        <p className="text-[10px] text-slate-500">Issued: {q.issueDate}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Linked Projects */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Briefcase className="w-4 h-4 text-indigo-400" />
                <span>Linked Projects ({clientProjects.length})</span>
              </h4>
              {clientProjects.length === 0 ? (
                <p className="text-xs text-slate-500 italic p-3 rounded-xl bg-slate-800/30 border border-slate-800">
                  No active or past projects for this client.
                </p>
              ) : (
                <div className="space-y-2">
                  {clientProjects.map((p) => (
                    <div
                      key={p.id}
                      className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{p.projectNumber}</span>
                          {getStatusBadge(p.status)}
                        </div>
                        <p className="text-slate-400 mt-0.5">{p.name}</p>
                      </div>
                      <span className="text-[11px] text-slate-400">{p.serviceCategory}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Linked Invoices */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Receipt className="w-4 h-4 text-emerald-400" />
                <span>Billing Invoices ({clientInvoices.length})</span>
              </h4>
              {clientInvoices.length === 0 ? (
                <p className="text-xs text-slate-500 italic p-3 rounded-xl bg-slate-800/30 border border-slate-800">
                  No invoices issued for this client.
                </p>
              ) : (
                <div className="space-y-2">
                  {clientInvoices.map((inv) => (
                    <div
                      key={inv.id}
                      className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{inv.invoiceNumber}</span>
                          {getStatusBadge(inv.status)}
                        </div>
                        <p className="text-slate-400 mt-0.5">{inv.title}</p>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-white">
                          ₱{(inv.grandTotalCentavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                        </span>
                        <p className="text-[10px] text-slate-400">
                          Balance: ₱{(inv.remainingBalanceCentavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Client Edit / Create Modal */}
      {isEditModalOpen && editingClient && (
        <Modal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          title={editingClient.id ? 'Edit Client Profile' : 'New Client Inquiry / Lead'}
          subtitle="All records are saved directly to this tablet's local IndexedDB"
          maxWidth="lg"
        >
          <form onSubmit={handleSaveClient} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Client / Company Name *
              </label>
              <input
                type="text"
                required
                value={editingClient.name || ''}
                onChange={(e) => setEditingClient({ ...editingClient, name: e.target.value })}
                placeholder="e.g. San Miguel Res. HOA or Juan Dela Cruz"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Contact Person
                </label>
                <input
                  type="text"
                  value={editingClient.contactPerson || ''}
                  onChange={(e) => setEditingClient({ ...editingClient, contactPerson: e.target.value })}
                  placeholder="e.g. Engr. Mark Santos"
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Contact Number *
                </label>
                <input
                  type="tel"
                  required
                  value={editingClient.contactNumber || ''}
                  onChange={(e) => setEditingClient({ ...editingClient, contactNumber: e.target.value })}
                  placeholder="e.g. 0917 123 4567"
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  value={editingClient.email || ''}
                  onChange={(e) => setEditingClient({ ...editingClient, email: e.target.value })}
                  placeholder="client@gmail.com"
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Lead Status
                </label>
                <select
                  value={editingClient.leadStatus || 'New Inquiry'}
                  onChange={(e) => setEditingClient({ ...editingClient, leadStatus: e.target.value as LeadStatus })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  {leadStatuses.map((st) => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Lead Acquisition Source
                </label>
                <select
                  value={editingClient.leadSource || 'Referral'}
                  onChange={(e) => setEditingClient({ ...editingClient, leadSource: e.target.value as LeadSource })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  {leadSources.map((src) => (
                    <option key={src} value={src}>{src}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Installation / Site Address
                </label>
                <input
                  type="text"
                  value={editingClient.address || ''}
                  onChange={(e) => setEditingClient({ ...editingClient, address: e.target.value })}
                  placeholder="e.g. Lot 12 Blk 4, Valle Verde 5, Pasig"
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Site Survey Notes / Security Requirements
              </label>
              <textarea
                rows={3}
                value={editingClient.notes || ''}
                onChange={(e) => setEditingClient({ ...editingClient, notes: e.target.value })}
                placeholder="Details about perimeter fence length, gate weight/swing vs slide, existing wiring, power source distance..."
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 shadow-md"
              >
                {editingClient.id ? 'Save Changes' : 'Create Client'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete Confirmation */}
      {clientToDelete && (
        <ConfirmDialog
          isOpen={!!clientToDelete}
          onClose={() => setClientToDelete(null)}
          onConfirm={handleDeleteClient}
          title="Delete Client Record"
          message={
            deleteError
              ? `Cannot delete ${clientToDelete.name}: ${deleteError}`
              : `Are you sure you want to permanently delete ${clientToDelete.name}? This action cannot be reversed.`
          }
          confirmLabel={deleteError ? 'Understood' : 'Delete Record'}
          variant={deleteError ? 'warning' : 'danger'}
        />
      )}
    </div>
  );
};
