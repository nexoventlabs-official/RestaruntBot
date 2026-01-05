// Chatbot Images Service - Get dynamic images for WhatsApp messages
const ChatbotImage = require('../models/ChatbotImage');

// Default fallback images
const defaultImages = {
  cart_cleared: 'https://customer-assets.emergentagent.com/job_imgtourl/artifacts/kvm8soy5_ChatGPT%20Image%20Jan%202%2C%202026%2C%2004_55_51%20PM.png',
  added_to_cart: 'https://customer-assets.emergentagent.com/job_imgtourl/artifacts/qixmcggk_ChatGPT%20Image%20Jan%202%2C%202026%2C%2004_55_37%20PM.png',
  order_confirmed: 'https://customer-assets.emergentagent.com/job_77792ac9-dc9d-42cc-8b47-74a726032c8b/artifacts/s75p7355_ChatGPT%20Image%20Jan%202%2C%202026%2C%2004_55_13%20PM.png',
  no_orders_found: 'https://customer-assets.emergentagent.com/job_imgtourl/artifacts/6al1ikel_ChatGPT%20Image%20Jan%202%2C%202026%2C%2004_56_02%20PM.png',
  your_orders: 'https://customer-assets.emergentagent.com/job_aba631ff-39f5-485d-9dc9-4b55cdde1a45/artifacts/so72utoq_ChatGPT%20Image%20Jan%202%2C%202026%2C%2004_56_10%20PM.png',
  no_active_orders: 'https://customer-assets.emergentagent.com/job_pic-url-maker/artifacts/6xfvk4ug_ChatGPT%20Image%20Jan%205%2C%202026%2C%2011_04_46%20AM.png',
  order_cancelled: 'https://customer-assets.emergentagent.com/job_77792ac9-dc9d-42cc-8b47-74a726032c8b/artifacts/4ysetjer_ChatGPT%20Image%20Jan%202%2C%202026%2C%2004_55_24%20PM.png'
};

// Cache for images (refresh every 5 minutes)
let imageCache = {};
let lastCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const chatbotImagesService = {
  /**
   * Get image URL by key
   * @param {string} key - Image key (e.g., 'cart_cleared', 'order_confirmed')
   * @returns {Promise<string>} - Image URL
   */
  async getImageUrl(key) {
    try {
      // Check cache
      const now = Date.now();
      if (imageCache[key] && (now - lastCacheTime) < CACHE_TTL) {
        return imageCache[key];
      }

      // Fetch from database
      const image = await ChatbotImage.findOne({ key });
      
      if (image?.imageUrl) {
        imageCache[key] = image.imageUrl;
        lastCacheTime = now;
        return image.imageUrl;
      }

      // Return default
      return defaultImages[key] || null;
    } catch (error) {
      console.error(`Error fetching chatbot image ${key}:`, error.message);
      return defaultImages[key] || null;
    }
  },

  /**
   * Refresh cache - call this after image updates
   */
  clearCache() {
    imageCache = {};
    lastCacheTime = 0;
  },

  /**
   * Get all images (for preloading)
   * @returns {Promise<Object>} - Object with all image URLs
   */
  async getAllImages() {
    try {
      const images = await ChatbotImage.find();
      const result = { ...defaultImages };
      
      images.forEach(img => {
        if (img.imageUrl) {
          result[img.key] = img.imageUrl;
        }
      });

      // Update cache
      imageCache = result;
      lastCacheTime = Date.now();
      
      return result;
    } catch (error) {
      console.error('Error fetching all chatbot images:', error.message);
      return defaultImages;
    }
  }
};

module.exports = chatbotImagesService;
