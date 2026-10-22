/**
 * SentinelOps - Multi-Tablet Sync Coordinator
 * Orchestrates atomic pull application, durable outbox push, exponential backoff,
 * authenticated cursor tracking, and retention-aware snapshot resynchronization.
 */

import { getDatabase, SyncConfig, SyncMetadata, SyncOutboxRecord, SyncConflictRecord } from '../storage/database';
import { syncConfigRepository, syncOutboxRepository, syncConflictRepository } from '../storage/repositories';
import { SYNC_NEEDED_EVENT } from './syncEvents';

export type SyncStatusState =
  | 'Not configured'
  | 'Offline'
  | 'Idle'
  | 'Pending'
  | 'Syncing'
  | 'Synced'
  | 'Conflict'
  | 'Error'
  | 'ResyncRequired';

export interface SyncCoordinatorState {
  status: SyncStatusState;
  pendingCount: number;
  lastSuccessfulSyncAt?: string;
  lastError?: string;
  isOnline: boolean;
  businessName?: string;
  deviceName?: string;
}

export interface PushResult {
  operationId: string;
  status: 'accepted' | 'already_applied' | 'rejected' | 'unauthorized' | 'conflict';
  revision?: string;
  errorCode?: string;
  message?: string;
}

export interface ChangeFeedItem {
  sequence: number;
  entityType: string;
  entityId: string;
  operation: 'upsert' | 'delete';
  revision: string;
  payload: any;
  createdAtUtc: string;
}

export interface ChangesResponse {
  changes: ChangeFeedItem[];
  nextCursor: string | null;
  resyncRequired: boolean;
}

export interface SnapshotResponse {
  entities: Array<{
    entityType: string;
    entityId: string;
    revision: string;
    payload: any;
  }>;
  snapshotCursor: string;
  hasMore: boolean;
}

class SyncCoordinator {
  private state: SyncCoordinatorState = {
    status: 'Not configured',
    pendingCount: 0,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  };

