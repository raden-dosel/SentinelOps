import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { DEFAULT_SETTINGS, resetDatabaseConnection } from '../src/storage/database';
import { queueBackupForCloudImport } from '../src/services/backupService';
import { BackupData } from '../src/types';

const makeBackup = (overrides: Partial<BackupData> = {}): BackupData => ({
  manifest: {
    appName: 'SentinelOps',
    schemaVersion: 4,
    exportedAt: new Date().toISOString(),
    appVersion: '1.0.0',
    recordCounts: {
      clients: 1,
      quotations: 0,
      quotationRevisions: 0,
      invoices: 0,
      payments: 0,
      projects: 0,
      attachments: 0,
      auditEvents: 0,
    },
  },
  settings: DEFAULT_SETTINGS,
  clients: [{
    id: 'client-import-1',
    name: 'Import Client',
    contactNumber: '09170000000',
    address: 'Pasig City',
    leadSource: 'Referral',
    leadStatus: 'New Inquiry',
    createdAt: '2026-10-22T00:00:00Z',
    updatedAt: '2026-10-22T00:00:00Z',
  }],
  quotations: [],
  quotationRevisions: [],
  invoices: [],
  payments: [],
  projects: [],
  attachmentsMetadata: [],
  auditEvents: [],
  ...overrides,
});

describe('Explicit cloud import queue', () => {
  beforeEach(() => {
    indexedDB = new IDBFactory();
    resetDatabaseConnection();
  });

  it('queues a clean backup without changing business stores', async () => {
    const { report, queuedOperationCount } = await queueBackupForCloudImport(makeBackup());

    expect(report.recommendation).toBe('SAFE_TO_MERGE');
    expect(queuedOperationCount).toBe(2);

    const { getDatabase } = await import('../src/storage/database');
    const db = await getDatabase();
    const client = await db.get('clients', 'client-import-1');
    const operations = await db.getAll('syncOutbox');

    expect(client).toBeUndefined();
    expect(operations.map((operation) => operation.entityType)).toEqual(['Settings', 'Client']);
  });

  it('rejects a backup with missing relationships before queueing anything', async () => {
    const backup = makeBackup({
      manifest: {
        ...makeBackup().manifest,
        recordCounts: { ...makeBackup().manifest.recordCounts, quotations: 1 },
      },
      quotations: [{
        id: 'quotation-import-1',
        quotationNumber: 'Q-2026-001',
        revisionNumber: 0,
        clientId: 'missing-client',
        clientName: 'Missing Client',
        clientContact: '',
        clientAddress: '',
        projectTitle: 'Test Project',
        serviceCategory: 'Other Service',
        scopeOfWork: 'Test',
        termsAndConditions: 'Test',
        issueDate: '2026-10-22',
        expiryDate: '2026-11-22',
        status: 'Draft',
        lineItems: [],
        subtotalCentavos: 0,
        taxRatePercent: 0,
        taxCentavos: 0,
        grandTotalCentavos: 0,
        taxMode: 'NON_VAT',
        createdAt: '2026-10-22T00:00:00Z',
        updatedAt: '2026-10-22T00:00:00Z',
      }],
    });

    await expect(queueBackupForCloudImport(backup)).rejects.toThrow('clean dry-run');

    const { getDatabase } = await import('../src/storage/database');
    const db = await getDatabase();
    expect(await db.count('syncOutbox')).toBe(0);
  });
});
