/**
 * SentinelOps - Client-Side PDF Generation Service
 * Powered entirely offline by 'pdf-lib'.
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { Quotation, Invoice, Payment, AppSettings } from '../types';
import { formatCurrency, fromCentavos, amountInWords } from '../domain/calculations';

// Helpers to format currency and clean strings
function formatPhp(centavos: number): string {
  return formatCurrency(centavos, true).replace(/₱/g, 'PHP ');
}

/**
 * Generates an itemized, paginated Quotation PDF document.
 */
export async function generateQuotationPdf(
  quotation: Quotation,
  settings: AppSettings
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const width = 595.28;
  const height = 841.89;
  const left = 40;
  const right = width - 40;
  const primary = rgb(0.06, 0.09, 0.16);
  const accent = rgb(0.15, 0.39, 0.92);
  const text = rgb(0.2, 0.25, 0.33);
  const pale = rgb(0.94, 0.96, 0.98);
  const border = rgb(0.85, 0.88, 0.92);
  const white = rgb(1, 1, 1);

  const wrap = (value: string, maxWidth: number, size: number): string[] => {
    const words = value.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [''];
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (regular.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  let page = pdfDoc.addPage([width, height]);
  let y = height - 50;
  const drawHeader = () => {
    page.drawRectangle({ x: left, y: y - 55, width: right - left, height: 65, color: primary });
    page.drawText(settings.businessName.toUpperCase(), { x: 55, y: y - 20, size: 13, font: bold, color: white });
    page.drawText(settings.tagline, { x: 55, y: y - 36, size: 8, font: regular, color: rgb(0.8, 0.85, 0.9) });
    page.drawText(quotation.revisionNumber > 0 ? `QUOTATION (REV ${quotation.revisionNumber})` : 'FORMAL QUOTATION', {
      x: width - 230, y: y - 25, size: 12, font: bold, color: rgb(0.98, 0.75, 0.18),
    });
    page.drawText(`Ref: ${quotation.quotationNumber}`, { x: width - 230, y: y - 42, size: 10, font: bold, color: white });
    y -= 80;
  };
  const drawTableHeader = () => {
    page.drawRectangle({ x: left, y: y - 18, width: right - left, height: 22, color: primary });
    const labels = [['NO.', 48], ['CATEGORY', 75], ['DESCRIPTION / SPECIFICATIONS', 150], ['QTY & UNIT', 380], ['UNIT PRICE (PHP)', 440], ['TOTAL (PHP)', 515]];
    labels.forEach(([label, x]) => page.drawText(String(label), { x: Number(x), y: y - 12, size: 8, font: bold, color: white }));
    y -= 22;
  };
  const newContentPage = () => {
    page = pdfDoc.addPage([width, height]);
    y = height - 50;
    drawHeader();
    drawTableHeader();
  };
  const drawWrapped = (value: string, x: number, maxWidth: number, size: number, color = text, font = regular, gap = 10) => {
    const lines = wrap(value, maxWidth, size);
    lines.forEach((line) => {
      if (y < 85) newContentPage();
      page.drawText(line, { x, y, size, font, color });
      y -= gap;
    });
    return lines.length;
  };

  drawHeader();
  page.drawText('FROM:', { x: left, y, size: 8, font: bold, color: accent });
  drawWrapped(settings.businessName, left, 245, 9, primary, bold, 11);
  drawWrapped(settings.address, left, 245, 8, text, regular, 10);
  drawWrapped(`${settings.city}, ${settings.region}`, left, 245, 8, text, regular, 10);
  drawWrapped(`Tel: ${settings.contactNumber} | Email: ${settings.email}`, left, 245, 8, text, regular, 10);
  if (settings.tinNumber) drawWrapped(`TIN: ${settings.tinNumber}`, left, 245, 8, text, regular, 10);

  let clientY = height - 130;
  page.drawText('PREPARED FOR:', { x: 330, y: clientY, size: 8, font: bold, color: accent });
  const drawClientLine = (value: string, size: number, clientFont = regular) => {
    page.drawText(value, { x: 330, y: clientY - 12, size, font: clientFont, color: clientFont === bold ? primary : text });
    clientY -= 11;
  };
  drawClientLine(quotation.clientName, 9, bold);
  drawClientLine(quotation.clientAddress || 'Client Site Address', 8);
  drawClientLine(`Contact: ${quotation.clientContact || 'N/A'}`, 8);
  drawClientLine(`Date Issued: ${quotation.issueDate} | Valid Until: ${quotation.expiryDate}`, 8);
  y = Math.min(y, clientY) - 18;

  page.drawRectangle({ x: left, y: y - 24, width: right - left, height: 28, color: pale, borderColor: border, borderWidth: 1 });
  page.drawText(`PROJECT / SERVICE: ${quotation.projectTitle.toUpperCase()}`, { x: 50, y: y - 16, size: 9, font: bold, color: primary });
  y -= 40;
  page.drawText('SCOPE OF WORK:', { x: left, y, size: 8, font: bold, color: primary });
  y -= 12;
  drawWrapped(quotation.scopeOfWork || 'No scope specified.', left, right - left, 7.5, text, regular, 10);
  y -= 5;
  drawTableHeader();

  quotation.lineItems.forEach((item, index) => {
    const descriptionLines = wrap(item.description, 220, 7.5);
    const rowHeight = Math.max(20, descriptionLines.length * 10 + 6);
    if (y - rowHeight < 110) newContentPage();
    if (index % 2 === 0) page.drawRectangle({ x: left, y: y - rowHeight, width: right - left, height: rowHeight, color: pale });
    page.drawText(`${index + 1}`, { x: 50, y: y - 13, size: 8, font: regular, color: text });
    page.drawText(item.category || 'Materials', { x: 75, y: y - 13, size: 7.5, font: regular, color: text });
    descriptionLines.forEach((line, lineIndex) => page.drawText(line, { x: 150, y: y - 11 - lineIndex * 10, size: 7.5, font: regular, color: primary }));
    page.drawText(`${item.quantity} ${item.unit}`, { x: 380, y: y - 13, size: 7.5, font: regular, color: text });
    page.drawText(fromCentavos(item.unitPriceCentavos).toFixed(2), { x: 440, y: y - 13, size: 7.5, font: regular, color: text });
    page.drawText(fromCentavos(item.totalCentavos).toFixed(2), { x: 515, y: y - 13, size: 7.5, font: bold, color: primary });
    y -= rowHeight;
  });

  if (y < 190) newContentPage();
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: border });
  y -= 14;
  const totalsX = 380;
  const drawTotal = (label: string, value: string) => {
    page.drawText(label, { x: totalsX, y, size: 9, font: regular, color: text });
    page.drawText(value, { x: 480, y, size: 9, font: regular, color: text });
    y -= 15;
  };
  drawTotal('Subtotal:', formatPhp(quotation.subtotalCentavos));
  if (quotation.taxMode !== 'NON_VAT') drawTotal(`VAT (${quotation.taxRatePercent}%):`, formatPhp(quotation.taxCentavos));
  page.drawRectangle({ x: totalsX - 10, y: y - 8, width: right - totalsX - 30, height: 24, color: primary });
  page.drawText('GRAND TOTAL:', { x: totalsX, y, size: 10, font: bold, color: white });
  page.drawText(formatPhp(quotation.grandTotalCentavos), { x: 480, y, size: 10, font: bold, color: rgb(0.98, 0.75, 0.18) });
  y -= 38;
  page.drawText('TERMS & CONDITIONS:', { x: left, y, size: 8, font: bold, color: primary });
  y -= 12;
  drawWrapped(quotation.termsAndConditions || settings.defaultPaymentTerms, left, right - left, 7, text, regular, 10);
  drawWrapped(settings.defaultWarrantyTerms, left, right - left, 7, text, regular, 10);
  if (quotation.notes) {
    y -= 4;
    page.drawText('NOTES:', { x: left, y, size: 8, font: bold, color: primary });
    y -= 12;
    drawWrapped(quotation.notes, left, right - left, 7, text, regular, 10);
  }
  page.drawText('Authorized Signature / Date', { x: left, y: 58, size: 7.5, font: regular, color: text });
  page.drawText('Client Conforme & Acceptance / Date', { x: width - 200, y: 58, size: 7.5, font: regular, color: text });
  page.drawText('This is a computer-generated commercial quotation issued by SentinelOps. Not a valid tax receipt under Philippine BIR regulations.', { x: left, y: 30, size: 6.5, font: regular, color: rgb(0.5, 0.55, 0.6) });
  return pdfDoc.save();
}

