/**
 * Invoice Service
 * ----------------
 * Returns the public URL of the order's invoice PDF, served by our own
 * backend at `GET /api/invoice/<orderId>.pdf` (see `routes/invoice.js`).
 *
 * No external storage is used — the PDF is generated on every request
 * from the live order document. This keeps storage costs at zero, avoids
 * stale-cache bugs after admin edits, and removes the Cloudinary dependency
 * for invoices.
 *
 * Public API:
 *   getInvoiceUrl(order)      -> string|null   (the public PDF URL)
 *   getInvoiceFilename(order) -> string
 */

const logger = require('./logger');

function _backendBaseUrl() {
  const url = process.env.BACKEND_URL || process.env.PUBLIC_URL;
  if (!url) {
    logger.warn('Invoice: BACKEND_URL not set — invoice URL cannot be built');
    return null;
  }
  return url.replace(/\/+$/, '');
}

/**
 * Returns a fully-qualified public URL Meta can fetch when delivering the
 * invoice as a WhatsApp document attachment. Returns `null` if the backend
 * URL is not configured.
 */
function getInvoiceUrl(order) {
  if (!order || !order.orderId) return null;
  const base = _backendBaseUrl();
  if (!base) return null;
  return `${base}/api/invoice/${order.orderId}.pdf`;
}

function getInvoiceFilename(order) {
  return `Invoice-${order?.orderId || 'order'}.pdf`;
}

module.exports = {
  getInvoiceUrl,
  getInvoiceFilename
};
