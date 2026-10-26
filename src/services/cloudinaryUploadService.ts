/**
 * SentinelOps - Direct-to-Cloudinary Upload Service
 *
 * Implements Section 6 & 7:
 * - Server-signed, direct-to-Cloudinary image upload
 * - Zero API secret exposure to client
 * - Per-file lifecycle and progress tracking
 * - Pre-allocated, immutable sequence numbers
 * - Atomic persistence in IndexedDB + syncOutbox
 */

import { AttachmentRecord, Project } from '../types';
import { syncConfigRepository, attachmentRepository } from '../storage/repositories';
import { buildProjectImageName, getNextSequenceNumber } from '../features/projects/projectImageNaming';
import { generateUUID } from './security';

export type FileUploadState =
  | 'selected'
  | 'validating'
  | 'requesting authorization'
  | 'uploading'
  | 'uploaded'
  | 'finalizing'
  | 'failed';

export interface FileUploadItem {
  id: string; // client-side item ID
  file: File;
  sequenceNumber: number;
  displayName: string;
  state: FileUploadState;
  progressPercent: number;
  error?: string;
  attachmentRecord?: AttachmentRecord;
  cloudinaryPublicId?: string;
  cloudinaryUrl?: string;
}

export interface SignatureResponse {
  cloudName: string;
  apiKey: string;
  publicId: string;
  folder: string;
  timestamp: number;
  signature: string;
  uploadUrl: string;
  attachmentId: string;
}

export interface CloudinaryDirectResponse {
  asset_id: string;
  public_id: string;
  version: number;
  format: string;
  resource_type: string;
  created_at: string;
  bytes: number;
  secure_url: string;
  url?: string;
}

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

/**
 * Validates file before upload begins
 */
export function validateImageFile(file: File): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: 'File is missing or empty.' };
  }
  if (file.size === 0) {
    return { valid: false, error: 'Empty file (0 bytes) cannot be uploaded.' };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: 'File size exceeds maximum 15 MB limit.' };
  }
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  const hasValidExt = name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.webp');
  if (!ALLOWED_MIME_TYPES.includes(mime) && !hasValidExt) {
    return { valid: false, error: 'Invalid format. Only JPEG, PNG, and WebP images are allowed.' };
  }
  return { valid: true };
}

/**
 * Prepares upload items with pre-allocated sequence numbers
 */
export function prepareUploadItems(
  files: File[],
  project: Project,
  existingAttachments: Array<{ sequenceNumber?: number | null }>
): FileUploadItem[] {
  let nextSeq = getNextSequenceNumber(existingAttachments);

  return files.map((file) => {
    const seq = nextSeq++;
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
      state: 'selected',
      progressPercent: 0,
    };
  });
}

/**
 * Executes a single file upload to Cloudinary with server signature
 */
