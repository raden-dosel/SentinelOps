/**
 * SentinelOps - Repository Layer for IndexedDB Entities
 * Encapsulates data access, transactional updates, and integrity rules.
 */

import { getDatabase, DEFAULT_SETTINGS } from './database';
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

// ======================== USERS & AUTH ========================
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
    const db = await getDatabase();
    const settings = (await db.get('settings', 'current_settings')) as AppSettings | undefined;
    if (!settings) {
      // First-run default
      await db.put('settings', DEFAULT_SETTINGS);
      return DEFAULT_SETTINGS;
    }
    return settings;
  },

  async saveSettings(settings: AppSettings, actorName = 'Admin'): Promise<AppSettings> {
    const db = await getDatabase();
    const updated = {
      ...settings,
      id: 'current_settings' as const,
      updatedAt: new Date().toISOString(),
    };
    await db.put('settings', updated);

    await auditRepository.logEvent({
      action: 'SETTINGS_UPDATE',
      entityType: 'Settings',
      entityId: 'current_settings',
      entityLabel: 'App Settings',
      actorId: 'admin',
      actorName,
      details: { businessName: updated.businessName, taxMode: updated.taxMode },
    });

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
    await db.put('auditEvents', event);
    return event;
  },

  async getAll(): Promise<AuditEvent[]> {
    const db = await getDatabase();
    const events = (await db.getAll('auditEvents')) as AuditEvent[];
    // Sort descending by timestamp
    return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  },
};

