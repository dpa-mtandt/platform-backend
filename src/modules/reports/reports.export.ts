import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { ReportResult } from './reports.service';

/** Render a report to an .xlsx workbook Buffer. */
export async function toXlsx(report: ReportResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MTANDT Enterprise Platform';
  const ws = wb.addWorksheet(report.title.slice(0, 31) || 'Report');

  ws.addRow([report.title]).font = { bold: true, size: 14 };
  ws.addRow([`Generated ${new Date(report.generatedAt).toLocaleString()}`]).font = { color: { argb: 'FF64748B' } };
  ws.addRow([]);

  const header = ws.addRow(report.columns.map((c) => c.label));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
  });

  for (const r of report.rows) {
    const row = ws.addRow(report.columns.map((c) => (r[c.key] ?? '') as string | number));
    report.columns.forEach((c, i) => {
      if (c.align === 'right') row.getCell(i + 1).alignment = { horizontal: 'right' };
    });
  }

  report.columns.forEach((c, i) => {
    const maxLen = Math.max(c.label.length, ...report.rows.map((r) => String(r[c.key] ?? '').length));
    ws.getColumn(i + 1).width = Math.min(48, Math.max(12, maxLen + 2));
  });

  if (report.summary?.length) {
    ws.addRow([]);
    ws.addRow(['Summary']).font = { bold: true };
    for (const s of report.summary) ws.addRow([s.label, s.value]);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** Render a report to a landscape A4 PDF Buffer. */
export function toPdf(report: ReportResult): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const M = { left: 36, right: 36, top: 36, bottom: 36 };
    const tableWidth = doc.page.width - M.left - M.right;
    const colW = tableWidth / report.columns.length;
    const rowH = 16;

    doc.font('Helvetica-Bold').fontSize(15).fillColor('#111827').text(report.title, M.left, M.top);
    doc.font('Helvetica').fontSize(8).fillColor('#6b7280').text(`Generated ${new Date(report.generatedAt).toLocaleString()}`);
    let y = doc.y + 6;

    const drawHeader = () => {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#111827');
      report.columns.forEach((c, i) => doc.text(c.label, M.left + i * colW + 2, y + 4, { width: colW - 4, align: c.align ?? 'left', ellipsis: true }));
      y += rowH;
      doc.moveTo(M.left, y).lineTo(M.left + tableWidth, y).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
      doc.font('Helvetica').fontSize(7.5).fillColor('#334155');
    };
    drawHeader();

    for (const r of report.rows) {
      if (y + rowH > doc.page.height - M.bottom) {
        doc.addPage();
        y = M.top;
        drawHeader();
      }
      report.columns.forEach((c, i) => doc.text(String(r[c.key] ?? ''), M.left + i * colW + 2, y + 4, { width: colW - 4, align: c.align ?? 'left', ellipsis: true }));
      y += rowH;
    }

    if (report.summary?.length) {
      if (y + rowH * (report.summary.length + 2) > doc.page.height - M.bottom) {
        doc.addPage();
        y = M.top;
      }
      y += 8;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827').text('Summary', M.left, y);
      y = doc.y + 2;
      doc.font('Helvetica').fontSize(8).fillColor('#334155');
      for (const s of report.summary) {
        doc.text(`${s.label}: ${s.value}`, M.left, y);
        y = doc.y + 1;
      }
    }

    doc.end();
  });
}
