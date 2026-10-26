/**
 * SentinelOps - Repository Layer for IndexedDB Entities
 * Encapsulates data access, transactional updates, durable outbox queuing, and integrity rules.
 */

import { openDB, IDBPDatabase } from 'idb';
import { getDatabase, DEFAULT_SETTINGS, SyncOutboxRecord, SyncConfig, SyncConflictRecord, SyncMetadata } from './database';
import {
  LocalUser,
  AppSettings,
  AuditEvent,
  Client,
  Quotation,
  QuotationRevision,
  Invoice,
  Payment,
  Project,
  ProjectProgressNote,
  AttachmentRecord,
  AttachmentMetadata,
  ID,
} from '../types';
import { generateUUID } from '../services/security';
import { calculateTotals, isInvoiceOverdue } from '../domain/calculations';
import { requestSync } from '../services/syncEvents';

/**
 * Creates a transaction using only object stores that actually exist in the database instance.
 * Completely eliminates "One of the specified object stores was not found" DOMExceptions
 * during database upgrades or schema transitions.
 */
export function safeTransaction(
  db: IDBPDatabase,
  storeNames: string[],
  mode: IDBTransactionMode = 'readwrite'
) {
  const available = storeNames.filter((s) => db.objectStoreNames.contains(s));
  if (available.length === 0) {
    throw new Error(`Failed to create transaction: none of requested stores [${storeNames.join(', ')}] exist in database.`);
  }
  const tx = (db as any).transaction(available, mode);
  return tx as {
    objectStore: (name: string) => any;
    objectStoreNames: DOMStringList;
    done: Promise<void>;
  };
}

/**
 * Enqueue an outbox record inside an active readwrite transaction.
 * If the transaction aborts, the outbox record is rolled back with the entity change.
 * If syncOutbox is not available, safely no-ops without breaking local mutations.
 */
function enqueueOutboxRecord(
  txOrStore: any,
  entityType: string,
  entityId: string,
  operation: 'upsert' | 'delete',
  payload: unknown,
  baseRevision: string | null = null
): SyncOutboxRecord | null {
  if (!txOrStore) return null;
  let outboxStore: any;
  if (txOrStore.objectStore) {
    if (!txOrStore.objectStoreNames?.contains('syncOutbox')) {
      return null;
    }
    outboxStore = txOrStore.objectStore('syncOutbox');
  } else {
    outboxStore = txOrStore;
  }
  if (!outboxStore || typeof outboxStore.put !== 'function') return null;

  const record: SyncOutboxRecord = {
    operationId: generateUUID(),
    entityType,
    entityId,
    operation,
    baseRevision,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
  };
  outboxStore.put(record);
  return record;
}

// ======================== USERS & AUTH ========================
// NOTE: Local users and authentication hashes are intentionally local-only
// and are never placed in the sync outbox.
export const userRepository = {
  async hasAnyUser(): Promise<boolean> {
    const db = await getDatabase();
    const count = await db.count('users');
    return count > 0;
  },

  async getFirstUser(): Promise<LocalUser | null> {
    const db = await getDatabase();
    const users = await db.getAll('users');
    return users.length > 0 ? (users[0] as LocalUser) : null;
  },

  async getUserByUsername(username: string): Promise<LocalUser | null> {
    const db = await getDatabase();
    const user = await db.getFromIndex('users', 'username', username);
    return (user as LocalUser) || null;
  },

  async saveUser(user: LocalUser): Promise<void> {
    const db = await getDatabase();
    await db.put('users', user);
  },
};

// ======================== APP SETTINGS ========================
export const settingsRepository = {
  async getSettings(): Promise<AppSettings> {
    try {
      const db = await getDatabase();
      if (!db.objectStoreNames.contains('settings')) {
        return DEFAULT_SETTINGS;
      }
      const settings = (await db.get('settings', 'current_settings')) as AppSettings | undefined;
      if (!settings) {
        try {
          await db.put('settings', DEFAULT_SETTINGS);
        } catch {
          // Non-fatal if initial write fails
        }
        return DEFAULT_SETTINGS;
      }
      return settings;
    } catch (err) {
      console.warn('Failed to retrieve settings from IndexedDB, using defaults:', err);
      return DEFAULT_SETTINGS;
    }
  },

  async saveSettings(settings: AppSettings, actorName = 'Admin'): Promise<AppSettings> {
    const db = await getDatabase();
    const updated: AppSettings = {
      ...settings,
      id: 'current_settings' as const,
      updatedAt: new Date().toISOString(),
    };

    const tx = safeTransaction(db, ['settings', 'syncOutbox', 'auditEvents'], 'readwrite');
    await tx.objectStore('settings').put(updated);

    // Enqueue synchronized business settings (public business profile only)
    if (tx.objectStoreNames.contains('syncOutbox')) {
      enqueueOutboxRecord(
        tx.objectStore('syncOutbox'),
        'Settings',
        'current_settings',
        'upsert',
        {
          businessName: updated.businessName,
          tradingName: updated.tradingName,
          tagline: updated.tagline,
          tinNumber: updated.tinNumber,
          contactNumber: updated.contactNumber,
          email: updated.email,
          website: updated.website,
          address: updated.address,
          city: updated.city,
          region: updated.region,
          postalCode: updated.postalCode,
          currency: updated.currency,
          currencySymbol: updated.currencySymbol,
          taxMode: updated.taxMode,
          taxRatePercent: updated.taxRatePercent,
          defaultQuotationValidityDays: updated.defaultQuotationValidityDays,
          defaultPaymentTerms: updated.defaultPaymentTerms,
          defaultWarrantyTerms: updated.defaultWarrantyTerms,
          defaultQuotationNotes: updated.defaultQuotationNotes,
          updatedAt: updated.updatedAt,
        }
      );
    }

    const auditEvent: AuditEvent = {
      id: generateUUID(),
      timestamp: new Date().toISOString(),
      action: 'SETTINGS_UPDATE',
      entityType: 'Settings',
      entityId: 'current_settings',
      entityLabel: 'App Settings',
      actorId: 'admin',
      actorName,
      details: { businessName: updated.businessName, taxMode: updated.taxMode },
    };
    if (tx.objectStoreNames.contains('auditEvents')) {
      await tx.objectStore('auditEvents').put(auditEvent);
    }

    await tx.done;
    requestSync();
    return updated;
  },
};