// ======================== CLIENTS (CRM) ========================
export const clientRepository = {
  async getAll(): Promise<Client[]> {
    const db = await getDatabase();
    const clients = (await db.getAll('clients')) as Client[];
    return clients.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async getById(id: ID): Promise<Client | null> {
    const db = await getDatabase();
    const client = await db.get('clients', id);
    return (client as Client) || null;
  },

  async save(client: Omit<Client, 'id' | 'createdAt' | 'updatedAt'> & { id?: ID }, actorName = 'Admin'): Promise<Client> {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const isNew = !client.id;

    const fullClient: Client = {
      ...client,
      id: client.id || generateUUID(),
      createdAt: isNew ? now : (await db.get('clients', client.id!))?.createdAt || now,
      updatedAt: now,
    };

    await db.put('clients', fullClient);

    await auditRepository.logEvent({
      action: isNew ? 'CLIENT_CREATE' : 'CLIENT_UPDATE',
      entityType: 'Client',
      entityId: fullClient.id,
      entityLabel: fullClient.name,
      actorId: 'admin',
      actorName,
      details: { leadStatus: fullClient.leadStatus, leadSource: fullClient.leadSource },
    });

    return fullClient;
  },

  async canDelete(id: ID): Promise<{ canDelete: boolean; reason?: string }> {
    const db = await getDatabase();
    const quotations = await db.getAllFromIndex('quotations', 'clientId', id);
    if (quotations.length > 0) {
      return { canDelete: false, reason: `Cannot delete client with ${quotations.length} linked quotation(s). Mark status as Lost instead to preserve historical records.` };
    }
    const invoices = await db.getAllFromIndex('invoices', 'clientId', id);
    if (invoices.length > 0) {
      return { canDelete: false, reason: `Cannot delete client with ${invoices.length} linked invoice(s). Financial records must be preserved.` };
    }
    const projects = await db.getAllFromIndex('projects', 'clientId', id);
    if (projects.length > 0) {
      return { canDelete: false, reason: `Cannot delete client with ${projects.length} linked project(s).` };
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
    await db.delete('clients', id);

    if (existing) {
      await auditRepository.logEvent({
        action: 'CLIENT_UPDATE',
        entityType: 'Client',
        entityId: id,
        entityLabel: existing.name,
        actorId: 'admin',
        actorName,
        details: { action: 'deleted' },
      });
    }
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

    await db.put('quotations', record);

    const isNew = !existing;
    await auditRepository.logEvent({
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
    });

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

    const tx = db.transaction(['quotationRevisions', 'quotations', 'auditEvents'], 'readwrite');
    await tx.objectStore('quotationRevisions').put(revision);

    current.revisionNumber = nextRevNum;
    current.updatedAt = new Date().toISOString();
    await tx.objectStore('quotations').put(current);

    await tx.done;

    await auditRepository.logEvent({
      action: 'QUOTATION_REVISE',
      entityType: 'Quotation',
      entityId: current.id,
      entityLabel: `${current.quotationNumber} (Rev ${nextRevNum})`,
      actorId: 'admin',
      actorName,
      details: { revisionNumber: current.revisionNumber, reason },
    });

    return revision;
  },

  async getRevisions(quotationId: ID): Promise<QuotationRevision[]> {
    const db = await getDatabase();
    const revs = (await db.getAllFromIndex('quotationRevisions', 'quotationId', quotationId)) as QuotationRevision[];
    return revs.sort((a, b) => b.revisionNumber - a.revisionNumber);
  },

  async delete(id: ID, actorName = 'Admin'): Promise<boolean> {
    const db = await getDatabase();
    const quotation = (await db.get('quotations', id)) as Quotation | undefined;
    if (!quotation) return false;

    // Check if converted to invoice
    if (quotation.convertedToInvoiceId) {
      throw new Error('Cannot delete quotation that has already been converted to an invoice.');
    }

    await db.delete('quotations', id);
    await auditRepository.logEvent({
      action: 'QUOTATION_UPDATE',
      entityType: 'Quotation',
      entityId: id,
      entityLabel: `${quotation.quotationNumber} (Deleted)`,
      actorId: 'admin',
      actorName,
      details: { deleted: true },
    });
    return true;
  },
};

// ======================== INVOICES ========================
export const invoiceRepository = {
  async getAll(): Promise<Invoice[]> {
    const db = await getDatabase();
    const invoices = (await db.getAll('invoices')) as Invoice[];
    // Auto-evaluate overdue status
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
    const invoices = (await db.getAllFromIndex('invoices', 'clientId', clientId)) as Invoice[];
    return invoices.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async getByProjectId(projectId: ID): Promise<Invoice[]> {
    const db = await getDatabase();
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

    await db.put('invoices', record);

    const isNew = !existing;
    await auditRepository.logEvent({
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
    });

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

    await db.put('invoices', inv);

    await auditRepository.logEvent({
      action: 'INVOICE_VOID',
      entityType: 'Invoice',
      entityId: inv.id,
      entityLabel: inv.invoiceNumber,
      actorId: 'admin',
      actorName,
      details: { reason },
    });

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
    const tx = db.transaction(['invoices', 'payments', 'projects', 'auditEvents'], 'readwrite');
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
    if (invoice.projectId) {
      const projectStore = tx.objectStore('projects');
      const project = (await projectStore.get(invoice.projectId)) as Project | undefined;
      if (project) {
        project.totalPaidCentavos = (project.totalPaidCentavos || 0) + payment.amountCentavos;
        project.updatedAt = new Date().toISOString();
        await projectStore.put(project);
      }
    }

    await tx.done;

    await auditRepository.logEvent({
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
    });

    return paymentRecord;
  },

  async reversePayment(paymentId: ID, reason: string, actorName = 'Admin'): Promise<Payment> {
    const db = await getDatabase();
    const tx = db.transaction(['invoices', 'payments', 'projects', 'auditEvents'], 'readwrite');
    const paymentStore = tx.objectStore('payments');
    const invoiceStore = tx.objectStore('invoices');

    const payment = (await paymentStore.get(paymentId)) as Payment | undefined;
    if (!payment) throw new Error('Payment not found');
    if (payment.isReversed) throw new Error('Payment is already reversed.');

    const invoice = (await invoiceStore.get(payment.invoiceId)) as Invoice | undefined;
    if (!invoice) throw new Error('Linked invoice not found');

    // Recompute invoice amounts
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

    // Reverse project paid amount if linked
    if (invoice.projectId) {
      const projectStore = tx.objectStore('projects');
      const project = (await projectStore.get(invoice.projectId)) as Project | undefined;
      if (project) {
        project.totalPaidCentavos = Math.max(0, (project.totalPaidCentavos || 0) - payment.amountCentavos);
        project.updatedAt = new Date().toISOString();
        await projectStore.put(project);
      }
    }

    await tx.done;

    await auditRepository.logEvent({
      action: 'PAYMENT_REVERSE',
      entityType: 'Payment',
      entityId: payment.id,
      entityLabel: `Reversal of ${payment.paymentNumber}`,
      actorId: 'admin',
      actorName,
      details: { reason, amountCentavos: payment.amountCentavos },
    });

    return payment;
  },
};

// ======================== PROJECTS ========================
export const projectRepository = {
  async getAll(): Promise<Project[]> {
    const db = await getDatabase();
    const projects = (await db.getAll('projects')) as Project[];
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async getById(id: ID): Promise<Project | null> {
    const db = await getDatabase();
    const p = await db.get('projects', id);
    return (p as Project) || null;
  },

  async getByClientId(clientId: ID): Promise<Project[]> {
    const db = await getDatabase();
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

    await db.put('projects', record);

    const isNew = !existing;
    await auditRepository.logEvent({
      action: isNew ? 'PROJECT_CREATE' : 'PROJECT_UPDATE',
      entityType: 'Project',
      entityId: record.id,
      entityLabel: `${record.projectNumber} - ${record.name}`,
      actorId: 'admin',
      actorName,
      details: { status: record.status, clientName: record.clientName },
    });

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

    await db.put('projects', project);

    await auditRepository.logEvent({
      action: statusChange ? 'PROJECT_STATUS_CHANGE' : 'PROJECT_UPDATE',
      entityType: 'Project',
      entityId: project.id,
      entityLabel: `${project.projectNumber} Progress Update`,
      actorId: 'admin',
      actorName: author,
      details: { text, statusChange },
    });

    return project;
  },

  async delete(id: ID, actorName = 'Admin'): Promise<boolean> {
    const db = await getDatabase();
    const project = (await db.get('projects', id)) as Project | undefined;
    if (!project) return false;

    // Check if invoices linked
    const invoices = (await db.getAllFromIndex('invoices', 'projectId', id)) as Invoice[];
    if (invoices.length > 0) {
      throw new Error(`Cannot delete project with ${invoices.length} linked invoice(s). Close the project instead to preserve history.`);
    }

    await db.delete('projects', id);
    await auditRepository.logEvent({
      action: 'PROJECT_UPDATE',
      entityType: 'Project',
      entityId: id,
      entityLabel: `${project.projectNumber} (Deleted)`,
      actorId: 'admin',
      actorName,
      details: { deleted: true },
    });
    return true;
  },
};

// ======================== ATTACHMENTS ========================
export const attachmentRepository = {
  async getByEntity(entityType: AttachmentMetadata['entityType'], entityId: ID): Promise<AttachmentRecord[]> {
    const db = await getDatabase();
    const all = (await db.getAllFromIndex('attachments', 'entityId', entityId)) as AttachmentRecord[];
    return all.filter((a) => a.entityType === entityType);
  },

  async saveAttachment(record: AttachmentRecord, actorName = 'Admin'): Promise<AttachmentRecord> {
    const db = await getDatabase();
    await db.put('attachments', record);

    await auditRepository.logEvent({
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
    });

    return record;
  },

  async deleteAttachment(id: ID, actorName = 'Admin'): Promise<boolean> {
    const db = await getDatabase();
    const existing = (await db.get('attachments', id)) as AttachmentRecord | undefined;
    if (!existing) return false;

    await db.delete('attachments', id);

    await auditRepository.logEvent({
      action: 'ATTACHMENT_DELETE',
      entityType: 'Attachment',
      entityId: id,
      entityLabel: existing.fileName,
      actorId: 'admin',
      actorName,
      details: { parentEntity: `${existing.entityType}:${existing.entityId}` },
    });

    return true;
  },
};