export async function uploadSingleFileToCloudinary(
  item: FileUploadItem,
  project: Project,
  onProgress?: (item: FileUploadItem) => void
): Promise<FileUploadItem> {
  const currentItem = { ...item };

  // 1. Validation
  currentItem.state = 'validating';
  onProgress?.(currentItem);

  const validation = validateImageFile(currentItem.file);
  if (!validation.valid) {
    currentItem.state = 'failed';
    currentItem.error = validation.error;
    onProgress?.(currentItem);
    return currentItem;
  }

  // 2. Request upload signature from SentinelOps API
  currentItem.state = 'requesting authorization';
  currentItem.progressPercent = 10;
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
  const sigUrl = `${cleanBaseUrl}/api/v1/projects/${cleanProjectId}/images/upload-signature`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config?.deviceToken) {
    headers['Authorization'] = `Bearer ${config.deviceToken}`;
    headers['X-Device-Id'] = config.deviceId;
  }

  let signatureData: SignatureResponse;
  try {
    const sigRes = await fetch(sigUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        fileName: currentItem.file.name,
        fileType: currentItem.file.type || 'image/jpeg',
        fileSize: currentItem.file.size,
        attachmentId: currentItem.id,
        sequenceNumber: currentItem.sequenceNumber,
      }),
    });

    if (!sigRes.ok) {
      const errText = await sigRes.text();
      let parsedMsg = '';
      try {
        const json = JSON.parse(errText);
        parsedMsg = json.detail || json.title || errText;
      } catch {
        parsedMsg = errText;
      }
      throw new Error(parsedMsg || `Signature authorization failed with HTTP ${sigRes.status}.`);
    }

    signatureData = (await sigRes.json()) as SignatureResponse;
  } catch (err: unknown) {
    currentItem.state = 'failed';
    currentItem.error = err instanceof Error ? err.message : 'Failed to obtain upload authorization.';
    onProgress?.(currentItem);
    return currentItem;
  }

  // 3. Direct upload to Cloudinary
  currentItem.state = 'uploading';
  currentItem.progressPercent = 30;
  onProgress?.(currentItem);

  const formData = new FormData();
  formData.append('file', currentItem.file);
  formData.append('api_key', signatureData.apiKey);
  formData.append('timestamp', String(signatureData.timestamp));
  formData.append('signature', signatureData.signature);
  formData.append('public_id', signatureData.publicId);
  formData.append('folder', signatureData.folder);

  let cloudinaryResult: CloudinaryDirectResponse;
  try {
    const uploadRes = await fetch(signatureData.uploadUrl, {
      method: 'POST',
      body: formData,
    });

    if (!uploadRes.ok) {
      const errJson = await uploadRes.json().catch(() => null);
      const msg = errJson?.error?.message || `Cloudinary upload failed with HTTP ${uploadRes.status}.`;
      throw new Error(msg);
    }

    cloudinaryResult = (await uploadRes.json()) as CloudinaryDirectResponse;
    currentItem.progressPercent = 85;
    currentItem.cloudinaryPublicId = cloudinaryResult.public_id;
    currentItem.cloudinaryUrl = cloudinaryResult.secure_url;
    currentItem.state = 'finalizing';
    onProgress?.(currentItem);
  } catch (err: unknown) {
    currentItem.state = 'failed';
    currentItem.error = err instanceof Error ? err.message : 'Direct upload to Cloudinary failed.';
    onProgress?.(currentItem);
    return currentItem;
  }

  // 4. Durably persist metadata to local IndexedDB and syncOutbox
  try {
    const derivedFileName = buildProjectImageName(
      project.name,
      project.startDate,
      currentItem.sequenceNumber,
      cloudinaryResult.format || currentItem.file.type
    );

    const attachmentRecord: AttachmentRecord = {
      id: signatureData.attachmentId || currentItem.id,
      entityType: 'Project',
      entityId: project.id,
      fileName: derivedFileName,
      fileType: currentItem.file.type || `image/${cloudinaryResult.format || 'jpeg'}`,
      fileSize: cloudinaryResult.bytes || currentItem.file.size,
      caption: derivedFileName,
      uploadedAt: new Date().toISOString(),
      sequenceNumber: currentItem.sequenceNumber,
      cloudinaryPublicId: cloudinaryResult.public_id,
      cloudinaryUrl: cloudinaryResult.secure_url,
      storageProvider: 'cloudinary',
      // Store blob locally as well for offline preview cache
      blob: currentItem.file,
    };

    const saved = await attachmentRepository.saveAttachment(attachmentRecord, 'Admin');
    currentItem.attachmentRecord = saved;
    currentItem.progressPercent = 100;
    currentItem.state = 'uploaded';
    onProgress?.(currentItem);

    // 5. Fire-and-forget optional server completion notification
    try {
      const compUrl = `${cleanBaseUrl}/api/v1/projects/${cleanProjectId}/images/complete`;
      void fetch(compUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          attachmentId: saved.id,
          publicId: cloudinaryResult.public_id,
          secureUrl: cloudinaryResult.secure_url,
          fileSize: saved.fileSize,
          fileType: saved.fileType,
          sequenceNumber: currentItem.sequenceNumber,
          derivedFileName: saved.fileName,
        }),
      }).catch(() => {
        // Non-blocking completion notice
      });
    } catch {
      // Non-blocking
    }

    return currentItem;
  } catch (err: unknown) {
    currentItem.state = 'failed';
    currentItem.error = err instanceof Error ? err.message : 'Failed to save attachment metadata locally.';
    onProgress?.(currentItem);
    return currentItem;
  }
}
