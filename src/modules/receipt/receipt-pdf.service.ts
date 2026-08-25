import PDFDocument from 'pdfkit';
import type { ReceiptPayload } from './receipt.service';

function formatCurrency(amount: number | null | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return 'PHP 0.00';
  return `PHP ${amount.toFixed(2)}`;
}

function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function formatStatus(status: string | null | undefined): string {
  if (!status) return '—';
  if (status === 'settled_pending_terminal') return 'PENDING CONFIRMATION';
  if (status === 'refunded_pending_review') return 'REFUND PENDING REVIEW';
  return status.replace(/_/g, ' ').toUpperCase();
}

function formatChangeState(state: string | null | undefined): string {
  if (!state || state === 'none') return 'NONE';
  if (state === 'failed') return 'FAILED (STAFF REVIEW)';
  if (state === 'dispensed') return 'DISPENSED';
  return state.replace(/_/g, ' ').toUpperCase();
}

export class ReceiptPdfService {
  /**
   * Generates a compact thermal-style e-receipt PDF (80mm width).
   */
  public generateThermalReceiptPdf(payload: ReceiptPayload): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      // 80mm standard thermal roll width in PostScript points: 80 / 25.4 * 72 = ~226.77 pt
      const pageWidth = 226;
      const leftMargin = 14;
      const rightMargin = 14;
      const contentWidth = pageWidth - leftMargin - rightMargin;

      // Estimate height based on whether change / notes / color pages are present
      let estimatedHeight = 360;
      if (payload.change && payload.change.requested > 0) estimatedHeight += 45;
      if (payload.change && payload.change.remaining > 0) estimatedHeight += 20;
      if (payload.colorPages != null && payload.bwPages != null) estimatedHeight += 24;

      const doc = new PDFDocument({
        size: [pageWidth, estimatedHeight],
        margins: {
          top: 14,
          bottom: 14,
          left: leftMargin,
          right: rightMargin,
        },
        autoFirstPage: true,
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err: Error) => reject(err));

      const drawDashedLine = () => {
        doc.moveDown(0.3);
        const y = doc.y;
        doc
          .save()
          .strokeColor('#888888')
          .lineWidth(0.6)
          .dash(3, { space: 2 })
          .moveTo(leftMargin, y)
          .lineTo(pageWidth - rightMargin, y)
          .stroke()
          .restore();
        doc.moveDown(0.4);
      };

      const drawRow = (label: string, value: string, isBold = false) => {
        const y = doc.y;
        const fontName = isBold ? 'Helvetica-Bold' : 'Helvetica';
        doc.font(fontName).fontSize(7.5).fillColor('#333333');
        doc.text(label, leftMargin, y, {
          width: contentWidth * 0.52,
          align: 'left',
          lineBreak: false,
        });
        doc.font(fontName).fontSize(7.5).fillColor('#000000');
        doc.text(value, leftMargin + contentWidth * 0.5, y, {
          width: contentWidth * 0.5,
          align: 'right',
          lineBreak: false,
        });
        doc.moveDown(0.35);
      };

      // ── 1. Header ──────────────────────────────────────────────
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#111111');
      doc.text('PRINTBIT', { align: 'center' });

      doc.font('Helvetica').fontSize(7.5).fillColor('#555555');
      doc.text('SELF-SERVICE PRINTING KIOSK', { align: 'center' });

      doc.font('Helvetica-Bold').fontSize(8).fillColor('#222222');
      doc.text('OFFICIAL E-RECEIPT', { align: 'center' });

      drawDashedLine();

      // ── 2. Transaction Information ─────────────────────────────
      drawRow('Transaction ID:', payload.transactionId);
      drawRow('Service Mode:', (payload.mode || 'PRINT').toUpperCase());
      drawRow('Status:', formatStatus(payload.status), true);
      drawRow('Date:', formatDate(payload.settledAt || payload.generatedAt));

      drawDashedLine();

      // ── 3. Line Items / Service Breakdown ──────────────────────
      if (payload.colorPages != null) {
        drawRow('Pages (Color):', String(payload.colorPages));
      }
      if (payload.bwPages != null) {
        drawRow('Pages (B&W):', String(payload.bwPages));
      }
      if (payload.pagesPrinted != null) {
        const pagesText =
          payload.totalPages != null
            ? `${payload.pagesPrinted} of ${payload.totalPages}`
            : String(payload.pagesPrinted);
        drawRow('Pages Printed:', pagesText);
      }

      drawRow('Amount Charged:', formatCurrency(payload.chargedAmount), true);

      // ── 4. Change Details (if applicable) ──────────────────────
      if (payload.change && payload.change.requested > 0) {
        drawDashedLine();
        drawRow('Change Requested:', formatCurrency(payload.change.requested));
        drawRow('Change Dispensed:', formatCurrency(payload.change.dispensed));
        if (payload.change.remaining > 0) {
          drawRow('Remaining Owed:', formatCurrency(payload.change.remaining), true);
        }
        drawRow('Change Status:', formatChangeState(payload.change.state));
        if (payload.change.owedChangeId) {
          drawRow('Owed Change ID:', payload.change.owedChangeId);
        }
      }

      drawDashedLine();

      // ── 5. Footer ──────────────────────────────────────────────
      doc.moveDown(0.2);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#222222');
      doc.text('Thank you for using PrintBit!', { align: 'center' });

      doc.moveDown(0.2);
      doc.font('Helvetica').fontSize(6.5).fillColor('#666666');
      doc.text('Keep this receipt for your records.', { align: 'center' });
      doc.text('Generated: ' + formatDate(payload.generatedAt), { align: 'center' });

      doc.end();
    });
  }
}

export const receiptPdfService = new ReceiptPdfService();
