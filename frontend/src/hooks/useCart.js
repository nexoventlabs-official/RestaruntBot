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

  // Sync cart and wishlist with latest menu data
  // Updates images, names, units, and handles offer price changes
  const syncWithMenuData = useCallback((menuItems) => {
    if (!menuItems || menuItems.length === 0) return;

    // Create a map for quick lookup
    const menuMap = new Map(menuItems.map(item => [item._id, item]));

    // Update cart items with latest data
    setCart(prev => prev.map(cartItem => {
      const latestItem = menuMap.get(cartItem._id);
      if (latestItem) {
        // If cart item has a variant, sync from the specific variant data
        if (cartItem.variantIndex !== null && cartItem.variantIndex !== undefined && latestItem.variants?.[cartItem.variantIndex]) {
          const v = latestItem.variants[cartItem.variantIndex];
          let variantPrice, variantOriginal;
          // If quantity index is set, use quantity-level data
          if (cartItem.quantityIndex !== null && cartItem.quantityIndex !== undefined && v.quantities?.[cartItem.quantityIndex]) {
            const q = v.quantities[cartItem.quantityIndex];
            variantPrice = q.offerPrice && q.offerPrice < q.price ? q.offerPrice : q.price;
            variantOriginal = q.offerPrice && q.offerPrice < q.price ? q.price : undefined;
          } else {
            variantPrice = v.offerPrice && v.offerPrice < v.price ? v.offerPrice : v.price;
            variantOriginal = v.offerPrice && v.offerPrice < v.price ? v.price : undefined;
          }
          return {
            ...cartItem,
            name: latestItem.name,
            price: variantPrice,
            originalPrice: variantOriginal,
            image: v.image || latestItem.image,
            unit: latestItem.unit || 'piece',
            unitQty: latestItem.quantity || 1,
            variantLabel: v.label
          };
        }

        // Check if this is a regular offer item (not targeted)
        const isRegularOffer = cartItem.offerInfo?.isRegularOffer;
        const isTargetedOffer = cartItem.offerInfo && !cartItem.offerInfo.isRegularOffer;
        
        // For regular offers, sync with menu's offerPrice
        if (isRegularOffer) {
          // If menu item still has offer, update to latest offer price
          if (latestItem.offerPrice && latestItem.offerPrice < latestItem.price) {
            return {
              ...cartItem,
              name: latestItem.name,
              price: latestItem.offerPrice,
              originalPrice: latestItem.price,
              image: latestItem.image,
              unit: latestItem.unit || 'piece',
              unitQty: latestItem.quantity || 1,
              offerInfo: {
                offerType: Array.isArray(latestItem.offerType) ? latestItem.offerType.join(', ') : latestItem.offerType,
                title: Array.isArray(latestItem.offerType) ? latestItem.offerType.join(', ') : latestItem.offerType,
                isRegularOffer: true
              }
            };
          } else {
            // Offer removed from menu item - update to regular price and remove offer info
            return {
              ...cartItem,
              name: latestItem.name,
              price: latestItem.price,
              originalPrice: undefined,
              image: latestItem.image,
              unit: latestItem.unit || 'piece',
              unitQty: latestItem.quantity || 1,
              offerInfo: undefined
            };
          }
        }
        
        // For targeted offers, keep the offer price (don't sync from menu)
        // The offer price will be validated/cleaned by validateOfferItems
        if (isTargetedOffer) {
          return {
            ...cartItem,
            name: latestItem.name,
            image: latestItem.image,
            unit: latestItem.unit || 'piece',
            unitQty: latestItem.quantity || 1
          };
        }
        
        // For items without any offer, sync everything including price
        return {
          ...cartItem,
          name: latestItem.name,
          price: latestItem.offerPrice && latestItem.offerPrice < latestItem.price ? latestItem.offerPrice : latestItem.price,
          originalPrice: latestItem.offerPrice && latestItem.offerPrice < latestItem.price ? latestItem.price : undefined,
          image: latestItem.image,
          unit: latestItem.unit || 'piece',
          unitQty: latestItem.quantity || 1,
          offerInfo: latestItem.offerPrice && latestItem.offerPrice < latestItem.price ? {
            offerType: Array.isArray(latestItem.offerType) ? latestItem.offerType.join(', ') : latestItem.offerType,
            title: Array.isArray(latestItem.offerType) ? latestItem.offerType.join(', ') : latestItem.offerType,
            isRegularOffer: true
          } : undefined
        };
      }
      return cartItem;
    }));

    // Update wishlist items with latest data
    setWishlist(prev => prev.map(wishlistItem => {
      const latestItem = menuMap.get(wishlistItem._id);
      if (latestItem) {
        // If wishlist item has a variant, sync from the specific variant data
        if (wishlistItem.variantIndex !== null && wishlistItem.variantIndex !== undefined && latestItem.variants?.[wishlistItem.variantIndex]) {
          const v = latestItem.variants[wishlistItem.variantIndex];
          // If quantity index is set, use quantity-level data
          let syncPrice, syncOriginal;
          if (wishlistItem.quantityIndex !== null && wishlistItem.quantityIndex !== undefined && v.quantities?.[wishlistItem.quantityIndex]) {
            const q = v.quantities[wishlistItem.quantityIndex];
            syncPrice = q.offerPrice && q.offerPrice < q.price ? q.offerPrice : q.price;
            syncOriginal = q.offerPrice && q.offerPrice < q.price ? q.price : undefined;
          } else {
            syncPrice = v.offerPrice && v.offerPrice < v.price ? v.offerPrice : v.price;
            syncOriginal = v.offerPrice && v.offerPrice < v.price ? v.price : undefined;
          }
          // Build display name: parent name + variant label (if variantLabel is set)
          const displayName = wishlistItem.variantLabel 
            ? `${latestItem.name}` // variantLabel shown separately in sidebar
            : (wishlistItem.name?.includes(' - ') ? `${latestItem.name} - ${v.label}` : latestItem.name);
          return {
            ...wishlistItem,
            name: displayName,
            price: syncPrice,
            originalPrice: syncOriginal,
            image: v.image || latestItem.image,
            unit: latestItem.unit || 'piece',
            unitQty: latestItem.quantity || 1,
            variantLabel: wishlistItem.variantLabel || null,
            offerInfo: syncOriginal ? {
              offerType: Array.isArray(latestItem.offerType) ? latestItem.offerType.join(', ') : (latestItem.offerType || 'Special Offer'),
              title: Array.isArray(latestItem.offerType) ? latestItem.offerType.join(', ') : (latestItem.offerType || 'Special Offer'),
              isRegularOffer: true
            } : wishlistItem.offerInfo
          };
        }
        
        // Check if this is a regular offer item (not targeted)
        const isRegularOffer = wishlistItem.offerInfo?.isRegularOffer;
        const isTargetedOffer = wishlistItem.offerInfo && !wishlistItem.offerInfo.isRegularOffer;
        
        // For regular offers, sync with menu's offerPrice
        if (isRegularOffer) {
          // If menu item still has offer, update to latest offer price
          if (latestItem.offerPrice && latestItem.offerPrice < latestItem.price) {
            return {
              ...wishlistItem,
              name: latestItem.name,
              price: latestItem.offerPrice,
              originalPrice: latestItem.price,
              image: latestItem.image,
              unit: latestItem.unit || 'piece',
              unitQty: latestItem.quantity || 1,
              offerInfo: {
                offerType: Array.isArray(latestItem.offerType) ? latestItem.offerType.join(', ') : latestItem.offerType,
                title: Array.isArray(latestItem.offerType) ? latestItem.offerType.join(', ') : latestItem.offerType,
                isRegularOffer: true
              }
            };
          } else {
            // Offer removed from menu item - update to regular price and remove offer info
            return {
              ...wishlistItem,
              name: latestItem.name,
              price: latestItem.price,
              originalPrice: undefined,
              image: latestItem.image,
              unit: latestItem.unit || 'piece',
              unitQty: latestItem.quantity || 1,
              offerInfo: undefined
            };
          }
        }
        
        // For targeted offers, keep the offer price (don't sync from menu)
        // The offer price will be validated/cleaned by validateOfferItems
        if (isTargetedOffer) {
          return {
            ...wishlistItem,
            name: latestItem.name,
            image: latestItem.image,
            unit: latestItem.unit || 'piece',
            unitQty: latestItem.quantity || 1
          };
        }
        
        // For items without any offer, sync everything including price
        return {
          ...wishlistItem,
          name: latestItem.name,
          price: latestItem.offerPrice && latestItem.offerPrice < latestItem.price ? latestItem.offerPrice : latestItem.price,
          originalPrice: latestItem.offerPrice && latestItem.offerPrice < latestItem.price ? latestItem.price : undefined,
          image: latestItem.image,
          unit: latestItem.unit || 'piece',
          unitQty: latestItem.quantity || 1,
          offerInfo: latestItem.offerPrice && latestItem.offerPrice < latestItem.price ? {
            offerType: Array.isArray(latestItem.offerType) ? latestItem.offerType.join(', ') : latestItem.offerType,
            title: Array.isArray(latestItem.offerType) ? latestItem.offerType.join(', ') : latestItem.offerType,
            isRegularOffer: true
          } : undefined
        };
      }
      return wishlistItem;
    }));
  }, []);

  const addToCart = (item, qty = 1, offerInfo = null, variantInfo = null) => {
    // Auto-detect offer info from item if not provided
    let finalOfferInfo = offerInfo;
    let finalPrice = item.price;
    let finalOriginalPrice = item.originalPrice;
    
    // If variant is selected, use variant pricing
    if (variantInfo) {
      finalPrice = variantInfo.offerPrice || variantInfo.price;
      if (variantInfo.offerPrice && variantInfo.offerPrice < variantInfo.price) {
        finalOriginalPrice = variantInfo.price;
      }
    } else if (!offerInfo && item.offerPrice && item.offerPrice < item.price) {
      // If item has offerPrice (from "all customers" offers), auto-create offer info
      finalOfferInfo = {
        offerType: Array.isArray(item.offerType) ? item.offerType.join(', ') : item.offerType,
        title: Array.isArray(item.offerType) ? item.offerType.join(', ') : item.offerType,
        isRegularOffer: true
      };
      finalPrice = item.offerPrice;
      finalOriginalPrice = item.price;
    }
    
    // If item already has originalPrice set (from targeted offers), use it
    if (!variantInfo && item.originalPrice && item.originalPrice > item.price) {
      finalOriginalPrice = item.originalPrice;
      finalPrice = item.price;
    }

    // Cart key: use _id + variantIndex + quantityIndex to distinguish variants and quantity options
    const cartKey = variantInfo 
      ? (variantInfo.quantityIndex !== null && variantInfo.quantityIndex !== undefined 
          ? `${item._id}_v${variantInfo.variantIndex}_q${variantInfo.quantityIndex}` 
          : `${item._id}_v${variantInfo.variantIndex}`) 
      : item._id;
    
    setCart(prev => {
      const existing = prev.find(c => c.cartKey === cartKey);
      if (existing) {
        // If adding with offer info, update offer info and price too
        if (finalOfferInfo) {
          return prev.map(c => c.cartKey === cartKey ? { 
            ...c, 
            quantity: c.quantity + qty, 
            offerInfo: finalOfferInfo,
            price: finalPrice,
            originalPrice: finalOriginalPrice 
          } : c);
        }
        return prev.map(c => c.cartKey === cartKey ? { ...c, quantity: c.quantity + qty } : c);
      }
      return [...prev, { 
        _id: item._id,
        cartKey,
        name: item.name, 
        price: finalPrice, 
        originalPrice: finalOriginalPrice, // Store original price if exists
        image: variantInfo?.image || item.image, 
        quantity: qty, 
        unit: item.unit || 'piece', 
        unitQty: item.quantity || 1,
        offerInfo: finalOfferInfo, // Store offer info with cart item
        variantLabel: variantInfo?.label || null, // Store variant label for display
        variantIndex: variantInfo?.variantIndex ?? null,
        quantityIndex: variantInfo?.quantityIndex ?? null,
        quantityLabel: variantInfo?.quantityLabel || null
      }];
    });
  };

  const removeFromCart = (cartKey) => {
    setCart(prev => prev.filter(c => (c.cartKey || c._id) !== cartKey));
  };

  const updateQuantity = (cartKey, qty) => {
    if (qty <= 0) {
      removeFromCart(cartKey);
      return;
    }
    setCart(prev => prev.map(c => (c.cartKey || c._id) === cartKey ? { ...c, quantity: qty } : c));
  };

  const clearCart = () => setCart([]);

  const cartTotal = cart.reduce((sum, c) => sum + c.price * c.quantity, 0);
  const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0);

  // Wishlist functions
  const addToWishlist = (item, offerInfo = null) => {
    // Auto-detect offer info from item if not provided
    let finalOfferInfo = offerInfo;
    let finalPrice = item.price;
    let finalOriginalPrice = item.originalPrice;
    
    // If item has offerPrice (from "all customers" offers), auto-create offer info
    if (!offerInfo && item.offerPrice && item.offerPrice < item.price) {
      finalOfferInfo = {
        offerType: Array.isArray(item.offerType) ? item.offerType.join(', ') : item.offerType,
        title: Array.isArray(item.offerType) ? item.offerType.join(', ') : item.offerType,
        isRegularOffer: true
      };
      finalPrice = item.offerPrice;
      finalOriginalPrice = item.price;
    }
    
    // If item already has originalPrice set (from targeted offers), use it
    if (item.originalPrice && item.originalPrice > item.price) {
      finalOriginalPrice = item.originalPrice;
      finalPrice = item.price;
    }
    
    setWishlist(prev => {
      const key = item.wishlistKey || item._id;
      if (prev.find(w => (w.wishlistKey || w._id) === key)) return prev;
      return [...prev, { 
        _id: item._id, 
        wishlistKey: item.wishlistKey || item._id,
        name: item.name, 
        price: finalPrice, 
        originalPrice: finalOriginalPrice,
        image: item.image, 
        unit: item.unit || 'piece', 
        unitQty: item.quantity || 1,
        offerInfo: finalOfferInfo,
        variantIndex: item.variantIndex ?? null,
        variantLabel: item.variantLabel || null,
        quantityIndex: item.quantityIndex ?? null,
        quantityLabel: item.quantityLabel || null
      }];
    });
  };

  const removeFromWishlist = (keyOrId) => {
    setWishlist(prev => prev.filter(w => (w.wishlistKey || w._id) !== keyOrId));
  };

  // Remove all items associated with a specific offer
  const removeItemsByOfferId = useCallback((offerId) => {
    setCart(prev => prev.filter(c => c.offerInfo?.offerId !== offerId));
    setWishlist(prev => prev.filter(w => w.offerInfo?.offerId !== offerId));
  }, []);

  // Validate cart/wishlist items against active offers
  // Remove items whose offers have been deleted
  // Note: Only validates regular (non-targeted) offer items against the public offers list
  // Targeted offer items are validated separately via SSE events or individual API checks
  const validateOfferItems = useCallback((activeOfferIds) => {
    if (!activeOfferIds || !Array.isArray(activeOfferIds)) return;
    
    // Filter out cart items whose regular offer no longer exists
    setCart(prev => prev.filter(c => {
      // Keep items without offer info
      if (!c.offerInfo || !c.offerInfo.offerId) return true;
      // Skip targeted offer items - they're not in the public offers list
      // They get cleaned up via offer-deleted SSE events or individual checks
      if (c.offerInfo.isTargetedOffer) return true;
      // Keep regular offer items whose offer still exists
      return activeOfferIds.includes(c.offerInfo.offerId);
    }));
    
    // Filter out wishlist items whose regular offer no longer exists
    setWishlist(prev => prev.filter(w => {
      // Keep items without offer info
      if (!w.offerInfo || !w.offerInfo.offerId) return true;
      // Skip targeted offer items
      if (w.offerInfo.isTargetedOffer) return true;
      // Keep regular offer items whose offer still exists
      return activeOfferIds.includes(w.offerInfo.offerId);
    }));
  }, []);

  const isInWishlist = (keyOrId) => wishlist.some(w => (w.wishlistKey || w._id) === keyOrId);
  const isInCart = (itemId) => cart.some(c => c._id === itemId);

  return {
    cart, wishlist, cartTotal, cartCount,
    addToCart, removeFromCart, updateQuantity, clearCart,
    addToWishlist, removeFromWishlist, isInWishlist, isInCart,
    syncWithMenuData, removeItemsByOfferId, validateOfferItems
  };
}
