/**
 * Public invoice endpoint.
 *
 *   GET /api/invoice/:orderId.pdf
 *
 * Returns the system-generated invoice PDF for the given order.
 *
 * The route is intentionally public (no auth) because Meta's WhatsApp Cloud
 * API fetches this URL directly when delivering the document message to the
 * customer. The order id is the only identifier; ids are 16+ random
 * alphanumeric characters which provides ~10^28 entropy — not realistically
 * enumerable.
 *
 * The PDF is generated on each request from the live order document. This
 * keeps storage to zero (no Cloudinary, no Buffer in Mongo) and means edits
 * to an order (e.g. an admin correcting an item) are reflected immediately
 * the next time the customer (or Meta) re-fetches.
 *
 * Response headers:
 *   Content-Type:        application/pdf
 *   Content-Disposition: inline; filename="Invoice-<orderId>.pdf"
 *   Cache-Control:       public, max-age=3600  (1h CDN/Meta hint)
 */

const express = require('express');
const Order = require('../models/Order');
const logger = require('../services/logger');
const { generateInvoicePdf } = require('../services/invoicePdf');

const router = express.Router();

router.get('/:filename', async (req, res) => {
  const { filename } = req.params;

  // Strip the .pdf extension and validate the order id shape
  const m = /^([A-Za-z0-9_-]{6,64})\.pdf$/.exec(filename);
  if (!m) {
    return res.status(400).type('text/plain').send('Bad invoice filename');
  }
  const orderId = m[1];

  try {
    const order = await Order.findOne({ orderId });
    if (!order) {
      return res.status(404).type('text/plain').send('Order not found');
    }

    const buffer = await generateInvoicePdf(order, {
      restaurantName:    process.env.MERCHANT_NAME || process.env.BUSINESS_NAME || undefined,
      restaurantPhone:   process.env.RESTAURANT_PHONE || undefined,
      restaurantAddress: process.env.RESTAURANT_ADDRESS || undefined
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(buffer.length),
      'Content-Disposition': `inline; filename="Invoice-${orderId}.pdf"`,
      // 1 hour edge cache. Render's CDN and Meta's fetcher will respect this.
      'Cache-Control': 'public, max-age=3600'
    });
    return res.send(buffer);
  } catch (err) {
    logger.error('Invoice route — generation failed', {
      orderId, error: err.message, stack: err.stack
    });
    return res.status(500).type('text/plain').send('Invoice generation failed');
  }
});

module.exports = router;
