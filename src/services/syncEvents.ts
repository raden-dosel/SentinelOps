export const SYNC_NEEDED_EVENT = 'sentinelops:sync-needed';

export function requestSync(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SYNC_NEEDED_EVENT));
  }
}