// services/crmBridge.js
// SYNHA — Loop 5: CRM bridge.
//
// Sends a standard "completed outcome" webhook to config.crmWebhookUrl on
// every completion (order in Restarunt, appointment in vijya-hospital).
// This is the ONE integration point for SIGNAL CRM — when SIGNAL is located,
// only config.crmWebhookUrl changes; nothing else.
//
// This file is IDENTICAL in both systems (Restarunt + vijya-hospital).
//
// Guarantees:
//   - Silent skip when crmWebhookUrl is empty/null (not an error).
//   - Non-blocking: never throws; completion is never blocked.
//   - Idempotent: de-duplicates by source+reference within process lifetime.
//   - Standard payload contract (same shape for every system / event).

const axios = require('axios');

// Process-lifetime dedupe, keyed by `${source}:${reference}`.
const _pushed = new Set();
const _clear = setInterval(() => _pushed.clear(), 60 * 60 * 1000);
if (typeof _clear.unref === 'function') _clear.unref();

/** Map a Restarunt Order document to the standard event shape. */
function fromOrder(order) {
  return {
    type: 'order_completed',
    customerPhone: order.customer?.phone || '',
    customerName: order.customer?.name || 'Customer',
    amount: order.totalAmount != null ? order.totalAmount : null,
    outcome: {
      reference: order.orderId,
      items: Array.isArray(order.items)
        ? order.items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price }))
        : [],
      total: order.totalAmount,
      serviceType: order.serviceType,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      status: order.status,
    },
  };
}

/** Map a vijya-hospital Appointment document to the standard event shape. */
function fromAppointment(appt) {
  return {
    type: 'appointment_confirmed',
    customerPhone: appt.patientPhone || '',
    customerName: appt.patientName || 'Patient',
    amount: appt.fee != null ? appt.fee : null,
    outcome: {
      reference: appt.code,
      doctor: appt.doctorName,
      department: appt.departmentName,
      date: appt.date,
      time: appt.timeLabel || appt.time,
      paymentMode: appt.paymentMode,
      paymentStatus: appt.paymentStatus,
      status: appt.status,
    },
  };
}

/**
 * Push a completed outcome to the configured CRM webhook.
 * @param {Object} eventData - { type, customerPhone, customerName, amount, outcome }
 * @param {Object} config    - restaurant.config / hospital.config
 */
async function pushToCRM(eventData, config) {
  try {
    if (!config || !config.crmWebhookUrl) return; // CRM not configured yet → silent skip
    if (!eventData) return;
    const reference = eventData.outcome && eventData.outcome.reference;
    const key = `${config.systemSource || ''}:${reference || ''}`;
    if (reference) {
      if (_pushed.has(key)) return;
      _pushed.add(key);
    }
    const payload = {
      eventType: eventData.type,
      businessName: config.businessName,
      customerPhone: eventData.customerPhone,
      customerName: eventData.customerName,
      outcome: eventData.outcome,
      amount: eventData.amount != null ? eventData.amount : null,
      timestamp: new Date().toISOString(),
      source: config.systemSource,
    };
    await axios.post(config.crmWebhookUrl, payload, {
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
        'X-SYNHA-Key': config.crmApiKey || '',
      },
    });
  } catch (err) {
    // Never throw — completion is never blocked by the CRM push.
    console.error('[crmBridge] push failed:', err && err.message);
  }
}

module.exports = { pushToCRM, fromOrder, fromAppointment };
