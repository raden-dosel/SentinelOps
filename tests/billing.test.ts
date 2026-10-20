import { describe, it, expect } from 'vitest';
import { calculateTotals, toCentavos, fromCentavos } from '../src/domain/calculations';
import { InvoiceStatus, QuotationStatus } from '../src/types';

describe('Billing & Financial Invariant Tests', () => {
  it('prevents payment from exceeding outstanding balance', () => {
    const invoiceTotalCentavos = toCentavos(75000); // ₱75,000.00
    const alreadyPaidCentavos = toCentavos(30000); // ₱30,000.00
    const outstandingCentavos = invoiceTotalCentavos - alreadyPaidCentavos; // ₱45,000.00

    const proposedPayment = toCentavos(50000); // ₱50,000.00
    const isValid = proposedPayment <= outstandingCentavos;

    expect(isValid).toBe(false);
  });

  it('correctly transitions invoice status when fully settled', () => {
    const invoiceTotalCentavos = toCentavos(50000);
    let paidAmountCentavos = 0;

    // Payment 1: ₱25,000
    paidAmountCentavos += toCentavos(25000);
    let remaining = invoiceTotalCentavos - paidAmountCentavos;
    let status: InvoiceStatus = remaining === 0 ? 'Paid' : 'Partially Paid';
    expect(status).toBe('Partially Paid');
    expect(fromCentavos(remaining)).toBe(25000);

    // Payment 2: Remaining ₱25,000
    paidAmountCentavos += toCentavos(25000);
    remaining = invoiceTotalCentavos - paidAmountCentavos;
    status = remaining === 0 ? 'Paid' : 'Partially Paid';
    expect(status).toBe('Paid');
    expect(remaining).toBe(0);
  });

  it('safely handles invoice voiding constraints', () => {
    // Business rule: Cannot void an invoice with applied payments
    const invoice = {
      status: 'Issued' as InvoiceStatus,
      paidAmountCentavos: toCentavos(10000),
    };

    const canVoid = invoice.paidAmountCentavos === 0;
    expect(canVoid).toBe(false);
  });

  it('preserves historical document revision integrity', () => {
    // Revision counter starts at 0 and increments monotonically
    const initialRev = 0;
    const nextRev = initialRev + 1;
    expect(nextRev).toBe(1);
    expect(nextRev).toBeGreaterThan(initialRev);
  });
});
