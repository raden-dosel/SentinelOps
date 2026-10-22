import { describe, it, expect, beforeEach } from 'vitest';
import { openDB } from 'idb';
import 'fake-indexeddb/auto';
import { upgradeDatabaseSchema } from '../src/storage/database';

describe('IndexedDB Migration & Schema Preservation (v1 -> v2)', () => {
  const TEST_DB_NAME = 'test_sentinelops_migration_db';

  beforeEach(() => {
    // Reset fake-indexeddb
    indexedDB = new IDBFactory();
  });

  it('preserves existing v1 data and creates all required v2 sync stores during upgrade', async () => {
    // 1. Initialize as a genuine Version 1 database
    const v1Db = await openDB(TEST_DB_NAME, 1, {
      upgrade(db, oldVersion, newVersion) {
        upgradeDatabaseSchema(db, oldVersion, newVersion);
      },
    });

    // Verify v1 stores exist and v2 stores do NOT exist yet
    expect(v1Db.objectStoreNames.contains('clients')).toBe(true);
    expect(v1Db.objectStoreNames.contains('invoices')).toBe(true);
    expect(v1Db.objectStoreNames.contains('syncOutbox')).toBe(false);
    expect(v1Db.objectStoreNames.contains('syncMetadata')).toBe(false);
    expect(v1Db.objectStoreNames.contains('syncConflicts')).toBe(false);
    expect(v1Db.objectStoreNames.contains('syncConfig')).toBe(false);

    // Seed realistic v1 business data
    const sampleClient = {
      id: 'client-100',
      name: 'San Lorenzo Village Association',
      contactNumber: '0917-555-1234',
      email: 'admin@sanlorenzo.ph',
      address: 'Makati City',
      leadStatus: 'Won',
      leadSource: 'Referral',
      createdAt: '2026-10-15T08:00:00Z',
      updatedAt: '2026-10-15T08:00:00Z',
    };

    const sampleInvoice = {
      id: 'inv-100',
      invoiceNumber: 'INV-2026-001',
      clientId: 'client-100',
      clientName: 'San Lorenzo Village Association',
      clientContact: '0917-555-1234',
      clientAddress: 'Makati City',
      title: 'Gate Motor Installation',
      lineItems: [],
      subtotalCentavos: 5000000,
      taxRatePercent: 12,
      taxCentavos: 600000,
      grandTotalCentavos: 5600000,
      paidAmountCentavos: 2000000,
      remainingBalanceCentavos: 3600000,
      status: 'Partially Paid',
      taxMode: 'EXCLUSIVE',
      issueDate: '2026-10-16',
      dueDate: '2026-10-31',
      createdAt: '2026-10-16T09:00:00Z',
      updatedAt: '2026-10-16T09:00:00Z',
    };

    await v1Db.put('clients', sampleClient);
    await v1Db.put('invoices', sampleInvoice);
    v1Db.close();

    // 2. Open at Version 2 (triggers migration from oldVersion = 1 to 2)
    const v2Db = await openDB(TEST_DB_NAME, 2, {
      upgrade(db, oldVersion, newVersion) {
        upgradeDatabaseSchema(db, oldVersion, newVersion);
      },
    });

    // 3. Verify all v2 sync stores are now present
    expect(v2Db.objectStoreNames.contains('syncOutbox')).toBe(true);
    expect(v2Db.objectStoreNames.contains('syncMetadata')).toBe(true);
    expect(v2Db.objectStoreNames.contains('syncConflicts')).toBe(true);
    expect(v2Db.objectStoreNames.contains('syncConfig')).toBe(true);

    // Verify syncOutbox indexes
    const tx = v2Db.transaction('syncOutbox', 'readonly');
    const outboxStore = tx.objectStore('syncOutbox');
    expect(outboxStore.indexNames.contains('createdAt')).toBe(true);
    expect(outboxStore.indexNames.contains('entityId')).toBe(true);
    expect(outboxStore.indexNames.contains('entityType')).toBe(true);
    await tx.done;

    // 4. CRITICAL: Verify existing v1 records are completely preserved
    const retrievedClient = await v2Db.get('clients', 'client-100');
    expect(retrievedClient).toBeDefined();
    expect(retrievedClient.name).toBe('San Lorenzo Village Association');
    expect(retrievedClient.leadStatus).toBe('Won');

    const retrievedInvoice = await v2Db.get('invoices', 'inv-100');
    expect(retrievedInvoice).toBeDefined();
    expect(retrievedInvoice.invoiceNumber).toBe('INV-2026-001');
    expect(retrievedInvoice.grandTotalCentavos).toBe(5600000);
    expect(retrievedInvoice.remainingBalanceCentavos).toBe(3600000);

    v2Db.close();
  });

  it('correctly initializes all v1 and v2 stores on a brand new fresh installation', async () => {
    const freshDb = await openDB('fresh_v2_db', 2, {
      upgrade(db, oldVersion, newVersion) {
        upgradeDatabaseSchema(db, oldVersion, newVersion);
      },
    });

    const expectedStores = [
      'users',
      'settings',
      'numberSequences',
      'clients',
      'quotations',
      'quotationRevisions',
      'invoices',
      'payments',
      'projects',
      'attachments',
      'auditEvents',
      'syncOutbox',
      'syncMetadata',
      'syncConflicts',
      'syncConfig',
    ];

    for (const store of expectedStores) {
      expect(freshDb.objectStoreNames.contains(store)).toBe(true);
    }

    freshDb.close();
  });

  it('handles repeated initialization idempotently without error', async () => {
    const db1 = await openDB('idempotent_test_db', 2, {
      upgrade(db, oldVersion, newVersion) {
        upgradeDatabaseSchema(db, oldVersion, newVersion);
      },
    });
    db1.close();

    const db2 = await openDB('idempotent_test_db', 2, {
      upgrade(db, oldVersion, newVersion) {
        upgradeDatabaseSchema(db, oldVersion, newVersion);
      },
    });
    expect(db2.version).toBe(2);
    db2.close();
  });

  it('self-heals missing stores when an existing database was opened without sync stores', async () => {
    // Simulate a database where syncOutbox was never created
    const stuckDb = await openDB('sentinelops_db', 2, {
      upgrade(db) {
        // Only created core stores, missed sync stores
        db.createObjectStore('clients', { keyPath: 'id' });
        db.createObjectStore('auditEvents', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'id' });
      },
    });
    expect(stuckDb.objectStoreNames.contains('syncOutbox')).toBe(false);
    stuckDb.close();

    // Now getDatabase() is called by the application
    const healedDb = await (await import('../src/storage/database')).getDatabase();
    expect(healedDb.objectStoreNames.contains('syncOutbox')).toBe(true);
    expect(healedDb.objectStoreNames.contains('clients')).toBe(true);
    expect(healedDb.objectStoreNames.contains('auditEvents')).toBe(true);
    healedDb.close();
  });
});
