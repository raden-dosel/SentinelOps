/**
 * SentinelOps - Core Domain Types & Data Contracts
 * Offline-first Business Operations Management System for Security Installation Services
 */

export type ID = string;

// --- Authentication & Local Security ---
export interface LocalUser {
  id: ID;
  username: string;
  fullName: string;
  email: string;
  passwordHash: string; // PBKDF2 derived hash
  salt: string;
  securityQuestion: string;
  securityAnswerHash: string;
  createdAt: string;
  lastLoginAt: string;
}

export interface AuthSession {
  userId: ID;
  username: string;
  fullName: string;
  isAuthenticated: boolean;
  isLocked: boolean;
  lastActiveTimestamp: number;
}

// --- Audit Trail ---
export type AuditAction =
  | 'AUTH_LOGIN'
  | 'AUTH_LOGOUT'
  | 'AUTH_LOCK'
  | 'AUTH_UNLOCK'
  | 'CLIENT_CREATE'
  | 'CLIENT_UPDATE'
  | 'CLIENT_STATUS_CHANGE'
  | 'QUOTATION_CREATE'
  | 'QUOTATION_UPDATE'
  | 'QUOTATION_ISSUE'
  | 'QUOTATION_ACCEPT'
  | 'QUOTATION_DECLINE'
  | 'QUOTATION_REVISE'
  | 'INVOICE_CREATE'
  | 'INVOICE_ISSUE'
  | 'INVOICE_VOID'
  | 'PAYMENT_RECORD'
  | 'PAYMENT_REVERSE'
  | 'PROJECT_CREATE'
  | 'PROJECT_UPDATE'
  | 'PROJECT_STATUS_CHANGE'
  | 'ATTACHMENT_ADD'
  | 'ATTACHMENT_DELETE'
  | 'BACKUP_EXPORT'
  | 'BACKUP_RESTORE'
  | 'SETTINGS_UPDATE';

export type EntityType =
  | 'User'
  | 'Client'
  | 'Quotation'
  | 'Invoice'
  | 'Payment'
  | 'Project'
  | 'Attachment'
  | 'Settings'
  | 'System';

export interface AuditEvent {
  id: ID;
  timestamp: string; // ISO 8601
  actorId: string;
  actorName: string;
  action: AuditAction;
  entityType: EntityType;
  entityId: string;
  entityLabel?: string;
  details?: Record<string, unknown>;
}

// --- App Settings ---
export type TaxMode = 'EXCLUSIVE' | 'INCLUSIVE' | 'NON_VAT';

export interface AppSettings {
  id: 'current_settings';
  // Business Profile
  businessName: string;
  tradingName: string;
  tagline: string;
  tinNumber: string;
  contactNumber: string;
  email: string;
  website?: string;
  address: string;
  city: string;
  region: string;
  postalCode: string;
  // Financial & Tax Settings
  currency: string; // PHP
  currencySymbol: string; // ₱
  taxMode: TaxMode;
  taxRatePercent: number; // e.g. 12
  // Quotation Defaults
  defaultQuotationValidityDays: number; // e.g. 30
  defaultPaymentTerms: string;
  defaultWarrantyTerms: string;
  defaultQuotationNotes: string;
  // Numbering Prefixes
  quotationPrefix: string; // Q-
  invoicePrefix: string; // INV-
  paymentPrefix: string; // PAY-
  projectPrefix: string; // PRJ-
  // Security & App Behavior
  autoLockMinutes: number; // 0 = never, 5, 10, 15, 30
  theme: 'dark' | 'light' | 'system';
  updatedAt: string;
}

// --- Document Number Sequences ---
export interface NumberSequence {
  prefix: string; // e.g. 'Q-2026-', 'INV-2026-'
  lastNumber: number; // e.g. 14
}

// --- Clients (CRM) ---
export type LeadStatus =
  | 'New Inquiry'
  | 'Site Visit Scheduled'
  | 'Quotation Sent'
  | 'Won'
  | 'Lost';

export type LeadSource =
  | 'Referral'
  | 'Facebook'
  | 'Google Search'
  | 'Direct Call'
  | 'Website'
  | 'Subcontractor'
  | 'Walk-in'
  | 'Existing Customer'
  | 'Other';

