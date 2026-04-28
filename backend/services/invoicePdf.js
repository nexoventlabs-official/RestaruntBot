/**
 * Invoice PDF Generator
 * ----------------------
 * Builds a single-page A4 invoice for a delivered/completed order.
 * Returns a Buffer that can be uploaded to Cloudinary and sent as a
 * WhatsApp document attachment.
 *
 * Sections:
 *   - Header band  : restaurant name + tagline + invoice meta
 *   - Bill-to      : customer name / phone / delivery address (delivery only)
 *   - Items table  : #, item (+ variant), qty, unit price (with strike-through
 *                    if discounted), line total
 *   - Totals block : subtotal, discount (with offer titles), delivery fee, tax,
 *                    GRAND TOTAL
 *   - Payment box  : method + status + paid timestamp
 *   - Footer       : thank-you note + restaurant contact
 *
 * Currency: uses "Rs." instead of ₹ because pdfkit's built-in Helvetica
 * does not embed the Indian Rupee glyph (same convention as reportPdf.js).
 */

const PDFDocument = require('pdfkit');
const https = require('https');
const http = require('http');
const logger = require('./logger');
const Offer = require('../models/Offer');

// ─── tiny image fetcher (mirrors reportPdf.js) ────────────────────────────
const isValidImage = (buffer) => {
  if (!buffer || buffer.length < 8) return false;
  const png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
    .every((b, i) => buffer[i] === b);
  const jpg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  return png || jpg;
};

const fetchImageBuffer = (url) => new Promise((resolve) => {
  if (!url) return resolve(null);
  const protocol = url.startsWith('https') ? https : http;
  const timeout = setTimeout(() => resolve(null), 8000);
  const go = (u, hops = 0) => {
    if (hops > 4) { clearTimeout(timeout); return resolve(null); }
    const p = u.startsWith('https') ? https : http;
    p.get(u, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return go(res.headers.location, hops + 1);
      }
      if (res.statusCode !== 200) { clearTimeout(timeout); return resolve(null); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        clearTimeout(timeout);
        const buf = Buffer.concat(chunks);
        resolve(isValidImage(buf) ? buf : null);
      });
      res.on('error', () => { clearTimeout(timeout); resolve(null); });
    }).on('error', () => { clearTimeout(timeout); resolve(null); });
  };
  go(url);
});

// ─── formatting helpers ──────────────────────────────────────────────────
const money = (val) => `Rs.${Number(val || 0).toLocaleString('en-IN')}`;

const fmtDate = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });
};

const sanitize = (s) => String(s || '').replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, '').trim();

// ─── theme ───────────────────────────────────────────────────────────────
const COLORS = {
  brand:    '#0B7F3D', // green band
  brandDk:  '#075F2D',
  text:     '#1c1d21',
  muted:    '#6b6f76',
  border:   '#e1e3e7',
  zebra:    '#f7f8fa',
  paidBg:   '#dcfce7',
  paidFg:   '#166534',
  pendBg:   '#fef9c3',
  pendFg:   '#854d0e',
  red:      '#dc2626'
};

// ─── main ────────────────────────────────────────────────────────────────
/**
 * @param {object} order - hydrated Order doc / lean object
 * @param {object} [meta]
 * @param {string} [meta.restaurantName]
 * @param {string} [meta.restaurantPhone]
 * @param {string} [meta.restaurantAddress]
 * @param {string} [meta.logoUrl]
 * @param {Buffer} [meta.logoBuffer]
 * @returns {Promise<Buffer>}
 */
