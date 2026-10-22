/**
 * SentinelOps - IndexedDB Database Initialization & Migration Layer
 * Built on the lightweight 'idb' promise wrapper.
 */

import { openDB, IDBPDatabase } from 'idb';
import { AppSettings, NumberSequence } from '../types';

export const DB_NAME = 'sentinelops_db';
export const DB_VERSION = 4;

export const REQUIRED_STORES = [
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
] as const;

export interface SyncOutboxRecord {
  operationId: string;
  entityType: string;
  entityId: string;
  operation: 'upsert' | 'delete';
  baseRevision: string | null;
  payload: unknown;
  createdAt: string;
  attempts: number;
  lastError?: string;
  status?: 'pending' | 'syncing' | 'failed' | 'conflict';
}

export interface SyncMetadata {
  id: 'cursor';
  cursor: string | null;
  lastSuccessfulSyncAt?: string;
  lastSyncAttemptAt?: string;
  resyncRequired?: boolean;
}

export interface SyncConfig {
  id: 'current_config';
  apiBaseUrl: string;
  deviceId: string;
  deviceToken: string;
  businessId: string;
  businessName: string;
  deviceName: string;
  autoSync: boolean;
  syncIntervalMinutes: number;
  enrolledAt: string;
  lastSyncStatus: 'Not configured' | 'Idle' | 'Syncing' | 'Synced' | 'Error' | 'Conflict' | 'ResyncRequired';
  lastSyncMessage?: string;
}

export interface SyncConflictRecord {
  operationId: string;
  entityType: string;
  entityId: string;
  operation: 'upsert' | 'delete';
  localPayload: unknown;
  serverRevision?: string;
  serverPayload?: unknown;
  message?: string;
  occurredAt: string;
  resolved: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'current_settings',
  businessName: 'Sentinel Security & Automation Solutions',
  tradingName: 'SentinelOps PH',
  tagline: 'Perimeter Security, Electric Fence & Automated Gate Systems',
  tinNumber: '123-456-789-000',
  contactNumber: '+63 917 555 8921',
  email: 'operations@sentinelops.local',
  website: 'https://sentinelops.local',
  address: 'Unit 402, Security Tower, C-5 Road, Brgy. Ugong',
  city: 'Pasig City',
  region: 'Metro Manila',
  postalCode: '1604',
  currency: 'PHP',
  currencySymbol: '₱',
  taxMode: 'EXCLUSIVE',
  taxRatePercent: 12,
  defaultQuotationValidityDays: 30,
  defaultPaymentTerms: '50% Mobilization Downpayment upon approval, 40% Progress billing upon delivery and installation of materials, 10% Final retention upon turnover and testing.',
  defaultWarrantyTerms: 'One (1) year full manufacturer warranty on energizers and gate automation motors. Six (6) months on workmanship and installation wiring.',
  defaultQuotationNotes: 'Site power supply (220V AC outlet) to energizer/motor controller location to be provided by client. Civil works not specified in the scope are excluded.',
  quotationPrefix: 'Q-',
  invoicePrefix: 'INV-',
  paymentPrefix: 'PAY-',
  projectPrefix: 'PRJ-',
  autoLockMinutes: 15,
  theme: 'dark',
  updatedAt: new Date().toISOString(),
};

/**
 * Versioned schema upgrader supporting upgrades from any previous version
 */
