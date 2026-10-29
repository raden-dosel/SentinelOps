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
  const cyan = rgb(0.05, 0.65, 0.82);
  const text = rgb(0.2, 0.25, 0.33);
  const pale = rgb(0.96, 0.97, 0.99);
  const border = rgb(0.85, 0.88, 0.92);
  const white = rgb(1, 1, 1);
  const amber = rgb(0.98, 0.75, 0.18);

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

  let pageIndex = 1;
  let page = pdfDoc.addPage([width, height]);
  let y = height - 50;

  const drawHeader = (isContinuation = false) => {
    const bannerHeight = 68;
    page.drawRectangle({ x: left, y: y - bannerHeight, width: right - left, height: bannerHeight, color: primary });
    page.drawRectangle({ x: left, y: y - bannerHeight - 2, width: right - left, height: 2, color: cyan });

    // 1. Dedicated Logo in the topmost left
    const logoX = left + 8;
    const logoY = y - bannerHeight + 11;
    const logoW = 44;
    const logoH = 46;

    page.drawRectangle({
      x: logoX,
      y: logoY,
      width: logoW,
      height: logoH,
      color: rgb(0.1, 0.15, 0.25),
      borderColor: cyan,
      borderWidth: 1.2,
    });
    page.drawRectangle({
      x: logoX + 5,
      y: logoY + 16,
      width: 34,
      height: 24,
      color: cyan,
    });
    page.drawText('SO', {
      x: logoX + 10,
      y: logoY + 22,
      size: 14,
      font: bold,
      color: white,
    });
    page.drawText('SECURITY', {
      x: logoX + 4.5,
      y: logoY + 5.5,
      size: 5.5,
      font: bold,
      color: rgb(0.65, 0.82, 0.96),
    });

    // 2. Company branding to the right of logo
    const companyX = left + 60;
    const rightColWidth = 195;
    const rightColStartX = right - rightColWidth;
    const maxCompanyWidth = rightColStartX - companyX - 10;

    let companySize = 11.5;
    while (companySize > 8 && bold.widthOfTextAtSize(settings.businessName.toUpperCase(), companySize) > maxCompanyWidth) {
      companySize -= 0.5;
    }
    page.drawText(settings.businessName.toUpperCase(), {
      x: companyX,
      y: y - 22,
      size: companySize,
      font: bold,
      color: white,
    });

    let tagline = settings.tagline;
    while (tagline.length > 5 && regular.widthOfTextAtSize(tagline, 7.5) > maxCompanyWidth) {
      tagline = tagline.slice(0, -4) + '...';
    }
    page.drawText(tagline, {
      x: companyX,
      y: y - 36,
      size: 7.5,
      font: regular,
      color: rgb(0.8, 0.85, 0.92),
    });

    const contactLine = `${settings.city || settings.address} | Tel: ${settings.contactNumber}`;
    let displayContact = contactLine;
    while (displayContact.length > 5 && regular.widthOfTextAtSize(displayContact, 6.5) > maxCompanyWidth) {
      displayContact = displayContact.slice(0, -4) + '...';
    }
    page.drawText(displayContact, {
      x: companyX,
      y: y - 48,
      size: 6.5,
      font: regular,
      color: rgb(0.65, 0.78, 0.9),
    });

    // 3. Document title & metadata on the right (aligned with left rows)
    const docTitle = quotation.revisionNumber > 0
      ? `QUOTATION (REV ${quotation.revisionNumber})${isContinuation ? ` - P.${pageIndex}` : ''}`
      : `FORMAL QUOTATION${isContinuation ? ` - P.${pageIndex}` : ''}`;
    const titleW = bold.widthOfTextAtSize(docTitle, 12);
    page.drawText(docTitle, {
      x: right - 12 - titleW,
      y: y - 22, // Vertically aligned with company name
      size: 12,
      font: bold,
      color: amber,
    });

    const refText = `Ref: ${quotation.quotationNumber}`;
    const refW = bold.widthOfTextAtSize(refText, 9.5);
    page.drawText(refText, {
      x: right - 12 - refW,
      y: y - 36, // Vertically aligned with tagline
      size: 9.5,
      font: bold,
      color: white,
    });

    const dateText = `Issued: ${quotation.issueDate} | Valid: ${quotation.expiryDate}`;
    const dateW = regular.widthOfTextAtSize(dateText, 7.5);
    page.drawText(dateText, {
      x: right - 12 - dateW,
      y: y - 48, // Vertically aligned with contact line
      size: 7.5,
      font: regular,
      color: rgb(0.8, 0.85, 0.92),
    });

    y -= (bannerHeight + 20);
  };

  const drawTableHeader = () => {
    page.drawRectangle({ x: left, y: y - 18, width: right - left, height: 22, color: primary });
    const labels = [
      ['NO.', 48],
      ['CATEGORY', 75],
      ['DESCRIPTION / SPECIFICATIONS', 145],
      ['QTY & UNIT', 365],
      ['UNIT PRICE (PHP)', 435],
      ['TOTAL (PHP)', 505],
    ];
    labels.forEach(([label, xPos]) => page.drawText(String(label), { x: Number(xPos), y: y - 12, size: 7.5, font: bold, color: white }));
    y -= 22;
  };

  const newContentPage = () => {
    pageIndex += 1;
    page = pdfDoc.addPage([width, height]);
    y = height - 50;
    drawHeader(true);
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

  drawHeader(false);

  // Two-Column Parties Panel (No overlapping headers!)
  const colWidth = (right - left) / 2 - 12;
  const rightColX = left + colWidth + 24;

  page.drawText('FROM:', { x: left, y, size: 8, font: bold, color: cyan });
  page.drawText('PREPARED FOR:', { x: rightColX, y, size: 8, font: bold, color: cyan });
  y -= 13; // Crucial: advance below labels before drawing sender/client text

  let fromY = y;
  const drawFromLine = (value: string, font = regular, size = 7.5, color = text, gap = 10) => {
    const lines = wrap(value, colWidth, size);
    lines.forEach((line) => {
      page.drawText(line, { x: left, y: fromY, size, font, color });
      fromY -= gap;
    });
  };

  let toY = y;
  const drawToLine = (value: string, font = regular, size = 7.5, color = text, gap = 10) => {
    const lines = wrap(value, colWidth, size);
    lines.forEach((line) => {
      page.drawText(line, { x: rightColX, y: toY, size, font, color });
      toY -= gap;
    });
  };

  drawFromLine(settings.businessName, bold, 8.5, primary, 11);
  drawFromLine(settings.address);
  drawFromLine(`${settings.city}, ${settings.region}`);
  drawFromLine(`Tel: ${settings.contactNumber} | Email: ${settings.email}`);
  if (settings.tinNumber) drawFromLine(`TIN: ${settings.tinNumber}`);

  drawToLine(quotation.clientName, bold, 8.5, primary, 11);
  drawToLine(quotation.clientAddress || 'Client Site Address');
  drawToLine(`Contact: ${quotation.clientContact || 'N/A'}`);
  drawToLine(`Date Issued: ${quotation.issueDate} | Valid Until: ${quotation.expiryDate}`);

  y = Math.min(fromY, toY) - 14;

  // Project / Service Callout Box with Cyan Left Edge and Category Badge
  const calloutHeight = 28;
  page.drawRectangle({ x: left, y: y - calloutHeight, width: right - left, height: calloutHeight, color: pale, borderColor: border, borderWidth: 1 });
  page.drawRectangle({ x: left, y: y - calloutHeight, width: 3.5, height: calloutHeight, color: cyan });

  // Service Category Badge on the right
  const catText = quotation.serviceCategory;
  const catW = regular.widthOfTextAtSize(catText, 7.5);
  const badgeW = catW + 16;
  const badgeX = right - 10 - badgeW;
  const badgeY = y - 22;
  page.drawRectangle({
    x: badgeX,
    y: badgeY,
    width: badgeW,
    height: 16,
    color: rgb(0.92, 0.97, 1),
    borderColor: cyan,
    borderWidth: 1,
  });
  page.drawText(catText, {
    x: badgeX + 8,
    y: badgeY + 4.5,
    size: 7.5,
    font: bold,
    color: cyan,
  });

  const projLabel = 'PROJECT / SERVICE:';
  page.drawText(projLabel, { x: left + 10, y: y - 17, size: 7.5, font: bold, color: cyan });
  const labelW = bold.widthOfTextAtSize(projLabel, 7.5);

  const titleStartX = left + 10 + labelW + 6;
  const maxTitleW = badgeX - 10 - titleStartX;
  let titleStr = quotation.projectTitle.toUpperCase();
  if (bold.widthOfTextAtSize(titleStr, 8) > maxTitleW) {
    while (titleStr.length > 3 && bold.widthOfTextAtSize(titleStr + '...', 8) > maxTitleW) {
      titleStr = titleStr.slice(0, -1);
    }
    titleStr += '...';
  }
  page.drawText(titleStr, { x: titleStartX, y: y - 17, size: 8, font: bold, color: primary });

  y -= (calloutHeight + 14);

  page.drawText('SCOPE OF WORK:', { x: left, y, size: 8, font: bold, color: primary });
  y -= 12;
  drawWrapped(quotation.scopeOfWork || 'No scope specified.', left, right - left, 7.5, text, regular, 10);
  y -= 6;
  drawTableHeader();

  quotation.lineItems.forEach((item, index) => {
    const descriptionLines = wrap(item.description, 210, 7.5);
    const rowHeight = Math.max(20, descriptionLines.length * 10 + 6);
    if (y - rowHeight < 110) newContentPage();
    if (index % 2 === 0) page.drawRectangle({ x: left, y: y - rowHeight, width: right - left, height: rowHeight, color: pale });
    page.drawText(`${index + 1}`, { x: 50, y: y - 13, size: 8, font: regular, color: text });
    page.drawText(item.category || 'Materials', { x: 75, y: y - 13, size: 7.5, font: regular, color: text });
    descriptionLines.forEach((line, lineIndex) => page.drawText(line, { x: 145, y: y - 11 - lineIndex * 10, size: 7.5, font: regular, color: primary }));
    page.drawText(`${item.quantity} ${item.unit}`, { x: 365, y: y - 13, size: 7.5, font: regular, color: text });
    page.drawText(fromCentavos(item.unitPriceCentavos).toFixed(2), { x: 435, y: y - 13, size: 7.5, font: regular, color: text });
    page.drawText(fromCentavos(item.totalCentavos).toFixed(2), { x: 505, y: y - 13, size: 7.5, font: bold, color: primary });
    y -= rowHeight;
  });

  if (y < 190) newContentPage();
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: border });
  y -= 14;

  // Totals Area (Structured, aligned, no overlapping banners)
  const totalsX = 350;
  const valueRightX = right - 12;
  const drawTotal = (label: string, value: string) => {
    page.drawText(label, { x: totalsX, y, size: 8.5, font: regular, color: text });
    const valWidth = regular.widthOfTextAtSize(value, 8.5);
    page.drawText(value, { x: valueRightX - valWidth, y, size: 8.5, font: regular, color: text });
    y -= 15;
  };
  drawTotal('Subtotal:', formatPhp(quotation.subtotalCentavos));
  if (quotation.taxMode !== 'NON_VAT') {
    drawTotal(`VAT (${quotation.taxRatePercent}%):`, formatPhp(quotation.taxCentavos));
  }

  // Clear vertical buffer before Grand Total banner
  y -= 4;
  const bannerHeight = 22;
  page.drawRectangle({
    x: totalsX - 8,
    y: y - 16,
    width: (valueRightX + 12) - (totalsX - 8),
    height: bannerHeight,
    color: primary,
  });
  page.drawText('GRAND TOTAL:', { x: totalsX, y: y - 11, size: 9, font: bold, color: white });
  const gtText = formatPhp(quotation.grandTotalCentavos);
  const gtWidth = bold.widthOfTextAtSize(gtText, 9.5);
  page.drawText(gtText, {
    x: valueRightX - gtWidth,
    y: y - 11,
    size: 9.5,
    font: bold,
    color: amber,
  });
  y -= 32;

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
 * Generates an itemized, paginated Billing Invoice PDF document
 * adhering to the compact technical-business design system in INVOICE_TEMPLATE_DESIGN.md.
 */
