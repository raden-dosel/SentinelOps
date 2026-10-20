/**
 * SentinelOps - Domain Calculations & Monetary Helpers
 * All currency amounts are handled in integer centavos (1 PHP = 100 centavos)
 * to avoid IEEE 754 floating point precision errors.
 */

import { TaxMode } from '../types';

/**
 * Convert PHP decimal amount to integer centavos.
 * Example: 1250.50 -> 125050
 */
export function toCentavos(amount: number): number {
  if (isNaN(amount) || !isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

/**
 * Convert integer centavos to PHP decimal.
 * Example: 125050 -> 1250.50
 */
export function fromCentavos(centavos: number): number {
  if (isNaN(centavos) || !isFinite(centavos)) return 0;
  return centavos / 100;
}

/**
 * Format integer centavos into a clean Philippine Peso currency string.
 * Example: 125050 -> "₱1,250.50"
 */
export function formatCurrency(centavos: number, showSymbol = true): string {
  const php = fromCentavos(centavos);
  const formatted = php.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return showSymbol ? `₱${formatted}` : formatted;
}

/**
 * Calculate line item total in centavos: quantity * unitPriceCentavos
 */
export function calculateLineTotal(quantity: number, unitPriceCentavos: number): number {
  if (quantity <= 0 || unitPriceCentavos <= 0) return 0;
  return Math.round(quantity * unitPriceCentavos);
}

export interface TaxCalculationResult {
  subtotalCentavos: number;
  taxRatePercent: number;
  taxCentavos: number;
  grandTotalCentavos: number;
  taxMode: TaxMode;
}

/**
 * Computes subtotal, tax, and grand total based on the line items sum and tax configuration.
 */
export function calculateTotals(
  sumOfLineTotalsCentavos: number,
  taxMode: TaxMode,
  taxRatePercent: number = 12
): TaxCalculationResult {
  const safeSum = Math.max(0, Math.round(sumOfLineTotalsCentavos));
  const safeRate = Math.max(0, taxRatePercent);

  if (taxMode === 'NON_VAT' || safeRate === 0) {
    return {
      subtotalCentavos: safeSum,
      taxRatePercent: 0,
      taxCentavos: 0,
      grandTotalCentavos: safeSum,
      taxMode,
    };
  }

  if (taxMode === 'EXCLUSIVE') {
    const subtotal = safeSum;
    const tax = Math.round((subtotal * safeRate) / 100);
    const grandTotal = subtotal + tax;
    return {
      subtotalCentavos: subtotal,
      taxRatePercent: safeRate,
      taxCentavos: tax,
      grandTotalCentavos: grandTotal,
      taxMode,
    };
  }

  // Tax-Inclusive: sum is already the grand total
  const grandTotal = safeSum;
  const subtotal = Math.round(grandTotal / (1 + safeRate / 100));
  const tax = grandTotal - subtotal;

  return {
    subtotalCentavos: subtotal,
    taxRatePercent: safeRate,
    taxCentavos: tax,
    grandTotalCentavos: grandTotal,
    taxMode,
  };
}

/**
 * Calculates remaining balance given an invoice grand total and applied payments.
 */
export function calculateRemainingBalance(
  grandTotalCentavos: number,
  appliedPaymentsCentavos: number
): number {
  const safeTotal = Math.max(0, grandTotalCentavos);
  const safePayments = Math.max(0, appliedPaymentsCentavos);
  return Math.max(0, safeTotal - safePayments);
}

/**
 * Evaluates whether an invoice is currently overdue.
 * An invoice is overdue if:
 * 1. It is not 'Draft', 'Paid', or 'Void'
 * 2. It has remaining balance > 0
 * 3. Today's date > dueDate
 */
export function isInvoiceOverdue(
  status: string,
  dueDate: string,
  remainingBalanceCentavos: number,
  currentDateStr?: string
): boolean {
  if (status === 'Draft' || status === 'Paid' || status === 'Void') {
    return false;
  }
  if (remainingBalanceCentavos <= 0) {
    return false;
  }
  const today = currentDateStr || new Date().toISOString().split('T')[0];
  return today > dueDate;
}

/**
 * Convert number in centavos to words in Philippine Pesos (for official receipts).
 * e.g. 1542050 -> "Fifteen Thousand Four Hundred Twenty Pesos and 50/100"
 */
export function amountInWords(centavos: number): string {
  const totalPHP = Math.floor(centavos / 100);
  const cents = centavos % 100;

  if (totalPHP === 0 && cents === 0) return 'Zero Pesos Only';

  const units = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertChunk(num: number): string {
    let str = '';
    if (num >= 100) {
      str += units[Math.floor(num / 100)] + ' Hundred ';
      num %= 100;
    }
    if (num >= 20) {
      str += tens[Math.floor(num / 10)] + ' ';
      num %= 10;
    }
    if (num > 0) {
      str += units[num] + ' ';
    }
    return str.trim();
  }

  let words = '';
  const millions = Math.floor(totalPHP / 1000000);
  const thousands = Math.floor((totalPHP % 1000000) / 1000);
  const remainder = totalPHP % 1000;

  if (millions > 0) {
    words += convertChunk(millions) + ' Million ';
  }
  if (thousands > 0) {
    words += convertChunk(thousands) + ' Thousand ';
  }
  if (remainder > 0) {
    words += convertChunk(remainder) + ' ';
  }

  const pesoPart = words.trim() || 'Zero';
  const centPart = cents > 0 ? ` and ${cents.toString().padStart(2, '0')}/100` : ' Only';

  return `${pesoPart} Pesos${centPart}`;
}