export function upgradeDatabaseSchema(
  db: IDBPDatabase,
  oldVersion: number,
  newVersion: number | null
): void {
  // Version 1: Core domain stores (Phase 1 MVP)
  if (newVersion === null || newVersion >= 1) {
    if (!db.objectStoreNames.contains('users')) {
      const userStore = db.createObjectStore('users', { keyPath: 'id' });
      userStore.createIndex('username', 'username', { unique: true });
    }

    if (!db.objectStoreNames.contains('settings')) {
      db.createObjectStore('settings', { keyPath: 'id' });
    }

    if (!db.objectStoreNames.contains('numberSequences')) {
      db.createObjectStore('numberSequences', { keyPath: 'prefix' });
    }

    if (!db.objectStoreNames.contains('clients')) {
      const clientStore = db.createObjectStore('clients', { keyPath: 'id' });
      clientStore.createIndex('name', 'name', { unique: false });
      clientStore.createIndex('leadStatus', 'leadStatus', { unique: false });
      clientStore.createIndex('leadSource', 'leadSource', { unique: false });
      clientStore.createIndex('updatedAt', 'updatedAt', { unique: false });
    }

    if (!db.objectStoreNames.contains('quotations')) {
      const quotationStore = db.createObjectStore('quotations', { keyPath: 'id' });
      quotationStore.createIndex('quotationNumber', 'quotationNumber', { unique: true });
      quotationStore.createIndex('clientId', 'clientId', { unique: false });
      quotationStore.createIndex('status', 'status', { unique: false });
      quotationStore.createIndex('updatedAt', 'updatedAt', { unique: false });
    }

    if (!db.objectStoreNames.contains('quotationRevisions')) {
      const revStore = db.createObjectStore('quotationRevisions', { keyPath: 'id' });
      revStore.createIndex('quotationId', 'quotationId', { unique: false });
    }

    if (!db.objectStoreNames.contains('invoices')) {
      const invStore = db.createObjectStore('invoices', { keyPath: 'id' });
      invStore.createIndex('invoiceNumber', 'invoiceNumber', { unique: true });
      invStore.createIndex('clientId', 'clientId', { unique: false });
      invStore.createIndex('quotationId', 'quotationId', { unique: false });
      invStore.createIndex('projectId', 'projectId', { unique: false });
      invStore.createIndex('status', 'status', { unique: false });
      invStore.createIndex('dueDate', 'dueDate', { unique: false });
      invStore.createIndex('updatedAt', 'updatedAt', { unique: false });
    }

    if (!db.objectStoreNames.contains('payments')) {
      const payStore = db.createObjectStore('payments', { keyPath: 'id' });
      payStore.createIndex('paymentNumber', 'paymentNumber', { unique: true });
      payStore.createIndex('invoiceId', 'invoiceId', { unique: false });
      payStore.createIndex('clientId', 'clientId', { unique: false });
      payStore.createIndex('paymentDate', 'paymentDate', { unique: false });
    }

    if (!db.objectStoreNames.contains('projects')) {
      const prjStore = db.createObjectStore('projects', { keyPath: 'id' });
      prjStore.createIndex('projectNumber', 'projectNumber', { unique: true });
      prjStore.createIndex('clientId', 'clientId', { unique: false });
      prjStore.createIndex('status', 'status', { unique: false });
      prjStore.createIndex('updatedAt', 'updatedAt', { unique: false });
    }

    if (!db.objectStoreNames.contains('attachments')) {
      const attStore = db.createObjectStore('attachments', { keyPath: 'id' });
      attStore.createIndex('entityType', 'entityType', { unique: false });
      attStore.createIndex('entityId', 'entityId', { unique: false });
    }

    if (!db.objectStoreNames.contains('auditEvents')) {
      const auditStore = db.createObjectStore('auditEvents', { keyPath: 'id' });
      auditStore.createIndex('timestamp', 'timestamp', { unique: false });
      auditStore.createIndex('action', 'action', { unique: false });
      auditStore.createIndex('entityType', 'entityType', { unique: false });
      auditStore.createIndex('entityId', 'entityId', { unique: false });
    }
  }

  // Version 2 & 3: Synchronization subsystem stores (Phase 2 & Upgrades)
  if (newVersion === null || newVersion >= 2) {
    if (!db.objectStoreNames.contains('syncOutbox')) {
      const outbox = db.createObjectStore('syncOutbox', { keyPath: 'operationId' });
      outbox.createIndex('createdAt', 'createdAt', { unique: false });
      outbox.createIndex('entityId', 'entityId', { unique: false });
      outbox.createIndex('entityType', 'entityType', { unique: false });
    }

    if (!db.objectStoreNames.contains('syncMetadata')) {
      db.createObjectStore('syncMetadata', { keyPath: 'id' });
    }

    if (!db.objectStoreNames.contains('syncConflicts')) {
      const conflicts = db.createObjectStore('syncConflicts', { keyPath: 'operationId' });
      conflicts.createIndex('entityId', 'entityId', { unique: false });
      conflicts.createIndex('entityType', 'entityType', { unique: false });
    }

    if (!db.objectStoreNames.contains('syncConfig')) {
      db.createObjectStore('syncConfig', { keyPath: 'id' });
    }
  }
}

let activeDbPromise: Promise<IDBPDatabase> | null = null;

export function resetDatabaseConnection(): void {
  activeDbPromise = null;
}

export function getDatabase(): Promise<IDBPDatabase> {
  if (!activeDbPromise) {
    activeDbPromise = (async () => {
      const openDbWithVersion = async (version: number): Promise<IDBPDatabase> => {
        return openDB(DB_NAME, version, {
          upgrade(db, oldVersion, newVersion) {
            upgradeDatabaseSchema(db, oldVersion, newVersion);
          },
          blocked() {
            console.warn('[IndexedDB] Database upgrade blocked by another connection.');
          },
          blocking(_currentVersion, _blockedVersion, event) {
            console.warn('[IndexedDB] Database upgrade pending; closing connection.');
            activeDbPromise = null;
            (event.target as IDBDatabase)?.close();
          },
          terminated() {
            activeDbPromise = null;
          },
        });
      };

      let db = await openDbWithVersion(DB_VERSION);

      // Self-healing check: verify all required stores actually exist
      const missingStores = REQUIRED_STORES.filter((s) => !db.objectStoreNames.contains(s));
      if (missingStores.length > 0) {
        console.warn(`[IndexedDB] Detected missing store(s): ${missingStores.join(', ')}. Triggering auto-upgrade...`);
        const nextVersion = Math.max(db.version + 1, DB_VERSION + 1);
        db.close();
        db = await openDbWithVersion(nextVersion);
      }

      db.addEventListener('close', () => {
        activeDbPromise = null;
      });

      return db;
    })().catch((err) => {
      activeDbPromise = null;
      throw err;
    });
  }

  return activeDbPromise;
}

/**
 * Atomic number allocation for documents within a database transaction.
 * Generates collision-free IDs like Q-2026-001, INV-2026-001, etc.
 */
export async function getNextDocumentNumber(prefixKey: string): Promise<string> {
  const currentYear = new Date().getFullYear();
  const sequencePrefix = `${prefixKey}${currentYear}-`;

  const db = await getDatabase();
  const tx = db.transaction('numberSequences', 'readwrite');
  const store = tx.objectStore('numberSequences');

  const existing = (await store.get(sequencePrefix)) as NumberSequence | undefined;
  const nextSeq = existing ? existing.lastNumber + 1 : 1;

  await store.put({
    prefix: sequencePrefix,
    lastNumber: nextSeq,
  });

  await tx.done;

  return `${sequencePrefix}${nextSeq.toString().padStart(3, '0')}`;
}

/**
 * Wipe all data (for testing or user-requested hard reset)
 */
export async function clearAllDatabaseData(): Promise<void> {
  const db = await getDatabase();
  const stores = [
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
  const availableStores = stores.filter((s) => db.objectStoreNames.contains(s));
  if (availableStores.length > 0) {
    const tx = db.transaction(availableStores, 'readwrite');
    for (const storeName of availableStores) {
      await tx.objectStore(storeName).clear();
    }
    await tx.done;
  }
}