async function generateInvoicePdf(order, meta = {}) {
  // Resolve any offer titles up-front so we don't await mid-stream
  const offerIds = (order.appliedOfferIds || [])
    .map(id => id?.toString?.() || String(id))
    .filter(Boolean);
  let offerTitles = [];
  if (offerIds.length) {
    try {
      const offers = await Offer.find({ _id: { $in: offerIds } })
        .select('title offerType code')
        .lean();
      offerTitles = offers.map(o => o.title || o.offerType || o.code).filter(Boolean);
    } catch (err) {
      logger.warn('Invoice: failed to load offer titles', { error: err.message });
    }
  }

  // Fetch logo if URL provided and no buffer supplied
  let logoBuffer = meta.logoBuffer || null;
  if (!logoBuffer && meta.logoUrl) {
    logoBuffer = await fetchImageBuffer(meta.logoUrl);
  }

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 36, size: 'A4' });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const PAGE_W = doc.page.width;
      const M = 36; // page margin
      const INNER_W = PAGE_W - M * 2;

      const restaurantName = sanitize(meta.restaurantName || process.env.MERCHANT_NAME || process.env.BUSINESS_NAME || 'Restaurant');
      const restaurantPhone = sanitize(meta.restaurantPhone || process.env.RESTAURANT_PHONE || '');
      const restaurantAddress = sanitize(meta.restaurantAddress || process.env.RESTAURANT_ADDRESS || '');

      const isPickup = order.serviceType === 'pickup';
      const paidBadge = order.paymentStatus === 'paid';

      // ─── HEADER BAND ─────────────────────────────────────────────────
      doc.rect(0, 0, PAGE_W, 110).fill(COLORS.brand);
      // Logo
      if (logoBuffer) {
        try {
          doc.image(logoBuffer, M, 22, { fit: [66, 66] });
        } catch (e) { /* ignore broken logo */ }
      }
      const headTextX = logoBuffer ? M + 78 : M;
      doc.fillColor('white').font('Helvetica-Bold').fontSize(20)
        .text(restaurantName, headTextX, 28, { width: INNER_W - 240 });
      doc.font('Helvetica').fontSize(10).fillColor('#e7fbec');
      const headLines = [];
      if (restaurantAddress) headLines.push(restaurantAddress);
      if (restaurantPhone) headLines.push(`Phone: ${restaurantPhone}`);
      if (headLines.length) {
        doc.text(headLines.join('\n'), headTextX, 56, { width: INNER_W - 240 });
      }

      // Right side: INVOICE label + meta
      doc.fillColor('white').font('Helvetica-Bold').fontSize(22)
        .text('INVOICE', PAGE_W - M - 200, 28, { width: 200, align: 'right' });
      doc.font('Helvetica').fontSize(10).fillColor('#e7fbec')
        .text(`Order #${order.orderId}`, PAGE_W - M - 200, 58, { width: 200, align: 'right' });
      doc.text(`Date: ${fmtDate(order.deliveredAt || order.updatedAt || order.createdAt)}`,
        PAGE_W - M - 200, 74, { width: 200, align: 'right' });

      // ─── BILL TO + SERVICE ───────────────────────────────────────────
      let y = 130;
      const colW = (INNER_W - 16) / 2;

      doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(9)
        .text('BILL TO', M, y);
      doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(9)
        .text('SERVICE', M + colW + 16, y);
      y += 14;

      // BILL TO content
      doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(11)
        .text(sanitize(order.customer?.name || 'Customer'), M, y, { width: colW });
      const blockTopLeft = y;
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);
      doc.text(`+${sanitize(order.customer?.phone || '')}`, M, doc.y, { width: colW });
      if (!isPickup) {
        const addr = sanitize(order.deliveryAddress?.address || order.customer?.address || '');
        if (addr) doc.text(addr, M, doc.y, { width: colW });
        if (order.deliveryDistance != null) {
          doc.fillColor(COLORS.muted).fontSize(9)
            .text(`${Number(order.deliveryDistance).toFixed(2)} km from restaurant`, M, doc.y, { width: colW });
        }
      }
      const billBottom = doc.y;

      // SERVICE content
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);
      doc.text(isPickup ? 'Self-Pickup' : 'Home Delivery', M + colW + 16, blockTopLeft, { width: colW });
      if (order.deliveryPartnerName && !isPickup) {
        doc.fillColor(COLORS.muted).fontSize(9)
          .text(`Delivered by: ${sanitize(order.deliveryPartnerName)}`,
            M + colW + 16, doc.y, { width: colW });
      }
      doc.fillColor(COLORS.muted).fontSize(9)
        .text(`Ordered: ${fmtDate(order.createdAt)}`, M + colW + 16, doc.y, { width: colW });
      if (order.deliveredAt) {
        doc.text(`${isPickup ? 'Completed' : 'Delivered'}: ${fmtDate(order.deliveredAt)}`,
          M + colW + 16, doc.y, { width: colW });
      }
      const svcBottom = doc.y;

      y = Math.max(billBottom, svcBottom) + 18;

      // ─── ITEMS TABLE ─────────────────────────────────────────────────
      // Columns
      const cols = {
        sno:   { x: M,            w: 28,  align: 'left'  },
        name:  { x: M + 28,       w: 290, align: 'left'  },
        qty:   { x: M + 28 + 290, w: 50,  align: 'center'},
        price: { x: M + 28 + 290 + 50, w: 80, align: 'right' },
        total: { x: M + 28 + 290 + 50 + 80, w: 75, align: 'right' }
      };
      const tblRight = M + INNER_W;

      // header
      doc.rect(M, y, INNER_W, 22).fill(COLORS.brandDk);
      doc.fillColor('white').font('Helvetica-Bold').fontSize(10);
      const hY = y + 6;
      doc.text('#',     cols.sno.x + 4, hY, { width: cols.sno.w - 4, align: cols.sno.align });
      doc.text('ITEM',  cols.name.x,    hY, { width: cols.name.w,     align: cols.name.align });
      doc.text('QTY',   cols.qty.x,     hY, { width: cols.qty.w,      align: cols.qty.align });
      doc.text('PRICE', cols.price.x,   hY, { width: cols.price.w - 4, align: cols.price.align });
      doc.text('TOTAL', cols.total.x,   hY, { width: cols.total.w - 4, align: cols.total.align });
      y += 22;

      // rows
      doc.fillColor(COLORS.text).font('Helvetica').fontSize(10);
      (order.items || []).forEach((item, idx) => {
        const lineTotal = Number(item.price || 0) * Number(item.quantity || 0);
        const hasDiscount = item.originalPrice != null && Number(item.originalPrice) > Number(item.price);
        const rowH = hasDiscount ? 32 : 24;

        if (idx % 2 === 0) doc.rect(M, y, INNER_W, rowH).fill(COLORS.zebra);
        doc.fillColor(COLORS.text);

        const ry = y + 6;
        doc.font('Helvetica').fontSize(10)
          .text(String(idx + 1), cols.sno.x + 4, ry, { width: cols.sno.w - 4 });

        // Item name + variant
        doc.font('Helvetica-Bold').fontSize(10)
          .text(sanitize(item.name), cols.name.x, ry, { width: cols.name.w });
        if (item.variantLabel) {
          doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
            .text(sanitize(item.variantLabel), cols.name.x, doc.y, { width: cols.name.w });
        }

        // qty
        doc.font('Helvetica').fontSize(10).fillColor(COLORS.text)
          .text(String(item.quantity || 0), cols.qty.x, ry, {
            width: cols.qty.w, align: cols.qty.align
          });

        // price (with strike-through if discounted)
        if (hasDiscount) {
          // strike-through original
          doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9)
            .text(money(item.originalPrice), cols.price.x, ry, {
              width: cols.price.w - 4, align: 'right'
            });
          // re-stroke a line through it
          const origText = money(item.originalPrice);
          const tw = doc.widthOfString(origText);
          const sx = cols.price.x + cols.price.w - 4 - tw;
          doc.moveTo(sx, ry + 4.5).lineTo(sx + tw, ry + 4.5)
            .strokeColor(COLORS.muted).lineWidth(0.6).stroke();
          // sale price
          doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(10)
            .text(money(item.price), cols.price.x, ry + 12, {
              width: cols.price.w - 4, align: 'right'
            });
        } else {
          doc.fillColor(COLORS.text).font('Helvetica').fontSize(10)
            .text(money(item.price), cols.price.x, ry, {
              width: cols.price.w - 4, align: 'right'
            });
        }

        // line total
        doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(10)
          .text(money(lineTotal), cols.total.x, ry, {
            width: cols.total.w - 4, align: 'right'
          });

        y += rowH;
      });

      // table outer border
      doc.lineWidth(0.6).strokeColor(COLORS.border)
        .rect(M, 130 + 0, INNER_W, 0); // (no-op; visual separator already provided by header band)
      doc.rect(M, y, INNER_W, 0); // bottom of rows reference

      // ─── TOTALS BLOCK ────────────────────────────────────────────────
      y += 12;
      const totalsX = M + INNER_W - 230;
      const totalsW = 230;

      const subtotal = Number(order.itemsTotal != null
        ? order.itemsTotal
        : (order.items || []).reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 0), 0));
      const discount = Number(order.discountAmount || 0);
      const delivery = Number(order.deliveryCharge || 0);
      const grand = Number(order.totalAmount || (subtotal - discount + delivery));

      const totalsLine = (label, value, opts = {}) => {
        doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(opts.size || 10)
          .fillColor(opts.color || COLORS.text);
        doc.text(label, totalsX, y, { width: 130, align: 'left' });
        doc.text(value, totalsX + 130, y, { width: 100, align: 'right' });
        y += (opts.size ? opts.size + 4 : 16);
      };

      totalsLine('Subtotal', money(subtotal));
      if (discount > 0) {
        totalsLine('Discount', `- ${money(discount)}`, { color: COLORS.red });
        if (offerTitles.length) {
          doc.font('Helvetica-Oblique').fontSize(8).fillColor(COLORS.muted)
            .text(`Offers applied: ${offerTitles.join(', ')}`,
              totalsX, y, { width: totalsW, align: 'right' });
          y += 11;
        }
      }
      if (!isPickup) {
        totalsLine(delivery > 0 ? 'Delivery fee' : 'Delivery fee (Free)',
          delivery > 0 ? money(delivery) : 'Rs.0');
      }

      // separator before grand total
      doc.moveTo(totalsX, y + 2).lineTo(totalsX + totalsW, y + 2)
        .strokeColor(COLORS.border).lineWidth(1).stroke();
      y += 8;

      // GRAND TOTAL
      doc.rect(totalsX, y, totalsW, 28).fill(COLORS.brand);
      doc.fillColor('white').font('Helvetica-Bold').fontSize(11)
        .text('TOTAL PAID', totalsX + 12, y + 8, { width: 100, align: 'left' });
      doc.fontSize(14)
        .text(money(grand), totalsX + 110, y + 6, { width: totalsW - 120, align: 'right' });
      y += 38;

      // ─── PAYMENT BOX ─────────────────────────────────────────────────
      // For COD / Pay-at-Hotel orders we honour `actualPaymentMethod` (set by
      // the admin / delivery partner when collecting payment) so the invoice
      // reflects whether the customer ultimately paid in cash or via UPI.
      const payMethod = (() => {
        if (order.paymentMethod === 'cod' && isPickup) {
          if (order.actualPaymentMethod === 'upi') return 'UPI (paid at hotel)';
          if (order.actualPaymentMethod === 'cash') return 'Cash (paid at hotel)';
          return 'Pay at Hotel';
        }
        if (order.paymentMethod === 'cod') {
          if (order.actualPaymentMethod === 'upi') return 'UPI (paid at delivery)';
          if (order.actualPaymentMethod === 'cash') return 'Cash (paid at delivery)';
          return 'Cash on Delivery';
        }
        return 'UPI / Online';
      })();

      doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(9)
        .text('PAYMENT', M, y);
      y += 14;
      doc.fillColor(COLORS.text).font('Helvetica').fontSize(10)
        .text(`Method: ${payMethod}`, M, y);
      y += 14;

      // status pill
      const pillBg = paidBadge ? COLORS.paidBg : COLORS.pendBg;
      const pillFg = paidBadge ? COLORS.paidFg : COLORS.pendFg;
      const pillText = paidBadge ? 'PAID' : (order.paymentStatus || 'PENDING').toUpperCase();
      const pillW = doc.font('Helvetica-Bold').fontSize(9).widthOfString(pillText) + 18;
      doc.roundedRect(M, y - 2, pillW, 16, 8).fill(pillBg);
      doc.fillColor(pillFg).font('Helvetica-Bold').fontSize(9)
        .text(pillText, M + 9, y + 2);
      y += 26;

      // ─── FOOTER ──────────────────────────────────────────────────────
      const footerY = doc.page.height - 60;
      doc.moveTo(M, footerY - 6).lineTo(PAGE_W - M, footerY - 6)
        .strokeColor(COLORS.border).lineWidth(0.6).stroke();
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9)
        .text('Thank you for ordering with us! We hope you enjoyed your meal.',
          M, footerY, { width: INNER_W, align: 'center' });
      doc.fontSize(8)
        .text(`This is a system-generated invoice for order ${order.orderId}.`,
          M, footerY + 14, { width: INNER_W, align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateInvoicePdf
};