// ======================== AUDIT TRAIL ========================
export const auditRepository = {
  async logEvent(params: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<AuditEvent> {
    const db = await getDatabase();
    const event: AuditEvent = {
      ...params,
      id: generateUUID(),
      timestamp: new Date().toISOString(),
    };
    if (db.objectStoreNames.contains('auditEvents')) {
      await db.put('auditEvents', event);
    }
    return event;
  },

  async getAll(): Promise<AuditEvent[]> {
    const db = await getDatabase();
    if (!db.objectStoreNames.contains('auditEvents')) return [];
    const events = (await db.getAll('auditEvents')) as AuditEvent[];
    return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  },
};

// ======================== CLIENTS (CRM) ========================
export const clientRepository = {
  async getAll(): Promise<Client[]> {
    const db = await getDatabase();
    if (!db.objectStoreNames.contains('clients')) return [];
    const clients = (await db.getAll('clients')) as Client[];
    return clients.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async getById(id: ID): Promise<Client | null> {
    const db = await getDatabase();
    if (!db.objectStoreNames.contains('clients')) return null;
    const client = await db.get('clients', id);
    return (client as Client) || null;
  },

  async save(
    client: Omit<Client, 'id' | 'createdAt' | 'updatedAt'> & { id?: ID },
    actorName = 'Admin'
  ): Promise<Client> {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const isNew = !client.id;

    const existing = client.id && db.objectStoreNames.contains('clients')
      ? ((await db.get('clients', client.id)) as Client | undefined)
      : undefined;
    const fullClient: Client = {
      ...client,
      id: client.id || generateUUID(),
      createdAt: isNew ? now : existing?.createdAt || now,
      updatedAt: now,
    };

    const tx = safeTransaction(db, ['clients', 'syncOutbox', 'auditEvents'], 'readwrite');
    await tx.objectStore('clients').put(fullClient);

    // Atomic Outbox Enqueue
    if (tx.objectStoreNames.contains('syncOutbox')) {
      enqueueOutboxRecord(
        tx.objectStore('syncOutbox'),
        'Client',
        fullClient.id,
        'upsert',
        fullClient
      );
    }

    const auditEvent: AuditEvent = {
      id: generateUUID(),
      timestamp: now,
      action: isNew ? 'CLIENT_CREATE' : 'CLIENT_UPDATE',
      entityType: 'Client',
      entityId: fullClient.id,
      entityLabel: fullClient.name,
      actorId: 'admin',
      actorName,
      details: { leadStatus: fullClient.leadStatus, leadSource: fullClient.leadSource },
    };
    if (tx.objectStoreNames.contains('auditEvents')) {
      await tx.objectStore('auditEvents').put(auditEvent);
    }

    await tx.done;
    requestSync();
    return fullClient;
  },

  async canDelete(id: ID): Promise<{ canDelete: boolean; reason?: string }> {
    const db = await getDatabase();
    if (db.objectStoreNames.contains('quotations')) {
      const quotations = await db.getAllFromIndex('quotations', 'clientId', id);
      if (quotations.length > 0) {
        return {
          canDelete: false,
          reason: `Cannot delete client with ${quotations.length} linked quotation(s). Mark status as Lost instead to preserve historical records.`,
        };
      }
    }
    if (db.objectStoreNames.contains('invoices')) {
      const invoices = await db.getAllFromIndex('invoices', 'clientId', id);
      if (invoices.length > 0) {
        return {
          canDelete: false,
          reason: `Cannot delete client with ${invoices.length} linked invoice(s). Financial records must be preserved.`,
        };
      }
    }
    if (db.objectStoreNames.contains('projects')) {
      const projects = await db.getAllFromIndex('projects', 'clientId', id);
      if (projects.length > 0) {
        return {
          canDelete: false,
          reason: `Cannot delete client with ${projects.length} linked project(s).`,
        };
      }
    }
    return { canDelete: true };
  },

  async delete(id: ID, actorName = 'Admin'): Promise<boolean> {
    const check = await this.canDelete(id);
    if (!check.canDelete) {
      throw new Error(check.reason);
    }
    const db = await getDatabase();
    const existing = await this.getById(id);
    if (!existing) return false;

    const tx = safeTransaction(db, ['clients', 'syncOutbox', 'auditEvents'], 'readwrite');
    await tx.objectStore('clients').delete(id);

    // Atomic Tombstone Enqueue
    if (tx.objectStoreNames.contains('syncOutbox')) {
      enqueueOutboxRecord(
        tx.objectStore('syncOutbox'),
        'Client',
        id,
        'delete',
        { id, deletedAt: new Date().toISOString() }
      );
    }

    const auditEvent: AuditEvent = {
      id: generateUUID(),
      timestamp: new Date().toISOString(),
      action: 'CLIENT_UPDATE',
      entityType: 'Client',
      entityId: id,
      entityLabel: existing.name,
      actorId: 'admin',
      actorName,
      details: { action: 'deleted' },
    };
    await tx.objectStore('auditEvents').put(auditEvent);

    await tx.done;
    requestSync();
    return true;
  },
};

// ======================== QUOTATIONS ========================
export const quotationRepository = {
  async getAll(): Promise<Quotation[]> {
    const db = await getDatabase();
    const quotations = (await db.getAll('quotations')) as Quotation[];
    return quotations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async getById(id: ID): Promise<Quotation | null> {
    const db = await getDatabase();
    const quotation = await db.get('quotations', id);
    return (quotation as Quotation) || null;
  },

  async getByClientId(clientId: ID): Promise<Quotation[]> {
    const db = await getDatabase();
    const quotations = (await db.getAllFromIndex('quotations', 'clientId', clientId)) as Quotation[];
    return quotations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async save(quotation: Quotation, actorName = 'Admin'): Promise<Quotation> {
    const db = await getDatabase();
    const existing = (await db.get('quotations', quotation.id)) as Quotation | undefined;
    const now = new Date().toISOString();

    const record: Quotation = {
      ...quotation,
      updatedAt: now,
      createdAt: existing ? existing.createdAt : quotation.createdAt || now,
    };

    const isNew = !existing;
    const tx = safeTransaction(db, ['quotations', 'syncOutbox', 'auditEvents'], 'readwrite');
    await tx.objectStore('quotations').put(record);

    // Atomic Outbox Enqueue
    if (tx.objectStoreNames.contains('syncOutbox')) {
      enqueueOutboxRecord(
        tx.objectStore('syncOutbox'),
        'Quotation',
        record.id,
        'upsert',
        record
      );
    }

    const auditEvent: AuditEvent = {
      id: generateUUID(),
      timestamp: now,
      action: isNew ? 'QUOTATION_CREATE' : 'QUOTATION_UPDATE',
      entityType: 'Quotation',
      entityId: record.id,
      entityLabel: `${record.quotationNumber} - ${record.projectTitle}`,
      actorId: 'admin',
      actorName,
      details: {
        status: record.status,
        grandTotalCentavos: record.grandTotalCentavos,
        clientName: record.clientName,
      },
    };
    if (tx.objectStoreNames.contains('auditEvents')) {
      await tx.objectStore('auditEvents').put(auditEvent);
    }

    await tx.done;
    requestSync();
    return record;
  },

  async createRevision(
    quotationId: ID,
    reason: string,
    actorName = 'Admin'
  ): Promise<QuotationRevision> {
    const db = await getDatabase();
    const current = (await db.get('quotations', quotationId)) as Quotation | undefined;
    if (!current) throw new Error('Quotation not found');

    const nextRevNum = current.revisionNumber + 1;
    const revision: QuotationRevision = {
      id: generateUUID(),
      quotationId: current.id,
      revisionNumber: current.revisionNumber,
      snapshot: JSON.parse(JSON.stringify(current)),
      reason,
      createdAt: new Date().toISOString(),
      createdBy: actorName,
    };

    current.revisionNumber = nextRevNum;
    current.updatedAt = new Date().toISOString();

    const tx = safeTransaction(db, ['quotationRevisions', 'quotations', 'syncOutbox', 'auditEvents'], 'readwrite');
    if (tx.objectStoreNames.contains('quotationRevisions')) {
      await tx.objectStore('quotationRevisions').put(revision);
    }
    await tx.objectStore('quotations').put(current);

    // Outbox: QuotationRevision snapshot (append-only)
    if (tx.objectStoreNames.contains('syncOutbox')) {
      enqueueOutboxRecord(
        tx.objectStore('syncOutbox'),
        'QuotationRevision',
        revision.id,
        'upsert',
        revision
      );

      // Outbox: Updated Quotation state
      enqueueOutboxRecord(
        tx.objectStore('syncOutbox'),
        'Quotation',
        current.id,
        'upsert',
        current
      );
    }

    const auditEvent: AuditEvent = {
      id: generateUUID(),
      timestamp: new Date().toISOString(),
      action: 'QUOTATION_REVISE',
      entityType: 'Quotation',
      entityId: current.id,
      entityLabel: `${current.quotationNumber} (Rev ${nextRevNum})`,
      actorId: 'admin',
      actorName,
      details: { revisionNumber: current.revisionNumber, reason },
    };
    if (tx.objectStoreNames.contains('auditEvents')) {
      await tx.objectStore('auditEvents').put(auditEvent);
    }

    await tx.done;
    requestSync();
    return revision;
  },

  async getRevisions(quotationId: ID): Promise<QuotationRevision[]> {
    const db = await getDatabase();
    if (!db.objectStoreNames.contains('quotationRevisions')) return [];
    const revs = (await db.getAllFromIndex('quotationRevisions', 'quotationId', quotationId)) as QuotationRevision[];
    return revs.sort((a, b) => b.revisionNumber - a.revisionNumber);
  },

  async delete(id: ID, actorName = 'Admin'): Promise<boolean> {
    const db = await getDatabase();
    const quotation = (await db.get('quotations', id)) as Quotation | undefined;
    if (!quotation) return false;

    if (quotation.convertedToInvoiceId) {
      throw new Error('Cannot delete quotation that has already been converted to an invoice.');
    }

    const tx = safeTransaction(db, ['quotations', 'syncOutbox', 'auditEvents'], 'readwrite');
    await tx.objectStore('quotations').delete(id);

    // Outbox tombstone
    if (tx.objectStoreNames.contains('syncOutbox')) {
      enqueueOutboxRecord(
        tx.objectStore('syncOutbox'),
        'Quotation',
        id,
        'delete',
        { id, quotationNumber: quotation.quotationNumber, deletedAt: new Date().toISOString() }
      );
    }

    const auditEvent: AuditEvent = {
      id: generateUUID(),
      timestamp: new Date().toISOString(),
      action: 'QUOTATION_UPDATE',
      entityType: 'Quotation',
      entityId: id,
      entityLabel: `${quotation.quotationNumber} (Deleted)`,
      actorId: 'admin',
      actorName,
      details: { deleted: true },
    };
    if (tx.objectStoreNames.contains('auditEvents')) {
      await tx.objectStore('auditEvents').put(auditEvent);
    }

    await tx.done;
    requestSync();
    return true;
  },
};

// ======================== INVOICES ========================
export const invoiceRepository = {
  async getAll(): Promise<Invoice[]> {
    const db = await getDatabase();
    if (!db.objectStoreNames.contains('invoices')) return [];
    const invoices = (await db.getAll('invoices')) as Invoice[];
    const today = new Date().toISOString().split('T')[0];
    return invoices
      .map((inv) => {
        if (isInvoiceOverdue(inv.status, inv.dueDate, inv.remainingBalanceCentavos, today)) {
          return { ...inv, status: 'Overdue' as const };
        }
        return inv;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async getById(id: ID): Promise<Invoice | null> {
    const db = await getDatabase();
    if (!db.objectStoreNames.contains('invoices')) return null;
    const inv = (await db.get('invoices', id)) as Invoice | undefined;
    if (!inv) return null;
    const today = new Date().toISOString().split('T')[0];
    if (isInvoiceOverdue(inv.status, inv.dueDate, inv.remainingBalanceCentavos, today)) {
      return { ...inv, status: 'Overdue' as const };
    }
    return inv;
  },

  async getByClientId(clientId: ID): Promise<Invoice[]> {
    const db = await getDatabase();
    if (!db.objectStoreNames.contains('invoices')) return [];
    const invoices = (await db.getAllFromIndex('invoices', 'clientId', clientId)) as Invoice[];
    return invoices.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async getByProjectId(projectId: ID): Promise<Invoice[]> {
    const db = await getDatabase();
    if (!db.objectStoreNames.contains('invoices')) return [];
    const invoices = (await db.getAllFromIndex('invoices', 'projectId', projectId)) as Invoice[];
    return invoices.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async save(invoice: Invoice, actorName = 'Admin'): Promise<Invoice> {
    const db = await getDatabase();
    const existing = (await db.get('invoices', invoice.id)) as Invoice | undefined;
    const now = new Date().toISOString();

    const record: Invoice = {
      ...invoice,
      updatedAt: now,
      createdAt: existing ? existing.createdAt : invoice.createdAt || now,
    };

    const isNew = !existing;
    const tx = safeTransaction(db, ['invoices', 'syncOutbox', 'auditEvents'], 'readwrite');
    await tx.objectStore('invoices').put(record);

    // Atomic Outbox Enqueue
    if (tx.objectStoreNames.contains('syncOutbox')) {
      enqueueOutboxRecord(
        tx.objectStore('syncOutbox'),
        'Invoice',
        record.id,
        'upsert',
        record
      );
    }

    const auditEvent: AuditEvent = {
      id: generateUUID(),
      timestamp: now,
      action: isNew ? 'INVOICE_CREATE' : 'INVOICE_ISSUE',
      entityType: 'Invoice',
      entityId: record.id,
      entityLabel: `${record.invoiceNumber} - ${record.title}`,
      actorId: 'admin',
      actorName,
      details: {
        status: record.status,
        grandTotalCentavos: record.grandTotalCentavos,
        remainingBalanceCentavos: record.remainingBalanceCentavos,
      },
    };
    if (tx.objectStoreNames.contains('auditEvents')) {
      await tx.objectStore('auditEvents').put(auditEvent);
    }

    await tx.done;
    requestSync();
    return record;
  },

  async voidInvoice(id: ID, reason: string, actorName = 'Admin'): Promise<Invoice> {
    const db = await getDatabase();
    const inv = (await db.get('invoices', id)) as Invoice | undefined;
    if (!inv) throw new Error('Invoice not found');
    if (inv.paidAmountCentavos > 0) {
      throw new Error('Cannot void an invoice with applied payments. Payments must be reversed first.');
    }

    inv.status = 'Void';
    inv.notes = (inv.notes ? inv.notes + '\n' : '') + `[VOIDED by ${actorName}: ${reason}]`;
    inv.updatedAt = new Date().toISOString();

    const tx = safeTransaction(db, ['invoices', 'syncOutbox', 'auditEvents'], 'readwrite');
    await tx.objectStore('invoices').put(inv);

    // Outbox: voided invoice update
    if (tx.objectStoreNames.contains('syncOutbox')) {
      enqueueOutboxRecord(
        tx.objectStore('syncOutbox'),
        'Invoice',
        inv.id,
        'upsert',
        inv
      );
    }

    const auditEvent: AuditEvent = {
      id: generateUUID(),
      timestamp: new Date().toISOString(),
      action: 'INVOICE_VOID',
      entityType: 'Invoice',
      entityId: inv.id,
      entityLabel: inv.invoiceNumber,
      actorId: 'admin',
      actorName,
      details: { reason },
    };
    if (tx.objectStoreNames.contains('auditEvents')) {
      await tx.objectStore('auditEvents').put(auditEvent);
    }

    await tx.done;
    requestSync();
    return inv;
  },
};

// ======================== PAYMENTS ========================
export const paymentRepository = {
  async getAll(): Promise<Payment[]> {
    const db = await getDatabase();
    const payments = (await db.getAll('payments')) as Payment[];
    return payments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async getById(id: ID): Promise<Payment | null> {
    const db = await getDatabase();
    const p = await db.get('payments', id);
    return (p as Payment) || null;
  },

  async getByInvoiceId(invoiceId: ID): Promise<Payment[]> {
    const db = await getDatabase();
    const payments = (await db.getAllFromIndex('payments', 'invoiceId', invoiceId)) as Payment[];
    return payments.sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));
  },

  async recordPayment(
    payment: Omit<Payment, 'id' | 'createdAt' | 'isReversed' | 'remainingBalanceAfterPaymentCentavos'>,
    actorName = 'Admin'
  ): Promise<Payment> {
    if (payment.amountCentavos <= 0) {
      throw new Error('Payment amount must be greater than zero.');
    }

    const db = await getDatabase();
    const tx = safeTransaction(db, ['invoices', 'payments', 'projects', 'syncOutbox', 'auditEvents'], 'readwrite');
    const invoiceStore = tx.objectStore('invoices');
    const paymentStore = tx.objectStore('payments');

    const invoice = (await invoiceStore.get(payment.invoiceId)) as Invoice | undefined;
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.status === 'Void') throw new Error('Cannot apply payment to a voided invoice.');

    if (payment.amountCentavos > invoice.remainingBalanceCentavos) {
      throw new Error(
        `Payment amount (₱${(payment.amountCentavos / 100).toFixed(2)}) exceeds remaining invoice balance (₱${(invoice.remainingBalanceCentavos / 100).toFixed(2)}).`
      );
    }

    const newPaidAmount = invoice.paidAmountCentavos + payment.amountCentavos;
    const newRemaining = Math.max(0, invoice.grandTotalCentavos - newPaidAmount);

    invoice.paidAmountCentavos = newPaidAmount;
    invoice.remainingBalanceCentavos = newRemaining;
    invoice.status = newRemaining === 0 ? 'Paid' : 'Partially Paid';
    invoice.updatedAt = new Date().toISOString();
    await invoiceStore.put(invoice);

    const paymentRecord: Payment = {
      ...payment,
      id: generateUUID(),
      remainingBalanceAfterPaymentCentavos: newRemaining,
      isReversed: false,
      createdAt: new Date().toISOString(),
    };
    await paymentStore.put(paymentRecord);

    // Update project totalPaid if linked
    if (invoice.projectId && tx.objectStoreNames.contains('projects')) {
      const projectStore = tx.objectStore('projects');
      const project = (await projectStore.get(invoice.projectId)) as Project | undefined;
      if (project) {
        project.totalPaidCentavos = (project.totalPaidCentavos || 0) + payment.amountCentavos;
        project.updatedAt = new Date().toISOString();
        await projectStore.put(project);
        if (tx.objectStoreNames.contains('syncOutbox')) {
          enqueueOutboxRecord(tx.objectStore('syncOutbox'), 'Project', project.id, 'upsert', project);
        }
      }
    }

    // Atomic Outbox Enqueue: Payment (financial event) + Invoice updated state
    if (tx.objectStoreNames.contains('syncOutbox')) {
      enqueueOutboxRecord(tx.objectStore('syncOutbox'), 'Payment', paymentRecord.id, 'upsert', paymentRecord);
      enqueueOutboxRecord(tx.objectStore('syncOutbox'), 'Invoice', invoice.id, 'upsert', invoice);
    }

    const auditEvent: AuditEvent = {
      id: generateUUID(),
      timestamp: new Date().toISOString(),
      action: 'PAYMENT_RECORD',
      entityType: 'Payment',
      entityId: paymentRecord.id,
      entityLabel: `${paymentRecord.paymentNumber} for ${invoice.invoiceNumber}`,
      actorId: 'admin',
      actorName,
      details: {
        amountCentavos: paymentRecord.amountCentavos,
        paymentMethod: paymentRecord.paymentMethod,
        remainingBalanceCentavos: newRemaining,
      },
    };
    if (tx.objectStoreNames.contains('auditEvents')) {
      await tx.objectStore('auditEvents').put(auditEvent);
    }

    await tx.done;
    requestSync();
    return paymentRecord;
  },

  async reversePayment(paymentId: ID, reason: string, actorName = 'Admin'): Promise<Payment> {
    const db = await getDatabase();
    const tx = safeTransaction(db, ['invoices', 'payments', 'projects', 'syncOutbox', 'auditEvents'], 'readwrite');
    const paymentStore = tx.objectStore('payments');
    const invoiceStore = tx.objectStore('invoices');

    const payment = (await paymentStore.get(paymentId)) as Payment | undefined;
    if (!payment) throw new Error('Payment not found');
    if (payment.isReversed) throw new Error('Payment is already reversed.');

    const invoice = (await invoiceStore.get(payment.invoiceId)) as Invoice | undefined;
    if (!invoice) throw new Error('Linked invoice not found');

    const restoredPaidAmount = Math.max(0, invoice.paidAmountCentavos - payment.amountCentavos);
    const restoredRemaining = invoice.grandTotalCentavos - restoredPaidAmount;

    invoice.paidAmountCentavos = restoredPaidAmount;
    invoice.remainingBalanceCentavos = restoredRemaining;
    invoice.status = restoredPaidAmount === 0 ? 'Issued' : 'Partially Paid';
    invoice.updatedAt = new Date().toISOString();
    await invoiceStore.put(invoice);

    payment.isReversed = true;
    payment.reversalReason = reason;
    await paymentStore.put(payment);

    if (invoice.projectId && tx.objectStoreNames.contains('projects')) {
      const projectStore = tx.objectStore('projects');
      const project = (await projectStore.get(invoice.projectId)) as Project | undefined;
      if (project) {
        project.totalPaidCentavos = Math.max(0, (project.totalPaidCentavos || 0) - payment.amountCentavos);
        project.updatedAt = new Date().toISOString();
        await projectStore.put(project);
        if (tx.objectStoreNames.contains('syncOutbox')) {
          enqueueOutboxRecord(tx.objectStore('syncOutbox'), 'Project', project.id, 'upsert', project);
        }
      }
    }

    // Atomic Outbox Enqueue: Payment reversal + Invoice restored state
    if (tx.objectStoreNames.contains('syncOutbox')) {
      enqueueOutboxRecord(tx.objectStore('syncOutbox'), 'Payment', payment.id, 'upsert', payment);
      enqueueOutboxRecord(tx.objectStore('syncOutbox'), 'Invoice', invoice.id, 'upsert', invoice);
    }

    const auditEvent: AuditEvent = {
      id: generateUUID(),
      timestamp: new Date().toISOString(),
      action: 'PAYMENT_REVERSE',
      entityType: 'Payment',
      entityId: payment.id,
      entityLabel: `Reversal of ${payment.paymentNumber}`,
      actorId: 'admin',
      actorName,
      details: { reason, amountCentavos: payment.amountCentavos },
    };
    if (tx.objectStoreNames.contains('auditEvents')) {
      await tx.objectStore('auditEvents').put(auditEvent);
    }

    await tx.done;
    requestSync();
    return payment;
  },
};

// ======================== PROJECTS ========================
export const projectRepository = {
  async getAll(): Promise<Project[]> {
    const db = await getDatabase();
    if (!db.objectStoreNames.contains('projects')) return [];
    const projects = (await db.getAll('projects')) as Project[];
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async getById(id: ID): Promise<Project | null> {
    const db = await getDatabase();
    if (!db.objectStoreNames.contains('projects')) return null;
    const p = await db.get('projects', id);
    return (p as Project) || null;
  },

  async getByClientId(clientId: ID): Promise<Project[]> {
    const db = await getDatabase();
    if (!db.objectStoreNames.contains('projects')) return [];
    const projects = (await db.getAllFromIndex('projects', 'clientId', clientId)) as Project[];
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async save(project: Project, actorName = 'Admin'): Promise<Project> {
    const db = await getDatabase();
    const existing = (await db.get('projects', project.id)) as Project | undefined;
    const now = new Date().toISOString();

    const record: Project = {
      ...project,
      updatedAt: now,
      createdAt: existing ? existing.createdAt : project.createdAt || now,
    };

    const isNew = !existing;
    const tx = safeTransaction(db, ['projects', 'syncOutbox', 'auditEvents'], 'readwrite');
    await tx.objectStore('projects').put(record);

    // Atomic Outbox Enqueue
    if (tx.objectStoreNames.contains('syncOutbox')) {
      enqueueOutboxRecord(
        tx.objectStore('syncOutbox'),
        'Project',
        record.id,
        'upsert',
        record
      );
    }

    const auditEvent: AuditEvent = {
      id: generateUUID(),
      timestamp: now,
      action: isNew ? 'PROJECT_CREATE' : 'PROJECT_UPDATE',
      entityType: 'Project',
      entityId: record.id,
      entityLabel: `${record.projectNumber} - ${record.name}`,
      actorId: 'admin',
      actorName,
      details: { status: record.status, clientName: record.clientName },
    };
    if (tx.objectStoreNames.contains('auditEvents')) {
      await tx.objectStore('auditEvents').put(auditEvent);
    }

    await tx.done;
    requestSync();
    return record;
  },

  async addProgressNote(
    projectId: ID,
    text: string,
    author: string,
    statusChange?: Project['status']
  ): Promise<Project> {
    const db = await getDatabase();
    const project = (await db.get('projects', projectId)) as Project | undefined;
    if (!project) throw new Error('Project not found');

    const note: ProjectProgressNote = {
      id: generateUUID(),
      timestamp: new Date().toISOString(),
      author,
      text,
      statusChange,
    };

    project.progressNotes = [...(project.progressNotes || []), note];
    if (statusChange) {
      project.status = statusChange;
      if (statusChange === 'Completed' && !project.actualCompletionDate) {
        project.actualCompletionDate = new Date().toISOString().split('T')[0];
      }
    }
    project.updatedAt = new Date().toISOString();

    const tx = safeTransaction(db, ['projects', 'syncOutbox', 'auditEvents'], 'readwrite');
    await tx.objectStore('projects').put(project);

    // Outbox: Updated project with progress note
    if (tx.objectStoreNames.contains('syncOutbox')) {
      enqueueOutboxRecord(
        tx.objectStore('syncOutbox'),
        'Project',
        project.id,
        'upsert',
        project
      );
    }

    const auditEvent: AuditEvent = {
      id: generateUUID(),
      timestamp: new Date().toISOString(),
      action: statusChange ? 'PROJECT_STATUS_CHANGE' : 'PROJECT_UPDATE',
      entityType: 'Project',
      entityId: project.id,
      entityLabel: `${project.projectNumber} Progress Update`,
      actorId: 'admin',
      actorName: author,
      details: { text, statusChange },
    };
    if (tx.objectStoreNames.contains('auditEvents')) {
      await tx.objectStore('auditEvents').put(auditEvent);
    }

    await tx.done;
    requestSync();
    return project;
  },

  async delete(id: ID, actorName = 'Admin'): Promise<boolean> {
    const db = await getDatabase();
    const project = (await db.get('projects', id)) as Project | undefined;
    if (!project) return false;

    if (db.objectStoreNames.contains('invoices')) {
      const invoices = (await db.getAllFromIndex('invoices', 'projectId', id)) as Invoice[];
      if (invoices.length > 0) {
        throw new Error(`Cannot delete project with ${invoices.length} linked invoice(s). Close the project instead to preserve history.`);
      }
    }

    const tx = safeTransaction(db, ['projects', 'syncOutbox', 'auditEvents'], 'readwrite');
    await tx.objectStore('projects').delete(id);

    // Outbox tombstone
    if (tx.objectStoreNames.contains('syncOutbox')) {
      enqueueOutboxRecord(
        tx.objectStore('syncOutbox'),
        'Project',
        id,
        'delete',
        { id, projectNumber: project.projectNumber, deletedAt: new Date().toISOString() }
      );
    }

    const auditEvent: AuditEvent = {
      id: generateUUID(),
      timestamp: new Date().toISOString(),
      action: 'PROJECT_UPDATE',
      entityType: 'Project',
      entityId: id,
      entityLabel: `${project.projectNumber} (Deleted)`,
      actorId: 'admin',
      actorName,
      details: { deleted: true },
    };
    if (tx.objectStoreNames.contains('auditEvents')) {
      await tx.objectStore('auditEvents').put(auditEvent);
    }

    await tx.done;
    requestSync();
    return true;
  },
};

// ======================== ATTACHMENTS ========================
export const attachmentRepository = {
  async getByEntity(entityType: AttachmentMetadata['entityType'], entityId: ID): Promise<AttachmentRecord[]> {
    const db = await getDatabase();
    if (!db.objectStoreNames.contains('attachments')) return [];
    const all = (await db.getAllFromIndex('attachments', 'entityId', entityId)) as AttachmentRecord[];
    return all.filter((a) => a.entityType === entityType);
  },

  async saveAttachment(record: AttachmentRecord, actorName = 'Admin'): Promise<AttachmentRecord> {
    const db = await getDatabase();
    const tx = safeTransaction(db, ['attachments', 'syncOutbox', 'auditEvents'], 'readwrite');
    const attStore = tx.objectStore('attachments');

    // If sequenceNumber not explicitly provided, allocate atomically within transaction
    let assignedSequence = record.sequenceNumber;
    if (assignedSequence === undefined || assignedSequence === null) {
      const existingRecords = (await attStore.index('entityId').getAll(record.entityId)) as AttachmentRecord[];
      const entityRecords = existingRecords.filter((a) => a.entityType === record.entityType);
      const maxSeq = entityRecords.reduce((max, a) => {
        const seq = typeof a.sequenceNumber === 'number' ? a.sequenceNumber : 0;
        return seq > max ? seq : max;
      }, 0);
      assignedSequence = maxSeq + 1;
    }

    const finalRecord: AttachmentRecord = {
      ...record,
      sequenceNumber: assignedSequence,
    };

    await attStore.put(finalRecord);

    // Outbox metadata (omits raw binary blob to avoid bloating sync feed payloads)
    const metadataPayload: AttachmentMetadata = {
      id: finalRecord.id,
      entityType: finalRecord.entityType,
      entityId: finalRecord.entityId,
      fileName: finalRecord.fileName,
      fileType: finalRecord.fileType,
      fileSize: finalRecord.fileSize,
      caption: finalRecord.caption,
      uploadedAt: finalRecord.uploadedAt,
      sequenceNumber: finalRecord.sequenceNumber,
      cloudinaryPublicId: finalRecord.cloudinaryPublicId,
      cloudinaryUrl: finalRecord.cloudinaryUrl,
      r2ObjectKey: finalRecord.r2ObjectKey,
      r2Bucket: finalRecord.r2Bucket,
      r2FolderName: finalRecord.r2FolderName,
      etag: finalRecord.etag,
      storageProvider: finalRecord.storageProvider,
    };
    if (tx.objectStoreNames.contains('syncOutbox')) {
      enqueueOutboxRecord(
        tx.objectStore('syncOutbox'),
        'Attachment',
        finalRecord.id,
        'upsert',
        metadataPayload
      );
    }

    const auditEvent: AuditEvent = {
      id: generateUUID(),
      timestamp: new Date().toISOString(),
      action: 'ATTACHMENT_ADD',
      entityType: 'Attachment',
      entityId: record.id,
      entityLabel: record.fileName,
      actorId: 'admin',
      actorName,
      details: {
        fileSize: record.fileSize,
        fileType: record.fileType,
        parentEntity: `${record.entityType}:${record.entityId}`,
      },
    };
    if (tx.objectStoreNames.contains('auditEvents')) {
      await tx.objectStore('auditEvents').put(auditEvent);
    }

    await tx.done;
    requestSync();
    return finalRecord;
  },

  async deleteAttachment(id: ID, actorName = 'Admin'): Promise<boolean> {
    const db = await getDatabase();
    if (!db.objectStoreNames.contains('attachments')) return false;
    const existing = (await db.get('attachments', id)) as AttachmentRecord | undefined;
    if (!existing) return false;

    const tx = safeTransaction(db, ['attachments', 'syncOutbox', 'auditEvents'], 'readwrite');
    await tx.objectStore('attachments').delete(id);

    // Outbox tombstone
    if (tx.objectStoreNames.contains('syncOutbox')) {
      enqueueOutboxRecord(
        tx.objectStore('syncOutbox'),
        'Attachment',
        id,
        'delete',
        { id, fileName: existing.fileName, deletedAt: new Date().toISOString() }
      );
    }

    const auditEvent: AuditEvent = {
      id: generateUUID(),
      timestamp: new Date().toISOString(),
      action: 'ATTACHMENT_DELETE',
      entityType: 'Attachment',
      entityId: id,
      entityLabel: existing.fileName,
      actorId: 'admin',
      actorName,
      details: { parentEntity: `${existing.entityType}:${existing.entityId}` },
    };
    if (tx.objectStoreNames.contains('auditEvents')) {
      await tx.objectStore('auditEvents').put(auditEvent);
    }

    await tx.done;
    requestSync();
    return true;
  },
};

// ======================== SYNC SUBSYSTEM REPOSITORIES ========================
export const syncConfigRepository = {
  async getConfig(): Promise<SyncConfig | null> {
    try {
      const db = await getDatabase();
      if (!db.objectStoreNames.contains('syncConfig')) return null;
      const config = (await db.get('syncConfig', 'current_config')) as SyncConfig | undefined;
      return config || null;
    } catch (err) {
      console.warn('Failed to get sync config:', err);
      return null;
    }
  },

  async saveConfig(config: SyncConfig): Promise<SyncConfig> {
    const db = await getDatabase();
    if (!db.objectStoreNames.contains('syncConfig')) return config;
    await db.put('syncConfig', { ...config, id: 'current_config' as const });
    return config;
  },

  async clearConfig(): Promise<void> {
    const db = await getDatabase();
    if (!db.objectStoreNames.contains('syncConfig')) return;
    await db.delete('syncConfig', 'current_config');
  },
};

export const syncOutboxRepository = {
  async getPendingCount(): Promise<number> {
    try {
      const db = await getDatabase();
      if (!db.objectStoreNames.contains('syncOutbox')) return 0;
      return await db.count('syncOutbox');
    } catch {
      return 0;
    }
  },

  async getPendingOperations(limit = 100): Promise<SyncOutboxRecord[]> {
    try {
      const db = await getDatabase();
      if (!db.objectStoreNames.contains('syncOutbox')) return [];
      const ops = (await db.getAllFromIndex('syncOutbox', 'createdAt')) as SyncOutboxRecord[];
      return ops.slice(0, limit);
    } catch {
      return [];
    }
  },

  async clearOutbox(): Promise<void> {
    const db = await getDatabase();
    if (!db.objectStoreNames.contains('syncOutbox')) return;
    await db.clear('syncOutbox');
  },
};

export const syncConflictRepository = {
  async getAll(): Promise<SyncConflictRecord[]> {
    try {
      const db = await getDatabase();
      if (!db.objectStoreNames.contains('syncConflicts')) return [];
      return (await db.getAll('syncConflicts')) as SyncConflictRecord[];
    } catch {
      return [];
    }
  },

  async resolveConflict(operationId: string): Promise<void> {
    const db = await getDatabase();
    if (!db.objectStoreNames.contains('syncConflicts')) return;
    await db.delete('syncConflicts', operationId);
  },
};
