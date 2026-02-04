const WhatsAppContact = require('../models/WhatsAppContact');
const Customer = require('../models/Customer');
const whatsapp = require('./whatsapp');
const googleSheets = require('./googleSheets');

// Template name for broadcast offers - must be created in WhatsApp Business Manager
// If you don't have a custom template, we'll use 'hello_world' which is pre-approved for all accounts
const OFFER_TEMPLATE_NAME = process.env.WHATSAPP_OFFER_TEMPLATE || 'hello_world';

// Check if using a test WhatsApp number
// Test numbers (like 15550001234, or numbers starting with 1555) have restrictions
const isTestNumber = () => {
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  // Meta test phone number IDs are typically different from production
  // You can set this env var to 'true' if using a test number
  return process.env.WHATSAPP_TEST_MODE === 'true';
};

const whatsappBroadcast = {
  // Add or update a WhatsApp contact - Now saves to Google Sheets (cost-saving)
  async addContact(phone, name = null, orderDate = new Date()) {
    try {
      // Save to Google Sheets (primary storage)
      await googleSheets.addOrUpdateWhatsAppContact({
        phone,
        name,
        firstOrderDate: orderDate,
        lastOrderDate: orderDate,
        totalOrders: 1,
        isActive: true
      });
      
      // Also save to MongoDB for backward compatibility (can be removed later)
      const contact = await WhatsAppContact.findOne({ phone });
      
      if (contact) {
        contact.name = name || contact.name;
        contact.lastOrderDate = orderDate;
        contact.totalOrders += 1;
        await contact.save();
        return contact;
      } else {
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

  // Sync all existing customers to WhatsApp contacts (both MongoDB and Sheets)
  async syncExistingCustomers() {
    try {
      console.log('[WhatsApp Broadcast] Syncing existing customers to Google Sheets...');
      
      // Get all customers with phone numbers from MongoDB
      const customers = await Customer.find({ 
        phone: { $exists: true, $ne: null, $ne: '' } 
      });
      
      console.log(`[WhatsApp Broadcast] Found ${customers.length} customers with phone numbers`);
      
      let synced = 0;
      
      // Sync each customer to Google Sheets
      for (const customer of customers) {
        if (customer.phone && customer.phone.trim() !== '') {
          await googleSheets.addOrUpdateWhatsAppContact({
            phone: customer.phone,
            name: customer.name || '',
            firstOrderDate: customer.createdAt,
            lastOrderDate: customer.updatedAt || customer.createdAt,
            totalOrders: customer.totalOrders || 1,
            isActive: true
          });
          synced++;
        }
      }
      
      console.log(`[WhatsApp Broadcast] Synced ${synced} customers to Google Sheets`);
      return { success: true, synced, total: customers.length };
    } catch (error) {
      console.error('[WhatsApp Broadcast] Error syncing customers:', error);
      return { success: false, error: error.message };
    }
  },

  // Get all active WhatsApp contacts from Google Sheets (cost-saving)
  async getAllContacts(includeOldCustomers = true) {
    try {
      if (includeOldCustomers) {
        // Sync any new customers first
        await this.syncExistingCustomers();
      }
      
      // Fetch from Google Sheets (primary source)
      const sheetContacts = await googleSheets.getActiveWhatsAppContacts();
      
      if (sheetContacts.length > 0) {
        console.log(`[WhatsApp Broadcast] Found ${sheetContacts.length} active contacts from Google Sheets`);
        return sheetContacts;
      }
      
      // Fallback to MongoDB if sheets fail
      console.log('[WhatsApp Broadcast] Falling back to MongoDB for contacts...');
      const contacts = await WhatsAppContact.find({ isActive: true }).sort({ lastOrderDate: -1 });
      console.log(`[WhatsApp Broadcast] Found ${contacts.length} active contacts from MongoDB`);
      return contacts;
    } catch (error) {
      console.error('[WhatsApp Broadcast] Error getting contacts:', error);
      return [];
    }
  },

  // Send offer image to WhatsApp contacts (supports targeting)
  // Uses interactive messages for users within 24-hour window
  // Falls back to template messages for users outside 24-hour window (even if they sent "hi" months ago)
  // targetedCustomers: array of phone numbers to send to (null = send to all)
  // offerId: optional offer ID to include claim button for eligibility check
  async sendOfferToAll(offerImageUrl, offerTitle, offerDescription, offerType, targetedCustomers = null, offerId = null) {
    try {
      // Ensure all customers are synced before sending (includes old customers who sent "hi" or any message)
      console.log('[WhatsApp Broadcast] Syncing ALL customers (including old customers) before sending...');
      await this.syncExistingCustomers();
      
      let contacts = await this.getAllContacts(true); // Include old customers
      
      // Filter contacts if targeting specific customers
      const isTargetedOffer = targetedCustomers && Array.isArray(targetedCustomers) && targetedCustomers.length > 0;
      if (isTargetedOffer) {
        console.log(`[WhatsApp Broadcast] Filtering to ${targetedCustomers.length} targeted customers...`);
        const targetSet = new Set(targetedCustomers.map(p => p.replace(/\D/g, ''))); // Normalize phone numbers
        contacts = contacts.filter(contact => {
          const normalizedPhone = contact.phone.replace(/\D/g, '');
          return targetSet.has(normalizedPhone);
        });
        console.log(`[WhatsApp Broadcast] Found ${contacts.length} matching contacts for targeting`);
      }
      
      if (contacts.length === 0) {
        return { success: false, message: 'No contacts found', sent: 0, failed: 0, total: 0 };
      }

      let sent = 0;
      let failed = 0;
      let sentViaTemplate = 0;
      let sentViaInteractive = 0;
      const failedContacts = [];
      const successContacts = [];

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
      
      // Add exclusive tag for targeted offers
      if (isTargetedOffer) {
        message += `✨ *Exclusive offer for you!* ✨\n\n`;
      }
      message += `Order now and enjoy this amazing deal! 🍽️`;

      const websiteUrl = 'https://restarunt-bot.vercel.app/offers';

      console.log(`[WhatsApp Broadcast] Sending offer to ${contacts.length} contacts...`);
      console.log(`[WhatsApp Broadcast] Note: Customers outside 24h window will receive via template`);
      console.log(`[WhatsApp Broadcast] Template configured: ${OFFER_TEMPLATE_NAME || 'None'}`);

      // Send to each contact with delay to avoid rate limiting
      // For customers within 24h window: sends interactive message directly
      // For customers outside 24h window: uses hello_world template to re-open conversation, then sends offer
      for (const contact of contacts) {
        // Check if customer is outside 24h window based on lastOrderDate
        const hoursSinceLastInteraction = Math.floor((new Date() - new Date(contact.lastOrderDate)) / (1000 * 60 * 60));
        const isOutside24h = hoursSinceLastInteraction >= 24;
        
        if (isOutside24h) {
          console.log(`[WhatsApp Broadcast] ${contact.phone} (${contact.name || 'Unknown'}) is outside 24h window (${hoursSinceLastInteraction}h ago), using template...`);
        }
        
        try {
          // If customer is outside 24h window, use template directly
          if (isOutside24h && OFFER_TEMPLATE_NAME) {
            console.log(`[WhatsApp Broadcast] Sending template to ${contact.phone} (${contact.name || 'Unknown'})...`);
            
            if (OFFER_TEMPLATE_NAME === 'hello_world') {
              // Use the pre-approved hello_world template first to re-open the conversation
              await whatsapp.sendSimpleTemplate(contact.phone, 'hello_world', 'en_US');
              console.log(`[WhatsApp Broadcast] Template sent to ${contact.phone}`);
              
              // Wait a moment then send the actual offer (now within 24h window)
              await new Promise(resolve => setTimeout(resolve, 1500));
              
              // Now send the actual offer content
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
            } else {
              // Send using custom marketing template
              await whatsapp.sendMarketingTemplate(
                contact.phone,
                OFFER_TEMPLATE_NAME,
                offerImageUrl,
                [offerTitle || 'Special Offer', offerDescription || 'Check out our latest deals!'],
                null
              );
            }
            sent++;
            sentViaTemplate++;
            successContacts.push({ phone: contact.phone, method: 'template', name: contact.name });
            console.log(`[WhatsApp Broadcast] ✅ Sent via template to ${contact.phone} (${contact.name || 'Unknown'})`);
            
          } else {
            // Customer is within 24h window, try sending interactive message directly
            // For targeted offers, use reply buttons for eligibility check
            // For non-targeted offers, use CTA URL to website
            if (isTargetedOffer && offerId) {
              // Targeted offer - use buttons so chatbot can verify eligibility when shared
              if (offerImageUrl) {
                await whatsapp.sendImageWithButtons(
                  contact.phone, 
                  offerImageUrl, 
                  message, 
                  [
                    { id: `claim_offer_${offerId}`, text: '🎁 Claim Offer' },
                    { id: 'view_menu', text: '📋 View Menu' }
                  ]
                );
              } else {
                await whatsapp.sendButtons(
                  contact.phone, 
                  message, 
                  [
                    { id: `claim_offer_${offerId}`, text: '🎁 Claim Offer' },
                    { id: 'view_menu', text: '📋 View Menu' }
                  ]
                );
              }
            } else {
              // Non-targeted offer - use CTA URL to website
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
            }
            sent++;
            sentViaInteractive++;
            successContacts.push({ phone: contact.phone, method: 'interactive', name: contact.name });
            console.log(`[WhatsApp Broadcast] ✅ Sent interactive to ${contact.phone} (${contact.name || 'Unknown'})`);
          }
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
          
          // For test numbers, if recipient is not added, try template method
          if (isTestRecipientError && OFFER_TEMPLATE_NAME) {
            // Try sending via template (templates work even for non-test recipients on test numbers)
            try {
              console.log(`[WhatsApp Broadcast] Test recipient restriction for ${contact.phone} (${contact.name || 'Unknown'}), trying template "${OFFER_TEMPLATE_NAME}"...`);
              
              if (OFFER_TEMPLATE_NAME === 'hello_world') {
                // Use the pre-approved hello_world template first to re-open the conversation
                await whatsapp.sendSimpleTemplate(contact.phone, 'hello_world', 'en_US');
                
                // Wait a moment then send the actual offer (now within 24h window)
                await new Promise(resolve => setTimeout(resolve, 1500));
                
                // Now send the actual offer content
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
              } else {
                // Send using custom marketing template
                await whatsapp.sendMarketingTemplate(
                  contact.phone,
                  OFFER_TEMPLATE_NAME,
                  offerImageUrl,
                  [offerTitle || 'Special Offer', offerDescription || 'Check out our latest deals!'],
                  null
                );
              }
              sent++;
              sentViaTemplate++;
              successContacts.push({ phone: contact.phone, method: 'template', name: contact.name });
              console.log(`[WhatsApp Broadcast] ✅ Sent via template to ${contact.phone} (${contact.name || 'Unknown'})`);
            } catch (templateError) {
              failed++;
              const templateErrorMsg = templateError.response?.data?.error?.message || templateError.message;
              failedContacts.push({ 
                phone: contact.phone,
                name: contact.name,
                error: templateErrorMsg,
                reason: 'test_recipient_template_failed'
              });
              console.error(`[WhatsApp Broadcast] ❌ Template also failed for ${contact.phone} (${contact.name || 'Unknown'}):`, templateErrorMsg);
            }
          } else if ((is24HourError || isTemplateRequiredError) && OFFER_TEMPLATE_NAME) {
            // Try sending via template (works outside 24-hour window)
            try {
              console.log(`[WhatsApp Broadcast] 24h window expired for ${contact.phone} (${contact.name || 'Unknown'}), trying template "${OFFER_TEMPLATE_NAME}"...`);
              
              if (OFFER_TEMPLATE_NAME === 'hello_world') {
                // Use the pre-approved hello_world template first to re-open the conversation
                await whatsapp.sendSimpleTemplate(contact.phone, 'hello_world', 'en_US');
                
                // Wait a moment then send the actual offer (now within 24h window)
                await new Promise(resolve => setTimeout(resolve, 1500));
                
                // Now send the actual offer content
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
              } else {
                // Send using custom marketing template
                // Template should have: header image, body with {{1}} for title, {{2}} for description
                await whatsapp.sendMarketingTemplate(
                  contact.phone,
                  OFFER_TEMPLATE_NAME,
                  offerImageUrl,
                  [offerTitle || 'Special Offer', offerDescription || 'Check out our latest deals!'],
                  null // buttonUrl if template has dynamic URL
                );
              }
              sent++;
              sentViaTemplate++;
              successContacts.push({ phone: contact.phone, method: 'template', name: contact.name });
              console.log(`[WhatsApp Broadcast] ✅ Sent via template to ${contact.phone} (${contact.name || 'Unknown'})`);
            } catch (templateError) {
              failed++;
              const templateErrorMsg = templateError.response?.data?.error?.message || templateError.message;
              failedContacts.push({ 
                phone: contact.phone,
                name: contact.name,
                error: templateErrorMsg,
                reason: 'template_failed'
              });
              console.error(`[WhatsApp Broadcast] ❌ Template also failed for ${contact.phone} (${contact.name || 'Unknown'}):`, templateErrorMsg);
            }
          } else if ((is24HourError || isTemplateRequiredError) && !OFFER_TEMPLATE_NAME) {
            // No template configured, log the 24-hour issue
            failed++;
            failedContacts.push({ 
              phone: contact.phone,
              name: contact.name,
              error: '24-hour window expired and no template configured. Set WHATSAPP_OFFER_TEMPLATE env var with your approved template name.',
              reason: '24h_no_template'
            });
            console.log(`[WhatsApp Broadcast] ⚠️ 24h window expired for ${contact.phone} (${contact.name || 'Unknown'}), no template configured`);
          } else if (isTestRecipientError && !OFFER_TEMPLATE_NAME) {
            // Test number restriction and no template to try
            failed++;
            failedContacts.push({ 
              phone: contact.phone,
              name: contact.name,
              error: 'Test number restriction: Can only send to registered test recipients. Add this number as a test recipient in Meta Business Manager or switch to a production WhatsApp number.',
              reason: 'test_recipient_restriction'
            });
            console.log(`[WhatsApp Broadcast] ⚠️ Test recipient restriction for ${contact.phone} (${contact.name || 'Unknown'}), no template to try`);
          } else {
            // Other error
            failed++;
            failedContacts.push({ 
              phone: contact.phone,
              name: contact.name,
              error: errorMessage,
              reason: 'other_error'
            });
            console.error(`[WhatsApp Broadcast] ❌ Failed to send to ${contact.phone} (${contact.name || 'Unknown'}):`, errorMessage);
          }
        }
        
        // Add delay to avoid rate limiting (500ms between messages)
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log(`[WhatsApp Broadcast] ========== BROADCAST SUMMARY ==========`);
      console.log(`[WhatsApp Broadcast] Total contacts: ${contacts.length}`);
      console.log(`[WhatsApp Broadcast] Successfully sent: ${sent} (${sentViaInteractive} interactive, ${sentViaTemplate} via template)`);
      console.log(`[WhatsApp Broadcast] Failed: ${failed}`);
      console.log(`[WhatsApp Broadcast] Template configured: ${OFFER_TEMPLATE_NAME || 'None'}`);
      console.log(`[WhatsApp Broadcast] =====================================`);
      
      return {
        success: true,
        total: contacts.length,
        sent,
        sentViaInteractive,
        sentViaTemplate,
        failed,
        failedContacts,
        successContacts,
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
  },

  // Send offer to a single phone number (for testing)
  async sendOfferToSingle(phone, offerImageUrl, offerTitle, offerDescription, offerType) {
    try {
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

      console.log(`[WhatsApp Broadcast] Testing send to ${phone}...`);

      try {
        // Try sending interactive message first
        if (offerImageUrl) {
          await whatsapp.sendImageWithCtaUrlOriginal(
            phone, 
            offerImageUrl, 
            message, 
            'View Offer', 
            websiteUrl,
            'Tap to order now!'
          );
        } else {
          await whatsapp.sendCtaUrl(
            phone, 
            message, 
            'View Offer', 
            websiteUrl,
            'Tap to order now!'
          );
        }
        
        console.log(`[WhatsApp Broadcast] ✅ Test send successful to ${phone}`);
        return {
          success: true,
          message: 'Offer sent successfully',
          phone,
          method: 'interactive'
        };
      } catch (error) {
        const errorMessage = error.response?.data?.error?.message || error.message || '';
        const errorCode = error.response?.data?.error?.code;
        
        console.error(`[WhatsApp Broadcast] ❌ Test send failed:`, {
          phone,
          errorCode,
          errorMessage,
          fullError: error.response?.data
        });

        // Check specific error types
        const is24HourError = errorCode === 131047 || 
                             errorMessage.includes('24 hour') || 
                             errorMessage.includes('re-engage') ||
                             errorMessage.includes('outside the allowed window');
        
        const isTemplateRequiredError = errorMessage.includes('template') && !errorMessage.includes('not found');
        
        let reason = 'unknown';
        let suggestion = '';
        
        if (is24HourError || isTemplateRequiredError) {
          // Try using hello_world template to re-open conversation
          console.log(`[WhatsApp Broadcast] 24h window expired, trying hello_world template for ${phone}...`);
          
          try {
            // Send hello_world template first
            await whatsapp.sendSimpleTemplate(phone, 'hello_world', 'en_US');
            
            // Wait then send the actual offer
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            if (offerImageUrl) {
              await whatsapp.sendImageWithCtaUrlOriginal(
                phone, 
                offerImageUrl, 
                message, 
                'View Offer', 
                websiteUrl,
                'Tap to order now!'
              );
            } else {
              await whatsapp.sendCtaUrl(
                phone, 
                message, 
                'View Offer', 
                websiteUrl,
                'Tap to order now!'
              );
            }
            
            console.log(`[WhatsApp Broadcast] ✅ Test send successful via template to ${phone}`);
            return {
              success: true,
              message: 'Offer sent successfully using hello_world template',
              phone,
              method: 'template_then_interactive'
            };
          } catch (templateErr) {
            reason = '24_hour_window';
            suggestion = 'Failed to send via template. The hello_world template may not be available or there is another issue. Check Meta Business Manager for approved templates.';
            return {
              success: false,
              message: 'Failed to send offer',
              phone,
              error: templateErr.response?.data?.error?.message || templateErr.message,
              errorCode: templateErr.response?.data?.error?.code,
              reason,
              suggestion
            };
          }
        } else if (errorCode === 131030 || errorMessage.includes('not a valid')) {
          reason = 'invalid_recipient';
          suggestion = 'This phone number is not a valid WhatsApp number or not registered on WhatsApp.';
        } else if (errorMessage.includes('test')) {
          reason = 'test_number_restriction';
          suggestion = 'You are using a test WhatsApp number. Test numbers can only send messages to phone numbers registered as test recipients in Meta Business Manager.';
        }

        return {
          success: false,
          message: 'Failed to send offer',
          phone,
          error: errorMessage,
          errorCode,
          reason,
          suggestion
        };
      }
    } catch (error) {
      console.error('[WhatsApp Broadcast] Test send error:', error);
      return { success: false, error: error.message, phone };
    }
  }
};

module.exports = whatsappBroadcast;
