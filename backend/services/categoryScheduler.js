const Category = require('../models/Category');
const cron = require('node-cron');

class CategoryScheduler {
  constructor() {
    this.jobs = new Map();
  }

  // Check if current time is within schedule
  isWithinSchedule(schedule) {
    if (!schedule || !schedule.enabled || !schedule.startTime || !schedule.endTime) {
      return true; // No schedule means always available
    }

    const now = new Date();
    const currentDay = now.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
    
    // Check if today is in the schedule (for custom days)
    if (schedule.type === 'custom' && schedule.days && schedule.days.length > 0) {
      if (!schedule.days.includes(currentDay)) {
        return false; // Not scheduled for today
      }
    }

    // Parse time strings (HH:MM format)
    const [startHour, startMin] = schedule.startTime.split(':').map(Number);
    const [endHour, endMin] = schedule.endTime.split(':').map(Number);

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    console.log(`[Category Scheduler] Checking schedule: Current=${currentMinutes} (${now.getHours()}:${now.getMinutes()}), Start=${startMinutes}, End=${endMinutes}`);

    // Handle overnight schedules (e.g., 22:00 to 02:00)
    if (endMinutes <= startMinutes) {
      const isWithin = currentMinutes >= startMinutes || currentMinutes <= endMinutes;
      console.log(`[Category Scheduler] Overnight schedule: ${isWithin}`);
      return isWithin;
    }

    // Normal schedule (e.g., 08:00 to 11:00)
    const isWithin = currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    console.log(`[Category Scheduler] Normal schedule: ${isWithin}`);
    return isWithin;
  }

  // Update category pause status based on schedule
  async updateCategoryStatus(categoryId) {
    try {
      const category = await Category.findById(categoryId);
      if (!category || !category.schedule || !category.schedule.enabled) {
        return;
      }

      console.log(`[Category Scheduler] Checking ${category.name}:`);
      console.log(`  Schedule: ${category.schedule.startTime} to ${category.schedule.endTime}`);
      console.log(`  Type: ${category.schedule.type}`);
      console.log(`  Days: ${category.schedule.days}`);

      const shouldBeActive = this.isWithinSchedule(category.schedule);
      const shouldBePaused = !shouldBeActive;

      console.log(`  Should be active: ${shouldBeActive}, Should be paused: ${shouldBePaused}`);
      console.log(`  Current isPaused: ${category.isPaused}`);

      // Only update if status needs to change
      // When within schedule, category should NOT be paused (isPaused = false)
      // When outside schedule, category should be paused (isPaused = true)
      if (category.isPaused !== shouldBePaused) {
        category.isPaused = shouldBePaused;
        await category.save();
        console.log(`[Category Scheduler] ${category.name}: ${shouldBePaused ? 'PAUSED (outside schedule)' : 'RESUMED (within schedule)'}`);
      } else {
        console.log(`[Category Scheduler] ${category.name}: No change needed (already ${category.isPaused ? 'paused' : 'active'})`);
      }
    } catch (error) {
      console.error(`[Category Scheduler] Error updating category ${categoryId}:`, error.message);
    }
  }

  // Check all categories with schedules
  async checkAllSchedules() {
    try {
      const categories = await Category.find({ 'schedule.enabled': true });
      
      for (const category of categories) {
        await this.updateCategoryStatus(category._id);
      }
    } catch (error) {
      console.error('[Category Scheduler] Error checking schedules:', error.message);
    }
  }

  // Start the scheduler (runs every minute)
  start() {
    // Run immediately on start
    this.checkAllSchedules();

    // Schedule to run every minute
    this.job = cron.schedule('* * * * *', () => {
      this.checkAllSchedules();
    });

    console.log('[Category Scheduler] Started - checking schedules every minute');
  }

  // Stop the scheduler
  stop() {
    if (this.job) {
      this.job.stop();
      console.log('[Category Scheduler] Stopped');
    }
  }
}

// Export singleton instance
const categoryScheduler = new CategoryScheduler();
module.exports = categoryScheduler;
