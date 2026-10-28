/**
 * SentinelOps - Direct-to-Cloudflare R2 Upload Service (Free-Plan Plain R2 Architecture)
 *
 * Implements Sections 2, 4, 7 & 7A:
 * - Server-issued SigV4 presigned PUT URLs for direct browser-to-R2 upload (Option A)
 * - Plain R2 private bucket with zero paid-plan dependencies (no Containers, no Sandbox)
 * - Folder naming: {ProjectName}_{StartDate} (immutable per project)
 * - File naming: {N}.{ext} (incrementing integer sequence starting from 1)
 * - Full object key: [{scope}/]{ProjectFolder}/{N}.{ext}
 * - Client-side image compression (max 1600px, 0.8 quality) to preserve 10 GB free tier
 * - Free-tier guardrails (max 10MB per file, max 50 images per project, 8 GB soft budget cap)
 * - Atomic persistence in IndexedDB + syncOutbox (omitting binary blobs in sync payloads)
 */

import { AttachmentRecord, Project } from '../types';
import { syncConfigRepository, attachmentRepository } from '../storage/repositories';
import {
  buildProjectFolderName,
  buildNumberedImageFileName,
  buildProjectImageName,
  getNextSequenceNumber,
} from '../features/projects/projectImageNaming';
import { generateUUID } from './security';

export type R2UploadState =
  | 'selected'
  | 'compressing'
  | 'validating'
  | 'requesting authorization'
  | 'uploading'
  | 'uploaded'
  | 'finalizing'
  | 'failed';

export interface R2UploadItem {
  id: string; // client-side item ID / stable attachmentId
  file: File;
  sequenceNumber: number;
  displayName: string;
  folderName: string;
  state: R2UploadState;
  progressPercent: number;
  error?: string;
  attachmentRecord?: AttachmentRecord;
  objectKey?: string;
  r2Bucket?: string;
  presignedPutUrl?: string;
}

export interface PresignedUrlResponse {
  uploadUrl: string;
  objectKey: string;
  attachmentId: string;
  sequenceNumber: number;
  fileType: string;
  fileSize: number;
  expiresInSeconds: number;
  bucket?: string;
  folderName?: string;
}

export interface UploadBatchResponse {
  presignedUrls: PresignedUrlResponse[];
}

export interface FinalizeResponse {
  status: string;
  attachmentId: string;
  objectKey: string;
  etag?: string;
  fileSize: number;
  completedAtUtc: string;
}

export interface DownloadUrlResponse {
  downloadUrl: string;
  objectKey: string;
  expiresInSeconds: number;
  derivedFileName?: string;
}

// Free-Tier Guardrails
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB limit before compression
export const MAX_IMAGES_PER_PROJECT = 50; // Guardrail to stay inside 10 GB free tier
export const STORAGE_SOFT_CAP_BYTES = 8 * 1024 * 1024 * 1024; // 8 GB soft cap
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

/**
 * Validates file before upload begins (MIME type, size, non-empty)
 */
export function validateImageFile(file: File): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: 'File is missing or empty.' };
  }
  if (file.size === 0) {
    return { valid: false, error: 'Empty file (0 bytes) cannot be uploaded.' };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: 'File size exceeds 10 MB free-tier limit.' };
  }
  const mime = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  const hasValidExt =
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.png') ||
    name.endsWith('.webp');
  if (!ALLOWED_MIME_TYPES.includes(mime) && !hasValidExt) {
    return { valid: false, error: 'Invalid format. Only JPEG, PNG, and WebP images are allowed.' };
  }
  return { valid: true };
}

/**
 * Compresses and resizes an image file on the client prior to upload.
 * Reduces raw 5-15MB camera photos to ~300-800KB, preserving the 10 GB free R2 storage limit.
 */
export async function compressImage(
  file: File,
  maxDimension = 1600,
  quality = 0.8
): Promise<File> {
  // If not in a browser environment or not an image, return file directly
  if (typeof window === 'undefined' || typeof document === 'undefined' || !file.type.startsWith('image/')) {
    return file;
  }

  // WebP/PNG/JPEG compression via canvas
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let width = img.width;
      let height = img.height;

      // Downscale proportionally if largest side exceeds maxDimension
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        resolve(file);
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const compressed = new File([blob], file.name, {
            type: outputType,
            lastModified: Date.now(),
          });
          resolve(compressed);
        },
        outputType,
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });
}

/**
 * Prepares upload items with pre-allocated sequence numbers and folder names in selection order
 */
