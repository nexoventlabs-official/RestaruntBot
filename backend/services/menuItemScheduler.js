const MenuItem = require('../models/MenuItem');
const cron = require('node-cron');
const logger = require('./logger');
const catalogService = require('./catalogService');
const { initContext, runWithContext } = require('./correlationContext');
const dataEvents = require('./eventEmitter');

class MenuItemScheduler {
  constructor() {
    this.job = null;
  }

  // Get current time in specified timezone
  getCurrentTimeInTimezone(timezone = 'Asia/Kolkata') {
    const now = new Date();
    const options = {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short'
    };
    const formatter = new Intl.DateTimeFormat('en-US', options);
    const parts = formatter.formatToParts(now);

    let hours = 0, minutes = 0, weekday = '';
    for (const part of parts) {
      if (part.type === 'hour') hours = parseInt(part.value, 10);
      if (part.type === 'minute') minutes = parseInt(part.value, 10);
      if (part.type === 'weekday') weekday = part.value;
    }

    // Map weekday to day number (0=Sun)
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dayNumber = dayMap[weekday] ?? new Date().getDay();

    return { hours, minutes, dayNumber, weekday };
  }

  // Check if current time is within a schedule
  isWithinSchedule(schedule) {
    const timezone = 'Asia/Kolkata';
    const { hours, minutes, dayNumber } = this.getCurrentTimeInTimezone(timezone);
    const currentMinutes = hours * 60 + minutes;
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentDay = dayNames[dayNumber];

    if (schedule.type === 'daily') {
      if (!schedule.dailyStartTime || !schedule.dailyEndTime) return false;
      const [startH, startM] = schedule.dailyStartTime.split(':').map(Number);
      const [endH, endM] = schedule.dailyEndTime.split(':').map(Number);
      const startMin = startH * 60 + startM;
      const endMin = endH * 60 + endM;

      // Handle overnight schedule (e.g., 22:00 - 06:00)
      if (endMin <= startMin) {
        return currentMinutes >= startMin || currentMinutes < endMin;
      }
      return currentMinutes >= startMin && currentMinutes < endMin;
    }

    if (schedule.type === 'custom') {
      if (!schedule.days || schedule.days.length === 0) return false;
      const daySchedule = schedule.days.find(d => d.day === currentDay && d.enabled);
      if (!daySchedule || !daySchedule.startTime || !daySchedule.endTime) return false;

      const [startH, startM] = daySchedule.startTime.split(':').map(Number);
      const [endH, endM] = daySchedule.endTime.split(':').map(Number);
      const startMin = startH * 60 + startM;
      const endMin = endH * 60 + endM;

      // Handle overnight schedule
      if (endMin <= startMin) {
        return currentMinutes >= startMin || currentMinutes < endMin;
      }
      return currentMinutes >= startMin && currentMinutes < endMin;
    }

    return false;
  }

  // Update a single menu item's availability based on its schedule
  async updateItemStatus(item) {
    try {
      if (!item.soldOutSchedule || !item.soldOutSchedule.enabled) return;

      // Schedule defines the AVAILABILITY window
      // Within schedule = available, outside schedule = sold out
      const isWithinSchedule = this.isWithinSchedule(item.soldOutSchedule);
      const shouldBeSoldOut = !isWithinSchedule;

      // Determine current sold-out state from variants or item-level availability
      const isCurrentlySoldOut = item.variants && item.variants.length > 0
        ? item.variants.every(v => v.available === false)
        : item.available === false;

      // Only update if state needs to change
      if (shouldBeSoldOut === isCurrentlySoldOut) return;

      const newStatus = shouldBeSoldOut ? 'SOLD_OUT' : 'AVAILABLE';
      const oldStatus = isCurrentlySoldOut ? 'SOLD_OUT' : 'AVAILABLE';

      logger.info('[MenuItem Scheduler] STATUS CHANGED', {
        name: item.name,
        from: oldStatus,
        to: newStatus
      });

      if (item.variants && item.variants.length > 0) {
        item.variants.forEach(v => { v.available = !shouldBeSoldOut; });
      }
      item.available = !shouldBeSoldOut;
      await item.save();

      // Sync to Meta catalog
      catalogService.syncProductToMeta(item).catch(err => {
        logger.info('[MenuItem Scheduler] Catalog sync error', {
          itemId: item._id,
          error: err.message
        });
      });

      // Emit event for real-time updates on admin panel
      dataEvents.emit('menu');
    } catch (error) {
      logger.error('[MenuItem Scheduler] Error updating item status', {
        itemId: item._id,
        error: error.message
      });
    }
  }