export interface Client {
  id: ID;
  name: string;
  contactPerson?: string;
  contactNumber: string;
  email?: string;
  address: string;
  city?: string;
  leadSource: LeadSource;
  leadStatus: LeadStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// --- Quotations ---
export type ServiceCategory =
  | 'Electric Fence Installation'
  | 'Automatic Gate Installation'
  | 'Maintenance Service'
  | 'CCTV & Security Systems'
  | 'Access Control & Intercom'
  | 'Integrated Perimeter Security'
  | 'Other Service';

export type QuotationStatus =
  | 'Draft'
  | 'Sent'
  | 'Accepted'
  | 'Declined'
  | 'Expired';

export type LineItemCategory =
  | 'Materials'
  | 'Labor'
  | 'Mobilization'
  | 'Contingency'
  | 'Equipment/Tools'
  | 'Additional';

export interface QuotationLineItem {
  id: ID;
  category: LineItemCategory;
  description: string;
  quantity: number;
  unit: string; // e.g. 'meters', 'sets', 'pcs', 'lots', 'hours', 'units'
  unitPriceCentavos: number; // Stored in integer centavos (PHP)
  totalCentavos: number; // quantity * unitPriceCentavos
}

export interface Quotation {
  id: ID;
  quotationNumber: string; // e.g. Q-2026-001
  revisionNumber: number; // 0 = original, 1 = R1, etc.
  clientId: ID;
  clientName: string;
  clientContact: string;
  clientAddress: string;
  projectTitle: string;
  serviceCategory: ServiceCategory;
  scopeOfWork: string;
  notes?: string;
  termsAndConditions: string;
  issueDate: string; // YYYY-MM-DD
  expiryDate: string; // YYYY-MM-DD
  status: QuotationStatus;
  lineItems: QuotationLineItem[];
  // Calculated monetary figures (stored in centavos)
  subtotalCentavos: number;
  taxRatePercent: number;
  taxCentavos: number;
  grandTotalCentavos: number;
  taxMode: TaxMode;
  convertedToProjectId?: ID;
  convertedToInvoiceId?: ID;
  createdAt: string;
  updatedAt: string;
}

export interface QuotationRevision {
  id: ID;
  quotationId: ID;
  revisionNumber: number;
  snapshot: Quotation;
  reason?: string;
  createdAt: string;
  createdBy: string;
}

// --- Billing & Invoices ---
export type InvoiceStatus =
  | 'Draft'
  | 'Issued'
  | 'Partially Paid'
  | 'Paid'
  | 'Overdue'
  | 'Void';

export interface InvoiceLineItem {
  id: ID;
  description: string;
  quantity: number;
  unit: string;
  unitPriceCentavos: number;
  totalCentavos: number;
}

export interface Invoice {
  id: ID;
  invoiceNumber: string; // e.g. INV-2026-001
  quotationId?: ID;
  quotationNumber?: string;
  projectId?: ID;
  projectNumber?: string;
  clientId: ID;
  clientName: string;
  clientContact: string;
  clientAddress: string;
  issueDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  title: string;
  lineItems: InvoiceLineItem[];
  subtotalCentavos: number;
  taxRatePercent: number;
  taxCentavos: number;
  grandTotalCentavos: number;
  paidAmountCentavos: number;
  remainingBalanceCentavos: number;
  status: InvoiceStatus;
  taxMode: TaxMode;
  notes?: string;
  paymentInstructions?: string;
  createdAt: string;
  updatedAt: string;
}

// --- Payments ---
export type PaymentMethod =
  | 'Cash'
  | 'Bank Transfer - BDO'
  | 'Bank Transfer - BPI'
  | 'Bank Transfer - Metrobank'
  | 'GCash'
  | 'Maya'
  | 'Check'
  | 'Credit/Debit Card'
  | 'Other';

export interface Payment {
  id: ID;
  paymentNumber: string; // e.g. PAY-2026-001
  invoiceId: ID;
  invoiceNumber: string;
  clientId: ID;
  clientName: string;
  amountCentavos: number;
  paymentDate: string; // YYYY-MM-DD
  paymentMethod: PaymentMethod;
  referenceNumber: string;
  receivedBy: string;
  notes?: string;
  remainingBalanceAfterPaymentCentavos: number;
  isReversed: boolean;
  reversalReason?: string;
  createdAt: string;
}

// --- Projects ---
export type ProjectStatus =
  | 'Planning'
  | 'Survey'
  | 'Approved'
  | 'Ongoing'
  | 'Completed'
  | 'Closed';

export interface ProjectProgressNote {
  id: ID;
  timestamp: string;
  author: string;
  text: string;
  statusChange?: ProjectStatus;
}

export interface Project {
  id: ID;
  projectNumber: string; // e.g. PRJ-2026-001
  clientId: ID;
  clientName: string;
  name: string;
  serviceCategory: ServiceCategory;
  siteAddress: string;
  description: string;
  scopeOfWork: string;
  quotationId?: ID;
  quotationNumber?: string;
  startDate?: string;
  targetCompletionDate?: string;
  actualCompletionDate?: string;
  status: ProjectStatus;
  progressNotes: ProjectProgressNote[];
  totalQuotedCentavos?: number;
  totalInvoicedCentavos?: number;
  totalPaidCentavos?: number;
  createdAt: string;
  updatedAt: string;
}

// --- Attachments & Site Photos ---
export interface AttachmentMetadata {
  id: ID;
  entityType: 'Project' | 'Client' | 'Quotation' | 'Invoice';
  entityId: ID;
  fileName: string;
  fileType: string; // e.g. 'image/jpeg', 'application/pdf'
  fileSize: number; // bytes
  caption?: string;
  uploadedAt: string;
  sequenceNumber?: number;
  cloudinaryPublicId?: string;
  cloudinaryUrl?: string;
  r2ObjectKey?: string;
  r2Bucket?: string;
  r2FolderName?: string;
  etag?: string;
  storageProvider?: 'local' | 'cloudflare-r2' | 'cloudinary';
}

export interface AttachmentRecord extends AttachmentMetadata {
  blob?: Blob;
}

// --- Backup & Restore ---
export interface BackupManifest {
  appName: 'SentinelOps';
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  recordCounts: {
    clients: number;
    quotations: number;
    quotationRevisions: number;
    invoices: number;
    payments: number;
    projects: number;
    attachments: number;
    auditEvents: number;
  };
}

export interface BackupData {
  manifest: BackupManifest;
  settings: AppSettings;
  clients: Client[];
  quotations: Quotation[];
  quotationRevisions: QuotationRevision[];
  invoices: Invoice[];
  payments: Payment[];
  projects: Project[];
  attachmentsMetadata: AttachmentMetadata[];
  auditEvents: AuditEvent[];
}
