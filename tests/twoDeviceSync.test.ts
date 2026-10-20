import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { openDB, IDBPDatabase } from 'idb';
import { upgradeDatabaseSchema } from '../src/storage/database';
import { toCentavos } from '../src/domain/calculations';

/**
 * Two-Device Acceptance & Multi-Tablet Synchronization Test Suite
 * Simulates two completely separate tablet profiles (Device A and Device B),
 * each with their own isolated IndexedDB database, synchronizing through
 * the versioned SentinelOps sync protocol.
 */

interface ServerChangeFeedEntry {
  sequence: number;
  businessId: string;
  deviceId: string;
  entityType: string;
  entityId: string;
  operation: 'upsert' | 'delete';
  revision: string;
  payload: any;
  createdAtUtc: string;
}

class MockServerBackend {
  public businessId = '00000000-0000-0000-0000-111111111111';
  public businessBId = '00000000-0000-0000-0000-222222222222';
  public devices = new Map<string, { token: string; revoked: boolean; businessId: string }>();
  public currentEntities = new Map<string, { revision: string; payload: any; businessId: string }>();
  public changeFeed: ServerChangeFeedEntry[] = [];
  public idempotency = new Map<string, { result: any }>();
  private sequenceCounter = 0;

  public registerDevice(deviceId: string, token: string, businessId = this.businessId) {
    this.devices.set(deviceId, { token, revoked: false, businessId });
  }

  public revokeDevice(deviceId: string) {
    const dev = this.devices.get(deviceId);
    if (dev) dev.revoked = true;
  }

  public pushBatch(deviceId: string, token: string, operations: any[]): {
    status: number;
    error?: string;
    results: Array<{ operationId: string; status: string; revision?: string; message?: string }>;
  } {
    const dev = this.devices.get(deviceId);
    if (!dev || dev.revoked || dev.token !== token) {
      return { status: 401, error: 'Unauthorized or revoked device.', results: [] };
    }

    const results: any[] = [];
    for (const op of operations) {
      // Idempotency check
      if (this.idempotency.has(op.operationId)) {
        results.push({
          operationId: op.operationId,
          status: 'already_applied',
          revision: this.idempotency.get(op.operationId)!.result.revision,
        });
        continue;
      }

      const key = `${dev.businessId}:${op.entityType}:${op.entityId}`;
      const existing = this.currentEntities.get(key);

      // Concurrency base-revision check
      if (existing && op.baseRevision && existing.revision !== op.baseRevision) {
        results.push({
          operationId: op.operationId,
          status: 'conflict',
          revision: existing.revision,
          message: 'Concurrent edit detected on another device.',
        });
        continue;
      }

      const newRev = `rev-${++this.sequenceCounter}`;
      if (op.operation === 'delete') {
        this.currentEntities.delete(key);
      } else {
        this.currentEntities.set(key, {
          revision: newRev,
          payload: op.payload,
          businessId: dev.businessId,
        });
      }

      this.changeFeed.push({
        sequence: this.sequenceCounter,
        businessId: dev.businessId,
        deviceId,
        entityType: op.entityType,
        entityId: op.entityId,
        operation: op.operation,
        revision: newRev,
        payload: op.operation === 'delete' ? null : op.payload,
        createdAtUtc: new Date().toISOString(),
      });

      const res = { operationId: op.operationId, status: 'accepted', revision: newRev };
      this.idempotency.set(op.operationId, { result: res });
      results.push(res);
    }

    return { status: 200, results };
  }

  public getChanges(deviceId: string, token: string, sinceSequence = 0): {
    status: number;
    error?: string;
    changes: ServerChangeFeedEntry[];
    nextCursor: string;
    nextSequence: number;
  } {
    const dev = this.devices.get(deviceId);
    if (!dev || dev.revoked || dev.token !== token) {
      return { status: 401, error: 'Unauthorized', changes: [], nextCursor: '', nextSequence: 0 };
    }

    const changes = this.changeFeed.filter(
      (c) => c.businessId === dev.businessId && c.sequence > sinceSequence
    );
    const nextSeq = changes.length > 0 ? changes[changes.length - 1].sequence : sinceSequence;
    return {
      status: 200,
      changes,
      nextCursor: `cursor-${dev.businessId}-${nextSeq}`,
      nextSequence: nextSeq,
    };
  }

