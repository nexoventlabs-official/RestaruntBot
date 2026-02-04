import { useState, useEffect, useRef, useCallback } from 'react';

const CART_KEY = 'restaurant_cart';
const WISHLIST_KEY = 'restaurant_wishlist';

// Helper to safely get from localStorage
const getFromStorage = (key, fallback = []) => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
};

export function useCart() {
  // Initialize state directly from localStorage
  const [cart, setCart] = useState(() => getFromStorage(CART_KEY, []));
  const [wishlist, setWishlist] = useState(() => getFromStorage(WISHLIST_KEY, []));
  const isInitialized = useRef(false);

  // Save cart to localStorage (skip first render)
  useEffect(() => {
    if (isInitialized.current) {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    }
  }, [cart]);

  // Save wishlist to localStorage (skip first render)
  useEffect(() => {
    if (isInitialized.current) {
      localStorage.setItem(WISHLIST_KEY, JSON.stringify(wishlist));
    }
  }, [wishlist]);

  // Mark as initialized after first render
  useEffect(() => {
    isInitialized.current = true;
  }, []);

  // Sync cart and wishlist with latest menu data (update images, names, units - NOT prices for offer items)
  const syncWithMenuData = useCallback((menuItems) => {
    if (!menuItems || menuItems.length === 0) return;

    // Create a map for quick lookup
    const menuMap = new Map(menuItems.map(item => [item._id, item]));

    // Update cart items with latest data (preserve offer prices)
    setCart(prev => prev.map(cartItem => {
      const latestItem = menuMap.get(cartItem._id);
      if (latestItem) {
        // If item has offer, keep its price and originalPrice, otherwise sync price from menu
        const hasOffer = cartItem.offerInfo || cartItem.originalPrice;
        return {
          ...cartItem,
          name: latestItem.name,
          // Only update price if there's no offer applied
          price: hasOffer ? cartItem.price : latestItem.price,
          // Keep originalPrice if it exists
          originalPrice: hasOffer ? (cartItem.originalPrice || latestItem.price) : undefined,
          image: latestItem.image,
          unit: latestItem.unit || 'piece',
          unitQty: latestItem.quantity || 1
        };
      }
      return cartItem;
    }));

    // Update wishlist items with latest data (preserve offer prices)
    setWishlist(prev => prev.map(wishlistItem => {
      const latestItem = menuMap.get(wishlistItem._id);
      if (latestItem) {
        // If item has offer, keep its price and originalPrice, otherwise sync price from menu
        const hasOffer = wishlistItem.offerInfo || wishlistItem.originalPrice;
        return {
          ...wishlistItem,
          name: latestItem.name,
          // Only update price if there's no offer applied
          price: hasOffer ? wishlistItem.price : latestItem.price,
          // Keep originalPrice if it exists
          originalPrice: hasOffer ? (wishlistItem.originalPrice || latestItem.price) : undefined,
          image: latestItem.image,
          unit: latestItem.unit || 'piece',
          unitQty: latestItem.quantity || 1
        };
      }
      return wishlistItem;
    }));
  }, []);

  const addToCart = (item, qty = 1, offerInfo = null) => {
    setCart(prev => {
      const existing = prev.find(c => c._id === item._id);
      if (existing) {
        // If adding with offer info, update offer info and price too
        if (offerInfo) {
          return prev.map(c => c._id === item._id ? { 
            ...c, 
            quantity: c.quantity + qty, 
            offerInfo,
            price: item.price,
            originalPrice: item.originalPrice 
          } : c);
        }
        return prev.map(c => c._id === item._id ? { ...c, quantity: c.quantity + qty } : c);
      }
      return [...prev, { 
        _id: item._id, 
        name: item.name, 
        price: item.price, 
        originalPrice: item.originalPrice, // Store original price if exists
        image: item.image, 
        quantity: qty, 
        unit: item.unit || 'piece', 
        unitQty: item.quantity || 1,
        offerInfo: offerInfo // Store offer info with cart item
      }];
    });
  };

  const removeFromCart = (itemId) => {
    setCart(prev => prev.filter(c => c._id !== itemId));
  };

  const updateQuantity = (itemId, qty) => {
    if (qty <= 0) {
      removeFromCart(itemId);
      return;
    }
    setCart(prev => prev.map(c => c._id === itemId ? { ...c, quantity: qty } : c));
  };

  const clearCart = () => setCart([]);

  const cartTotal = cart.reduce((sum, c) => sum + c.price * c.quantity, 0);
  const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0);

  // Wishlist functions
  const addToWishlist = (item, offerInfo = null) => {
    setWishlist(prev => {
      if (prev.find(w => w._id === item._id)) return prev;
      return [...prev, { 
        _id: item._id, 
        name: item.name, 
        price: item.price, 
        originalPrice: item.originalPrice, // Store original price if exists
        image: item.image, 
        unit: item.unit || 'piece', 
        unitQty: item.quantity || 1,
        offerInfo: offerInfo // Store offer info with wishlist item
      }];
    });
  };

  const removeFromWishlist = (itemId) => {
    setWishlist(prev => prev.filter(w => w._id !== itemId));
  };

  // Remove all items associated with a specific offer
  const removeItemsByOfferId = useCallback((offerId) => {
    setCart(prev => prev.filter(c => c.offerInfo?.offerId !== offerId));
    setWishlist(prev => prev.filter(w => w.offerInfo?.offerId !== offerId));
  }, []);

  // Validate cart/wishlist items against active offers
  // Remove items whose offers have been deleted
  const validateOfferItems = useCallback((activeOfferIds) => {
    if (!activeOfferIds || !Array.isArray(activeOfferIds)) return;
    
    // Filter out cart items whose offer no longer exists
    setCart(prev => prev.filter(c => {
      // Keep items without offer info
      if (!c.offerInfo || !c.offerInfo.offerId) return true;
      // Keep items whose offer still exists
      return activeOfferIds.includes(c.offerInfo.offerId);
    }));
    
    // Filter out wishlist items whose offer no longer exists
    setWishlist(prev => prev.filter(w => {
      // Keep items without offer info
      if (!w.offerInfo || !w.offerInfo.offerId) return true;
      // Keep items whose offer still exists
      return activeOfferIds.includes(w.offerInfo.offerId);
    }));
  }, []);

  const isInWishlist = (itemId) => wishlist.some(w => w._id === itemId);
  const isInCart = (itemId) => cart.some(c => c._id === itemId);

  return {
    cart, wishlist, cartTotal, cartCount,
    addToCart, removeFromCart, updateQuantity, clearCart,
    addToWishlist, removeFromWishlist, isInWishlist, isInCart,
    syncWithMenuData, removeItemsByOfferId, validateOfferItems
  };
}