export function prepareR2UploadItems(
  files: File[],
  project: Project,
  existingAttachments: Array<{ sequenceNumber?: number | null; r2FolderName?: string }>
): R2UploadItem[] {
  // Free-tier guard: verify project does not exceed maximum image count
  if (existingAttachments.length + files.length > MAX_IMAGES_PER_PROJECT) {
    throw new Error(
      `Project image limit reached (${existingAttachments.length} existing). Free tier allows up to ${MAX_IMAGES_PER_PROJECT} images per project.`
    );
  }

  // Folder immutability: reuse existing folder if already assigned to this project's attachments
  const existingFolder = existingAttachments.find((a) => Boolean(a.r2FolderName))?.r2FolderName;
  const folderName = existingFolder || buildProjectFolderName(project.name, project.startDate);

  let nextSeq = getNextSequenceNumber(existingAttachments);

  return files.map((file) => {
    const seq = nextSeq++;
    // Human-readable display label: {ProjectName}_{StartDate}_{Sequence}.{ext}
    const displayName = buildProjectImageName(
      project.name,
      project.startDate,
      seq,
      file.type || file.name
    );

    return {
      id: generateUUID(),
      file,
      sequenceNumber: seq,
      displayName,
      folderName,
      state: 'selected',
      progressPercent: 0,
    };
  });
}

/**
 * Executes a single file upload to Cloudflare R2 via presigned PUT URL
 */
export async function uploadSingleFileToR2(
  item: R2UploadItem,
  project: Project,
  onProgress?: (item: R2UploadItem) => void
): Promise<R2UploadItem> {
  const currentItem = { ...item };

  // 1. Client-side Validation
  currentItem.state = 'validating';
  onProgress?.(currentItem);

  const validation = validateImageFile(currentItem.file);
  if (!validation.valid) {
    currentItem.state = 'failed';
    currentItem.error = validation.error;
    onProgress?.(currentItem);
    return currentItem;
  }

  // 2. Client-side compression to protect the 10 GB free tier
  currentItem.state = 'compressing';
  currentItem.progressPercent = 5;
  onProgress?.(currentItem);

  let uploadFile = currentItem.file;
  try {
    uploadFile = await compressImage(currentItem.file, 1600, 0.8);
  } catch {
    // If compression fails, proceed with original file
  }

  // 3. Request presigned PUT URL from SentinelOps API
  currentItem.state = 'requesting authorization';
  currentItem.progressPercent = 15;
  onProgress?.(currentItem);

  const config = await syncConfigRepository.getConfig();
  const apiBaseUrl = config?.apiBaseUrl || (import.meta as any)?.env?.VITE_API_BASE_URL || '';
  if (!apiBaseUrl) {
    currentItem.state = 'failed';
    currentItem.error = 'API base URL is not configured. Please enroll device in Settings.';
    onProgress?.(currentItem);
    return currentItem;
  }

  const cleanBaseUrl = apiBaseUrl.replace(/\/+$/, '');
  const cleanProjectId = encodeURIComponent(project.id);
  const uploadUrlEndpoint = `${cleanBaseUrl}/api/v1/projects/${cleanProjectId}/images/upload-urls`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config?.deviceToken) {
    headers['Authorization'] = `Bearer ${config.deviceToken}`;
    headers['X-Device-Id'] = config.deviceId;
  }

  const targetMimeType = uploadFile.type || 'image/jpeg';
  let presignedInfo: PresignedUrlResponse;

  try {
    const res = await fetch(uploadUrlEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        files: [
          {
            fileName: currentItem.file.name,
            fileType: targetMimeType,
            fileSize: uploadFile.size,
            attachmentId: currentItem.id,
            sequenceNumber: currentItem.sequenceNumber,
            folderName: currentItem.folderName,
          },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      let parsedMsg = '';
      try {
        const json = JSON.parse(errText);
        parsedMsg = json.detail || json.title || errText;
      } catch {
        parsedMsg = errText;
      }
      throw new Error(parsedMsg || `Upload authorization failed with HTTP ${res.status}.`);
    }

    const batchData = (await res.json()) as UploadBatchResponse;
    if (!batchData.presignedUrls || batchData.presignedUrls.length === 0) {
      throw new Error('No presigned URL returned by SentinelOps API.');
    }
    presignedInfo = batchData.presignedUrls[0];
    currentItem.objectKey = presignedInfo.objectKey;
    currentItem.r2Bucket = presignedInfo.bucket;
    currentItem.presignedPutUrl = presignedInfo.uploadUrl;
  } catch (err: unknown) {
    currentItem.state = 'failed';
    currentItem.error = err instanceof Error ? err.message : 'Failed to obtain upload authorization.';
    onProgress?.(currentItem);
    return currentItem;
  }

  // 4. Direct HTTP PUT upload to Cloudflare R2 with raw binary payload & signed Content-Type
  currentItem.state = 'uploading';
  currentItem.progressPercent = 25;
  onProgress?.(currentItem);

  try {
    await executeR2Put(presignedInfo.uploadUrl, uploadFile, targetMimeType, (pct) => {
      // Map 0-100% upload progress to 25-85% overall progress
      currentItem.progressPercent = Math.min(85, Math.max(25, Math.round(25 + pct * 0.6)));
      onProgress?.(currentItem);
    });
  } catch (err: unknown) {
    currentItem.state = 'failed';
    currentItem.error =
      err instanceof Error
        ? err.message
        : 'Direct PUT upload to Cloudflare R2 failed or presigned URL expired.';
    onProgress?.(currentItem);
    return currentItem;
  }

  // 5. Server-side finalization & verification
  currentItem.state = 'finalizing';
  currentItem.progressPercent = 88;
  onProgress?.(currentItem);

  let finalizeResult: FinalizeResponse | null = null;
  try {
    const completeUrl = `${cleanBaseUrl}/api/v1/projects/${cleanProjectId}/images/complete`;
    const compRes = await fetch(completeUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        attachmentId: presignedInfo.attachmentId || currentItem.id,
        objectKey: presignedInfo.objectKey,
        fileType: targetMimeType,
        fileSize: uploadFile.size,
        sequenceNumber: currentItem.sequenceNumber,
        derivedFileName: currentItem.displayName,
      }),
    });

    if (compRes.ok) {
      finalizeResult = (await compRes.json()) as FinalizeResponse;
    }
  } catch {
    // If complete call times out, proceed to store metadata locally so user work is not lost
  }

  // 6. Durably persist metadata in local IndexedDB + syncOutbox
  try {
    // Numbered filename: {Sequence}.{ext} (e.g. 1.jpg)
    const numberedName = buildNumberedImageFileName(
      currentItem.sequenceNumber,
      uploadFile.type || uploadFile.name
    );

    const attachmentRecord: AttachmentRecord = {
      id: presignedInfo.attachmentId || currentItem.id,
      entityType: 'Project',
      entityId: project.id,
      fileName: numberedName,
      fileType: targetMimeType,
      fileSize: uploadFile.size,
      caption: currentItem.displayName,
      uploadedAt: new Date().toISOString(),
      sequenceNumber: currentItem.sequenceNumber,
      r2ObjectKey: presignedInfo.objectKey,
      r2Bucket: presignedInfo.bucket,
      r2FolderName: currentItem.folderName,
      etag: finalizeResult?.etag,
      storageProvider: 'cloudflare-r2',
      // Cache compressed blob locally for immediate offline previews
      blob: uploadFile,
    };

    const saved = await attachmentRepository.saveAttachment(attachmentRecord, 'Admin');
    currentItem.attachmentRecord = saved;
    currentItem.progressPercent = 100;
    currentItem.state = 'uploaded';
    onProgress?.(currentItem);
    return currentItem;
  } catch (err: unknown) {
    currentItem.state = 'failed';
    currentItem.error = err instanceof Error ? err.message : 'Failed to save attachment metadata locally.';
    onProgress?.(currentItem);
    return currentItem;
  }
}

