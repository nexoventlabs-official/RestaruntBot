const WhatsAppContact = require('../models/WhatsAppContact');
const Customer = require('../models/Customer');
const whatsapp = require('./whatsapp');

const whatsappBroadcast = {
  // Add or update a WhatsApp contact
  async addContact(phone, name = null, orderDate = new Date()) {
    try {
      const contact = await WhatsAppContact.findOne({ phone });
      
      if (contact) {
        // Update existing contact
        contact.name = name || contact.name;
        contact.lastOrderDate = orderDate;
        contact.totalOrders += 1;
        await contact.save();
        return contact;
      } else {
        // Create new contact
        const newContact = new WhatsAppContact({
          phone,
          name,
          firstOrderDate: orderDate,
          lastOrderDate: orderDate,
          totalOrders: 1
        });
        await newContact.save();
        return newContact;
      }
    } catch (error) {
      console.error('[WhatsApp Broadcast] Error adding contact:', error);
      return null;
    }
  },

  // Sync all existing customers to WhatsApp contacts
  async syncExistingCustomers() {
    try {
      console.log('[WhatsApp Broadcast] Syncing existing customers...');
      const customers = await Customer.find({ phone: { $exists: true, $ne: null } });
      
      let synced = 0;
      for (const customer of customers) {
        if (customer.phone) {
          await this.addContact(customer.phone, customer.name, customer.createdAt);
          synced++;
        }
      }
      
      console.log(`[WhatsApp Broadcast] Synced ${synced} customers to WhatsApp contacts`);
      return { success: true, synced };
    } catch (error) {
      console.error('[WhatsApp Broadcast] Error syncing customers:', error);
      return { success: false, error: error.message };
    }
  },

  // Get all active WhatsApp contacts
  async getAllContacts() {
    try {
      const contacts = await WhatsAppContact.find({ isActive: true }).sort({ lastOrderDate: -1 });
      return contacts;
    } catch (error) {
      console.error('[WhatsApp Broadcast] Error getting contacts:', error);
      return [];
    }
  },

  // Send offer image to all WhatsApp contacts
  async sendOfferToAll(offerImageUrl, offerTitle, offerDescription, offerType) {
    try {
      const contacts = await this.getAllContacts();
      
      if (contacts.length === 0) {
        return { success: false, message: 'No contacts found', sent: 0, failed: 0 };
      }

      let sent = 0;
      let failed = 0;
      const failedContacts = [];

      // Build message
      let message = `🎉 *New Offer!*\n\n`;
      if (offerType) {
        message += `🏷️ *${offerType}*\n\n`;
      }
      if (offerTitle) {
        message += `*${offerTitle}*\n\n`;
      }
      if (offerDescription) {
        message += `${offerDescription}\n\n`;
      }
      message += `Order now and enjoy this amazing deal! 🍽️`;

      const websiteUrl = 'https://restarunt-bot.vercel.app/offers';

      console.log(`[WhatsApp Broadcast] Sending offer to ${contacts.length} contacts...`);

      // Send to each contact with delay to avoid rate limiting
      for (const contact of contacts) {
        try {
          if (offerImageUrl) {
            // Send image with CTA button to website in original ratio
            await whatsapp.sendImageWithCtaUrlOriginal(
              contact.phone, 
              offerImageUrl, 
              message, 
              'View Offer', 
              websiteUrl,
              'Tap to order now!'
            );
          } else {
            // Send text message with CTA button
            await whatsapp.sendCtaUrl(
              contact.phone, 
              message, 
              'View Offer', 
              websiteUrl,
              'Tap to order now!'
            );
          }
          sent++;
          console.log(`[WhatsApp Broadcast] Sent to ${contact.phone}`);
          
          // Add delay to avoid rate limiting (500ms between messages)
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          failed++;
          failedContacts.push({ phone: contact.phone, error: error.message });
          console.error(`[WhatsApp Broadcast] Failed to send to ${contact.phone}:`, error.message);
        }
      }

      console.log(`[WhatsApp Broadcast] Completed: ${sent} sent, ${failed} failed`);
      
      return {
        success: true,
        total: contacts.length,
        sent,
        failed,
        failedContacts
      };
    } catch (error) {
      console.error('[WhatsApp Broadcast] Error sending offer:', error);
      return { success: false, error: error.message, sent: 0, failed: 0 };
    }
  },

  // Get contact statistics
  async getStats() {
    try {
      const total = await WhatsAppContact.countDocuments({ isActive: true });
      const totalInactive = await WhatsAppContact.countDocuments({ isActive: false });
      
      return {
        total,
        active: total,
        inactive: totalInactive
      };
    } catch (error) {
      console.error('[WhatsApp Broadcast] Error getting stats:', error);
      return { total: 0, active: 0, inactive: 0 };
    }
  }
};

module.exports = whatsappBroadcast;
