import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import PDFDocument from 'pdfkit';
import { Order } from 'src/schema/order_Management/order.schema';
import { EmailService } from 'src/common/services/email.service';
import { UPSKILLAB_LOGO_PNG } from 'src/common/assets/upskillab-logo';

const BRAND = '#f97316';
const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const SOFT = '#f8fafc';

const money = (n: any) => {
  const v = Number(n) || 0;
  // Standard PDF fonts have no ₹ glyph, so use "Rs."
  return `Rs. ${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const date = (d: any) => {
  if (!d) return '-';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '-' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
};
const esc = (v: any) => String(v ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

export function invoiceNumberFor(order: any): string {
  const d = new Date(order.approvedAt || order.orderDate || order.createdAt || Date.now());
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `UPS-${ym}-${String(order._id).slice(-6).toUpperCase()}`;
}

type Row = { label: string; detail?: string; amount: string; bold?: boolean; tone?: string };

/** Payment lines + totals from the order's v2 payment structure. */
function breakdown(order: any) {
  const rows: Row[] = [];
  const lumpsums = (order.lumpsumPayments || []).filter((l: any) => l.status !== 'Failed' && l.status !== 'Refunded');
  lumpsums.forEach((l: any, i: number) => {
    const reg = Number(l.registrationAmount) || 0;
    const received = Number(l.amountReceived) || 0;
    rows.push({
      label: lumpsums.length > 1 ? `Lumpsum #${i + 1}` : 'Lumpsum',
      detail: [`Reg. ${money(reg)} + Admission ${money(Math.max(0, received - reg))}`, l.paymentMode].filter(Boolean).join('  |  '),
      amount: money(received),
    });
  });
  const loans = (order.loans || []).filter((l: any) => l.disbursementStatus !== 'Cancelled');
  loans.forEach((l: any, i: number) => {
    rows.push({
      label: `Loan${loans.length > 1 ? ` #${i + 1}` : ''} - ${l.loanPartner?.name || 'Loan partner'}`,
      detail: `Disbursement: ${l.disbursementStatus || 'Pending'} (${money(l.disbursementAmount)})`,
      amount: money(l.loanAmount),
    });
  });
  (order.subscriptions || []).forEach((s: any, i: number, all: any[]) => {
    const plan = (Number(s.installmentAmount) || 0) * (Number(s.numberOfInstallments) || 0);
    rows.push({
      label: `Subscription${all.length > 1 ? ` #${i + 1}` : ''}`,
      detail: `${money(s.installmentAmount)} x ${s.numberOfInstallments} installments${s.firstInstallmentDate ? `  |  from ${date(s.firstInstallmentDate)}` : ''}`,
      amount: money(plan),
    });
  });
  (order.credits || []).forEach((c: any, i: number) => {
    rows.push({
      label: `Credit #${i + 1}`,
      detail: `Due ${date(c.dueDate)}  |  ${c.status}`,
      amount: money(c.amount),
      tone: c.status === 'Paid' ? '#059669' : c.status === 'Overdue' ? '#dc2626' : undefined,
    });
  });

  const s = order.paymentSummary || {};
  const finalFee = Number(order.finalFee) || 0;
  const received = Number(s.actualReceivedRevenue ?? 0);
  const due = Number(s.outstandingAmount ?? Math.max(0, finalFee - received));
  return { rows, finalFee, received, due };
}

