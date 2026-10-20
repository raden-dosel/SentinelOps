/**
 * SentinelOps - Backup, Restore, and Data Portability Service
 * Supports JSON snapshots, ZIP bundles with attachments via JSZip,
 * and comprehensive pre-restore validation.
 */

import JSZip from 'jszip';
import { getDatabase, DB_VERSION } from '../storage/database';
import {
  BackupData,
  BackupManifest,
  Client,
  Quotation,
  QuotationRevision,
  Invoice,
  Payment,
  Project,
  AttachmentRecord,
  AttachmentMetadata,
  AuditEvent,
  AppSettings,
} from '../types';
import {
  clientRepository,
  quotationRepository,
  invoiceRepository,
  paymentRepository,
  projectRepository,
  settingsRepository,
  auditRepository,
} from '../storage/repositories';

const APP_VERSION = '1.0.0';

/**
 * Gather all business records from IndexedDB into a structured BackupData payload
 */
export async function createBackupPayload(): Promise<BackupData> {
  const db = await getDatabase();

  const [settings, clients, quotations, quotationRevisions, invoices, payments, projects, allAttachments, auditEvents] =
    await Promise.all([
      settingsRepository.getSettings(),
      clientRepository.getAll(),
      quotationRepository.getAll(),
      db.getAll('quotationRevisions') as Promise<QuotationRevision[]>,
      invoiceRepository.getAll(),
      paymentRepository.getAll(),
      projectRepository.getAll(),
      db.getAll('attachments') as Promise<AttachmentRecord[]>,
      auditRepository.getAll(),
    ]);

  const attachmentsMetadata: AttachmentMetadata[] = allAttachments.map((a) => ({
    id: a.id,
    entityType: a.entityType,
    entityId: a.entityId,
    fileName: a.fileName,
    fileType: a.fileType,
    fileSize: a.fileSize,
    caption: a.caption,
    uploadedAt: a.uploadedAt,
  }));

  const manifest: BackupManifest = {
    appName: 'SentinelOps',
    schemaVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    recordCounts: {
      clients: clients.length,
      quotations: quotations.length,
      quotationRevisions: quotationRevisions.length,
      invoices: invoices.length,
      payments: payments.length,
      projects: projects.length,
      attachments: attachmentsMetadata.length,
      auditEvents: auditEvents.length,
    },
  };

  return {
    manifest,
    settings,
    clients,
    quotations,
    quotationRevisions,
    invoices,
    payments,
    projects,
    attachmentsMetadata,
    auditEvents,
  };
}

/**
 * Export full backup as formatted JSON file
 */
export async function exportJsonBackup(actorName = 'Admin'): Promise<void> {
  const backup = await createBackupPayload();
  const jsonStr = JSON.stringify(backup, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const filename = `SentinelOps_Backup_${new Date().toISOString().split('T')[0]}_v${backup.manifest.schemaVersion}.json`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);

  await auditRepository.logEvent({
    action: 'BACKUP_EXPORT',
    entityType: 'System',
    entityId: 'backup_json',
    entityLabel: filename,
    actorId: 'admin',
    actorName,
    details: { type: 'JSON', recordCounts: backup.manifest.recordCounts },
  });
}

/**
 * Export complete backup archive as a ZIP file including metadata and binary attachments
 */
export async function exportZipBackup(actorName = 'Admin'): Promise<void> {
  const backup = await createBackupPayload();
  const db = await getDatabase();
  const attachments = (await db.getAll('attachments')) as AttachmentRecord[];

  const zip = new JSZip();
  // 1. Root JSON database payload
  zip.file('sentinelops_database.json', JSON.stringify(backup, null, 2));

  // 2. Attachments folder
  const attFolder = zip.folder('attachments');
  if (attFolder) {
    for (const att of attachments) {
      if (att.blob) {
        attFolder.file(`${att.id}_${att.fileName}`, att.blob);
      }
    }
  }

  // Generate zip file blob
  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const filename = `SentinelOps_FullBackup_${new Date().toISOString().split('T')[0]}.zip`;

  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);

  await auditRepository.logEvent({
    action: 'BACKUP_EXPORT',
    entityType: 'System',
    entityId: 'backup_zip',
    entityLabel: filename,
    actorId: 'admin',
    actorName,
    details: { type: 'ZIP', filesCount: attachments.length, recordCounts: backup.manifest.recordCounts },
  });
}

