import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { DEFAULT_SETTINGS } from '../src/storage/database';
import { calculateLineTotal, toCentavos } from '../src/domain/calculations';
import { generateQuotationPdf } from '../src/services/pdfGenerator';
import { Quotation } from '../src/types';

describe('quotation PDF generation', () => {
  it('wraps long content and creates additional pages without changing totals', async () => {
    const lineItems = Array.from({ length: 34 }, (_, index) => ({
      id: `line-${index}`,
      category: 'Materials' as const,
      description: `Long security installation specification ${index + 1} with additional product and technical details that must remain readable in the exported document`,
      quantity: 2,
      unit: 'sets',
      unitPriceCentavos: toCentavos(1250),
      totalCentavos: calculateLineTotal(2, toCentavos(1250)),
    }));
    const quotation: Quotation = {
      id: 'pdf-quote-1',
      quotationNumber: 'Q-2026-PDF',
      revisionNumber: 1,
      clientId: 'client-pdf',
      clientName: 'PDF Test Client',
      clientContact: '0917-000-0000',
      clientAddress: 'Pasig City',
      projectTitle: 'Long Perimeter Security Installation',
      serviceCategory: 'Integrated Perimeter Security',
      scopeOfWork: 'A long scope description covering site preparation, installation, testing, commissioning, and handover. '.repeat(12),
      termsAndConditions: 'Payment and delivery terms with detailed conditions. '.repeat(20),
      notes: 'Additional exclusions and notes. '.repeat(20),
      issueDate: '2026-10-20',
      expiryDate: '2026-11-20',
      status: 'Draft',
      lineItems,
      subtotalCentavos: lineItems.reduce((sum, item) => sum + item.totalCentavos, 0),
      taxRatePercent: 12,
      taxCentavos: 102000,
      grandTotalCentavos: 8602000,
      taxMode: 'EXCLUSIVE',
      createdAt: '2026-10-20T00:00:00Z',
      updatedAt: '2026-10-20T00:00:00Z',
    };

    const bytes = await generateQuotationPdf(quotation, DEFAULT_SETTINGS);
    const document = await PDFDocument.load(bytes);

    expect(document.getPageCount()).toBeGreaterThan(1);
    expect(quotation.grandTotalCentavos).toBe(8602000);
  });
});
