import { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = 'https://restaruntbot.onrender.com/api/public';

// Global cache for preloaded data
let cachedData = {
  menu: null,
  categories: null,
  offers: null,
  imagesLoaded: false
};

// Preload a single image
const preloadImage = (src) => {
  return new Promise((resolve) => {
    if (!src) {
      resolve(src);
      return;
    }
    
    const img = new Image();
    img.onload = () => resolve(src);
    img.onerror = () => resolve(src);
    img.src = src;
  });
};

// Preload multiple images
const preloadImages = async (urls) => {
  const validUrls = urls.filter(url => url);
  await Promise.all(validUrls.map(preloadImage));
};

export function useImagePreloader() {
  const [isPreloading, setIsPreloading] = useState(!cachedData.imagesLoaded);
  const [progress, setProgress] = useState(cachedData.imagesLoaded ? 100 : 0);

  useEffect(() => {
    // If already loaded, skip
    if (cachedData.imagesLoaded) {
      setIsPreloading(false);
      setProgress(100);
      return;
    }

    const preloadAllImages = async () => {
      try {
        setProgress(10);
        
        // Fetch menu items, categories, and offers in parallel
        const [menuRes, categoriesRes, offersRes] = await Promise.all([
          axios.get(`${API_URL}/menu`).catch(() => ({ data: [] })),
          axios.get(`${API_URL}/categories`).catch(() => ({ data: [] })),
          axios.get(`${API_URL}/offers`).catch(() => ({ data: [] }))
        ]);

        // Store data in cache
        cachedData.menu = menuRes.data || [];
        cachedData.categories = categoriesRes.data || [];
        cachedData.offers = offersRes.data || [];

        setProgress(30);

        const allImages = [];

        // Collect all images
        cachedData.menu.forEach(item => {
          if (item.image) allImages.push(item.image);
        });
        cachedData.categories.forEach(cat => {
          if (cat.image) allImages.push(cat.image);
        });
        cachedData.offers.forEach(offer => {
          if (offer.image) allImages.push(offer.image);
        });

        // Preload images in batches
        const batchSize = 10;
        let loaded = 0;
        
        for (let i = 0; i < allImages.length; i += batchSize) {
          const batch = allImages.slice(i, i + batchSize);
          await preloadImages(batch);
          loaded += batch.length;
          setProgress(30 + Math.round((loaded / allImages.length) * 70));
        }

        cachedData.imagesLoaded = true;

      } catch (error) {
        console.error('Error preloading images:', error);
        cachedData.imagesLoaded = true;
      } finally {
        setIsPreloading(false);
        setProgress(100);
      }
    };

    preloadAllImages();
  }, []);

  return { isPreloading, progress };
}

// Hook to get cached data
export function useCachedData() {
  return {
    menu: cachedData.menu,
    categories: cachedData.categories,
    offers: cachedData.offers,
    isLoaded: cachedData.imagesLoaded
  };
}

// Export utility functions
export { preloadImage, preloadImages, cachedData };
