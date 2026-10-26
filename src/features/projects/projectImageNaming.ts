/**
 * SentinelOps - Project Image Naming & Sequence Management (Section 7A)
 *
 * Implements deterministic naming format:
 * {ProjectName}_{StartDate}_{Sequence}.{ext}
 *
 * - ProjectName: sanitized, NFKC normalized, safe against path traversal and reserved device names
 * - StartDate: date-only YYYY-MM-DD (no UTC shift in UTC+8) or 'undated'
 * - Sequence: positive integer starting at 1 per project
 * - ext: derived from validated MIME type, not original filename
 */

import { AttachmentMetadata, Project } from '../../types';

const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

/**
 * Sanitizes project name for filename safety:
 * - Normalizes Unicode (NFKC)
 * - Trims whitespace and replaces whitespace runs with single hyphen
 * - Strips characters unsafe in filenames: / \ : * ? " < > | and control chars
 * - Trims leading/trailing dots and hyphens
 * - Collapses consecutive hyphens
 * - Caps project name segment at 60 characters
 * - Guards against reserved device names
 * - Falls back to 'Project' if empty
 */
export function sanitizeProjectName(rawName: string | undefined | null): string {
  if (!rawName) return 'Project';

  let sanitized = rawName.normalize('NFKC').trim();

  // Replace whitespace runs with single hyphen
  sanitized = sanitized.replace(/\s+/g, '-');

  // Remove unsafe filename characters: / \ : * ? " < > | and control characters (0x00-0x1F, 0x7F-0x9F)
  sanitized = sanitized.replace(/[\\/:*?"<>|\x00-\x1F\x7F-\x9F]/g, '');

  // Collapse consecutive hyphens/underscores
  sanitized = sanitized.replace(/-+/g, '-');

  // Strip leading/trailing dots and hyphens
  sanitized = sanitized.replace(/^[.-]+|[.-]+$/g, '');

  // Truncate to maximum 60 characters without cutting in middle of surrogate pair
  if (sanitized.length > 60) {
    sanitized = sanitized.slice(0, 60).replace(/[.-]+$/, '');
  }

  // Guard against Windows reserved device names (e.g. CON, PRN, AUX, NUL)
  const upper = sanitized.toUpperCase();
  if (WINDOWS_RESERVED_NAMES.has(upper) || sanitized.length === 0) {
    return 'Project';
  }

  return sanitized;
}

/**
 * Formats start date as date-only YYYY-MM-DD without UTC conversion.
 * Guards against the 1-day backward shift in UTC+8 (Philippines timezone).
 * If missing, invalid, or empty, returns 'undated'.
 */
export function formatProjectStartDate(rawDate: string | undefined | null): string {
  if (!rawDate || typeof rawDate !== 'string') return 'undated';

  const trimmed = rawDate.trim();

  // If already YYYY-MM-DD or starts with YYYY-MM-DD
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, year, month, day] = match;
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    const d = parseInt(day, 10);
    if (y >= 1970 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${year}-${month}-${day}`;
    }
  }

  return 'undated';
}

/**
 * Derives the validated file extension from MIME type or filename hint.
 * Approved types: JPEG (jpg), PNG (png), WebP (webp).
 */
export function getImageExtension(mimeTypeOrExt: string | undefined | null): string {
  if (!mimeTypeOrExt) return 'jpg';
  const val = mimeTypeOrExt.toLowerCase().trim();

  if (val.includes('png')) return 'png';
  if (val.includes('webp')) return 'webp';
  if (val.includes('jpeg') || val.includes('jpg')) return 'jpg';

  // Check extension at end of filename
  if (val.endsWith('.png')) return 'png';
  if (val.endsWith('.webp')) return 'webp';
  if (val.endsWith('.jpg') || val.endsWith('.jpeg')) return 'jpg';

  return 'jpg';
}

/**
 * Builds the canonical project image name according to Section 7A:
 * {ProjectName}_{StartDate}_{Sequence}.{ext}
 *
 * Example: Main-Lobby-CCTV_2026-10-26_1.jpg
 */
export function buildProjectImageName(
  projectName: string | undefined | null,
  startDate: string | undefined | null,
  sequenceNumber: number,
  mimeTypeOrExt: string
): string {
  const sanitizedName = sanitizeProjectName(projectName);
  const formattedDate = formatProjectStartDate(startDate);
  const seq = Math.max(1, Math.floor(sequenceNumber));
  const ext = getImageExtension(mimeTypeOrExt);

  return `${sanitizedName}_${formattedDate}_${seq}.${ext}`;
}

/**
 * Builds the canonical project folder name according to Section 7.1:
 * {ProjectName}_{StartDate}
 *
 * Example: Main-Lobby-CCTV_2026-10-26
 */
export function buildProjectFolderName(
  projectName: string | undefined | null,
  startDate: string | undefined | null
): string {
  const sanitizedName = sanitizeProjectName(projectName);
  const formattedDate = formatProjectStartDate(startDate);
  return `${sanitizedName}_${formattedDate}`;
}

/**
 * Builds the canonical incrementing file name according to Section 7.2:
 * {Sequence}.{ext}
 *
 * Example: 1.jpg, 2.png, 3.webp
 */
export function buildNumberedImageFileName(
  sequenceNumber: number,
  mimeTypeOrExt: string
): string {
  const seq = Math.max(1, Math.floor(sequenceNumber));
  const ext = getImageExtension(mimeTypeOrExt);
  return `${seq}.${ext}`;
}

/**
 * Builds the full R2 object key according to Section 7.2:
 * [{scope}/]{ProjectFolder}/{N}.{ext}
 *
 * Example: Main-Lobby-CCTV_2026-10-26/1.jpg
 * Or with scope: sentinelops/tenant1/Main-Lobby-CCTV_2026-10-26/1.jpg
 */
export function buildProjectObjectKey(
  folderName: string,
  sequenceNumber: number,
  mimeTypeOrExt: string,
  scope?: string | null
): string {
  const fileName = buildNumberedImageFileName(sequenceNumber, mimeTypeOrExt);
  const cleanFolder = (folderName || 'Project_undated').replace(/^[/\\]+|[/\\]+$/g, '');
  if (scope && scope.trim()) {
    const cleanScope = scope.trim().replace(/^[/\\]+|[/\\]+$/g, '');
    return `${cleanScope}/${cleanFolder}/${fileName}`;
  }
  return `${cleanFolder}/${fileName}`;
}

/**
 * Resolves folder collisions deterministically if two projects share the same name and start date.
 * If baseFolderName exists for another project, appends '_2', '_3', etc.
 */
export function resolveFolderCollision(
  baseFolderName: string,
  existingFolderNames: string[]
): string {
  const existingSet = new Set(existingFolderNames);
  if (!existingSet.has(baseFolderName)) {
    return baseFolderName;
  }
  let counter = 2;
  while (existingSet.has(`${baseFolderName}_${counter}`)) {
    counter++;
  }
  return `${baseFolderName}_${counter}`;
}

/**
 * Calculates next sequence number for a project based on existing attachments.
 * If no attachments have a sequence number, starts at 1.
 * Otherwise returns max(existing sequence numbers) + 1.
 */
export function getNextSequenceNumber(
  existingAttachments: Array<{ sequenceNumber?: number | null }>
): number {
  let maxSeq = 0;
  for (const att of existingAttachments) {
    if (typeof att.sequenceNumber === 'number' && att.sequenceNumber > maxSeq) {
      maxSeq = att.sequenceNumber;
    }
  }
  return maxSeq + 1;
}

/**
 * Derives the display/download filename for an attachment.
 * If attachment has a sequenceNumber and project is provided, derives the name dynamically
 * so that renaming the project or updating the start date automatically reflects in the name.
 * For legacy attachments without sequenceNumber, returns existing fileName.
 */
export function getAttachmentDisplayName(
  attachment: AttachmentMetadata,
  project?: Project | null
): string {
  if (typeof attachment.sequenceNumber === 'number' && attachment.sequenceNumber > 0 && project) {
    return buildProjectImageName(
      project.name,
      project.startDate,
      attachment.sequenceNumber,
      attachment.fileType
    );
  }
  return attachment.fileName;
}

/**
 * Deterministic multi-device sequence collision resolver:
 * When two or more attachments in the same project claim the same sequence number,
 * sorts by:
 * 1. uploadedAt ascending (earliest upload keeps the sequence)
 * 2. id ascending (lexicographical tie-breaker)
 *
 * Subsequent conflicting attachments are re-sequenced to the next available integers.
 * Neither attachment is ever deleted or dropped.
 */
export function resolveSequenceCollisions(attachments: AttachmentMetadata[]): AttachmentMetadata[] {
  if (!attachments || attachments.length === 0) return [];

  // Group by entityId (projectId)
  const byProject = new Map<string, AttachmentMetadata[]>();
  for (const att of attachments) {
    const list = byProject.get(att.entityId) || [];
    list.push(att);
    byProject.set(att.entityId, list);
  }

  const result: AttachmentMetadata[] = [];

  for (const [, projectAtts] of byProject.entries()) {
    const usedSequences = new Set<number>();
    let maxAssigned = 0;

    // First, identify all attachments with sequenceNumbers
    const sequenced = projectAtts.filter((a) => typeof a.sequenceNumber === 'number' && a.sequenceNumber > 0);
    const unsequenced = projectAtts.filter((a) => typeof a.sequenceNumber !== 'number' || a.sequenceNumber <= 0);

    // Group sequenced by sequenceNumber to detect collisions
    const seqGroups = new Map<number, AttachmentMetadata[]>();
    for (const a of sequenced) {
      const seq = a.sequenceNumber!;
      const group = seqGroups.get(seq) || [];
      group.push(a);
      seqGroups.set(seq, group);
    }

    // Sort sequences ascending
    const sortedSeqs = Array.from(seqGroups.keys()).sort((a, b) => a - b);
    const resolvedProjectAtts: AttachmentMetadata[] = [];

    for (const seq of sortedSeqs) {
      const group = seqGroups.get(seq)!;
      if (group.length === 1) {
        resolvedProjectAtts.push(group[0]);
        usedSequences.add(seq);
        if (seq > maxAssigned) maxAssigned = seq;
      } else {
        // Collision! Deterministic sort: earliest uploadedAt, then id
        group.sort((a, b) => {
          const timeA = new Date(a.uploadedAt || 0).getTime();
          const timeB = new Date(b.uploadedAt || 0).getTime();
          if (timeA !== timeB) return timeA - timeB;
          return a.id.localeCompare(b.id);
        });

        // The first one keeps the sequence
        const winner = group[0];
        resolvedProjectAtts.push(winner);
        usedSequences.add(seq);
        if (seq > maxAssigned) maxAssigned = seq;

        // Reassign runners-up to next free sequences
        for (let i = 1; i < group.length; i++) {
          let nextFree = maxAssigned + 1;
          while (usedSequences.has(nextFree)) {
            nextFree++;
          }
          const reassigned: AttachmentMetadata = {
            ...group[i],
            sequenceNumber: nextFree,
          };
          usedSequences.add(nextFree);
          maxAssigned = nextFree;
          resolvedProjectAtts.push(reassigned);
        }
      }
    }

    // Add unsequenced items unchanged (legacy)
    resolvedProjectAtts.push(...unsequenced);
    result.push(...resolvedProjectAtts);
  }

  return result;
}
