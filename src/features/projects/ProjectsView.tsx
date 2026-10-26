import React, { useState, useEffect, useMemo } from 'react';
import {
  Project,
  ProjectStatus,
  ServiceCategory,
  Client,
  AttachmentRecord,
} from '../../types';
import {
  projectRepository,
  clientRepository,
  quotationRepository,
  invoiceRepository,
  attachmentRepository,
  settingsRepository,
} from '../../storage/repositories';
import { getNextDocumentNumber } from '../../storage/database';
import { getStatusBadge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../app/providers/ToastContext';
import { formatCurrency } from '../../domain/calculations';
import {
  FolderGit2,
  Plus,
  Search,
  Filter,
  Calendar,
  MapPin,
  Clock,
  CheckCircle2,
  Image,
  Upload,
  MessageSquare,
  Trash2,
  Edit2,
  DollarSign,
  FileText,
  AlertCircle,
  ExternalLink,
  CloudUpload,
  Wifi,
  WifiOff,
  ServerCrash,
  RefreshCw,
  Cloud,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { useConnectivity, OFFLINE_WARNING, API_UNREACHABLE_WARNING } from '../../hooks/useConnectivity';
import {
  buildProjectImageName,
  getAttachmentDisplayName,
} from './projectImageNaming';
import {
  prepareR2UploadItems,
  uploadSingleFileToR2,
  requestPresignedDownloadUrl,
  R2UploadItem,
} from '../../services/r2UploadService';

interface ProjectsViewProps {
  initialClientId?: string;
  onOpenInvoice?: (invoiceId: string) => void;
}

export const ProjectsView: React.FC<ProjectsViewProps> = ({
  initialClientId,
  onOpenInvoice,
}) => {
  const { showToast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Selected project for detailed timeline & attachments
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectAttachments, setProjectAttachments] = useState<AttachmentRecord[]>([]);

  // Project Create / Edit Modal
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Partial<Project> | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string>('');

  // Add Progress Note Modal / State
  const [newProgressNote, setNewProgressNote] = useState('');
  const [statusChangeOnNote, setStatusChangeOnNote] = useState<ProjectStatus | ''>('');

  // Attachment upload scratchpad
  const [isUploading, setIsUploading] = useState(false);
  const [attachmentCaption, setAttachmentCaption] = useState('');

  // Image preview modal
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // Network & SentinelOps API Reachability
  const connectivity = useConnectivity();

  // Cloudflare R2 Upload Batch State & Presigned URLs
  const [uploadBatch, setUploadBatch] = useState<R2UploadItem[]>([]);
  const [isBatchUploading, setIsBatchUploading] = useState(false);
  const [remoteImageUrls, setRemoteImageUrls] = useState<Record<string, string>>({});

  // Deletion confirm
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const projectStatuses: ProjectStatus[] = [
    'Planning',
    'Survey',
    'Approved',
    'Ongoing',
    'Completed',
    'Closed',
  ];

  const serviceCategories: ServiceCategory[] = [
    'Electric Fence Installation',
    'Automatic Gate Installation',
    'Maintenance Service',
    'CCTV & Security Systems',
    'Access Control & Intercom',
    'Integrated Perimeter Security',
    'Other Service',
  ];

  const loadData = async () => {
    try {
      setLoading(true);
      const [projs, clis] = await Promise.all([
        projectRepository.getAll(),
        clientRepository.getAll(),
      ]);
      setProjects(projs);
      setClients(clis);
    } catch {
      showToast('Failed to load projects', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadProjectAttachments = async (projectId: string) => {
    try {
      const atts = await attachmentRepository.getByEntity('Project', projectId);
      setProjectAttachments(atts);

      // Pre-fetch presigned download URLs for any R2 attachment without local blob
      atts.forEach((att) => {
        if (att.storageProvider === 'cloudflare-r2' && !att.blob && !remoteImageUrls[att.id]) {
          void requestPresignedDownloadUrl(projectId, att.id, att.fileName).then((url) => {
            if (url) {
              setRemoteImageUrls((prev) => ({ ...prev, [att.id]: url }));
            }
          });
        }
      });
    } catch {
      console.warn('Failed to load attachments');
    }
  };

  const handleSelectProject = (project: Project) => {
    setSelectedProject(project);
    loadProjectAttachments(project.id);
  };

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        p.projectNumber.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.clientName.toLowerCase().includes(q) ||
        p.siteAddress.toLowerCase().includes(q);

      const matchesStatus = statusFilter === 'ALL' || p.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [projects, searchQuery, statusFilter]);

  const handleOpenCreateProject = async (targetClientId?: string) => {
    const settings = await settingsRepository.getSettings();
    const prjNum = await getNextDocumentNumber(settings.projectPrefix || 'PRJ-');

    const cliId = targetClientId || (clients.length > 0 ? clients[0].id : '');
    const client = clients.find((c) => c.id === cliId);

    const newPrj: Partial<Project> = {
      projectNumber: prjNum,
      clientId: client?.id || '',
      clientName: client?.name || '',
      name: 'Electric Fence & Gate Automation Project',
      serviceCategory: 'Electric Fence Installation',
      siteAddress: client?.address || '',
      description: 'Full perimeter security wiring, brackets, gate motor setup, and controller commissioning.',
      scopeOfWork: 'Installation, wiring, earthing grounding, testing, turnover.',
      startDate: new Date().toISOString().split('T')[0],
      status: 'Ongoing',
      progressNotes: [
        {
          id: Math.random().toString(36).substring(2, 9),
          timestamp: new Date().toISOString(),
          author: 'Admin',
          text: 'Project initiated and registered in local database.',
          statusChange: 'Ongoing',
        },
      ],
      totalQuotedCentavos: 0,
      totalInvoicedCentavos: 0,
      totalPaidCentavos: 0,
    };

    setEditingProject(newPrj);
    setSelectedClientId(newPrj.clientId || '');
    setIsEditModalOpen(true);
  };

  const handleSaveProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProject || !selectedClientId) {
      showToast('Client is required', 'error');
      return;
    }
    if (!editingProject.name?.trim()) {
      showToast('Project title is required', 'error');
      return;
    }

    const client = clients.find((c) => c.id === selectedClientId);

    try {
      const fullProject: Project = {
        id: editingProject.id || Math.random().toString(36).substring(2, 9),
        projectNumber: editingProject.projectNumber || 'PRJ-000',
        clientId: selectedClientId,
        clientName: client?.name || editingProject.clientName || '',
        name: editingProject.name || '',
        serviceCategory: editingProject.serviceCategory || 'Electric Fence Installation',
        siteAddress: editingProject.siteAddress || client?.address || '',
        description: editingProject.description || '',
        scopeOfWork: editingProject.scopeOfWork || '',
        startDate: editingProject.startDate,
        targetCompletionDate: editingProject.targetCompletionDate,
        actualCompletionDate: editingProject.actualCompletionDate,
        status: editingProject.status || 'Ongoing',
        progressNotes: editingProject.progressNotes || [],
        totalQuotedCentavos: editingProject.totalQuotedCentavos || 0,
        totalInvoicedCentavos: editingProject.totalInvoicedCentavos || 0,
        totalPaidCentavos: editingProject.totalPaidCentavos || 0,
        createdAt: editingProject.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const saved = await projectRepository.save(fullProject);
      showToast('Project saved successfully', 'success');
      setIsEditModalOpen(false);
      setEditingProject(null);
      await loadData();

      if (selectedProject?.id === saved.id) {
        setSelectedProject(saved);
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save project', 'error');
    }
  };

  // Add Progress Note
  const handleAddProgressNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject || !newProgressNote.trim()) return;

    try {
      const updated = await projectRepository.addProgressNote(
        selectedProject.id,
        newProgressNote.trim(),
        'Admin',
        statusChangeOnNote ? (statusChangeOnNote as ProjectStatus) : undefined
      );

      showToast('Progress note logged to project timeline', 'success');
      setNewProgressNote('');
      setStatusChangeOnNote('');
      setSelectedProject(updated);
      await loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to add progress note', 'error');
    }
  };

  // Direct Cloudflare R2 Upload Handler (Online & SentinelOps API reachable only)
  const handleR2FilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0 || !selectedProject) return;

    if (connectivity.status !== 'ready') {
      showToast(connectivity.errorMessage || 'Cannot upload to Cloudflare R2 at this time.', 'error');
      return;
    }

    const files = Array.from(fileList);
    const preparedItems = prepareR2UploadItems(files, selectedProject, projectAttachments);
    setUploadBatch(preparedItems);
    setIsBatchUploading(true);

    try {
      for (let i = 0; i < preparedItems.length; i++) {
        const item = preparedItems[i];
        await uploadSingleFileToR2(item, selectedProject, (updated) => {
          setUploadBatch((prev) =>
            prev.map((it) => (it.id === updated.id ? updated : it))
          );
        });
      }

      showToast('Cloudflare R2 upload processing completed', 'success');
      await loadProjectAttachments(selectedProject.id);
    } catch {
      showToast('Error during image batch upload to Cloudflare R2', 'error');
    } finally {
      setIsBatchUploading(false);
      e.target.value = '';
    }
  };

  const handleRetryUpload = async (item: R2UploadItem) => {
    if (!selectedProject) return;
    if (connectivity.status !== 'ready') {
      showToast(connectivity.errorMessage || 'Cannot retry upload while offline or server unreachable.', 'error');
      return;
    }

    setIsBatchUploading(true);
    try {
      await uploadSingleFileToR2(item, selectedProject, (updated) => {
        setUploadBatch((prev) =>
          prev.map((it) => (it.id === updated.id ? updated : it))
        );
      });
      await loadProjectAttachments(selectedProject.id);
    } finally {
      setIsBatchUploading(false);
    }
  };

  const handleDismissBatch = () => {
    setUploadBatch([]);
  };

  // Upload Local Photo / Document (Available offline & online)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedProject) return;

    // Check size limit: 15MB
    if (file.size > 15 * 1024 * 1024) {
      showToast('File size exceeds 15MB limit. Please choose a smaller photo.', 'error');
      return;
    }

    try {
      setIsUploading(true);
      const attRecord: AttachmentRecord = {
        id: Math.random().toString(36).substring(2, 9),
        entityType: 'Project',
        entityId: selectedProject.id,
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        caption: attachmentCaption || file.name,
        uploadedAt: new Date().toISOString(),
        storageProvider: 'local',
        blob: file,
      };

      await attachmentRepository.saveAttachment(attRecord);
      showToast('Attachment saved directly to local storage', 'success');
      setAttachmentCaption('');
      await loadProjectAttachments(selectedProject.id);
    } catch {
      showToast('Failed to save file attachment', 'error');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteAttachment = async (id: string) => {
    if (!confirm('Delete this photo / attachment?')) return;
    try {
      await attachmentRepository.deleteAttachment(id);
      showToast('Attachment deleted', 'success');
      if (selectedProject) {
        await loadProjectAttachments(selectedProject.id);
      }
    } catch {
      showToast('Failed to delete attachment', 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Security Projects & Installations
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Track site progress, installation timeline, completion milestones, and site photos offline.
          </p>
        </div>

        <button
          onClick={() => handleOpenCreateProject()}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs sm:text-sm font-semibold shadow-lg shadow-blue-600/30 transition"
        >
          <Plus className="w-4 h-4" />
          <span>New Project</span>
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
            placeholder="Search by project #, title, client, or site address..."
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
            <option value="ALL">All Statuses ({projects.length})</option>
            {projectStatuses.map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Grid: Projects List + Selected Project Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Projects List */}
        <div className={`space-y-3 ${selectedProject ? 'lg:col-span-5' : 'lg:col-span-12'}`}>
          {loading ? (
            <div className="p-8 text-center text-slate-400 text-sm rounded-2xl bg-slate-900 border border-slate-800">
              Loading projects...
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <FolderGit2 className="w-10 h-10 text-slate-600 mx-auto" />
              <h3 className="text-base font-bold text-white">No projects found</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Initiate a project from an accepted quotation or create a new installation record directly.
              </p>
            </div>
          ) : (
            filteredProjects.map((p) => {
              const isSelected = selectedProject?.id === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => handleSelectProject(p)}
                  className={`p-4 rounded-2xl border transition cursor-pointer space-y-3 ${
                    isSelected
                      ? 'bg-slate-800/90 border-blue-500 shadow-lg shadow-blue-500/10'
                      : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm">{p.projectNumber}</span>
                        {getStatusBadge(p.status)}
                      </div>
                      <h4 className="text-sm font-semibold text-slate-200 mt-1">{p.name}</h4>
                      <p className="text-xs text-slate-400">
                        Client: <strong className="text-slate-300">{p.clientName}</strong> • {p.serviceCategory}
                      </p>
                    </div>

                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          setEditingProject({ ...p });
                          setSelectedClientId(p.clientId);
                          setIsEditModalOpen(true);
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                        title="Edit Project"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="text-xs text-slate-400 flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span className="truncate">{p.siteAddress || 'Site address not set'}</span>
                  </div>

                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-blue-400" />
                      Start: {p.startDate || 'N/A'}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageSquare className="w-3 h-3 text-purple-400" />
                      {p.progressNotes?.length || 0} updates
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right Column: Detailed Project Workspace */}
        {selectedProject && (
          <div className="lg:col-span-7 rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-6">
            {/* Top Overview */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="font-black text-white text-lg">{selectedProject.projectNumber}</span>
                  {getStatusBadge(selectedProject.status)}
                </div>
                <h3 className="text-base font-bold text-slate-200 mt-1">{selectedProject.name}</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Client: <strong className="text-white">{selectedProject.clientName}</strong> • Category: {selectedProject.serviceCategory}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setEditingProject({ ...selectedProject });
                    setSelectedClientId(selectedProject.clientId);
                    setIsEditModalOpen(true);
                  }}
                  className="px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-800 text-xs font-semibold text-slate-200 hover:text-white"
                >
                  Edit Scope
                </button>
              </div>
            </div>

            {/* Site Address & Description */}
            <div className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-700/60 text-xs space-y-2">
              <div className="flex items-center gap-2 text-slate-300">
                <MapPin className="w-4 h-4 text-blue-400 shrink-0" />
                <span className="font-semibold text-white">{selectedProject.siteAddress}</span>
              </div>
              {selectedProject.description && (
                <p className="text-slate-400 leading-relaxed">{selectedProject.description}</p>
              )}
            </div>

            {/* Progress Notes Timeline */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-purple-400" />
                <span>Site Progress Timeline ({selectedProject.progressNotes?.length || 0})</span>
              </h4>

              {/* Log new note form */}
              <form onSubmit={handleAddProgressNote} className="space-y-2 p-3 rounded-xl bg-slate-800/50 border border-slate-700">
                <textarea
                  rows={2}
                  required
                  value={newProgressNote}
                  onChange={(e) => setNewProgressNote(e.target.value)}
                  placeholder="Log site survey note, energizer bracket mounting, wire tension testing..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400">Update Status:</span>
                    <select
                      value={statusChangeOnNote}
                      onChange={(e) => setStatusChangeOnNote(e.target.value as ProjectStatus)}
                      className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                    >
                      <option value="">Keep current ({selectedProject.status})</option>
                      {projectStatuses.map((st) => (
                        <option key={st} value={st}>{st}</option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="submit"
                    className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white shadow-sm"
                  >
                    Post Progress Note
                  </button>
                </div>
              </form>

              {/* Notes List */}
              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {selectedProject.progressNotes?.slice().reverse().map((note) => (
                  <div
                    key={note.id}
                    className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/60 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white">{note.author}</span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(note.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-slate-300 leading-relaxed whitespace-pre-wrap">{note.text}</p>
                    {note.statusChange && (
                      <div className="pt-1 flex items-center gap-1.5 text-[10px] text-blue-400 font-semibold">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Status transitioned to: {note.statusChange}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Site Photos & Document Attachments */}
            <div className="space-y-3.5 pt-3 border-t border-slate-800">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                    <Image className="w-4 h-4 text-emerald-400" />
                    <span>Site Photos & Attachments ({projectAttachments.length})</span>
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Images are organized as {`{ProjectFolder}/{N}.ext`} (e.g. {`1.jpg`}) in R2
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Remote Cloudflare R2 Upload Button */}
                  <label
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold shadow-sm transition ${
                      connectivity.status === 'ready' && !isBatchUploading
                        ? 'cursor-pointer bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/20'
                        : 'cursor-not-allowed bg-slate-800 text-slate-500 border border-slate-700/60'
                    }`}
                    aria-disabled={connectivity.status !== 'ready' || isBatchUploading}
                    title={
                      connectivity.status !== 'ready'
                        ? connectivity.errorMessage || 'Cloudflare R2 upload unavailable'
                        : 'Upload photo(s) directly to Cloudflare R2'
                    }
                  >
                    <CloudUpload className="w-3.5 h-3.5" />
                    <span>{isBatchUploading ? 'Uploading...' : 'Upload to Cloudflare R2'}</span>
                    <input
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleR2FilesSelected}
                      disabled={connectivity.status !== 'ready' || isBatchUploading}
                      className="hidden"
                    />
                  </label>

                  {/* Local Photo / Document Upload Button (Preserved Offline & Online) */}
                  <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold shadow-sm transition">
                    <Upload className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{isUploading ? 'Saving...' : 'Add Local Photo'}</span>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={handleFileUpload}
                      disabled={isUploading}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* Connectivity Status & Warnings */}
              {connectivity.status === 'checking' && (
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60 text-xs text-slate-300">
                  <RefreshCw className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0" />
                  <span className="font-medium">Checking connection…</span>
                </div>
              )}

              {connectivity.status === 'offline' && (
                <div
                  className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-200"
                  role="alert"
                  aria-live="polite"
                >
                  <WifiOff className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1 font-medium leading-relaxed">
                    {OFFLINE_WARNING}
                  </div>
                </div>
              )}

              {connectivity.status === 'api-unreachable' && (
                <div
                  className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-200"
                  role="alert"
                  aria-live="polite"
                >
                  <ServerCrash className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="flex-1 font-medium leading-relaxed">
                    {API_UNREACHABLE_WARNING}
                  </div>
                  <button
                    type="button"
                    onClick={() => connectivity.checkReachability()}
                    className="px-2.5 py-1 text-[11px] font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-100 rounded-lg shrink-0 transition flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Retry Check</span>
                  </button>
                </div>
              )}

              {connectivity.status === 'ready' && (
                <div className="flex items-center justify-between p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
                  <div className="flex items-center gap-2">
                    <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="font-medium">SentinelOps API connected. Cloudflare R2 uploads enabled.</span>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Ready</span>
                </div>
              )}

              {/* Active Cloudinary Upload Batch Queue */}
              {uploadBatch.length > 0 && (
                <div className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <h5 className="text-xs font-bold text-white flex items-center gap-2">
                      <CloudUpload className="w-4 h-4 text-blue-400" />
                      <span>
                        Upload Batch ({uploadBatch.filter((b) => b.state === 'uploaded').length}/{uploadBatch.length} Completed)
                      </span>
                    </h5>
                    {!isBatchUploading && (
                      <button
                        type="button"
                        onClick={handleDismissBatch}
                        className="text-[11px] text-slate-400 hover:text-white px-2 py-0.5 rounded-lg bg-slate-800"
                      >
                        Clear Queue
                      </button>
                    )}
                  </div>

                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {uploadBatch.map((item) => (
                      <div
                        key={item.id}
                        className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">
                              #{item.sequenceNumber}
                            </span>
                            <span className="font-semibold text-slate-200 truncate" title={item.displayName}>
                              {item.displayName}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                item.state === 'uploaded'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : item.state === 'failed'
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                  : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                              }`}
                            >
                              {item.state}
                            </span>
                            {item.state === 'failed' && (
                              <button
                                type="button"
                                disabled={isBatchUploading || connectivity.status !== 'ready'}
                                onClick={() => handleRetryUpload(item)}
                                className="px-2 py-0.5 text-[10px] font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 rounded border border-amber-500/40 flex items-center gap-1 transition"
                              >
                                <RefreshCw className="w-2.5 h-2.5" />
                                <span>Retry #{item.sequenceNumber}</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full bg-slate-700/60 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              item.state === 'failed'
                                ? 'bg-rose-500'
                                : item.state === 'uploaded'
                                ? 'bg-emerald-500'
                                : 'bg-blue-500'
                            }`}
                            style={{ width: `${item.progressPercent}%` }}
                          />
                        </div>

                        {item.error && (
                          <p className="text-[11px] text-rose-300 font-medium">{item.error}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Attachments Gallery */}
              {projectAttachments.length === 0 ? (
                <p className="text-xs text-slate-500 italic p-3 rounded-xl bg-slate-800/30">
                  No site photos or files attached to this project yet. Use "Upload to Cloudflare R2" or "Add Local Photo" to attach photos.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {projectAttachments.map((att) => {
                    const isImg = att.fileType.startsWith('image/');
                    const isR2 = att.storageProvider === 'cloudflare-r2' || Boolean(att.r2ObjectKey);
                    const isCloudinary = att.storageProvider === 'cloudinary' || Boolean(att.cloudinaryUrl);
                    const url =
                      (isImg && att.blob ? URL.createObjectURL(att.blob) : null) ||
                      remoteImageUrls[att.id] ||
                      att.cloudinaryUrl ||
                      null;
                    const derivedDisplayName = getAttachmentDisplayName(att, selectedProject);

                    return (
                      <div
                        key={att.id}
                        className="group relative rounded-xl border border-slate-700 bg-slate-800/80 overflow-hidden flex flex-col"
                      >
                        {isImg && url ? (
                          <div
                            onClick={() => setPreviewImageUrl(url)}
                            className="h-28 bg-slate-900 cursor-pointer overflow-hidden flex items-center justify-center relative"
                          >
                            <img
                              src={url}
                              alt={derivedDisplayName}
                              className="w-full h-full object-cover group-hover:scale-105 transition"
                            />
                            {/* Storage Provider & Sequence Badge */}
                            <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
                              {typeof att.sequenceNumber === 'number' && (
                                <span className="px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-sm text-[9px] font-bold text-white">
                                  #{att.sequenceNumber}
                                </span>
                              )}
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-1 backdrop-blur-sm ${
                                  isR2
                                    ? 'bg-blue-600/90 text-white'
                                    : isCloudinary
                                    ? 'bg-purple-600/90 text-white'
                                    : 'bg-emerald-600/90 text-white'
                                }`}
                              >
                                {isR2 || isCloudinary ? <Cloud className="w-2.5 h-2.5" /> : null}
                                <span>{isR2 ? 'Cloudflare R2' : isCloudinary ? 'Cloudinary' : 'Local'}</span>
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="h-28 bg-slate-900 flex items-center justify-center text-slate-500 text-xs font-semibold relative">
                            <span>Document / PDF</span>
                            {typeof att.sequenceNumber === 'number' && (
                              <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-slate-800 text-[9px] font-bold text-slate-300">
                                #{att.sequenceNumber}
                              </span>
                            )}
                          </div>
                        )}

                        <div className="p-2 text-[11px] truncate flex items-center justify-between bg-slate-900/60">
                          <div className="min-w-0 pr-1">
                            <div className="truncate font-semibold text-slate-200" title={att.r2FolderName ? `${att.r2FolderName}/${att.fileName}` : derivedDisplayName}>
                              {att.storageProvider === 'cloudflare-r2' ? att.fileName : derivedDisplayName}
                            </div>
                            {att.r2FolderName && (
                              <div className="text-[10px] text-slate-400 truncate" title={`Folder: ${att.r2FolderName}`}>
                                {att.r2FolderName}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => handleDeleteAttachment(att.id)}
                            className="text-rose-400 hover:text-rose-300 p-1 shrink-0"
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Project Edit / Create Modal */}
      {isEditModalOpen && editingProject && (
        <Modal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          title={`Project Setup — ${editingProject.projectNumber}`}
          subtitle="Configure installation scope, site address, and milestones"
          maxWidth="2xl"
        >
          <form onSubmit={handleSaveProject} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Linked Client *
                </label>
                <select
                  required
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white"
                >
                  <option value="">-- Choose Client --</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Service Category
                </label>
                <select
                  value={editingProject.serviceCategory}
                  onChange={(e) =>
                    setEditingProject({
                      ...editingProject,
                      serviceCategory: e.target.value as ServiceCategory,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white"
                >
                  {serviceCategories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Project Title *
                </label>
                <input
                  type="text"
                  required
                  value={editingProject.name || ''}
                  onChange={(e) => setEditingProject({ ...editingProject, name: e.target.value })}
                  placeholder="e.g. 150m Perimeter Electric Fence & Sliding Gate Motor"
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Site Installation Address
                </label>
                <input
                  type="text"
                  value={editingProject.siteAddress || ''}
                  onChange={(e) =>
                    setEditingProject({ ...editingProject, siteAddress: e.target.value })
                  }
                  placeholder="e.g. Alabang Hills, Muntinlupa"
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Project Status
                </label>
                <select
                  value={editingProject.status}
                  onChange={(e) =>
                    setEditingProject({
                      ...editingProject,
                      status: e.target.value as ProjectStatus,
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white"
                >
                  {projectStatuses.map((st) => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Start Date
                </label>
                <input
                  type="date"
                  value={editingProject.startDate || ''}
                  onChange={(e) =>
                    setEditingProject({ ...editingProject, startDate: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Description & Technical Scope
              </label>
              <textarea
                rows={3}
                value={editingProject.description || ''}
                onChange={(e) =>
                  setEditingProject({ ...editingProject, description: e.target.value })
                }
                className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs sm:text-sm text-white"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500"
              >
                Save Project
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Image Preview Modal */}
      {previewImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md cursor-pointer"
          onClick={() => setPreviewImageUrl(null)}
        >
          <img
            src={previewImageUrl}
            alt="Site Photo Full Preview"
            className="max-w-full max-h-[90vh] rounded-2xl object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  );
};
