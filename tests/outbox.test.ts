import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  clientRepository,
  quotationRepository,
  invoiceRepository,
  paymentRepository,
  projectRepository,
  attachmentRepository,
  settingsRepository,
  userRepository,
  syncOutboxRepository,
} from '../src/storage/repositories';
import { getDatabase, resetDatabaseConnection } from '../src/storage/database';
import { toCentavos } from '../src/domain/calculations';

describe('Atomic Mutations and Durable Sync Outbox Integration', () => {
  beforeEach(async () => {
    indexedDB = new IDBFactory();
    resetDatabaseConnection();
    await syncOutboxRepository.clearOutbox();
  });

  it('enqueues Client upsert and tombstone delete operations atomically into syncOutbox', async () => {
    // 1. Create client
    const client = await clientRepository.save({
      name: 'Ortigas Center Security Office',
      contactNumber: '0918-111-2222',
      address: 'Ortigas, Pasig City',
      leadStatus: 'New Inquiry',
      leadSource: 'Direct Call',
    });

    const pending = await syncOutboxRepository.getPendingOperations();
    expect(pending.length).toBe(1);
    expect(pending[0].entityType).toBe('Client');
    expect(pending[0].entityId).toBe(client.id);
    expect(pending[0].operation).toBe('upsert');
    expect((pending[0].payload as any).name).toBe('Ortigas Center Security Office');

    // 2. Delete client -> generates tombstone
    await clientRepository.delete(client.id);

    const pendingAfterDelete = await syncOutboxRepository.getPendingOperations();
    expect(pendingAfterDelete.length).toBe(2);
    expect(pendingAfterDelete[1].entityType).toBe('Client');
    expect(pendingAfterDelete[1].entityId).toBe(client.id);
    expect(pendingAfterDelete[1].operation).toBe('delete');
  });

  it('enqueues Quotation create and immutable Revision snapshot operations atomically', async () => {
    const quote = await quotationRepository.save({
      id: 'quote-test-1',
      quotationNumber: 'Q-2026-001',
      revisionNumber: 0,
      clientId: 'client-1',
      clientName: 'Client Alpha',
      clientContact: '0917-123-4567',
      clientAddress: 'Quezon City',
      projectTitle: 'Electric Fence Perimeter',
      serviceCategory: 'Electric Fence Installation',
      scopeOfWork: 'Full perimeter installation',
      termsAndConditions: '50% downpayment',
      issueDate: '2026-10-20',
      expiryDate: '2026-11-20',
      status: 'Draft',
      lineItems: [],
      subtotalCentavos: 10000000,
      taxRatePercent: 12,
      taxCentavos: 1200000,
      grandTotalCentavos: 11200000,
      taxMode: 'EXCLUSIVE',
      createdAt: '2026-10-20T00:00:00Z',
      updatedAt: '2026-10-20T00:00:00Z',
    });

    let pending = await syncOutboxRepository.getPendingOperations();
    expect(pending.some((o) => o.entityType === 'Quotation' && o.entityId === quote.id)).toBe(true);

    // Create Revision
    await quotationRepository.createRevision(quote.id, 'Added extra energizer unit');
    pending = await syncOutboxRepository.getPendingOperations();

    const revisionOps = pending.filter((o) => o.entityType === 'QuotationRevision');
    expect(revisionOps.length).toBe(1);
    expect((revisionOps[0].payload as any).reason).toBe('Added extra energizer unit');
  });

  it('enqueues Payment financial event and updated Invoice atomically without losing financial history', async () => {
    // Setup invoice
    const inv = await invoiceRepository.save({
      id: 'inv-fin-1',
      invoiceNumber: 'INV-2026-001',
      clientId: 'cli-1',
      clientName: 'Client Corp',
      clientContact: '0917-000-1111',
      clientAddress: 'Taguig',
      issueDate: '2026-10-20',
      dueDate: '2026-11-05',
      title: 'Gate Automation Final Billing',
      lineItems: [],
      subtotalCentavos: 5000000,
      taxRatePercent: 12,
      taxCentavos: 600000,
      grandTotalCentavos: 5600000,
      paidAmountCentavos: 0,
      remainingBalanceCentavos: 5600000,
      status: 'Issued',
      taxMode: 'EXCLUSIVE',
      createdAt: '2026-10-20T00:00:00Z',
      updatedAt: '2026-10-20T00:00:00Z',
    });

    await syncOutboxRepository.clearOutbox();

    // Record partial payment of ₱25,000.00
    const payment = await paymentRepository.recordPayment({
      paymentNumber: 'PAY-2026-001',
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      clientId: inv.clientId,
      clientName: inv.clientName,
      amountCentavos: toCentavos(25000),
      paymentDate: '2026-10-20',
      paymentMethod: 'Bank Transfer - BDO',
      referenceNumber: 'BDO-REF-9988',
      receivedBy: 'Operations Officer',
    });

    const pending = await syncOutboxRepository.getPendingOperations();
    // Must contain Payment record AND updated Invoice record
    const paymentOp = pending.find((o) => o.entityType === 'Payment' && o.entityId === payment.id);
    const invoiceOp = pending.find((o) => o.entityType === 'Invoice' && o.entityId === inv.id);

    expect(paymentOp).toBeDefined();
    expect(paymentOp?.operation).toBe('upsert');
    expect((paymentOp?.payload as any).amountCentavos).toBe(toCentavos(25000));

    expect(invoiceOp).toBeDefined();
    expect((invoiceOp?.payload as any).status).toBe('Partially Paid');
    expect((invoiceOp?.payload as any).remainingBalanceCentavos).toBe(5600000 - toCentavos(25000));
  });

  it('guarantees local users and password credentials are NEVER enqueued in syncOutbox', async () => {
    await syncOutboxRepository.clearOutbox();

    await userRepository.saveUser({
      id: 'local-admin-id',
      username: 'admin',
      fullName: 'Master Owner',
      email: 'owner@sentinelops.local',
      passwordHash: 'salt:hash123456789',
      salt: 'salt1234',
      securityQuestion: 'Question?',
      securityAnswerHash: 'salt:answer1234',
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    });

    const pending = await syncOutboxRepository.getPendingOperations();
    const userOps = pending.filter((o) => o.entityType === 'User' || (o.payload as any)?.passwordHash);
    expect(userOps.length).toBe(0);
  });
});