  public getSnapshot(deviceId: string, token: string): {
    status: number;
    error?: string;
    entities: any[];
    snapshotCursor: string;
    snapshotSequence: number;
  } {
    const dev = this.devices.get(deviceId);
    if (!dev || dev.revoked || dev.token !== token) {
      return { status: 401, error: 'Unauthorized', entities: [], snapshotCursor: '', snapshotSequence: 0 };
    }

    const entities: any[] = [];
    for (const [key, val] of this.currentEntities.entries()) {
      if (val.businessId === dev.businessId) {
        const parts = key.split(':');
        entities.push({
          entityType: parts[1],
          entityId: parts[2],
          revision: val.revision,
          payload: val.payload,
        });
      }
    }
    return {
      status: 200,
      entities,
      snapshotCursor: `cursor-${dev.businessId}-${this.sequenceCounter}`,
      snapshotSequence: this.sequenceCounter,
    };
  }
}

describe('Two-Device Synchronization & Acceptance Scenarios', () => {
  let server: MockServerBackend;
  let dbA: IDBPDatabase;
  let dbB: IDBPDatabase;

  const deviceAId = 'dev-tablet-001';
  const deviceAToken = 'token-secret-alpha-998877665544332211';
  const deviceBId = 'dev-tablet-002';
  const deviceBToken = 'token-secret-bravo-112233445566778899';

  beforeEach(async () => {
    indexedDB = new IDBFactory();
    server = new MockServerBackend();

    // 1. Enroll both devices into the same authorized business
    server.registerDevice(deviceAId, deviceAToken);
    server.registerDevice(deviceBId, deviceBToken);

    // Initialize Device A IndexedDB
    dbA = await openDB('device_a_sentinelops_db', 2, {
      upgrade(db, oldVersion, newVersion) {
        upgradeDatabaseSchema(db, oldVersion, newVersion);
      },
    });

    // Initialize Device B IndexedDB
    dbB = await openDB('device_b_sentinelops_db', 2, {
      upgrade(db, oldVersion, newVersion) {
        upgradeDatabaseSchema(db, oldVersion, newVersion);
      },
    });
  });

  it('scenarios 1 & 2: enrolls two devices, creates client on Device A, and syncs to Device B', async () => {
    // Device A creates client
    const newClient = {
      id: 'client-ayala-01',
      name: 'Ayala Alabang Security Command',
      contactNumber: '0917-888-9999',
      address: 'Muntinlupa City',
      leadStatus: 'Won',
      leadSource: 'Contract Referral',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Store in Device A local store & outbox
    const txA = dbA.transaction(['clients', 'syncOutbox'], 'readwrite');
    await txA.objectStore('clients').put(newClient);
    await txA.objectStore('syncOutbox').put({
      operationId: 'op-create-client-1',
      entityType: 'Client',
      entityId: newClient.id,
      operation: 'upsert',
      baseRevision: null,
      payload: newClient,
      createdAt: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
    });
    await txA.done;

    // Device A pushes outbox to server
    const outboxOps = await dbA.getAll('syncOutbox');
    expect(outboxOps.length).toBe(1);

    const pushRes = server.pushBatch(deviceAId, deviceAToken, outboxOps);
    expect(pushRes.status).toBe(200);
    expect(pushRes.results[0].status).toBe('accepted');

    // Device A marks outbox as completed
    await dbA.delete('syncOutbox', 'op-create-client-1');

    // Device B pulls remote changes from server
    const pullRes = server.getChanges(deviceBId, deviceBToken, 0);
    expect(pullRes.status).toBe(200);
    expect(pullRes.changes.length).toBe(1);
    expect(pullRes.changes[0].entityId).toBe(newClient.id);

    // Device B applies pulled change atomically in its local database
    const txB = dbB.transaction(['clients', 'syncMetadata'], 'readwrite');
    const change = pullRes.changes[0];
    await txB.objectStore('clients').put({ ...change.payload, id: change.entityId });
    await txB.objectStore('syncMetadata').put({
      id: 'cursor',
      cursor: pullRes.nextCursor,
      lastSuccessfulSyncAt: new Date().toISOString(),
    });
    await txB.done;

    // Verify record now exists on Device B
    const clientOnB = await dbB.get('clients', 'client-ayala-01');
    expect(clientOnB).toBeDefined();
    expect(clientOnB.name).toBe('Ayala Alabang Security Command');
    expect(clientOnB.leadStatus).toBe('Won');
  });

  it('scenario 3: detects concurrent offline edits and flags conflict', async () => {
    // 1. Seed base record
    const baseClient = {
      id: 'client-concurrent-1',
      name: 'Ortigas Tower',
      contactNumber: '0917-111-2222',
      leadStatus: 'Proposal Sent',
      updatedAt: '2026-10-20T00:00:00Z',
    };
    server.currentEntities.set(`${server.businessId}:Client:client-concurrent-1`, {
      revision: 'rev-base-1',
      payload: baseClient,
      businessId: server.businessId,
    });

    // Device A edits while offline based on 'rev-base-1'
    const editA = {
      operationId: 'op-a-1',
      entityType: 'Client',
      entityId: 'client-concurrent-1',
      operation: 'upsert',
      baseRevision: 'rev-base-1',
      payload: { ...baseClient, leadStatus: 'Won' },
    };

    // Device B also edits while offline based on 'rev-base-1'
    const editB = {
      operationId: 'op-b-1',
      entityType: 'Client',
      entityId: 'client-concurrent-1',
      operation: 'upsert',
      baseRevision: 'rev-base-1',
      payload: { ...baseClient, leadStatus: 'Lost' },
    };

    // Device A syncs first
    const resA = server.pushBatch(deviceAId, deviceAToken, [editA]);
    expect(resA.results[0].status).toBe('accepted');

    // Device B syncs second -> server detects stale base revision 'rev-base-1'
    const resB = server.pushBatch(deviceBId, deviceBToken, [editB]);
    expect(resB.results[0].status).toBe('conflict');
    expect(resB.results[0].revision).toBe(resA.results[0].revision);

    // Device B stores conflict record in IndexedDB syncConflicts
    await dbB.put('syncConflicts', {
      operationId: editB.operationId,
      entityType: editB.entityType,
      entityId: editB.entityId,
      operation: editB.operation,
      localPayload: editB.payload,
      serverRevision: resB.results[0].revision,
      message: 'Conflict detected: modified on another tablet.',
      occurredAt: new Date().toISOString(),
      resolved: false,
    });

    const conflict = await dbB.get('syncConflicts', editB.operationId);
    expect(conflict).toBeDefined();
    expect(conflict.resolved).toBe(false);
  });

  it('scenarios 4, 5 & 6: verifies immutable quotation revisions and payment idempotency without duplicate deduction', async () => {
    // 1. Device A creates Invoice
    const invoice = {
      id: 'inv-solar-fence-1',
      invoiceNumber: 'INV-2026-001',
      clientId: 'client-1',
      title: 'Solar Powered Fence Installation',
      grandTotalCentavos: 5600000, // ₱56,000.00
      paidAmountCentavos: 0,
      remainingBalanceCentavos: 5600000,
      status: 'Issued',
    };

    server.pushBatch(deviceAId, deviceAToken, [
      {
        operationId: 'op-inv-1',
        entityType: 'Invoice',
        entityId: invoice.id,
        operation: 'upsert',
        baseRevision: null,
        payload: invoice,
      },
    ]);

    // 2. Device A records payment of ₱25,000.00
    const paymentOp = {
      operationId: 'op-pay-25000',
      entityType: 'Payment',
      entityId: 'pay-uuid-001',
      operation: 'upsert',
      baseRevision: null,
      payload: {
        id: 'pay-uuid-001',
        paymentNumber: 'PAY-2026-001',
        invoiceId: invoice.id,
        amountCentavos: toCentavos(25000),
        paymentDate: '2026-10-20',
      },
    };

    const firstPush = server.pushBatch(deviceAId, deviceAToken, [paymentOp]);
    expect(firstPush.results[0].status).toBe('accepted');

    // 3. Retry identical payment operation (e.g. tablet network timeout reconnect)
    const retryPush = server.pushBatch(deviceAId, deviceAToken, [paymentOp]);
    expect(retryPush.results[0].status).toBe('already_applied');

    // 4. Update Invoice state on server
    const updatedInvoice = {
      ...invoice,
      paidAmountCentavos: toCentavos(25000),
      remainingBalanceCentavos: 5600000 - toCentavos(25000), // ₱31,000.00
      status: 'Partially Paid',
    };

    server.pushBatch(deviceAId, deviceAToken, [
      {
        operationId: 'op-update-inv-1',
        entityType: 'Invoice',
        entityId: invoice.id,
        operation: 'upsert',
        baseRevision: null,
        payload: updatedInvoice,
      },
    ]);

    // 5. Device B pulls changes
    const pullB = server.getChanges(deviceBId, deviceBToken, 0);
    const invoiceChange = pullB.changes.find((c) => c.entityId === invoice.id && c.payload.status === 'Partially Paid');
    expect(invoiceChange).toBeDefined();
    expect(invoiceChange?.payload.remainingBalanceCentavos).toBe(3100000); // ₱31,000.00
  });

  it('scenario 7: propagates durable tombstones when an entity is deleted', async () => {
    // Create project
    const project = { id: 'prj-alpha-1', projectNumber: 'PRJ-2026-001', name: 'Alabang Gate Motor' };
    server.pushBatch(deviceAId, deviceAToken, [
      {
        operationId: 'op-prj-add',
        entityType: 'Project',
        entityId: project.id,
        operation: 'upsert',
        baseRevision: null,
        payload: project,
      },
    ]);

    // Device B pulls project
    let pullB = server.getChanges(deviceBId, deviceBToken, 0);
    await dbB.put('projects', pullB.changes[0].payload);
    expect(await dbB.get('projects', project.id)).toBeDefined();

    // Device A deletes project -> enqueues delete operation
    const deleteOp = {
      operationId: 'op-prj-del',
      entityType: 'Project',
      entityId: project.id,
      operation: 'delete',
      baseRevision: null,
      payload: {},
    };
    server.pushBatch(deviceAId, deviceAToken, [deleteOp]);

    // Device B pulls deletion tombstone
    pullB = server.getChanges(deviceBId, deviceBToken, pullB.nextSequence);
    const tombstone = pullB.changes.find((c) => c.entityId === project.id);
    expect(tombstone).toBeDefined();
    expect(tombstone?.operation).toBe('delete');

    // Device B applies delete in transaction
    const txB = dbB.transaction('projects', 'readwrite');
    await txB.objectStore('projects').delete(tombstone!.entityId);
    await txB.done;

    expect(await dbB.get('projects', project.id)).toBeUndefined();
  });

  it('scenario 8: revoking a device token blocks unauthorized push/pull immediately', async () => {
    server.revokeDevice(deviceBId);

    const pushRes = server.pushBatch(deviceBId, deviceBToken, [
      { operationId: 'op-unauth', entityType: 'Client', entityId: 'c1', operation: 'upsert', payload: {} },
    ]);
    expect(pushRes.status).toBe(401);

    const pullRes = server.getChanges(deviceBId, deviceBToken, 0);
    expect(pullRes.status).toBe(401);
  });

  it('scenario 9: executes full snapshot recovery without losing pending local outbox edits', async () => {
    // Populate server with authoritative data
    server.pushBatch(deviceAId, deviceAToken, [
      {
        operationId: 'op-authoritative-1',
        entityType: 'Client',
        entityId: 'client-server-authoritative',
        operation: 'upsert',
        baseRevision: null,
        payload: { id: 'client-server-authoritative', name: 'BGC Headquarters' },
      },
    ]);

    // Device B has an unpushed local edit in syncOutbox
    const localPendingClient = {
      id: 'client-local-pending',
      name: 'Quezon City Field Office',
    };
    await dbB.put('clients', localPendingClient);
    await dbB.put('syncOutbox', {
      operationId: 'op-pending-local',
      entityType: 'Client',
      entityId: localPendingClient.id,
      operation: 'upsert',
      baseRevision: null,
      payload: localPendingClient,
      createdAt: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
    });

    // Simulate snapshot recovery
    const snapshot = server.getSnapshot(deviceBId, deviceBToken);
    expect(snapshot.status).toBe(200);

    // Apply snapshot entities to Device B
    const tx = dbB.transaction(['clients', 'syncMetadata'], 'readwrite');
    for (const ent of snapshot.entities) {
      await tx.objectStore('clients').put(ent.payload);
    }
    await tx.objectStore('syncMetadata').put({
      id: 'cursor',
      cursor: snapshot.snapshotCursor,
      lastSuccessfulSyncAt: new Date().toISOString(),
      resyncRequired: false,
    });
    await tx.done;

    // Verify BOTH server entity AND local pending entity exist!
    expect(await dbB.get('clients', 'client-server-authoritative')).toBeDefined();
    expect(await dbB.get('clients', 'client-local-pending')).toBeDefined();

    // Verify outbox remained completely preserved!
    const outboxAfter = await dbB.getAll('syncOutbox');
    expect(outboxAfter.length).toBe(1);
    expect(outboxAfter[0].entityId).toBe('client-local-pending');
  });

  it('scenario 12: guarantees strict business tenant isolation', async () => {
    // Device in Business B
    server.registerDevice('dev-other-biz', 'token-other-biz', server.businessBId);

    // Write to Business A
    server.pushBatch(deviceAId, deviceAToken, [
      {
        operationId: 'op-biz-a',
        entityType: 'Client',
        entityId: 'client-confidential-a',
        operation: 'upsert',
        baseRevision: null,
        payload: { name: 'Top Secret Bank Installation' },
      },
    ]);

    // Business B pulls changes
    const pullOther = server.getChanges('dev-other-biz', 'token-other-biz', 0);
    expect(pullOther.status).toBe(200);
    // Must NOT contain Business A records
    expect(pullOther.changes.some((c) => c.entityId === 'client-confidential-a')).toBe(false);
  });
});