  private listeners = new Set<(state: SyncCoordinatorState) => void>();
  private activeSyncPromise: Promise<boolean> | null = null;
  private consecutiveFailures = 0;
  private scheduledRetryTimer: any = null;
  private syncIntervalTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.updateState({ isOnline: true });
        this.triggerSync();
      });
      window.addEventListener('offline', () => {
        this.updateState({ isOnline: false, status: 'Offline' });
      });
      window.addEventListener(SYNC_NEEDED_EVENT, () => {
        this.triggerSync();
      });
    }
  }

  public subscribe(listener: (state: SyncCoordinatorState) => void): () => void {
    this.listeners.add(listener);
    listener({ ...this.state });
    return () => this.listeners.delete(listener);
  }

  private updateState(partial: Partial<SyncCoordinatorState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((listener) => listener({ ...this.state }));
  }

  public getState(): SyncCoordinatorState {
    return { ...this.state };
  }

  public async initialize(): Promise<void> {
    const config = await syncConfigRepository.getConfig();
    const pendingCount = await syncOutboxRepository.getPendingCount();

    if (this.syncIntervalTimer) {
      clearInterval(this.syncIntervalTimer);
      this.syncIntervalTimer = null;
    }

    if (!config) {
      this.updateState({ status: 'Not configured', pendingCount });
      return;
    }

    const db = await getDatabase();
    const metadata = (await db.get('syncMetadata', 'cursor')) as SyncMetadata | undefined;

    this.updateState({
      status: !this.state.isOnline ? 'Offline' : pendingCount > 0 ? 'Pending' : 'Idle',
      pendingCount,
      lastSuccessfulSyncAt: metadata?.lastSuccessfulSyncAt,
      businessName: config.businessName,
      deviceName: config.deviceName,
    });

    if (config.autoSync) {
      const intervalMs = Math.max(1, config.syncIntervalMinutes || 5) * 60 * 1000;
      this.syncIntervalTimer = setInterval(() => {
        this.triggerSync();
      }, intervalMs);
    }

    if (pendingCount > 0 && this.state.isOnline) {
      void this.triggerSync();
    }
  }

  /**
   * Device Enrollment Flow
   * Enrolls tablet to server and registers credentials in local syncConfig.
   */
  public async enrollDevice(params: {
    apiBaseUrl: string;
    registrationToken: string;
    businessName: string;
    deviceName: string;
    businessId?: string;
  }): Promise<SyncConfig> {
    const cleanUrl = params.apiBaseUrl.replace(/\/+$/, '');
    const response = await fetch(`${cleanUrl}/api/v1/devices/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Registration-Token': params.registrationToken,
      },
      body: JSON.stringify({
        businessId: params.businessId || '00000000-0000-0000-0000-000000000000',
        businessName: params.businessName.trim(),
        deviceName: params.deviceName.trim(),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Device registration failed (${response.status}): ${errorText || 'Unauthorized or invalid token'}`);
    }

    const data = (await response.json()) as {
      businessId: string;
      deviceId: string;
      deviceToken: string;
    };

    const config: SyncConfig = {
      id: 'current_config',
      apiBaseUrl: cleanUrl,
      deviceId: data.deviceId,
      deviceToken: data.deviceToken,
      businessId: data.businessId,
      businessName: params.businessName,
      deviceName: params.deviceName,
      autoSync: true,
      syncIntervalMinutes: 5,
      enrolledAt: new Date().toISOString(),
      lastSyncStatus: 'Idle',
    };

    await syncConfigRepository.saveConfig(config);
    await this.initialize();
    await this.triggerSync();
    return config;
  }

  public async disconnectDevice(): Promise<void> {
    await syncConfigRepository.clearConfig();
    this.updateState({
      status: 'Not configured',
      businessName: undefined,
      deviceName: undefined,
      lastError: undefined,
    });
  }

  /**
   * Trigger foreground or background sync cycle.
   * Safe against concurrent calls (queues single execution).
   */
  public async triggerSync(): Promise<boolean> {
    if (this.activeSyncPromise) {
      return this.activeSyncPromise;
    }

    this.activeSyncPromise = this.executeSyncCycle().finally(() => {
      this.activeSyncPromise = null;
    });

    return this.activeSyncPromise;
  }

  private async executeSyncCycle(): Promise<boolean> {
    const config = await syncConfigRepository.getConfig();
    if (!config) {
      this.updateState({ status: 'Not configured' });
      return false;
    }

    if (!this.state.isOnline) {
      this.updateState({ status: 'Offline' });
      return false;
    }

    this.updateState({ status: 'Syncing', lastError: undefined });

    try {
      // Step 1: Push local pending outbox mutations to server
      const pendingOps = await syncOutboxRepository.getPendingOperations(100);
      if (pendingOps.length > 0) {
        await this.pushOutboxBatch(config, pendingOps);
      }

      // Step 2: Pull remote changes from server and apply atomically
      await this.pullRemoteChanges(config);

      // Step 3: Refresh pending count
      const remainingPending = await syncOutboxRepository.getPendingCount();
      const conflicts = await syncConflictRepository.getAll();

      const db = await getDatabase();
      const metadata = (await db.get('syncMetadata', 'cursor')) as SyncMetadata | undefined;

      this.consecutiveFailures = 0;
      this.updateState({
        status: conflicts.length > 0 ? 'Conflict' : remainingPending > 0 ? 'Pending' : 'Synced',
        pendingCount: remainingPending,
        lastSuccessfulSyncAt: metadata?.lastSuccessfulSyncAt || new Date().toISOString(),
      });
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.consecutiveFailures++;

      const isResync = message.includes('ResyncRequired') || message.includes('full synchronization reset');
      this.updateState({
        status: isResync ? 'ResyncRequired' : 'Error',
        lastError: message,
      });

      this.scheduleBackoffRetry();
      return false;
    }
  }

  private scheduleBackoffRetry() {
    if (this.scheduledRetryTimer) clearTimeout(this.scheduledRetryTimer);
    if (!this.state.isOnline) return;

    // Bounded exponential backoff with jitter: 2s, 4s, 8s, 16s... up to 60s
    const baseDelay = Math.min(60000, 2000 * Math.pow(2, Math.min(this.consecutiveFailures, 5)));
    const jitter = Math.floor(Math.random() * 1000);
    const delay = baseDelay + jitter;

    this.scheduledRetryTimer = setTimeout(() => {
      this.triggerSync();
    }, delay);
  }

  private async pushOutboxBatch(config: SyncConfig, operations: SyncOutboxRecord[]): Promise<void> {
    const payload = {
      deviceId: config.deviceId,
      operations: operations.map((op) => ({
        operationId: op.operationId,
        entityType: op.entityType,
        entityId: op.entityId,
        operation: op.operation,
        baseRevision: op.baseRevision,
        payload: op.payload,
      })),
    };

    const response = await fetch(`${config.apiBaseUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.deviceToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error('Device credential unauthorized or revoked by server.');
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Sync push rejected by server (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as { results: PushResult[] };
    if (!Array.isArray(data.results)) {
      throw new Error('Invalid server push response format.');
    }

    const db = await getDatabase();
    const tx = db.transaction(['syncOutbox', 'syncConflicts'], 'readwrite');
    const outboxStore = tx.objectStore('syncOutbox');
    const conflictStore = tx.objectStore('syncConflicts');

    for (const res of data.results) {
      if (res.status === 'accepted' || res.status === 'already_applied') {
        await outboxStore.delete(res.operationId);
      } else if (res.status === 'conflict') {
        const orig = operations.find((o) => o.operationId === res.operationId);
        if (orig) {
          const conflictRecord: SyncConflictRecord = {
            operationId: orig.operationId,
            entityType: orig.entityType,
            entityId: orig.entityId,
            operation: orig.operation,
            localPayload: orig.payload,
            serverRevision: res.revision,
            message: res.message || 'Conflict detected: modified on another tablet.',
            occurredAt: new Date().toISOString(),
            resolved: false,
          };
          await conflictStore.put(conflictRecord);
          await outboxStore.delete(orig.operationId);
        }
      } else {
        const orig = operations.find((o) => o.operationId === res.operationId);
        if (orig) {
          orig.attempts = (orig.attempts || 0) + 1;
          orig.lastError = res.message || res.errorCode || 'Server rejected operation';
          orig.status = 'failed';
          await outboxStore.put(orig);
        }
      }
    }

    await tx.done;
  }

  private async pullRemoteChanges(config: SyncConfig): Promise<void> {
    const db = await getDatabase();
    const metadata = (await db.get('syncMetadata', 'cursor')) as SyncMetadata | undefined;

    const params = new URLSearchParams({
      limit: '100',
    });
    if (metadata?.cursor) {
      params.set('cursor', metadata.cursor);
    }

    const response = await fetch(`${config.apiBaseUrl}/api/v1/sync/changes?${params}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.deviceToken}`,
        'X-Device-Id': config.deviceId,
      },
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error('Device credential unauthorized or revoked by server.');
    }

    if (!response.ok) {
      throw new Error(`Sync pull failed with HTTP ${response.status}.`);
    }

    const data = (await response.json()) as ChangesResponse;
    if (data.resyncRequired) {
      // Trigger safe full snapshot recovery
      await this.recoverFromSnapshot(config);
      return;
    }

    if (!Array.isArray(data.changes)) {
      throw new Error('Invalid changes feed response.');
    }

    if (data.changes.length === 0 && data.nextCursor) {
      const updatedMeta: SyncMetadata = {
        id: 'cursor',
        cursor: data.nextCursor,
        lastSuccessfulSyncAt: new Date().toISOString(),
      };
      await db.put('syncMetadata', updatedMeta);
      return;
    }

    // CRITICAL: Apply changes, tombstones, and cursor in ONE single atomic IndexedDB transaction
    await this.applyChangesAtomically(data.changes, data.nextCursor);
  }

  /**
   * Applies pulled changes, tombstones, and cursor advancement in ONE atomic transaction.
   * If any record application fails, the entire transaction rolls back and cursor does NOT advance.
   */
  public async applyChangesAtomically(changes: ChangeFeedItem[], nextCursor: string | null): Promise<void> {
    const db = await getDatabase();
    const targetStores = [
      'clients',
      'quotations',
      'quotationRevisions',
      'invoices',
      'payments',
      'projects',
      'attachments',
      'settings',
      'syncMetadata',
    ];

    const tx = db.transaction(targetStores, 'readwrite');

    for (const change of changes) {
      const storeName = this.mapEntityTypeToStoreName(change.entityType);
      if (!storeName || !db.objectStoreNames.contains(storeName)) {
        continue;
      }

      const store = tx.objectStore(storeName);

      if (change.operation === 'delete') {
        await store.delete(change.entityId);
      } else if (change.operation === 'upsert' && change.payload) {
        // Enforce required primary key on payload
        const entityPayload = {
          ...change.payload,
          id: change.entityId,
        };
        await store.put(entityPayload);
      }
    }

    // Persist new cursor inside the same transaction
    if (nextCursor) {
      const updatedMeta: SyncMetadata = {
        id: 'cursor',
        cursor: nextCursor,
        lastSuccessfulSyncAt: new Date().toISOString(),
      };
      await tx.objectStore('syncMetadata').put(updatedMeta);
    }

    // Atomic commit
    await tx.done;
  }

  /**
   * Safe Full Snapshot Recovery
   * Pulls authoritative server snapshot when a cursor expires past retention,
   * while PRESERVING local pending outbox edits!
   */
  public async recoverFromSnapshot(config: SyncConfig): Promise<void> {
    const response = await fetch(`${config.apiBaseUrl}/api/v1/sync/snapshot`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.deviceToken}`,
        'X-Device-Id': config.deviceId,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download full server snapshot (${response.status})`);
    }

    const snapshot = (await response.json()) as SnapshotResponse;
    const db = await getDatabase();

    // Preserve local outbox items
    const pendingOutbox = await syncOutboxRepository.getPendingOperations();

    const targetStores = [
      'clients',
      'quotations',
      'quotationRevisions',
      'invoices',
      'payments',
      'projects',
      'syncMetadata',
    ];

    const tx = db.transaction(targetStores, 'readwrite');

    // Apply snapshot entities
    for (const item of snapshot.entities || []) {
      const storeName = this.mapEntityTypeToStoreName(item.entityType);
      if (storeName && db.objectStoreNames.contains(storeName)) {
        const payload = { ...item.payload, id: item.entityId };
        await tx.objectStore(storeName).put(payload);
      }
    }

    // Set cursor to snapshot cursor
    const meta: SyncMetadata = {
      id: 'cursor',
      cursor: snapshot.snapshotCursor,
      lastSuccessfulSyncAt: new Date().toISOString(),
      resyncRequired: false,
    };
    await tx.objectStore('syncMetadata').put(meta);
    await tx.done;

    // After snapshot is committed, re-push pending local operations
    if (pendingOutbox.length > 0) {
      await this.pushOutboxBatch(config, pendingOutbox);
    }
  }

  private mapEntityTypeToStoreName(entityType: string): string | null {
    switch (entityType) {
      case 'Client':
        return 'clients';
      case 'Quotation':
        return 'quotations';
      case 'QuotationRevision':
        return 'quotationRevisions';
      case 'Invoice':
        return 'invoices';
      case 'Payment':
        return 'payments';
      case 'Project':
        return 'projects';
      case 'Attachment':
        return 'attachments';
      case 'Settings':
        return 'settings';
      default:
        return null;
    }
  }
}

export const syncCoordinator = new SyncCoordinator();