/**
 * Direct HTTP PUT to Cloudflare R2 using XMLHttpRequest for reliable upload progress
 */
function executeR2Put(
  presignedUrl: string,
  file: File,
  contentType: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presignedUrl, true);

    // Exact signed Content-Type header is required for AWS SigV4
    xhr.setRequestHeader('Content-Type', contentType);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    };

    xhr.onload = () => {
      // S3 / R2 returns 200 OK or 204 No Content on successful PUT
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        // Expired presigned URLs return 403 ExpiredRequest
        if (xhr.status === 403) {
          reject(new Error('Presigned upload URL expired or signature mismatch. Retry to obtain a fresh URL.'));
        } else {
          reject(new Error(`Cloudflare R2 responded with HTTP status ${xhr.status}.`));
        }
      }
    };

    xhr.onerror = () => {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'current origin';
      reject(
        new Error(
          `Network error during direct PUT to Cloudflare R2. Cloudflare blocked the upload due to bucket CORS policy. Ensure '${origin}' or '*' is added to your R2 bucket CORS AllowedOrigins.`
        )
      );
    };

    xhr.ontimeout = () => {
      reject(new Error('Timeout during direct PUT to Cloudflare R2.'));
    };

    xhr.send(file);
  });
}

/**
 * Retrieves a fresh, short-lived presigned GET URL for viewing private R2 images
 */
export async function requestPresignedDownloadUrl(
  projectId: string,
  attachmentId: string,
  derivedFileName?: string,
  objectKey?: string
): Promise<string | null> {
  try {
    const config = await syncConfigRepository.getConfig();
    const apiBaseUrl = config?.apiBaseUrl || (import.meta as any)?.env?.VITE_API_BASE_URL || '';
    if (!apiBaseUrl) return null;

    const cleanBaseUrl = apiBaseUrl.replace(/\/+$/, '');
    const cleanProjectId = encodeURIComponent(projectId);
    const cleanAttId = encodeURIComponent(attachmentId);

    let url = `${cleanBaseUrl}/api/v1/projects/${cleanProjectId}/images/${cleanAttId}/download-url`;
    const params = new URLSearchParams();
    if (derivedFileName) {
      params.append('fileName', derivedFileName);
    }
    if (objectKey) {
      params.append('key', objectKey);
    }
    const qs = params.toString();
    if (qs) {
      url += `?${qs}`;
    }

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (config?.deviceToken) {
      headers['Authorization'] = `Bearer ${config.deviceToken}`;
      headers['X-Device-Id'] = config.deviceId;
    }

    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) return null;

    const data = (await res.json()) as DownloadUrlResponse;
    return data.downloadUrl || null;
  } catch {
    return null;
  }
}