export interface RestorePreview {
  valid: boolean;
  manifest?: BackupManifest;
  error?: string;
  previewData?: BackupData;
}

/**
 * Validates a backup file before restoration
 */
export async function validateBackupFile(file: File): Promise<RestorePreview> {
  try {
    if (file.name.endsWith('.json')) {
      const text = await file.text();
      const data = JSON.parse(text) as BackupData;

      if (!data.manifest || data.manifest.appName !== 'SentinelOps') {
        return { valid: false, error: 'Invalid backup file: Missing or invalid SentinelOps manifest header.' };
      }

      if (data.manifest.schemaVersion > DB_VERSION) {
        return {
          valid: false,
          error: `Incompatible backup version: File requires schema v${data.manifest.schemaVersion}, but current app supports v${DB_VERSION}.`,
        };
      }

      if (!Array.isArray(data.clients) || !Array.isArray(data.quotations) || !Array.isArray(data.invoices)) {
        return { valid: false, error: 'Corrupt backup file: Expected client, quotation, and invoice collections.' };
      }

      return { valid: true, manifest: data.manifest, previewData: data };
    }

    if (file.name.endsWith('.zip')) {
      const zip = await JSZip.loadAsync(file);
      const jsonFile = zip.file('sentinelops_database.json');
      if (!jsonFile) {
        return { valid: false, error: 'Invalid ZIP archive: Missing sentinelops_database.json payload.' };
      }

      const text = await jsonFile.async('string');
      const data = JSON.parse(text) as BackupData;

      if (!data.manifest || data.manifest.appName !== 'SentinelOps') {
        return { valid: false, error: 'Invalid ZIP backup: Invalid SentinelOps manifest header.' };
      }

      return { valid: true, manifest: data.manifest, previewData: data };
    }

    return { valid: false, error: 'Unsupported file type. Please provide a .json or .zip SentinelOps backup file.' };
  } catch (err: unknown) {
    return { valid: false, error: `Failed to parse backup file: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Restores database from a validated BackupData object
 */
export async function restoreBackupData(
  data: BackupData,
  file?: File,
  actorName = 'Admin'
): Promise<void> {
  const db = await getDatabase();
  const stores = [
    'settings',
    'clients',
    'quotations',
    'quotationRevisions',
    'invoices',
    'payments',
    'projects',
    'attachments',
    'auditEvents',
  ];

  const tx = db.transaction(stores, 'readwrite');

  // Clear existing business stores
  for (const storeName of stores) {
    await tx.objectStore(storeName).clear();
  }

  // Restore Settings
  if (data.settings) {
    await tx.objectStore('settings').put(data.settings);
  }

  // Restore Clients
  for (const c of data.clients || []) {
    await tx.objectStore('clients').put(c);
  }

  // Restore Quotations
  for (const q of data.quotations || []) {
    await tx.objectStore('quotations').put(q);
  }

  // Restore Quotation Revisions
  for (const rev of data.quotationRevisions || []) {
    await tx.objectStore('quotationRevisions').put(rev);
  }

  // Restore Invoices
  for (const inv of data.invoices || []) {
    await tx.objectStore('invoices').put(inv);
  }

  // Restore Payments
  for (const p of data.payments || []) {
    await tx.objectStore('payments').put(p);
  }

  // Restore Projects
  for (const prj of data.projects || []) {
    await tx.objectStore('projects').put(prj);
  }

  // Restore Attachments metadata and blobs if available from ZIP
  if (file && file.name.endsWith('.zip')) {
    const zip = await JSZip.loadAsync(file);
    for (const meta of data.attachmentsMetadata || []) {
      const zipEntry = zip.file(`attachments/${meta.id}_${meta.fileName}`);
      if (zipEntry) {
        const blob = await zipEntry.async('blob');
        const record: AttachmentRecord = {
          ...meta,
          blob,
        };
        await tx.objectStore('attachments').put(record);
      }
    }
  }

  // Restore historical audit events
  for (const audit of data.auditEvents || []) {
    await tx.objectStore('auditEvents').put(audit);
  }

  await tx.done;

  // Log restoration event
  await auditRepository.logEvent({
    action: 'BACKUP_RESTORE',
    entityType: 'System',
    entityId: 'restore_event',
    entityLabel: `Restored backup from ${data.manifest.exportedAt}`,
    actorId: 'admin',
    actorName,
    details: { recordCounts: data.manifest.recordCounts },
  });
}

/**
 * Estimates storage usage in bytes via standard StorageManager API
 */
export async function getStorageEstimate(): Promise<{ usedBytes: number; quotaBytes: number; percentage: number }> {
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      const usedBytes = estimate.usage || 0;
      const quotaBytes = estimate.quota || 1;
      const percentage = Math.min(100, Math.round((usedBytes / quotaBytes) * 100));
      return { usedBytes, quotaBytes, percentage };
    } catch (e) {
      console.warn('Storage estimate failed:', e);
    }
  }
  return { usedBytes: 0, quotaBytes: 0, percentage: 0 };
}

export interface DryRunMigrationReport {
  valid: boolean;
  canMerge: boolean;
  manifest?: BackupManifest;
  sourceCounts: Record<string, number>;
  existingCounts: Record<string, number>;
  duplicateIds: string[];
  documentNumberCollisions: string[];
  missingRelations: string[];
  warnings: string[];
  recommendation: 'SAFE_TO_MERGE' | 'REQUIRES_REPLACE_CONFIRMATION' | 'INVALID_FILE';
}

/**
 * Performs a safe dry-run analysis of a backup against the current local database
 * without mutating any local data.
 */
export async function dryRunBackupMigration(data: BackupData): Promise<DryRunMigrationReport> {
  const db = await getDatabase();
  const warnings: string[] = [];
  const duplicateIds: string[] = [];
  const documentNumberCollisions: string[] = [];
  const missingRelations: string[] = [];

  if (!data.manifest || data.manifest.appName !== 'SentinelOps') {
    return {
      valid: false,
      canMerge: false,
      sourceCounts: {},
      existingCounts: {},
      duplicateIds: [],
      documentNumberCollisions: [],
      missingRelations: [],
      warnings: ['Invalid manifest: not a recognized SentinelOps backup file.'],
      recommendation: 'INVALID_FILE',
    };
  }

  // 1. Gather current counts and existing records
  const [
    existingClients,
    existingQuotations,
    existingInvoices,
    existingPayments,
    existingProjects,
  ] = await Promise.all([
    db.getAll('clients') as Promise<Client[]>,
    db.getAll('quotations') as Promise<Quotation[]>,
    db.getAll('invoices') as Promise<Invoice[]>,
    db.getAll('payments') as Promise<Payment[]>,
    db.getAll('projects') as Promise<Project[]>,
  ]);

  const existingClientIds = new Set(existingClients.map((c) => c.id));
  const existingQuoteNums = new Map(existingQuotations.map((q) => [q.quotationNumber, q.id]));
  const existingInvNums = new Map(existingInvoices.map((i) => [i.invoiceNumber, i.id]));
  const existingPayNums = new Map(existingPayments.map((p) => [p.paymentNumber, p.id]));
  const existingPrjNums = new Map(existingProjects.map((p) => [p.projectNumber, p.id]));

  const backupClientIds = new Set((data.clients || []).map((c) => c.id));
  const allClientIds = new Set([...existingClientIds, ...backupClientIds]);

  const backupInvoiceIds = new Set((data.invoices || []).map((i) => i.id));
  const existingInvoiceIds = new Set(existingInvoices.map((i) => i.id));
  const allInvoiceIds = new Set([...existingInvoiceIds, ...backupInvoiceIds]);

  // Check Clients
  for (const client of data.clients || []) {
    if (existingClientIds.has(client.id)) {
      duplicateIds.push(`Client:${client.id} (${client.name})`);
    }
  }

  // Check Quotations
  for (const quote of data.quotations || []) {
    if (!allClientIds.has(quote.clientId)) {
      missingRelations.push(`Quotation ${quote.quotationNumber} references missing client ID: ${quote.clientId}`);
    }
    const existingId = existingQuoteNums.get(quote.quotationNumber);
    if (existingId && existingId !== quote.id) {
      documentNumberCollisions.push(`Quotation Number '${quote.quotationNumber}' used by existing ID ${existingId}`);
    }
  }

  // Check Invoices
  for (const inv of data.invoices || []) {
    if (!allClientIds.has(inv.clientId)) {
      missingRelations.push(`Invoice ${inv.invoiceNumber} references missing client ID: ${inv.clientId}`);
    }
    const existingId = existingInvNums.get(inv.invoiceNumber);
    if (existingId && existingId !== inv.id) {
      documentNumberCollisions.push(`Invoice Number '${inv.invoiceNumber}' used by existing ID ${existingId}`);
    }
  }

  // Check Payments
  for (const pay of data.payments || []) {
    if (!allInvoiceIds.has(pay.invoiceId)) {
      missingRelations.push(`Payment ${pay.paymentNumber} references missing invoice ID: ${pay.invoiceId}`);
    }
    const existingId = existingPayNums.get(pay.paymentNumber);
    if (existingId && existingId !== pay.id) {
      documentNumberCollisions.push(`Payment Number '${pay.paymentNumber}' used by existing ID ${existingId}`);
    }
  }

  // Check Projects
  for (const prj of data.projects || []) {
    if (!allClientIds.has(prj.clientId)) {
      missingRelations.push(`Project ${prj.projectNumber} references missing client ID: ${prj.clientId}`);
    }
    const existingId = existingPrjNums.get(prj.projectNumber);
    if (existingId && existingId !== prj.id) {
      documentNumberCollisions.push(`Project Number '${prj.projectNumber}' used by existing ID ${existingId}`);
    }
  }

  if (documentNumberCollisions.length > 0) {
    warnings.push(
      `Found ${documentNumberCollisions.length} document number collision(s). Merging without caution could cause document numbering discrepancies.`
    );
  }
  if (missingRelations.length > 0) {
    warnings.push(`Found ${missingRelations.length} dangling relational references in backup payload.`);
  }

  const canMerge = documentNumberCollisions.length === 0;
  const recommendation =
    documentNumberCollisions.length > 0
      ? 'REQUIRES_REPLACE_CONFIRMATION'
      : 'SAFE_TO_MERGE';

  return {
    valid: true,
    canMerge,
    manifest: data.manifest,
    sourceCounts: data.manifest.recordCounts,
    existingCounts: {
      clients: existingClients.length,
      quotations: existingQuotations.length,
      invoices: existingInvoices.length,
      payments: existingPayments.length,
      projects: existingProjects.length,
    },
    duplicateIds,
    documentNumberCollisions,
    missingRelations,
    warnings,
    recommendation,
  };
}

/**
 * Merges backup data into the existing database idempotently without clearing existing records.
 */
export async function mergeBackupData(
  data: BackupData,
  actorName = 'Admin'
): Promise<{ addedCount: number; updatedCount: number }> {
  const db = await getDatabase();
  const stores = [
    'clients',
    'quotations',
    'quotationRevisions',
    'invoices',
    'payments',
    'projects',
    'auditEvents',
  ];

  let addedCount = 0;
  let updatedCount = 0;

  const tx = db.transaction(stores, 'readwrite');

  // Helper to upsert with count tracking
  const upsert = async (storeName: string, item: { id: string }) => {
    const store = tx.objectStore(storeName);
    const existing = await store.get(item.id);
    if (existing) {
      updatedCount++;
    } else {
      addedCount++;
    }
    await store.put(item);
  };

  for (const c of data.clients || []) await upsert('clients', c);
  for (const q of data.quotations || []) await upsert('quotations', q);
  for (const r of data.quotationRevisions || []) await upsert('quotationRevisions', r);
  for (const i of data.invoices || []) await upsert('invoices', i);
  for (const p of data.payments || []) await upsert('payments', p);
  for (const prj of data.projects || []) await upsert('projects', prj);
  for (const a of data.auditEvents || []) await upsert('auditEvents', a);

  await tx.done;

  await auditRepository.logEvent({
    action: 'BACKUP_RESTORE',
    entityType: 'System',
    entityId: 'backup_merge',
    entityLabel: `Merged backup from ${data.manifest.exportedAt}`,
    actorId: 'admin',
    actorName,
    details: { addedCount, updatedCount },
  });

  return { addedCount, updatedCount };
}

