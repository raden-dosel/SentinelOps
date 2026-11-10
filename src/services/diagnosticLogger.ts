/**
 * SentinelOps - Privacy-Safe Diagnostic Logger
 * Implements Section 10 of the Cross-Device R2 Upload specification.
 *
 * Distinguishes:
 * 1. Connectivity check started
 * 2. API health check succeeded or failed
 * 3. Device enrollment state checked
 * 4. Device authorization validated or rejected
 * 5. Presigned URL request started / succeeded / failed
 * 6. R2 upload started / succeeded / failed
 * 7. Image metadata persistence succeeded / failed
 *
 * SECURITY GUARANTEES:
 * - Never logs device tokens, passwords, JWTs, or R2 secret keys
 * - Never logs full presigned URLs (only sanitized host and bucket)
 * - Never logs customer PII or raw image content
 */

export interface LogEntry {
  timestamp: string;
  category: 'CONNECTIVITY' | 'AUTH' | 'PRESIGNED_URL' | 'R2_STORAGE' | 'METADATA';
  level: 'info' | 'warn' | 'error';
  message: string;
  correlationId?: string;
  details?: Record<string, unknown>;
}

class DiagnosticLogger {
  private inMemoryLogs: LogEntry[] = [];
  private maxLogs = 200;

  private record(entry: Omit<LogEntry, 'timestamp'>) {
    const fullEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    this.inMemoryLogs.push(fullEntry);
    if (this.inMemoryLogs.length > this.maxLogs) {
      this.inMemoryLogs.shift();
    }

    const prefix = `[SentinelOps ${entry.category}]`;
    const corr = entry.correlationId ? ` (corr:${entry.correlationId})` : '';

    if (entry.level === 'error') {
      console.error(`${prefix}${corr} ${entry.message}`, entry.details || '');
    } else if (entry.level === 'warn') {
      console.warn(`${prefix}${corr} ${entry.message}`, entry.details || '');
    } else {
      console.info(`${prefix}${corr} ${entry.message}`, entry.details || '');
    }
  }

  // 1. Connectivity check started
  public logConnectivityStart(apiBaseUrl: string | null, isOnline: boolean) {
    this.record({
      category: 'CONNECTIVITY',
      level: 'info',
      message: 'Network reachability check started',
      details: {
        isOnline,
        hasConfiguredEndpoint: Boolean(apiBaseUrl),
      },
    });
  }

  // 2. API health check succeeded or failed
  public logHealthCheck(details: { url: string; success: boolean; status?: number; error?: string }) {
    this.record({
      category: 'CONNECTIVITY',
      level: details.success ? 'info' : 'warn',
      message: details.success
        ? 'API health probe succeeded (/api/v1/health/live)'
        : 'API health probe failed',
      details: {
        endpoint: details.url,
        httpStatus: details.status,
        error: details.error,
      },
    });
  }

  // 3. Device enrollment state checked
  public logEnrollmentState(isEnrolled: boolean, deviceId?: string | null) {
    this.record({
      category: 'AUTH',
      level: isEnrolled ? 'info' : 'warn',
      message: isEnrolled
        ? `Device enrollment confirmed (DeviceId: ${deviceId || 'assigned'})`
        : 'Device enrollment not found in local IndexedDB',
      details: {
        isEnrolled,
        hasDeviceId: Boolean(deviceId),
      },
    });
  }

  // 4. Device authorization validated or rejected
  public logDeviceAuth(details: {
    deviceId?: string | null;
    authorized: boolean;
    httpStatus?: number;
    error?: string;
  }) {
    this.record({
      category: 'AUTH',
      level: details.authorized ? 'info' : 'error',
      message: details.authorized
        ? 'Device credentials successfully validated against backend'
        : 'Device authorization rejected by backend',
      details: {
        hasDeviceId: Boolean(details.deviceId),
        httpStatus: details.httpStatus,
        error: details.error,
      },
    });
  }

  // 5. Presigned URL request
  public logPresignedUrl(details: {
    stage: 'started' | 'succeeded' | 'failed';
    projectId: string;
    fileCount: number;
    correlationId?: string;
    error?: string;
  }) {
    this.record({
      category: 'PRESIGNED_URL',
      level: details.stage === 'failed' ? 'error' : 'info',
      correlationId: details.correlationId,
      message: `Presigned upload URL request ${details.stage}`,
      details: {
        projectId: details.projectId,
        fileCount: details.fileCount,
        error: details.error,
      },
    });
  }

  // 6. R2 direct upload
  public logR2Upload(details: {
    stage: 'started' | 'succeeded' | 'failed';
    sequenceNumber: number;
    fileType: string;
    fileSize: number;
    correlationId?: string;
    error?: string;
  }) {
    this.record({
      category: 'R2_STORAGE',
      level: details.stage === 'failed' ? 'error' : 'info',
      correlationId: details.correlationId,
      message: `Direct Cloudflare R2 PUT upload ${details.stage} (seq:${details.sequenceNumber})`,
      details: {
        fileType: details.fileType,
        fileSize: details.fileSize,
        error: details.error,
      },
    });
  }

  // 7. Metadata persistence
  public logMetadataPersistence(details: {
    stage: 'started' | 'succeeded' | 'failed';
    attachmentId: string;
    projectId: string;
    correlationId?: string;
    error?: string;
  }) {
    this.record({
      category: 'METADATA',
      level: details.stage === 'failed' ? 'error' : 'info',
      correlationId: details.correlationId,
      message: `Attachment metadata persistence ${details.stage}`,
      details: {
        attachmentId: details.attachmentId,
        projectId: details.projectId,
        error: details.error,
      },
    });
  }

  public getRecentLogs(): readonly LogEntry[] {
    return [...this.inMemoryLogs];
  }
}

export const diagnosticLogger = new DiagnosticLogger();
