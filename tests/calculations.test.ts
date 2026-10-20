import { describe, it, expect } from 'vitest';
import {
  toCentavos,
  fromCentavos,
  formatCurrency,
  calculateLineTotal,
  calculateTotals,
  calculateRemainingBalance,
  isInvoiceOverdue,
  amountInWords,
} from '../src/domain/calculations';

describe('Monetary & Domain Calculations (Integer Centavos Precision)', () => {
  it('converts PHP decimals accurately to integer centavos without floating point creep', () => {
    expect(toCentavos(1250.5)).toBe(125050);
    expect(toCentavos(0.1 + 0.2)).toBe(30); // 0.30 PHP = 30 centavos
    expect(toCentavos(99.99)).toBe(9999);
    expect(toCentavos(0)).toBe(0);
  });

  it('converts integer centavos back to PHP decimal representation', () => {
    expect(fromCentavos(125050)).toBe(1250.5);
    expect(fromCentavos(9999)).toBe(99.99);
    expect(fromCentavos(0)).toBe(0);
  });

  it('formats currency correctly in Philippine Peso (PHP)', () => {
    expect(formatCurrency(125050)).toBe('₱1,250.50');
    expect(formatCurrency(100000000)).toBe('₱1,000,000.00');
    expect(formatCurrency(0)).toBe('₱0.00');
  });

  it('calculates line item totals accurately', () => {
    // 200 meters at ₱45.00/meter = 200 * 4500 centavos = 900,000 centavos (₱9,000.00)
    const total = calculateLineTotal(200, toCentavos(45));
    expect(total).toBe(900000);
    expect(fromCentavos(total)).toBe(9000);

    // Zero or negative handling
    expect(calculateLineTotal(0, 5000)).toBe(0);
    expect(calculateLineTotal(-5, 5000)).toBe(0);
    expect(calculateLineTotal(10, 0)).toBe(0);
  });

  describe('Tax Calculations', () => {
    it('calculates VAT Exclusive correctly (12% added to subtotal)', () => {
      // Subtotal = ₱100,000.00 = 10,000,000 centavos
      const subtotalCentavos = toCentavos(100000);
      const result = calculateTotals(subtotalCentavos, 'EXCLUSIVE', 12);

      expect(result.subtotalCentavos).toBe(10000000);
      expect(result.taxCentavos).toBe(1200000); // ₱12,000.00
      expect(result.grandTotalCentavos).toBe(11200000); // ₱112,000.00
    });

    it('calculates VAT Inclusive correctly (backed out of gross total)', () => {
      // Gross = ₱112,000.00 = 11,200,000 centavos
      const grossCentavos = toCentavos(112000);
      const result = calculateTotals(grossCentavos, 'INCLUSIVE', 12);

      expect(result.grandTotalCentavos).toBe(11200000);
      expect(result.subtotalCentavos).toBe(10000000); // ₱100,000.00
      expect(result.taxCentavos).toBe(1200000); // ₱12,000.00
    });

    it('calculates Non-VAT correctly (0% tax)', () => {
      const grossCentavos = toCentavos(50000);
      const result = calculateTotals(grossCentavos, 'NON_VAT', 12);

      expect(result.subtotalCentavos).toBe(grossCentavos);
      expect(result.taxCentavos).toBe(0);
      expect(result.grandTotalCentavos).toBe(grossCentavos);
    });
  });

  describe('Invoice Overdue & Outstanding Balance Evaluator', () => {
    it('computes remaining balance correctly', () => {
      const grandTotal = toCentavos(50000);
      const applied = toCentavos(20000);
      expect(calculateRemainingBalance(grandTotal, applied)).toBe(toCentavos(30000));

      // Overpayment clamp prevention
      expect(calculateRemainingBalance(grandTotal, toCentavos(60000))).toBe(0);
    });

    it('identifies overdue invoices properly based on dueDate and remaining balance', () => {
      // Due yesterday with balance > 0
      expect(isInvoiceOverdue('Issued', '2026-10-15', 5000, '2026-10-19')).toBe(true);

      // Due yesterday with balance = 0 -> Not overdue
      expect(isInvoiceOverdue('Paid', '2026-10-15', 0, '2026-10-19')).toBe(false);

      // Voided invoice -> Never overdue
      expect(isInvoiceOverdue('Void', '2026-10-15', 5000, '2026-10-19')).toBe(false);

      // Draft invoice -> Not overdue
      expect(isInvoiceOverdue('Draft', '2026-10-15', 5000, '2026-10-19')).toBe(false);

      // Due in future -> Not overdue
      expect(isInvoiceOverdue('Issued', '2026-10-25', 5000, '2026-10-19')).toBe(false);
    });
  });

  describe('Amount In Words Generator (Receipts)', () => {
    it('converts centavos to clear Philippine Peso wording', () => {
      expect(amountInWords(toCentavos(15420.5))).toBe(
        'Fifteen Thousand Four Hundred Twenty Pesos and 50/100'
      );
      expect(amountInWords(toCentavos(250000))).toBe(
        'Two Hundred Fifty Thousand Pesos Only'
      );
      expect(amountInWords(0)).toBe('Zero Pesos Only');
    });
  });
});
