/**
 * Invoice Service
 * ----------------
 * Glue layer between `services/invoicePdf.js` (renderer) and the rest of
 * the app:
 *   - resolves restaurant branding (env vars + chatbot images cache)
 *   - generates the PDF buffer
 *   - uploads it as a raw asset to Cloudinary
 *   - caches the resulting public URL on `order.invoiceUrl` so future
 *     re-sends don't regenerate the file
 *
 * Public API:
 *   getOrCreateInvoiceUrl(order) -> Promise<string|null>
 *   regenerateInvoiceUrl(order)  -> Promise<string|null>   (force-rebuild)
 *   getInvoiceFilename(order)    -> string
 */

const logger = require('./logger');
const cloudinaryService = require('./cloudinary');
const chatbotImagesService = require('./chatbotImages');
const { generateInvoicePdf } = require('./invoicePdf');

const INVOICE_FOLDER = 'restaurant-bot/invoices';

/**
 * @param {object} order - Hydrated Order document (NOT lean if you want
 *                         the cached URL persisted via .save()).
 */
async function _generateAndUpload(order) {
  // Resolve a logo from chatbot images (best effort — most deployments use
  // 'welcome' or 'order_confirmed' as a brand banner; we prefer a 'logo' key
  // if the operator added one).
  let logoUrl = null;
  try {
    logoUrl = await chatbotImagesService.getImageUrl('logo')
      || await chatbotImagesService.getImageUrl('restaurant_logo')
      || null;
  } catch (_) { /* non-fatal */ }

  const meta = {
    restaurantName: process.env.MERCHANT_NAME || process.env.BUSINESS_NAME || undefined,
    restaurantPhone: process.env.RESTAURANT_PHONE || undefined,
    restaurantAddress: process.env.RESTAURANT_ADDRESS || undefined,
    logoUrl
  };

  const buffer = await generateInvoicePdf(order, meta);
  const publicId = `Invoice-${order.orderId}`;
  const url = await cloudinaryService.uploadRawFromBuffer(
    buffer,
    INVOICE_FOLDER,
    publicId,
    'pdf'
  );
  return url;
}

/**
 * Returns a public Cloudinary URL for the order's invoice PDF.
 * Generates + uploads on first call, then caches `order.invoiceUrl`.
 *
 * Returns `null` (and logs) if generation fails — callers should treat
 * the invoice attachment as best-effort.
 */
async function getOrCreateInvoiceUrl(order) {
  if (!order || !order.orderId) return null;
  if (order.invoiceUrl) return order.invoiceUrl;

  try {
    const url = await _generateAndUpload(order);
    order.invoiceUrl = url;
    if (typeof order.save === 'function') {
      try { await order.save(); }
      catch (saveErr) {
        logger.warn('Invoice: failed to persist invoiceUrl on order', {
          orderId: order.orderId, error: saveErr.message
        });
      }
    }
    logger.info('Invoice generated', { orderId: order.orderId, url });
    return url;
  } catch (err) {
    logger.error('Invoice generation failed', {
      orderId: order.orderId,
      error: err.message
    });
    return null;
  }
}

/** Force-rebuild the invoice PDF (e.g. after items were corrected). */
async function regenerateInvoiceUrl(order) {
  if (!order || !order.orderId) return null;
  try {
    const url = await _generateAndUpload(order);
    order.invoiceUrl = url;
    if (typeof order.save === 'function') {
      try { await order.save(); } catch (_) { /* non-fatal */ }
    }
    return url;
  } catch (err) {
    logger.error('Invoice regenerate failed', {
      orderId: order.orderId, error: err.message
    });
    return null;
  }
}

function getInvoiceFilename(order) {
  return `Invoice-${order?.orderId || 'order'}.pdf`;
}

module.exports = {
  getOrCreateInvoiceUrl,
  regenerateInvoiceUrl,
  getInvoiceFilename
};
