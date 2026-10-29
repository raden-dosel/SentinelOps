import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { DEFAULT_SETTINGS } from '../src/storage/database';
import { calculateLineTotal, toCentavos } from '../src/domain/calculations';
import {
  generateQuotationPdf,
  generateInvoicePdf,
  generatePaymentReceiptPdf,
} from '../src/services/pdfGenerator';
import { Quotation, Invoice, Payment } from '../src/types';

describe('PDF generation service', () => {
  it('wraps long quotation content and creates additional pages without changing totals', async () => {
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

  it('generates multi-page invoice PDF with auto-wrapped items and preserves financial contracts', async () => {
    const lineItems = Array.from({ length: 32 }, (_, index) => ({
      id: `inv-line-${index}`,
      description: `Detailed commercial access control component #${index + 1} including heavy duty magnetic locks, backup battery PSU, and shielded cabling`,
      quantity: 3,
      unit: 'units',
      unitPriceCentavos: toCentavos(3500),
      totalCentavos: calculateLineTotal(3, toCentavos(3500)),
    }));

    const subtotal = lineItems.reduce((acc, curr) => acc + curr.totalCentavos, 0);
    const tax = Math.round(subtotal * 0.12);
    const grandTotal = subtotal + tax;
    const paid = toCentavos(50000);
    const balance = grandTotal - paid;

    const invoice: Invoice = {
      id: 'inv-pdf-1',
      invoiceNumber: 'INV-2026-MULTI',
      clientId: 'client-123',
      clientName: 'Apex Logistics Corporation',
      clientContact: '0917-888-9999',
      clientAddress: 'BGC, Taguig City, Metro Manila',
      title: 'Warehouse Automated Barrier & Access Security Turnkeys',
      issueDate: '2026-10-28',
      dueDate: '2026-11-15',
      lineItems,
      subtotalCentavos: subtotal,
      taxRatePercent: 12,
      taxCentavos: tax,
      grandTotalCentavos: grandTotal,
      paidAmountCentavos: paid,
      remainingBalanceCentavos: balance,
      status: 'Partially Paid',
      taxMode: 'EXCLUSIVE',
      quotationNumber: 'Q-2026-APEX',
      createdAt: '2026-10-28T00:00:00Z',
      updatedAt: '2026-10-28T00:00:00Z',
    };

    const bytes = await generateInvoicePdf(invoice, DEFAULT_SETTINGS);
    const document = await PDFDocument.load(bytes);

    expect(document.getPageCount()).toBeGreaterThan(1);
    // Page dimensions must be A4 (595.28 x 841.89)
    const firstPage = document.getPage(0);
    expect(Math.round(firstPage.getWidth())).toBe(595);
    expect(Math.round(firstPage.getHeight())).toBe(842);
    expect(invoice.grandTotalCentavos).toBe(grandTotal);
    expect(invoice.remainingBalanceCentavos).toBe(balance);
  });

  it('generates payment receipt PDF in voucher landscape format', async () => {
    const invoice: Invoice = {
      id: 'inv-rcpt-1',
      invoiceNumber: 'INV-2026-0045',
      clientId: 'client-rcpt',
      clientName: 'Robinsons Galleria Security Dept',
      clientContact: '0917-123-4567',
      clientAddress: 'Ortigas, Quezon City',
      issueDate: '2026-10-10',
      dueDate: '2026-10-25',
      title: 'CCTV Upgrades & NVR Server Rack Replacement',
      lineItems: [],
      subtotalCentavos: toCentavos(100000),
      taxRatePercent: 12,
      taxCentavos: toCentavos(12000),
      grandTotalCentavos: toCentavos(112000),
      paidAmountCentavos: toCentavos(50000),
      remainingBalanceCentavos: toCentavos(62000),
      status: 'Partially Paid',
      taxMode: 'EXCLUSIVE',
      createdAt: '2026-10-10T00:00:00Z',
      updatedAt: '2026-10-10T00:00:00Z',
    };

    const payment: Payment = {
      id: 'pay-1',
      paymentNumber: 'CR-2026-0012',
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      clientId: invoice.clientId,
      clientName: invoice.clientName,
      amountCentavos: toCentavos(50000),
      remainingBalanceAfterPaymentCentavos: toCentavos(62000),
      paymentMethod: 'Bank Transfer - BDO',
      referenceNumber: 'BDO-REF-8947291',
      paymentDate: '2026-10-12',
      receivedBy: 'Chief Accountant Maria Santos',
      isReversed: false,
      createdAt: '2026-10-12T00:00:00Z',
    };

    const bytes = await generatePaymentReceiptPdf(payment, invoice, DEFAULT_SETTINGS);
    const document = await PDFDocument.load(bytes);

    expect(document.getPageCount()).toBe(1);
    const voucherPage = document.getPage(0);
    expect(Math.round(voucherPage.getWidth())).toBe(595);
    expect(Math.round(voucherPage.getHeight())).toBe(421);
  });
});
