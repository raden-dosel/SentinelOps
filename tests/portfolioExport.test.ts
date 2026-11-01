/**
 * SentinelOps - Portfolio Metadata & Project Details Export Test Suite
 *
 * Validates:
 * 1. Comprehensive Project Details snapshot creation from canonical domain entities
 * 2. Complete field inventory (Client info, Project info, Status, Scope, Progress Notes, Financials)
 * 3. Associated Image metadata and references (sequence, storage provider, cloud keys)
 * 4. Zero binary blob bloat and zero secret leakage in JSON output
 * 5. Structured JSON formatting with schemaVersion: "1.0"
 * 6. Deterministic export file naming for all platforms
 * 7. Attachment record association with projectMetadataSnapshot upon upload
 * 8. Offline resilience using local IndexedDB storage
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  Project,
  Client,
  AttachmentMetadata,
  AttachmentRecord,
} from '../src/types';
import {
  buildProjectDetailsSnapshot,
  buildImageReferences,
  buildPortfolioExport,
  exportProjectMetadataAsJson,
  getPortfolioExportFileName,
} from '../src/services/portfolioExportService';
import {
  projectRepository,
  clientRepository,
  attachmentRepository,
} from '../src/storage/repositories';
import { getDatabase, resetDatabaseConnection } from '../src/storage/database';

describe('Portfolio Metadata & Project Details Export Suite', () => {
  const mockClient: Client = {
    id: 'cli-001',
    name: 'Megaworld Logistics Hub',
    contactPerson: 'Engr. Roberto Santos',
    contactNumber: '+63 917 123 4567',
    email: 'roberto.santos@megaworld.ph',
    address: 'Bldg 4, Laguna Technopark',
    city: 'Biñan, Laguna',
    leadSource: 'Referral',
    leadStatus: 'Won',
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
  };

  const mockProject: Project = {
    id: 'prj-101',
    projectNumber: 'PRJ-2026-088',
    clientId: 'cli-001',
    clientName: 'Megaworld Logistics Hub',
    name: 'Perimeter Electric Fence & Gate Automation',
    serviceCategory: 'Integrated Perimeter Security',
    siteAddress: 'Bldg 4, Laguna Technopark, Biñan, Laguna',
    description: 'High-voltage perimeter pulsed security fence with heavy-duty sliding gate motor.',
    scopeOfWork: 'Supply, mounting, earthing grounding, energizer setup, loop detector, turnover.',
    startDate: '2026-10-15',
    targetCompletionDate: '2026-11-15',
    actualCompletionDate: '2026-11-10',
    status: 'Completed',
    quotationId: 'q-555',
    quotationNumber: 'Q-2026-042',
    progressNotes: [
      {
        id: 'note-1',
        timestamp: '2026-10-15T09:00:00.000Z',
        author: 'Admin',
        text: 'Mobilization started on site. Ground rods installed.',
        statusChange: 'Ongoing',
      },
      {
        id: 'note-2',
        timestamp: '2026-11-10T16:00:00.000Z',
        author: 'Chief Tech',
        text: 'Final energizer test passed (9.2 kV). System commissioned.',
        statusChange: 'Completed',
      },
    ],
    totalQuotedCentavos: 45000000, // ₱450,000.00
    totalInvoicedCentavos: 45000000,
    totalPaidCentavos: 45000000,
    createdAt: '2026-10-15T08:00:00.000Z',
    updatedAt: '2026-11-10T17:00:00.000Z',
  };

  const mockAttachments: AttachmentMetadata[] = [
    {
      id: 'att-1',
      entityType: 'Project',
      entityId: 'prj-101',
      fileName: '1.jpg',
      fileType: 'image/jpeg',
      fileSize: 412580,
      caption: 'Main Entrance Gate Posts and Energizer Mounting',
      uploadedAt: '2026-10-16T10:30:00.000Z',
      sequenceNumber: 1,
      storageProvider: 'cloudflare-r2',
      r2ObjectKey: 'Perimeter-Electric-Fence-Gate-Automation_2026-10-15/1.jpg',
      r2Bucket: 'sentinelops-site-photos',
      r2FolderName: 'Perimeter-Electric-Fence-Gate-Automation_2026-10-15',
      etag: '"d41d8cd98f00b204e9800998ecf8427e"',
    },
    {
      id: 'att-2',
      entityType: 'Project',
      entityId: 'prj-101',
      fileName: '2.png',
      fileType: 'image/png',
      fileSize: 852300,
      caption: 'North Perimeter Tension Wire Brackets',
      uploadedAt: '2026-10-20T14:15:00.000Z',
      sequenceNumber: 2,
      storageProvider: 'cloudinary',
      cloudinaryPublicId: 'sentinelops/projects/prj-101/2',
      cloudinaryUrl: 'https://res.cloudinary.com/sentinelops/image/upload/v12345/prj-101/2.png',
    },
  ];

  beforeEach(() => {
    indexedDB = new IDBFactory();
    resetDatabaseConnection();
  });

  it('1. builds complete Project Details snapshot using canonical source of truth', () => {
    const snapshot = buildProjectDetailsSnapshot(mockProject, mockClient);

    expect(snapshot.id).toBe('prj-101');
    expect(snapshot.projectNumber).toBe('PRJ-2026-088');
    expect(snapshot.name).toBe('Perimeter Electric Fence & Gate Automation');
    expect(snapshot.serviceCategory).toBe('Integrated Perimeter Security');
    expect(snapshot.status).toBe('Completed');
    expect(snapshot.siteAddress).toBe('Bldg 4, Laguna Technopark, Biñan, Laguna');
    expect(snapshot.description).toContain('High-voltage perimeter');
    expect(snapshot.scopeOfWork).toContain('Supply, mounting');
    expect(snapshot.startDate).toBe('2026-10-15');
    expect(snapshot.targetCompletionDate).toBe('2026-11-15');
    expect(snapshot.actualCompletionDate).toBe('2026-11-10');
    expect(snapshot.quotationNumber).toBe('Q-2026-042');

    // Client Snapshot verification
    expect(snapshot.client.id).toBe('cli-001');
    expect(snapshot.client.name).toBe('Megaworld Logistics Hub');
    expect(snapshot.client.contactPerson).toBe('Engr. Roberto Santos');
    expect(snapshot.client.contactNumber).toBe('+63 917 123 4567');
    expect(snapshot.client.email).toBe('roberto.santos@megaworld.ph');
    expect(snapshot.client.city).toBe('Biñan, Laguna');

    // Financials verification
    expect(snapshot.financials.totalQuotedCentavos).toBe(45000000);
    expect(snapshot.financials.formattedQuoted).toBe('₱450,000.00');
    expect(snapshot.financials.formattedPaid).toBe('₱450,000.00');
    expect(snapshot.financials.balanceDueCentavos).toBe(0);
    expect(snapshot.financials.formattedBalanceDue).toBe('₱0.00');

    // Progress notes timeline verification
    expect(snapshot.progressNotes).toHaveLength(2);
    expect(snapshot.progressNotes[0].author).toBe('Admin');
    expect(snapshot.progressNotes[1].statusChange).toBe('Completed');
  });

  it('2. handles missing client gracefully without crashing', () => {
    const snapshot = buildProjectDetailsSnapshot(mockProject, null);

    expect(snapshot.client.id).toBe('cli-001');
    expect(snapshot.client.name).toBe('Megaworld Logistics Hub');
    expect(snapshot.client.contactPerson).toBeUndefined();
    expect(snapshot.client.email).toBeUndefined();
  });

  it('3. converts attachments into image references without binary bloat or credentials', () => {
    const imageRefs = buildImageReferences(mockAttachments, mockProject);

    expect(imageRefs).toHaveLength(2);

    const ref1 = imageRefs[0];
    expect(ref1.id).toBe('att-1');
    expect(ref1.sequenceNumber).toBe(1);
    expect(ref1.fileName).toBe('1.jpg');
    expect(ref1.storageProvider).toBe('cloudflare-r2');
    expect(ref1.r2ObjectKey).toBe('Perimeter-Electric-Fence-Gate-Automation_2026-10-15/1.jpg');
    expect(ref1.r2Bucket).toBe('sentinelops-site-photos');

    const ref2 = imageRefs[1];
    expect(ref2.id).toBe('att-2');
    expect(ref2.sequenceNumber).toBe(2);
    expect(ref2.storageProvider).toBe('cloudinary');
    expect(ref2.cloudinaryPublicId).toBe('sentinelops/projects/prj-101/2');
    expect(ref2.cloudinaryUrl).toContain('https://res.cloudinary.com/');

    // Assert NO binary blobs or base64 data exist
    imageRefs.forEach((ref) => {
      expect((ref as any).blob).toBeUndefined();
      expect((ref as any).base64).toBeUndefined();
      expect((ref as any).apiKey).toBeUndefined();
      expect((ref as any).secretKey).toBeUndefined();
      expect((ref as any).password).toBeUndefined();
    });
  });

  it('4. compiles structured portfolio export with schemaVersion 1.0', () => {
    const exportResult = buildPortfolioExport(mockProject, mockAttachments, mockClient);

    expect(exportResult.schemaVersion).toBe('1.0');
    expect(exportResult.source).toBe('SentinelOps');
    expect(exportResult.portfolioClassificationReady).toBe(true);
    expect(exportResult.exportedAt).toBeDefined();
    expect(new Date(exportResult.exportedAt).getTime()).not.toBeNaN();
    expect(exportResult.project.projectNumber).toBe('PRJ-2026-088');
    expect(exportResult.images).toHaveLength(2);
  });

  it('5. generates deterministic and OS-safe filenames', () => {
    expect(getPortfolioExportFileName(mockProject)).toBe('sentinelops-project-PRJ-2026-088.json');

    const projectWithoutNumber: Project = {
      ...mockProject,
      projectNumber: '',
      id: 'prj-alpha-99',
    };
    expect(getPortfolioExportFileName(projectWithoutNumber)).toBe('sentinelops-project-prj-alpha-99.json');

    const projectWithSpecialChars: Project = {
      ...mockProject,
      projectNumber: 'PRJ/2026:01#Test',
    };
    expect(getPortfolioExportFileName(projectWithSpecialChars)).toBe('sentinelops-project-PRJ_2026_01_Test.json');
  });

  it('6. produces valid, parseable, pretty-printed JSON', () => {
    const jsonString = exportProjectMetadataAsJson(mockProject, mockAttachments, mockClient);

    expect(typeof jsonString).toBe('string');
    expect(jsonString).toContain('"schemaVersion": "1.0"');
    expect(jsonString).toContain('"portfolioClassificationReady": true');

    const parsed = JSON.parse(jsonString);
    expect(parsed.schemaVersion).toBe('1.0');
    expect(parsed.project.name).toBe('Perimeter Electric Fence & Gate Automation');
    expect(parsed.images[0].fileName).toBe('1.jpg');
  });

  it('7. durably associates projectMetadataSnapshot with attachment in IndexedDB', async () => {
    // 1. Seed project and client into local database
    await clientRepository.save(mockClient);
    await projectRepository.save(mockProject);

    // 2. Build snapshot
    const snapshot = buildProjectDetailsSnapshot(mockProject, mockClient);

    // 3. Save attachment with projectMetadataSnapshot
    const attRecord: AttachmentRecord = {
      id: 'att-snap-test-1',
      entityType: 'Project',
      entityId: mockProject.id,
      fileName: '1.jpg',
      fileType: 'image/jpeg',
      fileSize: 250000,
      caption: 'Site Survey Photo 1',
      uploadedAt: new Date().toISOString(),
      sequenceNumber: 1,
      storageProvider: 'cloudflare-r2',
      r2ObjectKey: 'Perimeter-Electric-Fence-Gate-Automation_2026-10-15/1.jpg',
      r2Bucket: 'sentinelops-site-photos',
      projectMetadataSnapshot: snapshot,
    };

    const saved = await attachmentRepository.saveAttachment(attRecord);
    expect(saved.projectMetadataSnapshot).toBeDefined();
    expect(saved.projectMetadataSnapshot?.projectNumber).toBe('PRJ-2026-088');

    // 4. Retrieve directly from IndexedDB to verify persistence
    const loaded = await attachmentRepository.getByEntity('Project', mockProject.id);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('att-snap-test-1');
    expect(loaded[0].projectMetadataSnapshot).toBeDefined();
    expect(loaded[0].projectMetadataSnapshot?.client.name).toBe('Megaworld Logistics Hub');
    expect(loaded[0].projectMetadataSnapshot?.financials.formattedQuoted).toBe('₱450,000.00');

    // 5. Verify syncOutbox payload also contains projectMetadataSnapshot without blobs
    const db = await getDatabase();
    const outboxRecords = await db.getAll('syncOutbox');
    const attOutbox = outboxRecords.find((r) => r.entityId === 'att-snap-test-1');

    expect(attOutbox).toBeDefined();
    const payload = attOutbox?.payload as AttachmentMetadata;
    expect(payload.projectMetadataSnapshot).toBeDefined();
    expect(payload.projectMetadataSnapshot?.id).toBe('prj-101');
    expect((payload as any).blob).toBeUndefined();
  });
});