export async function generateInvoicePdf(
  invoice: Invoice,
  settings: AppSettings
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const width = 595.28;
  const height = 841.89;
  const left = 40;
  const right = width - 40;

  // Design Tokens from INVOICE_TEMPLATE_DESIGN.md
  const primary = rgb(0.06, 0.09, 0.16); // Navy (#0f172a)
  const cyan = rgb(0.05, 0.65, 0.82);    // Restrained Cyan accent (#0891b2 / #06b6d4)
  const text = rgb(0.2, 0.25, 0.33);      // Slate text
  const pale = rgb(0.96, 0.97, 0.99);    // Pale tint
  const border = rgb(0.85, 0.88, 0.92);  // Light border
  const white = rgb(1, 1, 1);
  const amber = rgb(0.98, 0.75, 0.18);
  const success = rgb(0.1, 0.6, 0.2);
  const danger = rgb(0.7, 0.1, 0.1);

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

  let pageIndex = 1;
  let page = pdfDoc.addPage([width, height]);
  let y = height - 50;

  const drawHeader = (isContinuation = false) => {
    const bannerHeight = 68;
    page.drawRectangle({ x: left, y: y - bannerHeight, width: right - left, height: bannerHeight, color: primary });
    page.drawRectangle({ x: left, y: y - bannerHeight - 2, width: right - left, height: 2, color: cyan });

    // 1. Dedicated Logo in the topmost left
    const logoX = left + 8;
    const logoY = y - bannerHeight + 11;
    const logoW = 44;
    const logoH = 46;

    page.drawRectangle({
      x: logoX,
      y: logoY,
      width: logoW,
      height: logoH,
      color: rgb(0.1, 0.15, 0.25),
      borderColor: cyan,
      borderWidth: 1.2,
    });
    page.drawRectangle({
      x: logoX + 5,
      y: logoY + 16,
      width: 34,
      height: 24,
      color: cyan,
    });
    page.drawText('SO', {
      x: logoX + 10,
      y: logoY + 22,
      size: 14,
      font: bold,
      color: white,
    });
    page.drawText('SECURITY', {
      x: logoX + 4.5,
      y: logoY + 5.5,
      size: 5.5,
      font: bold,
      color: rgb(0.65, 0.82, 0.96),
    });

    // 2. Company branding to the right of logo
    const companyX = left + 60;
    const rightColWidth = 195;
    const rightColStartX = right - rightColWidth;
    const maxCompanyWidth = rightColStartX - companyX - 10;

    let companySize = 11.5;
    while (companySize > 8 && bold.widthOfTextAtSize(settings.businessName.toUpperCase(), companySize) > maxCompanyWidth) {
      companySize -= 0.5;
    }
    page.drawText(settings.businessName.toUpperCase(), {
      x: companyX,
      y: y - 22,
      size: companySize,
      font: bold,
      color: white,
    });

    let tagline = settings.tagline;
    while (tagline.length > 5 && regular.widthOfTextAtSize(tagline, 7.5) > maxCompanyWidth) {
      tagline = tagline.slice(0, -4) + '...';
    }
    page.drawText(tagline, {
      x: companyX,
      y: y - 36,
      size: 7.5,
      font: regular,
      color: rgb(0.8, 0.85, 0.92),
    });

    const contactLine = `${settings.city || settings.address} | Tel: ${settings.contactNumber}`;
    let displayContact = contactLine;
    while (displayContact.length > 5 && regular.widthOfTextAtSize(displayContact, 6.5) > maxCompanyWidth) {
      displayContact = displayContact.slice(0, -4) + '...';
    }
    page.drawText(displayContact, {
      x: companyX,
      y: y - 48,
      size: 6.5,
      font: regular,
      color: rgb(0.65, 0.78, 0.9),
    });

    // 3. Document title & metadata on the right (aligned horizontally with left rows)
    const docTitle = isContinuation
      ? `BILLING INVOICE (P.${pageIndex})`
      : 'BILLING INVOICE';
    const titleW = bold.widthOfTextAtSize(docTitle, 12);
    page.drawText(docTitle, {
      x: right - 12 - titleW,
      y: y - 22, // Vertically aligned with company name
      size: 12,
      font: bold,
      color: amber,
    });

    const refText = `No: ${invoice.invoiceNumber}`;
    const refW = bold.widthOfTextAtSize(refText, 9.5);
    page.drawText(refText, {
      x: right - 12 - refW,
      y: y - 36, // Vertically aligned with tagline
      size: 9.5,
      font: bold,
      color: white,
    });

    const dateText = `Issued: ${invoice.issueDate} | Due: ${invoice.dueDate}`;
    const dateW = regular.widthOfTextAtSize(dateText, 7.5);
    page.drawText(dateText, {
      x: right - 12 - dateW,
      y: y - 48, // Vertically aligned with contact line
      size: 7.5,
      font: regular,
      color: rgb(0.8, 0.85, 0.92),
    });

    y -= (bannerHeight + 20);
  };

  const drawTableHeader = () => {
    page.drawRectangle({ x: left, y: y - 18, width: right - left, height: 22, color: primary });
    const labels: [string, number][] = [
      ['NO.', 48],
      ['ITEM DESCRIPTION / SCOPE', 75],
      ['QTY & UNIT', 360],
      ['UNIT PRICE (PHP)', 430],
      ['AMOUNT (PHP)', 505],
    ];
    labels.forEach(([label, xPos]) => {
      page.drawText(label, { x: xPos, y: y - 12, size: 7.5, font: bold, color: white });
    });
    y -= 22;
  };

  const newContentPage = () => {
    pageIndex += 1;
    page = pdfDoc.addPage([width, height]);
    y = height - 50;
    drawHeader(true);
    drawTableHeader();
  };

  const drawWrapped = (
    value: string,
    x: number,
    maxWidth: number,
    size: number,
    color = text,
    font = regular,
    gap = 10
  ) => {
    const lines = wrap(value, maxWidth, size);
    lines.forEach((line) => {
      if (y < 85) newContentPage();
      page.drawText(line, { x, y, size, font, color });
      y -= gap;
    });
    return lines.length;
  };

  // 1. Draw Top Header Banner
  drawHeader(false);

  // 2. Parties and Transaction Context (Two-Column Party Panel - No overlapping headers!)
  const colWidth = (right - left) / 2 - 12;
  const rightColX = left + colWidth + 24;

  page.drawText('BILLED FROM:', { x: left, y, size: 8, font: bold, color: cyan });
  page.drawText('BILLED TO:', { x: rightColX, y, size: 8, font: bold, color: cyan });
  y -= 13; // Crucial: advance below labels before drawing party text lines

  let fromY = y;
  const drawFromLine = (value: string, font = regular, size = 7.5, color = text, gap = 10) => {
    const lines = wrap(value, colWidth, size);
    lines.forEach((line) => {
      page.drawText(line, { x: left, y: fromY, size, font, color });
      fromY -= gap;
    });
  };

  let toY = y;
  const drawToLine = (value: string, font = regular, size = 7.5, color = text, gap = 10) => {
    const lines = wrap(value, colWidth, size);
    lines.forEach((line) => {
      page.drawText(line, { x: rightColX, y: toY, size, font, color });
      toY -= gap;
    });
  };

  drawFromLine(settings.businessName, bold, 8.5, primary, 11);
  drawFromLine(settings.address);
  drawFromLine(`${settings.city}, ${settings.region}`);
  drawFromLine(`Tel: ${settings.contactNumber} | Email: ${settings.email}`);
  if (settings.tinNumber) drawFromLine(`TIN: ${settings.tinNumber}`);

  drawToLine(invoice.clientName, bold, 8.5, primary, 11);
  drawToLine(invoice.clientAddress || 'Client Site Address');
  drawToLine(`Contact: ${invoice.clientContact || 'N/A'}`);
  drawToLine(`Date Issued: ${invoice.issueDate}  |  Due Date: ${invoice.dueDate}`);
  if (invoice.quotationNumber) drawToLine(`Quotation Ref: ${invoice.quotationNumber}`);

  y = Math.min(fromY, toY) - 14;

  // 3. Subject / Billing For Callout Box with Cyan Left Edge Accent & Status Badge
  const calloutHeight = 28;
  page.drawRectangle({
    x: left,
    y: y - calloutHeight,
    width: right - left,
    height: calloutHeight,
    color: pale,
    borderColor: border,
    borderWidth: 1,
  });
  page.drawRectangle({
    x: left,
    y: y - calloutHeight,
    width: 3.5,
    height: calloutHeight,
    color: cyan,
  });

  // Dedicated Status Pill Badge on the right
  const statusStr = invoice.status.toUpperCase();
  const statusColor = invoice.status === 'Paid' ? success : invoice.status === 'Overdue' ? danger : cyan;
  const statusTextW = bold.widthOfTextAtSize(statusStr, 7.5);
  const badgeW = statusTextW + 16;
  const badgeX = right - 10 - badgeW;
  const badgeY = y - 22;
  page.drawRectangle({
    x: badgeX,
    y: badgeY,
    width: badgeW,
    height: 16,
    color: invoice.status === 'Paid' ? rgb(0.9, 0.98, 0.92) : invoice.status === 'Overdue' ? rgb(0.99, 0.92, 0.92) : rgb(0.92, 0.97, 1),
    borderColor: statusColor,
    borderWidth: 1,
  });
  page.drawText(statusStr, {
    x: badgeX + 8,
    y: badgeY + 4.5,
    size: 7.5,
    font: bold,
    color: statusColor,
  });

  // Label & Subject Title (Guaranteed no overlap with badge)
  const label = 'SUBJECT / BILLING FOR:';
  page.drawText(label, {
    x: left + 10,
    y: y - 17,
    size: 7.5,
    font: bold,
    color: cyan,
  });
  const labelW = bold.widthOfTextAtSize(label, 7.5);

  const titleStartX = left + 10 + labelW + 6;
  const maxTitleW = badgeX - 10 - titleStartX;
  let titleStr = invoice.title.toUpperCase();
  if (bold.widthOfTextAtSize(titleStr, 8) > maxTitleW) {
    while (titleStr.length > 3 && bold.widthOfTextAtSize(titleStr + '...', 8) > maxTitleW) {
      titleStr = titleStr.slice(0, -1);
    }
    titleStr += '...';
  }
  page.drawText(titleStr, {
    x: titleStartX,
    y: y - 17,
    size: 8,
    font: bold,
    color: primary,
  });

  y -= (calloutHeight + 14);

  // 4. Line Items Table
  drawTableHeader();

  invoice.lineItems.forEach((item, index) => {
    const descriptionLines = wrap(item.description, 260, 7.5);
    const rowHeight = Math.max(20, descriptionLines.length * 10 + 6);
    if (y - rowHeight < 110) newContentPage();

    if (index % 2 === 0) {
      page.drawRectangle({
        x: left,
        y: y - rowHeight,
        width: right - left,
        height: rowHeight,
        color: pale,
      });
    }

    page.drawText(`${index + 1}`, { x: 50, y: y - 13, size: 8, font: regular, color: text });
    descriptionLines.forEach((line, lineIndex) => {
      page.drawText(line, {
        x: 75,
        y: y - 11 - lineIndex * 10,
        size: 7.5,
        font: regular,
        color: primary,
      });
    });
    page.drawText(`${item.quantity} ${item.unit}`, { x: 360, y: y - 13, size: 7.5, font: regular, color: text });
    page.drawText(fromCentavos(item.unitPriceCentavos).toFixed(2), {
      x: 430,
      y: y - 13,
      size: 7.5,
      font: regular,
      color: text,
    });
    page.drawText(fromCentavos(item.totalCentavos).toFixed(2), {
      x: 505,
      y: y - 13,
      size: 7.5,
      font: bold,
      color: primary,
    });

    y -= rowHeight;
  });

  // Table bottom border
  page.drawLine({
    start: { x: left, y },
    end: { x: right, y },
    thickness: 1,
    color: border,
  });
  y -= 12;

  // If totals block won't fit, start a new page
  if (y < 210) newContentPage();

  // 5. Totals Area (Structured, right-aligned, no overlapping with balance due!)
  const totalsX = 350;
  const valueRightX = right - 12;
  const drawTotalRow = (label: string, value: string, font = regular, color = text, size = 8.5) => {
    page.drawText(label, { x: totalsX, y, size, font, color });
    const valWidth = font.widthOfTextAtSize(value, size);
    page.drawText(value, { x: valueRightX - valWidth, y, size, font, color });
    y -= 15;
  };

  drawTotalRow('Subtotal:', formatPhp(invoice.subtotalCentavos));

  if (invoice.taxMode !== 'NON_VAT') {
    const taxLabel = invoice.taxMode === 'INCLUSIVE'
      ? `VAT (${invoice.taxRatePercent}% Incl.):`
      : `VAT (${invoice.taxRatePercent}%):`;
    drawTotalRow(taxLabel, formatPhp(invoice.taxCentavos));
  }

  drawTotalRow('Grand Total Billed:', formatPhp(invoice.grandTotalCentavos), bold, primary, 9);
  drawTotalRow('Total Paid to Date:', formatPhp(invoice.paidAmountCentavos), regular, success, 8.5);

  // Clear vertical buffer between "Total Paid to Date" and the Balance Due banner
  y -= 4;

  // Balance Due Banner (Properly offset and vertically separated)
  const isSettled = invoice.remainingBalanceCentavos <= 0;
  const bannerHeight = 22;
  page.drawRectangle({
    x: totalsX - 8,
    y: y - 16,
    width: (valueRightX + 12) - (totalsX - 8),
    height: bannerHeight,
    color: isSettled ? success : danger,
  });
  page.drawText('BALANCE DUE:', { x: totalsX, y: y - 11, size: 9, font: bold, color: white });
  const balText = formatPhp(invoice.remainingBalanceCentavos);
  const balWidth = bold.widthOfTextAtSize(balText, 9.5);
  page.drawText(balText, {
    x: valueRightX - balWidth,
    y: y - 11,
    size: 9.5,
    font: bold,
    color: white,
  });
  y -= 32;

  // 6. Payment Instructions & Remittance Terms
  page.drawText('PAYMENT INSTRUCTIONS & BANK DETAILS:', { x: left, y, size: 8, font: bold, color: primary });
  y -= 12;

  const instructions = [
    'Direct Bank Transfer: BDO Unibank Current Acct # 0012-3456-7890 (Sentinel Security Solutions)',
    'GCash / Maya Operations: +63 917 555 8921 (Account: SentinelOps Operations)',
    'Please send proof of payment / transaction screenshot referencing invoice number to billing@sentinelops.local',
  ];

  for (const line of instructions) {
    if (y < 85) newContentPage();
    page.drawText(`• ${line}`, { x: left, y, size: 7, font: regular, color: text });
    y -= 10;
  }

  // 7. Signature Line
  page.drawLine({
    start: { x: left, y: 55 },
    end: { x: 200, y: 55 },
    thickness: 1,
    color: border,
  });
  page.drawText('Authorized Representative Signature / Date', {
    x: left,
    y: 43,
    size: 7.5,
    font: regular,
    color: text,
  });

  // 8. Quiet Footer / BIR Compliance Notice
  page.drawText(
    'This billing document is an internal commercial invoice issued by SentinelOps. Not an authorized BIR tax invoice.',
    {
      x: left,
      y: 26,
      size: 6.5,
      font: regular,
      color: rgb(0.5, 0.55, 0.6),
    }
  );

  return pdfDoc.save();
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
  const cyanColor = rgb(0.05, 0.65, 0.82);
  const textColor = rgb(0.2, 0.25, 0.33);
  const lightGrey = rgb(0.96, 0.97, 0.99);
  const borderGrey = rgb(0.85, 0.88, 0.92);

  let y = height - 40;

  // Top header banner
  const bannerHeight = 50;
  page.drawRectangle({
    x: 35,
    y: y - bannerHeight,
    width: width - 70,
    height: bannerHeight,
    color: primaryColor,
  });
  // Thin Cyan accent rule beneath header banner
  page.drawRectangle({
    x: 35,
    y: y - bannerHeight - 2,
    width: width - 70,
    height: 2,
    color: cyanColor,
  });

  // Logo in topmost left
  const logoX = 42;
  const logoY = y - bannerHeight + 8;
  const logoW = 34;
  const logoH = 34;
  page.drawRectangle({
    x: logoX,
    y: logoY,
    width: logoW,
    height: logoH,
    color: rgb(0.1, 0.15, 0.25),
    borderColor: cyanColor,
    borderWidth: 1,
  });
  page.drawRectangle({
    x: logoX + 4,
    y: logoY + 11,
    width: 26,
    height: 18,
    color: cyanColor,
  });
  page.drawText('SO', {
    x: logoX + 8,
    y: logoY + 15,
    size: 11,
    font: fontBold,
    color: rgb(1, 1, 1),
  });
  page.drawText('CR', {
    x: logoX + 11,
    y: logoY + 3.5,
    size: 5,
    font: fontBold,
    color: rgb(0.7, 0.85, 0.98),
  });

  const companyX = 84;
  const rightColWidth = 160;
  const maxCompanyWidth = width - 45 - rightColWidth - companyX - 10;

  let companySize = 10.5;
  while (companySize > 7.5 && fontBold.widthOfTextAtSize(settings.businessName.toUpperCase(), companySize) > maxCompanyWidth) {
    companySize -= 0.5;
  }
  page.drawText(settings.businessName.toUpperCase(), {
    x: companyX,
    y: y - 18,
    size: companySize,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  page.drawText('COLLECTION RECEIPT & PAYMENT ACKNOWLEDGMENT', {
    x: companyX,
    y: y - 32,
    size: 7,
    font: fontRegular,
    color: rgb(0.85, 0.9, 0.98),
  });

  const rcptText = `RECEIPT NO: ${payment.paymentNumber}`;
  const rcptW = fontBold.widthOfTextAtSize(rcptText, 9.5);
  page.drawText(rcptText, {
    x: width - 45 - rcptW,
    y: y - 18,
    size: 9.5,
    font: fontBold,
    color: rgb(0.98, 0.75, 0.18),
  });

  const dateText = `Date: ${payment.paymentDate}`;
  const dateW = fontRegular.widthOfTextAtSize(dateText, 7.5);
  page.drawText(dateText, {
    x: width - 45 - dateW,
    y: y - 32,
    size: 7.5,
    font: fontRegular,
    color: rgb(1, 1, 1),
  });

  y -= (bannerHeight + 18);

  // Received From & Reference Details Panel with Cyan Left Accent
  page.drawRectangle({
    x: 35,
    y: y - 65,
    width: width - 70,
    height: 70,
    color: lightGrey,
    borderColor: borderGrey,
    borderWidth: 1,
  });
  // Restrained cyan left edge
  page.drawRectangle({
    x: 35,
    y: y - 65,
    width: 3.5,
    height: 70,
    color: cyanColor,
  });

  page.drawText(`RECEIVED FROM:`, { x: 48, y: y - 15, size: 8, font: fontBold, color: primaryColor });
  page.drawText(payment.clientName.toUpperCase(), { x: 138, y: y - 15, size: 8.5, font: fontBold, color: cyanColor });

  page.drawText(`INVOICE REFERENCE:`, { x: 48, y: y - 30, size: 8, font: fontBold, color: primaryColor });
  page.drawText(`${payment.invoiceNumber} - ${invoice.title}`, { x: 158, y: y - 30, size: 8, font: fontRegular, color: textColor });

  page.drawText(`PAYMENT METHOD:`, { x: 48, y: y - 45, size: 8, font: fontBold, color: primaryColor });
  page.drawText(payment.paymentMethod, { x: 148, y: y - 45, size: 8, font: fontRegular, color: textColor });

  page.drawText(`TRANSACTION REF / CHECK #:`, { x: 330, y: y - 45, size: 8, font: fontBold, color: primaryColor });
  page.drawText(payment.referenceNumber || 'N/A (Cash)', { x: 475, y: y - 45, size: 8, font: fontRegular, color: textColor });

  page.drawText(`RECEIVED BY:`, { x: 48, y: y - 58, size: 8, font: fontBold, color: primaryColor });
  page.drawText(payment.receivedBy || 'Authorized Officer', { x: 138, y: y - 58, size: 8, font: fontRegular, color: textColor });

  y -= 80;

  // Amount in words box
  page.drawText('THE SUM OF:', { x: 45, y, size: 8, font: fontBold, color: primaryColor });
  const words = amountInWords(payment.amountCentavos);
  page.drawText(words, { x: 115, y, size: 8, font: fontBold, color: cyanColor });

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

  return pdfDoc.save();
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
