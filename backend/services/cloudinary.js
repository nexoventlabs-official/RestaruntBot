// Cloudinary Service - Image Upload & Optimization
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const cloudinaryService = {
  /**
   * Upload image from URL to Cloudinary
   * @param {string} imageUrl - Source image URL
   * @param {string} folder - Folder name in Cloudinary
   * @param {string} publicId - Optional custom public ID
   * @returns {Promise<string>} - Optimized Cloudinary URL
   */
  async uploadFromUrl(imageUrl, folder = 'restaurant-bot', publicId = null) {
    try {
      const options = {
        folder,
        resource_type: 'image',
        transformation: [
          { width: 600, height: 600, crop: 'fill', gravity: 'center' },
          { quality: 'auto:best', fetch_format: 'auto' }
        ]
      };
      
      if (publicId) {
        options.public_id = publicId;
      }

      const result = await cloudinary.uploader.upload(imageUrl, options);
      console.log('✅ Cloudinary upload success:', result.secure_url);
      return result.secure_url;
    } catch (error) {
      console.error('❌ Cloudinary upload error:', error.message);
      throw error;
    }
  },

  /**
   * Upload image from buffer (for file uploads)
   * @param {Buffer} buffer - Image buffer
   * @param {string} folder - Folder name
   * @param {string} publicId - Optional custom public ID
   * @returns {Promise<string>} - Optimized Cloudinary URL
   */
  async uploadFromBuffer(buffer, folder = 'restaurant-bot', publicId = null) {
    return new Promise((resolve, reject) => {
      const options = {
        folder,
        resource_type: 'image',
        transformation: [
          { width: 600, height: 600, crop: 'fill', gravity: 'center' },
          { quality: 'auto:best', fetch_format: 'auto' }
        ]
      };

      if (publicId) {
        options.public_id = publicId;
      }

      const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
        if (error) {
          console.error('❌ Cloudinary buffer upload error:', error.message);
          reject(error);
        } else {
          console.log('✅ Cloudinary buffer upload success:', result.secure_url);
          resolve(result.secure_url);
        }
      });

      uploadStream.end(buffer);
    });
  },

  /**
   * Upload image preserving original aspect ratio (for offer cards, banners, etc.)
   * @param {Buffer} buffer - Image buffer
   * @param {string} folder - Folder name
   * @param {string} publicId - Optional custom public ID
   * @returns {Promise<string>} - Optimized Cloudinary URL
   */
  async uploadPreserveAspect(buffer, folder = 'restaurant-bot', publicId = null) {
    return new Promise((resolve, reject) => {
      const options = {
        folder,
        resource_type: 'image',
        transformation: [
          { width: 800, crop: 'scale' },
          { quality: 'auto:best', fetch_format: 'auto' }
        ]
      };

      if (publicId) {
        options.public_id = publicId;
      }

      const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
        if (error) {
          console.error('❌ Cloudinary buffer upload error:', error.message);
          reject(error);
        } else {
          console.log('✅ Cloudinary buffer upload success:', result.secure_url);
          resolve(result.secure_url);
        }
      });

      uploadStream.end(buffer);
    });
  },

  /**
   * Get optimized URL for WhatsApp (transforms existing Cloudinary URL or external URL)
   * @param {string} imageUrl - Original image URL
   * @param {string} aspectRatio - Aspect ratio: '1:1' for menu items, '2:1' for chatbot banners
   * @returns {string} - Optimized URL for WhatsApp
   */
  getOptimizedUrl(imageUrl, aspectRatio = '1:1') {
    if (!imageUrl) return imageUrl;

    // Determine dimensions based on aspect ratio
    let width, height;
    if (aspectRatio === '2:1') {
      width = 1200;
      height = 600;
    } else {
      // Default 1:1 for menu items
      width = 600;
      height = 600;
    }

    // If already a Cloudinary URL, add transformations
    if (imageUrl.includes('cloudinary.com')) {
      // Extract public ID and add transformations
      const parts = imageUrl.split('/upload/');
      if (parts.length === 2) {
        return `${parts[0]}/upload/w_${width},h_${height},c_fill,g_center,q_auto:best,f_auto/${parts[1]}`;
      }
      return imageUrl;
    }

    // For external URLs, use Cloudinary fetch (on-the-fly transformation)
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    if (!cloudName) {
      console.warn('⚠️ CLOUDINARY_CLOUD_NAME not set, returning original URL');
      return imageUrl;
    }

    const encodedUrl = encodeURIComponent(imageUrl);
    return `https://res.cloudinary.com/${cloudName}/image/fetch/w_${width},h_${height},c_fill,g_center,q_auto:best,f_auto/${encodedUrl}`;
  },

  /**
   * Delete image from Cloudinary
   * @param {string} publicId - Public ID of the image
   */
  async deleteImage(publicId) {
    try {
      const result = await cloudinary.uploader.destroy(publicId);
      console.log('✅ Cloudinary delete:', result);
      return result;
    } catch (error) {
      console.error('❌ Cloudinary delete error:', error.message);
      throw error;
    }
  }
};

module.exports = cloudinaryService;
