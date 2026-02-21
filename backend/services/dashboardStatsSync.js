/**
 * Dashboard Stats Sync Scheduler
 * 
 * Purpose: Periodically reconcile DashboardStats counters with actual database values.
 * Fixes counter drift caused by crashes, partial writes, or missed increments.
 * 
 * Runs daily at 3:00 AM (low-traffic window).
 * Also exported for manual/startup execution.
 */

const cron = require('node-cron');
const Order = require('../models/Order');
const Customer = require('../models/Customer');
const DashboardStats = require('../models/DashboardStats');
const logger = require('./logger');
const { initContext, runWithContext } = require('./correlationContext');

let schedulerTask = null;

/**
 * Recalculate dashboard stats from actual database state
 */
async function syncStats() {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Count today's orders from actual DB
    const todayOrders = await Order.countDocuments({
      createdAt: { $gte: todayStart, $lte: todayEnd }
    });

    // Count today's revenue from actual DB
    const todayRevenueResult = await Order.aggregate([
      { 
        $match: { 
          createdAt: { $gte: todayStart, $lte: todayEnd }, 
          paymentStatus: { $in: ['paid', 'pending'] } 
        } 
      },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    const todayRevenue = todayRevenueResult[0]?.total || 0;

    // Count total stats
    const totalOrders = await Order.countDocuments();
    const totalRevenueResult = await Order.aggregate([
      { $match: { paymentStatus: { $in: ['paid', 'pending'] } } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    const totalRevenue = totalRevenueResult[0]?.total || 0;
    const totalCustomers = await Customer.countDocuments();

    // Update DashboardStats atomically
    const updated = await DashboardStats.findOneAndUpdate(
      {},
      {
        $set: {
          todayOrders,
          todayRevenue,
          totalOrders,
          totalRevenue,
          totalCustomers,
          todayDate: todayStr,
          lastUpdated: new Date(),
          lastSyncedAt: new Date()
        }
      },
      { upsert: true, new: true }
    );

    logger.info('[DashboardSync] Stats reconciled', {
      todayOrders,
      todayRevenue,
      totalOrders,
      totalRevenue,
      totalCustomers
    });

    // Also sync to Google Sheets if available
    try {
      const googleSheets = require('./googleSheets');
      await googleSheets.updateDashboardStat('Total Orders', totalOrders);
      await googleSheets.updateDashboardStat('Total Revenue', totalRevenue);
      await googleSheets.updateDashboardStat('Total Customers', totalCustomers);
      await googleSheets.updateDashboardStat('Today Orders', todayOrders);
      await googleSheets.updateDashboardStat('Today Revenue', todayRevenue);
      const todayDate = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
      await googleSheets.updateDashboardStat('Today Date', todayDate);
      logger.info('[DashboardSync] Google Sheets synced');
    } catch (sheetsErr) {
      logger.warn('[DashboardSync] Google Sheets sync skipped', { error: sheetsErr.message });
    }

    return { todayOrders, todayRevenue, totalOrders, totalRevenue, totalCustomers };
  } catch (error) {
    logger.error('[DashboardSync] Fatal error', { error: error.message, stack: error.stack });
    return { error: error.message };
  }
}

function start() {
  if (schedulerTask) {
    logger.info('[DashboardSync] Already running');
    return;
  }
  // Run daily at 3:00 AM
  schedulerTask = cron.schedule('0 3 * * *', async () => {
    const ctx = initContext(null, { source: 'scheduler', job: 'dashboardStatsSync' });
    await runWithContext(ctx, async () => {
      logger.info('[DashboardSync] Running daily stats reconciliation');
      await syncStats();
    });
  });
  logger.info('[DashboardSync] Started — running daily at 3:00 AM');
}

function stop() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    logger.info('[DashboardSync] Stopped');
  }
}

module.exports = { start, stop, syncStats };
