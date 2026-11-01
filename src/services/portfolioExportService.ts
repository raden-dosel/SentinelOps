/**
 * SentinelOps - Portfolio Metadata & Project Details Export Service
 *
 * Implements export of Project Details and associated Image References
 * into a structured, portfolio-ready JSON format (schemaVersion: "1.0").
 *
 * Guarantees:
 * - Single source of truth: uses canonical Project and Client domain records
 * - No binary bloat: image references include metadata, sequence, and URLs, zero blobs/base64
 * - Zero secret leakage: no storage API credentials, signing keys, or server secrets
 * - Offline-capable: pure client-side JSON compilation and browser download
 * - Deterministic file naming: sentinelops-project-{ProjectNumber|ID}.json
 */

import {
  Project,
  Client,
  AttachmentMetadata,
  ProjectDetailsSnapshot,
  ProjectImageReference,
  PortfolioProjectExport,
  ProjectClientSnapshot,
  ProjectFinancialSummary,
} from '../types';
import { formatCurrency } from '../domain/calculations';
import { getAttachmentDisplayName } from '../features/projects/projectImageNaming';

/**
 * Builds a comprehensive snapshot of Project Details using the canonical Project
 * and Client records as the source of truth.
 */
export function buildProjectDetailsSnapshot(
  project: Project,
  client?: Client | null
): ProjectDetailsSnapshot {
  const quoted = project.totalQuotedCentavos ?? 0;
  const invoiced = project.totalInvoicedCentavos ?? 0;
  const paid = project.totalPaidCentavos ?? 0;
  const balanceDue = Math.max(0, invoiced - paid);

  const clientSnapshot: ProjectClientSnapshot = {
    id: client?.id || project.clientId,
    name: client?.name || project.clientName,
    contactPerson: client?.contactPerson || undefined,
    contactNumber: client?.contactNumber || undefined,
    email: client?.email || undefined,
    address: client?.address || project.siteAddress || undefined,
    city: client?.city || undefined,
    leadSource: client?.leadSource || undefined,
    leadStatus: client?.leadStatus || undefined,
  };

  const financials: ProjectFinancialSummary = {
    totalQuotedCentavos: quoted,
    totalInvoicedCentavos: invoiced,
    totalPaidCentavos: paid,
    balanceDueCentavos: balanceDue,
    formattedQuoted: formatCurrency(quoted),
    formattedInvoiced: formatCurrency(invoiced),
    formattedPaid: formatCurrency(paid),
    formattedBalanceDue: formatCurrency(balanceDue),
  };

  return {
    id: project.id,
    projectNumber: project.projectNumber,
    name: project.name,
    serviceCategory: project.serviceCategory,
    status: project.status,
    siteAddress: project.siteAddress,
    description: project.description || '',
    scopeOfWork: project.scopeOfWork || '',
    startDate: project.startDate || undefined,
    targetCompletionDate: project.targetCompletionDate || undefined,
    actualCompletionDate: project.actualCompletionDate || undefined,
    quotationId: project.quotationId || undefined,
    quotationNumber: project.quotationNumber || undefined,
    client: clientSnapshot,
    financials,
    progressNotes: Array.isArray(project.progressNotes) ? [...project.progressNotes] : [],
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

/**
 * Maps an array of AttachmentMetadata into clean image references without binary data or secrets.
 */
export function buildImageReferences(
  attachments: AttachmentMetadata[],
  project?: Project | null
): ProjectImageReference[] {
  if (!attachments || attachments.length === 0) return [];

  return attachments.map((att) => {
    const displayName = project ? getAttachmentDisplayName(att, project) : att.fileName;

    const ref: ProjectImageReference = {
      id: att.id,
      sequenceNumber: att.sequenceNumber,
      fileName: att.fileName,
      displayName,
      fileType: att.fileType,
      fileSize: att.fileSize,
      caption: att.caption || undefined,
      uploadedAt: att.uploadedAt,
      storageProvider: att.storageProvider,
      r2ObjectKey: att.r2ObjectKey || undefined,
      r2Bucket: att.r2Bucket || undefined,
      r2FolderName: att.r2FolderName || undefined,
      etag: att.etag || undefined,
      cloudinaryPublicId: att.cloudinaryPublicId || undefined,
      cloudinaryUrl: att.cloudinaryUrl || undefined,
    };

    return ref;
  });
}

/**
 * Compiles the complete export structure for portfolio classification.
 */
export function buildPortfolioExport(
  project: Project,
  attachments: AttachmentMetadata[],
  client?: Client | null
): PortfolioProjectExport {
  const projectSnapshot = buildProjectDetailsSnapshot(project, client);
  const images = buildImageReferences(attachments, project);

  return {
    schemaVersion: '1.0',
    exportedAt: new Date().toISOString(),
    source: 'SentinelOps',
    portfolioClassificationReady: true,
    project: projectSnapshot,
    images,
  };
}

/**
 * Formats the export object as a pretty-printed JSON string.
 */
export function exportProjectMetadataAsJson(
  project: Project,
  attachments: AttachmentMetadata[],
  client?: Client | null,
  indent = 2
): string {
  const exportData = buildPortfolioExport(project, attachments, client);
  return JSON.stringify(exportData, null, indent);
}

/**
 * Generates a clean, deterministic filename for the exported JSON.
 * Example: sentinelops-project-PRJ-2026-001.json
 */
export function getPortfolioExportFileName(project: Project): string {
  const rawId = project.projectNumber || project.id || 'project';
  const cleanId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `sentinelops-project-${cleanId}.json`;
}

/**
 * Triggers a client-side download of the formatted JSON file in browser environments.
 * 100% offline-compatible; works with local IndexedDB records.
 */
export function downloadProjectMetadataJson(
  project: Project,
  attachments: AttachmentMetadata[],
  client?: Client | null
): void {
  const jsonString = exportProjectMetadataAsJson(project, attachments, client);
  const fileName = getPortfolioExportFileName(project);

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