  // Also check legacy soldOutUntil (one-time schedule)
  async checkSoldOutUntil(item) {
    try {
      if (!item.soldOutUntil) return;

      const { hours, minutes } = this.getCurrentTimeInTimezone('Asia/Kolkata');
      const currentMinutes = hours * 60 + minutes;
      const [endH, endM] = item.soldOutUntil.split(':').map(Number);
      const endMinutes = endH * 60 + endM;

      if (currentMinutes >= endMinutes) {
        logger.info('[MenuItem Scheduler] soldOutUntil EXPIRED - resuming item', {
          name: item.name,
          endTime: item.soldOutUntil
        });

        if (item.variants && item.variants.length > 0) {
          item.variants.forEach(v => { v.available = true; });
        }
        item.available = true;
        item.soldOutUntil = null;
        await item.save();

        catalogService.syncProductToMeta(item).catch(err => {
          logger.info('[MenuItem Scheduler] Catalog sync error on resume', {
            itemId: item._id,
            error: err.message
          });
        });

        dataEvents.emit('menu');
      }
    } catch (error) {
      logger.error('[MenuItem Scheduler] Error checking soldOutUntil', {
        itemId: item._id,
        error: error.message
      });
    }
  }

  // Check all menu items with schedules
  async checkAllSchedules() {
    try {
      const { hours, minutes, dayNumber } = this.getCurrentTimeInTimezone('Asia/Kolkata');
      const currentTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      const currentDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayNumber];

      logger.info('[MenuItem Scheduler] Running check', { time: currentTime, day: currentDay });

      // Check recurring schedules
      const itemsWithSchedule = await MenuItem.find({ 'soldOutSchedule.enabled': true });
      if (itemsWithSchedule.length > 0) {
        logger.info('[MenuItem Scheduler] Found items with schedules', { count: itemsWithSchedule.length });
        for (const item of itemsWithSchedule) {
          await this.updateItemStatus(item);
        }
      }

      // Check legacy one-time soldOutUntil
      const itemsWithSoldOutUntil = await MenuItem.find({ soldOutUntil: { $ne: null } });
      if (itemsWithSoldOutUntil.length > 0) {
        logger.info('[MenuItem Scheduler] Found items with soldOutUntil', { count: itemsWithSoldOutUntil.length });
        for (const item of itemsWithSoldOutUntil) {
          await this.checkSoldOutUntil(item);
        }
      }

      if (itemsWithSchedule.length === 0 && itemsWithSoldOutUntil.length === 0) {
        logger.info('[MenuItem Scheduler] No items with schedules');
      }
    } catch (error) {
      logger.error('[MenuItem Scheduler] Error checking schedules', { error: error.message });
    }
  }

  // Start the scheduler (runs every minute)
  start() {
    // Run immediately on start
    const ctx = initContext(null, { source: 'scheduler', job: 'menuItemScheduler' });
    runWithContext(ctx, () => this.checkAllSchedules());

    // Schedule to run every minute
    this.job = cron.schedule('* * * * *', () => {
      const ctx = initContext(null, { source: 'scheduler', job: 'menuItemScheduler' });
      runWithContext(ctx, () => this.checkAllSchedules());
    });

    logger.info('[MenuItem Scheduler] Started - checking schedules every minute');
  }

  // Stop the scheduler
  stop() {
    if (this.job) {
      this.job.stop();
      logger.info('[MenuItem Scheduler] Stopped');
    }
  }
}

// Export singleton instance
const menuItemScheduler = new MenuItemScheduler();
module.exports = menuItemScheduler;