/** Renders the invoice PDF. */
export function renderInvoicePdf(order: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Invoice ${invoiceNumberFor(order)}`, Author: 'Upskillab' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = 40;
    const R = 555;
    const W = R - L;
    const { rows, finalFee, received, due } = breakdown(order);
    const invNo = order.invoiceNumber || invoiceNumberFor(order);

    /* header band */
    doc.rect(0, 0, 595, 110).fill(BRAND);
    try {
      doc.roundedRect(L, 25, 60, 60, 10).fill('#ffffff');
      doc.image(UPSKILLAB_LOGO_PNG, L + 5, 30, { width: 50, height: 50 });
    } catch {
      /* logo is decorative */
    }
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22).text('UPSKILLAB', L + 75, 34);
    doc.font('Helvetica').fontSize(10).fillColor('#ffedd5').text('Learn. Upskill. Grow.', L + 75, 62);
    doc.font('Helvetica-Bold').fontSize(24).fillColor('#ffffff').text('INVOICE', L, 30, { width: W, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor('#ffedd5')
      .text(`Invoice No: ${invNo}`, L, 62, { width: W, align: 'right' })
      .text(`Invoice Date: ${date(order.approvedAt || new Date())}`, L, 75, { width: W, align: 'right' });

    /* billed to / order details */
    let y = 135;
    const colW = (W - 15) / 2;
    const panel = (x: number, title: string, lines: [string, string][]) => {
      doc.roundedRect(x, y, colW, 118, 8).fillAndStroke(SOFT, LINE);
      doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(9).text(title.toUpperCase(), x + 12, y + 10, { characterSpacing: 0.8 });
      let ly = y + 28;
      for (const [k, v] of lines) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(k, x + 12, ly, { width: 80 });
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(v || '-', x + 92, ly, { width: colW - 104, ellipsis: true, height: 12 });
        ly += 15;
      }
    };
    panel(L, 'Billed to', [
      ['Student', order.studentName],
      ["Father's name", order.fatherName],
      ['Mobile', order.mobile],
      ['Email', order.email],
      ['Address', [order.address, order.city, order.state].filter(Boolean).join(', ')],
    ]);
    panel(L + colW + 15, 'Order details', [
      ['Order ID', String(order._id).slice(-10).toUpperCase()],
      ['Order date', date(order.orderDate)],
      ['Approved on', date(order.approvedAt)],
      ['Counsellor', order.counsellorId?.name || order.counsellorName],
      ['Status', due > 0.01 ? 'Partially paid' : 'Fully paid'],
    ]);
    y += 140;

    /* table helper */
    const table = (title: string, head: [string, string, string], body: Row[], footer?: Row[]) => {
      if (y > 680) {
        doc.addPage();
        y = 50;
      }
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(title, L, y);
      y += 18;
      doc.rect(L, y, W, 22).fill(INK);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5);
      doc.text(head[0].toUpperCase(), L + 10, y + 7, { width: 150 });
      doc.text(head[1].toUpperCase(), L + 165, y + 7, { width: 250 });
      doc.text(head[2].toUpperCase(), L, y + 7, { width: W - 10, align: 'right' });
      y += 22;
      body.forEach((r, i) => {
        const h = 26;
        if (y + h > 790) {
          doc.addPage();
          y = 50;
        }
        if (i % 2 === 1) doc.rect(L, y, W, h).fill(SOFT);
        doc.fillColor(INK).font(r.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).text(r.label, L + 10, y + 8, { width: 150, ellipsis: true, height: 12 });
        doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(r.detail || '', L + 165, y + 8, { width: 255, ellipsis: true, height: 12 });
        doc.fillColor(r.tone || INK).font(r.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).text(r.amount, L, y + 8, { width: W - 10, align: 'right' });
        y += h;
        doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(LINE).stroke();
      });
      (footer || []).forEach((r) => {
        doc.fillColor(r.tone || INK).font('Helvetica-Bold').fontSize(10).text(r.label, L + 10, y + 8);
        doc.text(r.amount, L, y + 8, { width: W - 10, align: 'right' });
        y += 24;
      });
      y += 18;
    };

    const feeRows: Row[] = [
      { label: order.courseName || 'Course', detail: order.courseDuration ? `Duration: ${order.courseDuration}` : '', amount: money(order.totalFee ?? finalFee) },
    ];
    if (Number(order.discount) > 0) feeRows.push({ label: 'Discount', amount: `- ${money(order.discount)}`, tone: '#dc2626' });
    if (order.GSTEnabled && Number(order.GSTAmount) > 0) feeRows.push({ label: 'GST', amount: `+ ${money(order.GSTAmount)}` });
    table('Course fee', ['Description', 'Details', 'Amount'], feeRows, [{ label: 'Final fee payable', amount: money(finalFee) }]);

    if (rows.length) table('Payment breakdown', ['Source', 'Details', 'Amount'], rows);

    /* summary box */
    if (y > 700) {
      doc.addPage();
      y = 50;
    }
    const bx = R - 230;
    doc.roundedRect(bx, y, 230, 84, 8).fillAndStroke('#fff7ed', '#fed7aa');
    const sum = (label: string, val: string, yy: number, color = INK, bold = false) => {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(label, bx + 14, yy);
      doc.fillColor(color).font(bold ? 'Helvetica-Bold' : 'Helvetica-Bold').fontSize(bold ? 12 : 10).text(val, bx, yy - (bold ? 1 : 0), { width: 216, align: 'right' });
    };
    sum('Final fee', money(finalFee), y + 12);
    sum('Total received', money(received), y + 34, '#059669');
    doc.moveTo(bx + 14, y + 53).lineTo(bx + 216, y + 53).strokeColor('#fed7aa').stroke();
    sum('Balance due', money(due), y + 60, due > 0.01 ? BRAND : INK, true);

    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
      .text(order.remarks ? `Remarks: ${order.remarks}` : '', L, y + 6, { width: bx - L - 20 });
    y += 110;

    /* footer – drawn inside the bottom margin, so stop pdfkit adding pages */
    doc.page.margins.bottom = 0;
    doc.moveTo(L, 790).lineTo(R, 790).strokeColor(LINE).stroke();
    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
      .text('This is a computer-generated invoice and does not require a signature.', L, 798, { width: W, align: 'center', lineBreak: false })
      .text('Upskillab  |  www.upskillab.com', L, 810, { width: W, align: 'center', lineBreak: false });

    doc.end();
  });
}

@Injectable()
export class OrderInvoiceService {
  private readonly logger = new Logger(OrderInvoiceService.name);

  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
    private readonly email: EmailService,
  ) {}

  private load(orderId: string) {
    return this.orderModel
      .findById(orderId)
      .populate('counsellorId', 'name email')
      .populate('loans.loanPartner', 'name')
      .lean();
  }

  async pdf(orderId: string) {
    const order: any = await this.load(orderId);
    if (!order) return null;
    return { order, buffer: await renderInvoicePdf(order) };
  }

  /**
   * After admin approval: email the invoice to the student and the counsellor.
   * Runs once per order (invoiceSentAt); never throws.
   */
  async sendApprovalInvoice(orderId: string) {
    try {
      if (!Types.ObjectId.isValid(orderId)) return;
      // claim first so two concurrent approvals don't both send
      const invoiceNumber = invoiceNumberFor({ _id: orderId, approvedAt: new Date() });
      const claimed = await this.orderModel.findOneAndUpdate(
        { _id: orderId, Approved: true, invoiceSentAt: { $exists: false } },
        { $set: { invoiceSentAt: new Date(), invoiceNumber } },
        { new: true },
      );
      if (!claimed) return;

      const order: any = await this.load(orderId);
      const buffer = await renderInvoicePdf(order);
      const filename = `Upskillab-Invoice-${order.invoiceNumber}.pdf`;
      const attachments = [{ filename, content: buffer, contentType: 'application/pdf' }];
      const from = process.env.ORDER_MAIL_FROM || undefined;
      const { finalFee, received, due } = breakdown(order);

      const html = (greeting: string, intro: string) => `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#0f172a">
        <div style="background:#f97316;padding:20px 24px;border-radius:12px 12px 0 0">
          <h2 style="margin:0;color:#fff;font-size:20px">Upskillab – Fee Invoice</h2>
          <p style="margin:4px 0 0;color:#ffedd5;font-size:13px">Invoice ${esc(order.invoiceNumber)}</p>
        </div>
        <div style="border:1px solid #e2e8f0;border-top:0;padding:24px;border-radius:0 0 12px 12px">
          <p>${greeting}</p>
          <p>${intro}</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
            <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;color:#64748b">Student</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right"><b>${esc(order.studentName)}</b></td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;color:#64748b">Course</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right">${esc(order.courseName)}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;color:#64748b">Final fee</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right">${esc(money(finalFee))}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;color:#64748b">Received</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;color:#059669"><b>${esc(money(received))}</b></td></tr>
            <tr><td style="padding:8px;color:#64748b">Balance due</td><td style="padding:8px;text-align:right;color:#f97316"><b>${esc(money(due))}</b></td></tr>
          </table>
          <p style="font-size:13px;color:#475569">The detailed invoice is attached as a PDF.</p>
          <p>Regards,<br/>Team Upskillab</p>
        </div>
      </div>`;

      const sends: Promise<boolean>[] = [];
      if (order.email) {
        sends.push(
          this.email.sendMail(
            order.email,
            `Your Upskillab invoice ${order.invoiceNumber}`,
            html(`Dear ${esc(order.studentName)},`, `Thank you for enrolling in <b>${esc(order.courseName)}</b>. Your order has been confirmed. Please find your invoice attached.`),
            { from, attachments },
          ),
        );
      }
      const bda = order.counsellorId;
      if (bda?.email) {
        sends.push(
          this.email.sendMail(
            bda.email,
            `Order approved – ${order.studentName} (${order.invoiceNumber})`,
            html(`Hi ${esc(bda.name)},`, `The order of <b>${esc(order.studentName)}</b> has been approved. A copy of the invoice sent to the student is attached.`),
            { from, attachments },
          ),
        );
      }
      const results = await Promise.all(sends);
      if (!results.length || results.some((ok) => !ok)) {
        this.logger.warn(`Invoice ${order.invoiceNumber}: some emails failed (${results.join(',')})`);
      }
    } catch (e: any) {
      this.logger.error(`Invoice email failed for order ${orderId}: ${e?.message}`);
    }
  }
}
