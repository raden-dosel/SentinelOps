import { getDatabase, SyncMetadata, SyncOutboxRecord } from '../storage/database';
import { generateUUID } from './security';

export interface PushResult {
  operationId: string;
  status: 'accepted' | 'already_applied' | 'rejected' | 'unauthorized' | 'conflict';
  revision?: string;
  errorCode?: string;
  message?: string;
}

interface ChangesResponse {
  changes: Array<{
    sequence: number;
    entityType: string;
    entityId: string;
    operation: 'upsert' | 'delete';
    revision: string;
    payload: unknown;
  }>;
  nextCursor: string | null;
  resyncRequired: boolean;
}

const MAX_BATCH_SIZE = 100;

export async function enqueueSyncOperation(
  operation: Omit<SyncOutboxRecord, 'operationId' | 'createdAt' | 'attempts'>
): Promise<SyncOutboxRecord> {
  const record: SyncOutboxRecord = {
    ...operation,
    operationId: generateUUID(),
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  const db = await getDatabase();
  await db.put('syncOutbox', record);
  return record;
}

export async function getPendingSyncOperations(): Promise<SyncOutboxRecord[]> {
  const db = await getDatabase();
  return (await db.getAllFromIndex('syncOutbox', 'createdAt')) as SyncOutboxRecord[];
}

export async function pushSyncOperations(
  apiBaseUrl: string,
  deviceId: string,
  token: string
): Promise<PushResult[]> {
  const db = await getDatabase();
  const operations = (await db.getAllFromIndex('syncOutbox', 'createdAt')).slice(0, MAX_BATCH_SIZE) as SyncOutboxRecord[];
  if (operations.length === 0) return [];

  const response = await fetch(`${apiBaseUrl}/api/v1/sync/push`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, operations }),
  });
  if (!response.ok) throw new Error(`Sync push failed with HTTP ${response.status}.`);

  const results = (await response.json() as { results: PushResult[] }).results;
  if (!Array.isArray(results) || results.some((item) => typeof item.operationId !== 'string')) {
    throw new Error('Sync push returned an invalid response.');
  }
  const tx = db.transaction(['syncOutbox', 'syncConflicts'], 'readwrite');
  for (const result of results) {
    if (result.status === 'accepted' || result.status === 'already_applied') {
      await tx.objectStore('syncOutbox').delete(result.operationId);
    } else if (result.status === 'conflict') {
      const operation = operations.find((item) => item.operationId === result.operationId);
      if (operation) {
        await tx.objectStore('syncConflicts').put({ ...operation, serverRevision: result.revision, message: result.message });
      }
    } else {
      const operation = operations.find((item) => item.operationId === result.operationId);
      if (operation) await tx.objectStore('syncOutbox').put({ ...operation, attempts: operation.attempts + 1, lastError: result.message });
    }
  }
  await tx.done;
  return results;
}

export async function pullSyncChanges(
  apiBaseUrl: string,
  deviceId: string,
  token: string,
  apply: (changes: ChangesResponse['changes']) => Promise<void>
): Promise<ChangesResponse> {
  const db = await getDatabase();
  const metadata = await db.get('syncMetadata', 'cursor') as SyncMetadata | undefined;
  const params = new URLSearchParams({ deviceId, limit: String(MAX_BATCH_SIZE) });
  if (metadata?.cursor) params.set('cursor', metadata.cursor);
  const response = await fetch(`${apiBaseUrl}/api/v1/sync/changes?${params}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Device-Id': deviceId },
  });
  if (!response.ok) throw new Error(`Sync pull failed with HTTP ${response.status}.`);
  const result = await response.json() as ChangesResponse;
  if (!Array.isArray(result.changes) || typeof result.nextCursor !== 'string' ||
      typeof result.resyncRequired !== 'boolean') {
    throw new Error('Sync pull returned an invalid response.');
  }
  if (result.resyncRequired) {
    throw new Error('A full synchronization reset is required before applying changes.');
  }
  await apply(result.changes);
  const updated: SyncMetadata = {
    id: 'cursor',
    cursor: result.nextCursor,
    lastSuccessfulSyncAt: new Date().toISOString(),
  };
  await db.put('syncMetadata', updated);
  return result;
}