/** Legacy single-page renderer retained for reference during migration. */
export async function generateQuotationPdfLegacy(
  quotation: Quotation,
  settings: AppSettings
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4 size
  const { width, height } = page.getSize();

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const primaryColor = rgb(0.06, 0.09, 0.16); // Slate 900
  const accentColor = rgb(0.15, 0.39, 0.92); // Blue 600
  const textColor = rgb(0.2, 0.25, 0.33); // Slate 700
  const lightGrey = rgb(0.94, 0.96, 0.98); // Slate 100
  const borderGrey = rgb(0.85, 0.88, 0.92); // Slate 300

  let y = height - 50;

  // Header Banner
  page.drawRectangle({
    x: 40,
    y: y - 55,
    width: width - 80,
    height: 65,
    color: primaryColor,
  });

  // Company Name
  page.drawText(settings.businessName.toUpperCase(), {
    x: 55,
    y: y - 20,
    size: 13,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  // Tagline / Subtitle
  page.drawText(settings.tagline, {
    x: 55,
    y: y - 36,
    size: 8,
    font: fontRegular,
    color: rgb(0.8, 0.85, 0.9),
  });

  // Document Title on right side
  const docTitle = quotation.revisionNumber > 0
    ? `QUOTATION (REV ${quotation.revisionNumber})`
    : 'FORMAL QUOTATION';

  page.drawText(docTitle, {
    x: width - 230,
    y: y - 25,
    size: 12,
    font: fontBold,
    color: rgb(0.98, 0.75, 0.18), // Amber accent
  });

  page.drawText(`Ref: ${quotation.quotationNumber}`, {
    x: width - 230,
    y: y - 42,
    size: 10,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  y -= 80;

  // Info Columns (Company Info vs Client Info)
  // Left Column: Business Details
  page.drawText('FROM:', { x: 40, y, size: 8, font: fontBold, color: accentColor });
  page.drawText(settings.businessName, { x: 40, y: y - 12, size: 9, font: fontBold, color: primaryColor });
  page.drawText(settings.address, { x: 40, y: y - 24, size: 8, font: fontRegular, color: textColor });
  page.drawText(`${settings.city}, ${settings.region}`, { x: 40, y: y - 35, size: 8, font: fontRegular, color: textColor });
  page.drawText(`Tel: ${settings.contactNumber} | Email: ${settings.email}`, { x: 40, y: y - 46, size: 8, font: fontRegular, color: textColor });
  if (settings.tinNumber) {
    page.drawText(`TIN: ${settings.tinNumber}`, { x: 40, y: y - 57, size: 8, font: fontRegular, color: textColor });
  }

  // Right Column: Client & Quotation Dates
  const colRightX = 330;
  page.drawText('PREPARED FOR:', { x: colRightX, y, size: 8, font: fontBold, color: accentColor });
  page.drawText(quotation.clientName, { x: colRightX, y: y - 12, size: 9, font: fontBold, color: primaryColor });
  page.drawText(quotation.clientAddress || 'Client Site Address', { x: colRightX, y: y - 24, size: 8, font: fontRegular, color: textColor });
  page.drawText(`Contact: ${quotation.clientContact || 'N/A'}`, { x: colRightX, y: y - 35, size: 8, font: fontRegular, color: textColor });
  page.drawText(`Date Issued: ${quotation.issueDate}   |   Valid Until: ${quotation.expiryDate}`, {
    x: colRightX,
    y: y - 46,
    size: 8,
    font: fontRegular,
    color: textColor,
  });

  y -= 75;

  // Project Title Box
  page.drawRectangle({
    x: 40,
    y: y - 24,
    width: width - 80,
    height: 28,
    color: lightGrey,
    borderColor: borderGrey,
    borderWidth: 1,
  });

  page.drawText(`PROJECT / SERVICE: ${quotation.projectTitle.toUpperCase()}`, {
    x: 50,
    y: y - 16,
    size: 9,
    font: fontBold,
    color: primaryColor,
  });

  page.drawText(`Category: ${quotation.serviceCategory}`, {
    x: width - 230,
    y: y - 16,
    size: 8,
    font: fontRegular,
    color: accentColor,
  });

  y -= 40;

  // Scope of Work summary if provided
  if (quotation.scopeOfWork) {
    page.drawText('SCOPE OF WORK:', { x: 40, y, size: 8, font: fontBold, color: primaryColor });
    const scopePreview = quotation.scopeOfWork.length > 140
      ? quotation.scopeOfWork.substring(0, 140) + '...'
      : quotation.scopeOfWork;
    page.drawText(scopePreview, { x: 40, y: y - 12, size: 7.5, font: fontRegular, color: textColor });
    y -= 30;
  }

  // Line Items Table Header
  const tableHeaderY = y;
  page.drawRectangle({
    x: 40,
    y: tableHeaderY - 18,
    width: width - 80,
    height: 22,
    color: primaryColor,
  });

  page.drawText('NO.', { x: 48, y: tableHeaderY - 12, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText('CATEGORY', { x: 75, y: tableHeaderY - 12, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText('DESCRIPTION / SPECIFICATIONS', { x: 150, y: tableHeaderY - 12, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText('QTY & UNIT', { x: 380, y: tableHeaderY - 12, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText('UNIT PRICE (PHP)', { x: 440, y: tableHeaderY - 12, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText('TOTAL (PHP)', { x: 515, y: tableHeaderY - 12, size: 8, font: fontBold, color: rgb(1, 1, 1) });

  y -= 22;

  // Render Line Items
  quotation.lineItems.forEach((item, index) => {
    const isEven = index % 2 === 0;
    const rowHeight = 20;

    if (isEven) {
      page.drawRectangle({
        x: 40,
        y: y - rowHeight,
        width: width - 80,
        height: rowHeight,
        color: lightGrey,
      });
    }

    page.drawText(`${index + 1}`, { x: 50, y: y - 13, size: 8, font: fontRegular, color: textColor });
    page.drawText(item.category || 'Materials', { x: 75, y: y - 13, size: 7.5, font: fontRegular, color: textColor });

    // Truncate long descriptions
    const descText = item.description.length > 45
      ? item.description.substring(0, 42) + '...'
      : item.description;
    page.drawText(descText, { x: 150, y: y - 13, size: 7.5, font: fontRegular, color: primaryColor });

    page.drawText(`${item.quantity} ${item.unit}`, { x: 380, y: y - 13, size: 7.5, font: fontRegular, color: textColor });
    page.drawText(fromCentavos(item.unitPriceCentavos).toFixed(2), {
      x: 440,
      y: y - 13,
      size: 7.5,
      font: fontRegular,
      color: textColor,
    });
    page.drawText(fromCentavos(item.totalCentavos).toFixed(2), {
      x: 515,
      y: y - 13,
      size: 7.5,
      font: fontBold,
      color: primaryColor,
    });

    y -= rowHeight;
  });

  // Table bottom border
  page.drawLine({
    start: { x: 40, y },
    end: { x: width - 40, y },
    thickness: 1,
    color: borderGrey,
  });

  y -= 10;

  // Totals Area (Right aligned)
  const totalsX = 380;
  page.drawText('Subtotal:', { x: totalsX, y, size: 9, font: fontRegular, color: textColor });
  page.drawText(formatPhp(quotation.subtotalCentavos), { x: 480, y, size: 9, font: fontRegular, color: textColor });
  y -= 15;

  if (quotation.taxMode !== 'NON_VAT') {
    const taxLabel = quotation.taxMode === 'INCLUSIVE'
      ? `VAT (${quotation.taxRatePercent}% Incl.):`
      : `VAT (${quotation.taxRatePercent}%):`;
    page.drawText(taxLabel, { x: totalsX, y, size: 9, font: fontRegular, color: textColor });
    page.drawText(formatPhp(quotation.taxCentavos), { x: 480, y, size: 9, font: fontRegular, color: textColor });
    y -= 15;
  }

  // Grand Total Box
  page.drawRectangle({
    x: totalsX - 10,
    y: y - 8,
    width: width - totalsX - 30,
    height: 24,
    color: primaryColor,
  });

  page.drawText('GRAND TOTAL:', { x: totalsX, y, size: 10, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText(formatPhp(quotation.grandTotalCentavos), {
    x: 480,
    y,
    size: 10,
    font: fontBold,
    color: rgb(0.98, 0.75, 0.18),
  });

  y -= 35;

  // Terms and Conditions Box
  page.drawText('TERMS & CONDITIONS:', { x: 40, y, size: 8, font: fontBold, color: primaryColor });
  y -= 12;

  const terms = quotation.termsAndConditions || settings.defaultPaymentTerms;
  const termsLines = [
    terms.length > 120 ? terms.substring(0, 120) : terms,
    settings.defaultWarrantyTerms.length > 120 ? settings.defaultWarrantyTerms.substring(0, 120) : settings.defaultWarrantyTerms,
  ];

  for (const line of termsLines) {
    page.drawText(`• ${line}`, { x: 40, y, size: 7, font: fontRegular, color: textColor });
    y -= 10;
  }

  // Sign-off / Signature section
  y = Math.max(y - 20, 90);

  // Prepared By (Left)
  page.drawLine({ start: { x: 40, y: y + 25 }, end: { x: 200, y: y + 25 }, thickness: 1, color: borderGrey });
  page.drawText('Authorized Signature / Date', { x: 40, y: y + 12, size: 7.5, font: fontRegular, color: textColor });
  page.drawText(settings.businessName, { x: 40, y: y + 2, size: 8, font: fontBold, color: primaryColor });

  // Client Acceptance (Right)
  page.drawLine({ start: { x: width - 200, y: y + 25 }, end: { x: width - 40, y: y + 25 }, thickness: 1, color: borderGrey });
  page.drawText('Client Conforme & Acceptance / Date', { x: width - 200, y: y + 12, size: 7.5, font: fontRegular, color: textColor });
  page.drawText(quotation.clientName, { x: width - 200, y: y + 2, size: 8, font: fontBold, color: primaryColor });

  // Footer Disclaimer
  page.drawText(
    'This is a computer-generated commercial quotation issued by SentinelOps. Not a valid tax receipt under Philippine BIR regulations.',
    {
      x: 40,
      y: 30,
      size: 6.5,
      font: fontRegular,
      color: rgb(0.5, 0.55, 0.6),
    }
  );

  return await pdfDoc.save();
}

/**
 * Generates a Billing Invoice PDF document
 */
export async function generateInvoicePdf(
  invoice: Invoice,
  settings: AppSettings
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const primaryColor = rgb(0.06, 0.09, 0.16);
  const accentColor = rgb(0.15, 0.39, 0.92);
  const textColor = rgb(0.2, 0.25, 0.33);
  const lightGrey = rgb(0.94, 0.96, 0.98);
  const borderGrey = rgb(0.85, 0.88, 0.92);

  let y = height - 50;

  // Header Banner
  page.drawRectangle({
    x: 40,
    y: y - 55,
    width: width - 80,
    height: 65,
    color: primaryColor,
  });

  page.drawText(settings.businessName.toUpperCase(), {
    x: 55,
    y: y - 20,
    size: 13,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  page.drawText(settings.tagline, {
    x: 55,
    y: y - 36,
    size: 8,
    font: fontRegular,
    color: rgb(0.8, 0.85, 0.9),
  });

  // Invoice Title
  page.drawText('BILLING INVOICE', {
    x: width - 210,
    y: y - 25,
    size: 12,
    font: fontBold,
    color: rgb(0.98, 0.75, 0.18),
  });

  page.drawText(`No: ${invoice.invoiceNumber}`, {
    x: width - 210,
    y: y - 42,
    size: 10,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  y -= 80;

  // Info Section
  page.drawText('BILLED FROM:', { x: 40, y, size: 8, font: fontBold, color: accentColor });
  page.drawText(settings.businessName, { x: 40, y: y - 12, size: 9, font: fontBold, color: primaryColor });
  page.drawText(settings.address, { x: 40, y: y - 24, size: 8, font: fontRegular, color: textColor });
  page.drawText(`${settings.city}, ${settings.region}`, { x: 40, y: y - 35, size: 8, font: fontRegular, color: textColor });
  page.drawText(`Tel: ${settings.contactNumber} | Email: ${settings.email}`, { x: 40, y: y - 46, size: 8, font: fontRegular, color: textColor });
  if (settings.tinNumber) {
    page.drawText(`TIN: ${settings.tinNumber}`, { x: 40, y: y - 57, size: 8, font: fontRegular, color: textColor });
  }

  const colRightX = 330;
  page.drawText('BILLED TO:', { x: colRightX, y, size: 8, font: fontBold, color: accentColor });
  page.drawText(invoice.clientName, { x: colRightX, y: y - 12, size: 9, font: fontBold, color: primaryColor });
  page.drawText(invoice.clientAddress || 'Client Site Address', { x: colRightX, y: y - 24, size: 8, font: fontRegular, color: textColor });
  page.drawText(`Contact: ${invoice.clientContact || 'N/A'}`, { x: colRightX, y: y - 35, size: 8, font: fontRegular, color: textColor });
  page.drawText(`Date Issued: ${invoice.issueDate}   |   Due Date: ${invoice.dueDate}`, {
    x: colRightX,
    y: y - 46,
    size: 8,
    font: fontBold,
    color: primaryColor,
  });
  if (invoice.quotationNumber) {
    page.drawText(`Quotation Ref: ${invoice.quotationNumber}`, { x: colRightX, y: y - 57, size: 8, font: fontRegular, color: textColor });
  }

  y -= 75;

  // Title Box
  page.drawRectangle({
    x: 40,
    y: y - 24,
    width: width - 80,
    height: 28,
    color: lightGrey,
    borderColor: borderGrey,
    borderWidth: 1,
  });

  page.drawText(`SUBJECT / BILLING FOR: ${invoice.title.toUpperCase()}`, {
    x: 50,
    y: y - 16,
    size: 9,
    font: fontBold,
    color: primaryColor,
  });

  const statusLabel = `Status: ${invoice.status.toUpperCase()}`;
  page.drawText(statusLabel, {
    x: width - 180,
    y: y - 16,
    size: 8,
    font: fontBold,
    color: invoice.status === 'Paid' ? rgb(0.1, 0.6, 0.2) : accentColor,
  });

  y -= 40;

  // Table Header
  const tableHeaderY = y;
  page.drawRectangle({
    x: 40,
    y: tableHeaderY - 18,
    width: width - 80,
    height: 22,
    color: primaryColor,
  });

  page.drawText('NO.', { x: 48, y: tableHeaderY - 12, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText('ITEM DESCRIPTION / SCOPE', { x: 80, y: tableHeaderY - 12, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText('QTY & UNIT', { x: 380, y: tableHeaderY - 12, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText('UNIT PRICE (PHP)', { x: 440, y: tableHeaderY - 12, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText('AMOUNT (PHP)', { x: 515, y: tableHeaderY - 12, size: 8, font: fontBold, color: rgb(1, 1, 1) });

  y -= 22;

  invoice.lineItems.forEach((item, index) => {
    const isEven = index % 2 === 0;
    const rowHeight = 20;

    if (isEven) {
      page.drawRectangle({
        x: 40,
        y: y - rowHeight,
        width: width - 80,
        height: rowHeight,
        color: lightGrey,
      });
    }

    page.drawText(`${index + 1}`, { x: 50, y: y - 13, size: 8, font: fontRegular, color: textColor });
    page.drawText(item.description.length > 55 ? item.description.substring(0, 52) + '...' : item.description, {
      x: 80,
      y: y - 13,
      size: 7.5,
      font: fontRegular,
      color: primaryColor,
    });
    page.drawText(`${item.quantity} ${item.unit}`, { x: 380, y: y - 13, size: 7.5, font: fontRegular, color: textColor });
    page.drawText(fromCentavos(item.unitPriceCentavos).toFixed(2), {
      x: 440,
      y: y - 13,
      size: 7.5,
      font: fontRegular,
      color: textColor,
    });
    page.drawText(fromCentavos(item.totalCentavos).toFixed(2), {
      x: 515,
      y: y - 13,
      size: 7.5,
      font: fontBold,
      color: primaryColor,
    });

    y -= rowHeight;
  });

  page.drawLine({ start: { x: 40, y }, end: { x: width - 40, y }, thickness: 1, color: borderGrey });
  y -= 10;

  // Payment Breakdown
  const totalsX = 360;
  page.drawText('Subtotal:', { x: totalsX, y, size: 9, font: fontRegular, color: textColor });
  page.drawText(formatPhp(invoice.subtotalCentavos), { x: 480, y, size: 9, font: fontRegular, color: textColor });
  y -= 15;

  if (invoice.taxMode !== 'NON_VAT') {
    const taxLabel = invoice.taxMode === 'INCLUSIVE'
      ? `VAT (${invoice.taxRatePercent}% Incl.):`
      : `VAT (${invoice.taxRatePercent}%):`;
    page.drawText(taxLabel, { x: totalsX, y, size: 9, font: fontRegular, color: textColor });
    page.drawText(formatPhp(invoice.taxCentavos), { x: 480, y, size: 9, font: fontRegular, color: textColor });
    y -= 15;
  }

  page.drawText('Grand Total Billed:', { x: totalsX, y, size: 9, font: fontBold, color: primaryColor });
  page.drawText(formatPhp(invoice.grandTotalCentavos), { x: 480, y, size: 9, font: fontBold, color: primaryColor });
  y -= 15;

  page.drawText('Total Paid to Date:', { x: totalsX, y, size: 9, font: fontRegular, color: rgb(0.1, 0.6, 0.2) });
  page.drawText(formatPhp(invoice.paidAmountCentavos), { x: 480, y, size: 9, font: fontRegular, color: rgb(0.1, 0.6, 0.2) });
  y -= 18;

  // Remaining Balance Banner
  page.drawRectangle({
    x: totalsX - 10,
    y: y - 8,
    width: width - totalsX - 30,
    height: 24,
    color: invoice.remainingBalanceCentavos > 0 ? rgb(0.7, 0.1, 0.1) : rgb(0.1, 0.5, 0.2),
  });

  page.drawText('BALANCE DUE:', { x: totalsX, y, size: 9, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText(formatPhp(invoice.remainingBalanceCentavos), {
    x: 480,
    y,
    size: 9.5,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  y -= 35;

  // Payment Instructions
  page.drawText('PAYMENT INSTRUCTIONS & BANK DETAILS:', { x: 40, y, size: 8, font: fontBold, color: primaryColor });
  y -= 12;

  const instructions = [
    'Direct Bank Transfer: BDO Unibank Current Acct # 0012-3456-7890 (Sentinel Security Solutions)',
    'GCash / Maya Operations: +63 917 555 8921 (Account: SentinelOps Operations)',
    'Please send proof of payment / transaction screenshot referencing invoice number to billing@sentinelops.local',
  ];

  for (const line of instructions) {
    page.drawText(`• ${line}`, { x: 40, y, size: 7, font: fontRegular, color: textColor });
    y -= 10;
  }

  // Footer Disclaimer
  page.drawText(
    'This billing document is an internal commercial invoice issued by SentinelOps. Not an authorized BIR tax invoice.',
    {
      x: 40,
      y: 30,
      size: 6.5,
      font: fontRegular,
      color: rgb(0.5, 0.55, 0.6),
    }
  );

  return await pdfDoc.save();
}

/**
 * Generates an Official Collection Receipt / Payment Acknowledgment PDF document
 */
export async function generatePaymentReceiptPdf(
  payment: Payment,
  invoice: Invoice,
  settings: AppSettings
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  // Standard Half-Page / Voucher format (595.28 x 420.94 - A5 landscape)
  const page = pdfDoc.addPage([595.28, 420.94]);
  const { width, height } = page.getSize();

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const primaryColor = rgb(0.06, 0.09, 0.16);
  const accentColor = rgb(0.15, 0.39, 0.92);
  const textColor = rgb(0.2, 0.25, 0.33);
  const lightGrey = rgb(0.94, 0.96, 0.98);
  const borderGrey = rgb(0.85, 0.88, 0.92);

  let y = height - 40;

  // Top header banner
  page.drawRectangle({
    x: 35,
    y: y - 45,
    width: width - 70,
    height: 50,
    color: primaryColor,
  });

  page.drawText(settings.businessName.toUpperCase(), {
    x: 45,
    y: y - 18,
    size: 11,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  page.drawText('COLLECTION RECEIPT & PAYMENT ACKNOWLEDGMENT', {
    x: 45,
    y: y - 32,
    size: 7.5,
    font: fontRegular,
    color: rgb(0.85, 0.9, 0.98),
  });

  page.drawText(`RECEIPT NO: ${payment.paymentNumber}`, {
    x: width - 210,
    y: y - 20,
    size: 10,
    font: fontBold,
    color: rgb(0.98, 0.75, 0.18),
  });

  page.drawText(`Date: ${payment.paymentDate}`, {
    x: width - 210,
    y: y - 33,
    size: 8,
    font: fontRegular,
    color: rgb(1, 1, 1),
  });

  y -= 65;

  // Received From & Reference Details
  page.drawRectangle({
    x: 35,
    y: y - 65,
    width: width - 70,
    height: 70,
    color: lightGrey,
    borderColor: borderGrey,
    borderWidth: 1,
  });

  page.drawText(`RECEIVED FROM:`, { x: 45, y: y - 15, size: 8, font: fontBold, color: primaryColor });
  page.drawText(payment.clientName.toUpperCase(), { x: 135, y: y - 15, size: 8.5, font: fontBold, color: accentColor });

  page.drawText(`INVOICE REFERENCE:`, { x: 45, y: y - 30, size: 8, font: fontBold, color: primaryColor });
  page.drawText(`${payment.invoiceNumber} - ${invoice.title}`, { x: 155, y: y - 30, size: 8, font: fontRegular, color: textColor });

  page.drawText(`PAYMENT METHOD:`, { x: 45, y: y - 45, size: 8, font: fontBold, color: primaryColor });
  page.drawText(payment.paymentMethod, { x: 145, y: y - 45, size: 8, font: fontRegular, color: textColor });

  page.drawText(`TRANSACTION REF / CHECK #:`, { x: 330, y: y - 45, size: 8, font: fontBold, color: primaryColor });
  page.drawText(payment.referenceNumber || 'N/A (Cash)', { x: 475, y: y - 45, size: 8, font: fontRegular, color: textColor });

  page.drawText(`RECEIVED BY:`, { x: 45, y: y - 58, size: 8, font: fontBold, color: primaryColor });
  page.drawText(payment.receivedBy || 'Authorized Officer', { x: 135, y: y - 58, size: 8, font: fontRegular, color: textColor });

  y -= 80;

  // Amount in words box
  page.drawText('THE SUM OF:', { x: 45, y, size: 8, font: fontBold, color: primaryColor });
  const words = amountInWords(payment.amountCentavos);
  page.drawText(words, { x: 115, y, size: 8, font: fontBold, color: accentColor });

  y -= 25;

  // Amount and Balance Breakdown
  const colW = (width - 70) / 3;

  // Box 1: Amount Collected
  page.drawRectangle({ x: 35, y: y - 35, width: colW - 5, height: 40, color: rgb(0.9, 0.96, 0.9) });
  page.drawText('AMOUNT COLLECTED', { x: 45, y: y - 12, size: 7.5, font: fontBold, color: rgb(0.1, 0.5, 0.2) });
  page.drawText(formatPhp(payment.amountCentavos), { x: 45, y: y - 28, size: 12, font: fontBold, color: rgb(0.1, 0.5, 0.2) });

  // Box 2: Total Invoice Grand Total
  page.drawRectangle({ x: 35 + colW, y: y - 35, width: colW - 5, height: 40, color: lightGrey });
  page.drawText('INVOICE TOTAL', { x: 45 + colW, y: y - 12, size: 7.5, font: fontBold, color: textColor });
  page.drawText(formatPhp(invoice.grandTotalCentavos), { x: 45 + colW, y: y - 28, size: 11, font: fontBold, color: primaryColor });

  // Box 3: Remaining Balance
  page.drawRectangle({ x: 35 + colW * 2, y: y - 35, width: colW, height: 40, color: lightGrey });
  page.drawText('REMAINING BALANCE', { x: 45 + colW * 2, y: y - 12, size: 7.5, font: fontBold, color: textColor });
  page.drawText(formatPhp(payment.remainingBalanceAfterPaymentCentavos), {
    x: 45 + colW * 2,
    y: y - 28,
    size: 11,
    font: fontBold,
    color: payment.remainingBalanceAfterPaymentCentavos > 0 ? rgb(0.7, 0.1, 0.1) : rgb(0.1, 0.5, 0.2),
  });

  y -= 60;

  // Signature Block
  page.drawLine({ start: { x: width - 210, y: y + 15 }, end: { x: width - 40, y: y + 15 }, thickness: 1, color: borderGrey });
  page.drawText('Authorized Representative Signature', { x: width - 210, y: y + 4, size: 7, font: fontRegular, color: textColor });
  page.drawText(settings.businessName, { x: width - 210, y: y - 6, size: 7.5, font: fontBold, color: primaryColor });

  // Compliance notice at bottom
  page.drawText(
    'Notice: This payment acknowledgment is an internal commercial receipt issued for client reference. Not an Official Receipt (OR) registered with the BIR.',
    {
      x: 35,
      y: 18,
      size: 6,
      font: fontRegular,
      color: rgb(0.5, 0.55, 0.6),
    }
  );

  return await pdfDoc.save();
}

/**
 * Triggers browser download of a generated PDF
 */
export function downloadPdfBlob(pdfBytes: Uint8Array, fileName: string): void {
  const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * Opens PDF in browser for native printing
 */
export function printPdfBlob(pdfBytes: Uint8Array): void {
  const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  iframe.src = url;
  iframe.onload = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => {
      document.body.removeChild(iframe);
      URL.revokeObjectURL(url);
    }, 60000);
  };
}

/**
 * Share PDF file using Web Share API if supported, or fallback to download
 */
export async function sharePdfBlob(
  pdfBytes: Uint8Array,
  fileName: string,
  title: string,
  fallbackSummary?: string
): Promise<boolean> {
  const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
  const file = new File([blob], fileName, { type: 'application/pdf' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title,
        text: `Attached is ${title} from SentinelOps.`,
      });
      return true;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return false;
      }
      console.warn('Web Share failed, falling back to download:', err);
    }
  }

  // Fallback to direct download
  downloadPdfBlob(pdfBytes, fileName);
  if (fallbackSummary && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(fallbackSummary);
    } catch {
      // Clipboard access is optional; the PDF download remains available.
    }
  }
  return true;
}
