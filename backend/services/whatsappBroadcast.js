const WhatsAppContact = require('../models/WhatsAppContact');
const Customer = require('../models/Customer');
const whatsapp = require('./whatsapp');

// Template name for broadcast offers - must be created in WhatsApp Business Manager
// If you don't have a template, set this to null to skip template fallback
const OFFER_TEMPLATE_NAME = process.env.WHATSAPP_OFFER_TEMPLATE || null;

// Check if using a test WhatsApp number
// Test numbers (like 15550001234, or numbers starting with 1555) have restrictions
const isTestNumber = () => {
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  // Meta test phone number IDs are typically different from production
  // You can set this env var to 'true' if using a test number
  return process.env.WHATSAPP_TEST_MODE === 'true';
};

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
  // Uses interactive messages for users within 24-hour window
  // Falls back to template messages for users outside 24-hour window
  async sendOfferToAll(offerImageUrl, offerTitle, offerDescription, offerType) {
    try {
      const contacts = await this.getAllContacts();
      
      if (contacts.length === 0) {
        return { success: false, message: 'No contacts found', sent: 0, failed: 0 };
      }

      let sent = 0;
      let failed = 0;
      let sentViaTemplate = 0;
      const failedContacts = [];

      // Build message for interactive messages
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
          // Try sending interactive message first (works within 24-hour window)
          if (offerImageUrl) {
            await whatsapp.sendImageWithCtaUrlOriginal(
              contact.phone, 
              offerImageUrl, 
              message, 
              'View Offer', 
              websiteUrl,
              'Tap to order now!'
            );
          } else {
            await whatsapp.sendCtaUrl(
              contact.phone, 
              message, 
              'View Offer', 
              websiteUrl,
              'Tap to order now!'
            );
          }
          sent++;
          console.log(`[WhatsApp Broadcast] ✅ Sent interactive to ${contact.phone}`);
        } catch (error) {
          const errorMessage = error.response?.data?.error?.message || error.message || '';
          const errorCode = error.response?.data?.error?.code;
          
          // Check if error is due to 24-hour window (error code 131047 or message contains relevant text)
          // Also check for test number recipient restrictions (error code 131030)
          const is24HourError = errorCode === 131047 || 
                               errorMessage.includes('24 hour') || 
                               errorMessage.includes('re-engage') ||
                               errorMessage.includes('outside the allowed window');
          
          const isTemplateRequiredError = errorMessage.includes('template') && !errorMessage.includes('not found');
          
          // Test number restriction - can only send to test recipients
          const isTestRecipientError = errorCode === 131030 || 
                                       errorMessage.includes('test') ||
                                       errorMessage.includes('recipient') ||
                                       errorMessage.includes('not a valid');
          
          if ((is24HourError || isTemplateRequiredError) && OFFER_TEMPLATE_NAME) {
            // Try sending via template (works outside 24-hour window)
            try {
              console.log(`[WhatsApp Broadcast] 24h window expired for ${contact.phone}, trying template...`);
              
              // Send using marketing template
              // Template should have: header image, body with {{1}} for title, {{2}} for description
              await whatsapp.sendMarketingTemplate(
                contact.phone,
                OFFER_TEMPLATE_NAME,
                offerImageUrl,
                [offerTitle || 'Special Offer', offerDescription || 'Check out our latest deals!'],
                null // buttonUrl if template has dynamic URL
              );
              sent++;
              sentViaTemplate++;
              console.log(`[WhatsApp Broadcast] ✅ Sent via template to ${contact.phone}`);
            } catch (templateError) {
              failed++;
              failedContacts.push({ 
                phone: contact.phone, 
                error: templateError.response?.data?.error?.message || templateError.message,
                reason: 'template_failed'
              });
              console.error(`[WhatsApp Broadcast] ❌ Template also failed for ${contact.phone}:`, templateError.message);
            }
          } else if ((is24HourError || isTemplateRequiredError) && !OFFER_TEMPLATE_NAME) {
            // No template configured, log the 24-hour issue
            failed++;
            failedContacts.push({ 
              phone: contact.phone, 
              error: '24-hour window expired and no template configured. Set WHATSAPP_OFFER_TEMPLATE env var with your approved template name.',
              reason: '24h_no_template'
            });
            console.log(`[WhatsApp Broadcast] ⚠️ 24h window expired for ${contact.phone}, no template configured`);
          } else if (isTestRecipientError) {
            // Test number restriction
            failed++;
            failedContacts.push({ 
              phone: contact.phone, 
              error: 'Test number restriction: Can only send to registered test recipients. Add this number as a test recipient in Meta Business Manager or switch to a production WhatsApp number.',
              reason: 'test_recipient_restriction'
            });
            console.log(`[WhatsApp Broadcast] ⚠️ Test recipient restriction for ${contact.phone}`);
          } else {
            // Other error
            failed++;
            failedContacts.push({ phone: contact.phone, error: errorMessage, reason: 'other_error' });
            console.error(`[WhatsApp Broadcast] ❌ Failed to send to ${contact.phone}:`, errorMessage);
          }
        }
        
        // Add delay to avoid rate limiting (500ms between messages)
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log(`[WhatsApp Broadcast] Completed: ${sent} sent (${sentViaTemplate} via template), ${failed} failed`);
      
      return {
        success: true,
        total: contacts.length,
        sent,
        sentViaTemplate,
        failed,
        failedContacts,
        templateConfigured: !!OFFER_TEMPLATE_NAME
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
