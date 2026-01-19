import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useOutletContext } from 'react-router-dom';
import axios from 'axios';
import { Tag, ShoppingCart, Plus, Minus, Heart, Star, X, Clock, Package } from 'lucide-react';

const API_URL = 'https://restaruntbot.onrender.com/api/public';
const WHATSAPP_NUMBER = '15551858897';

// WhatsApp Icon Component
const WhatsAppIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

export default function OffersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOfferType, setSelectedOfferType] = useState(searchParams.get('offerType') || '');
  const [currentOfferIndex, setCurrentOfferIndex] = useState(0);
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const eventSourceRef = useRef(null);
  const itemsGridRef = useRef(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [dialogQuantity, setDialogQuantity] = useState(1);

  // Get cart functions from UserLayout context
  const context = useOutletContext();
  const { 
    cart, addToCart, updateQuantity, 
    addToWishlist, removeFromWishlist, isInWishlist, isInCart,
    setSidebarOpen, setActiveTab
  } = context || {};

  useEffect(() => {
    loadData();
    setupSSE();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // When offers are loaded, check if we need to show a specific offer from URL
  useEffect(() => {
    if (offers.length > 0 && selectedOfferType) {
      // Find the index of the offer that matches the selected offer type
      const offerIndex = offers.findIndex(o => o.offerType === selectedOfferType);
      if (offerIndex !== -1) {
        // Synchronize both indices immediately
        setCurrentOfferIndex(offerIndex);
        setCurrentBannerIndex(offerIndex);
      }
    }
  }, [offers, selectedOfferType]);

  // Auto-rotate header offer type every 3 seconds (only if no specific offer selected)
  useEffect(() => {
    if (offers.length === 0 || selectedOfferType) return;
    const interval = setInterval(() => {
      setCurrentOfferIndex((prev) => {
        const newIndex = (prev + 1) % offers.length;
        // Synchronize banner with header
        setCurrentBannerIndex(newIndex);
        return newIndex;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [offers.length, selectedOfferType]);

  // Remove the separate banner rotation - it's now synchronized with header
  // Auto-rotate banner images every 5 seconds (only if no specific offer selected)
  // This is removed to keep banner and header in sync

  useEffect(() => {
    // Update URL when offer type changes
    const params = {};
    if (selectedOfferType) params.offerType = selectedOfferType;
    setSearchParams(params);
  }, [selectedOfferType, setSearchParams]);

  const setupSSE = () => {
    try {
      const SSE_URL = 'https://restaruntbot.onrender.com/api/events';
      eventSourceRef.current = new EventSource(SSE_URL);
      eventSourceRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'menu' || data.type === 'offers') {
            loadData();
          }
        } catch (e) {
          console.error('SSE parse error:', e);
        }
      };
      eventSourceRef.current.onerror = () => {
        setTimeout(() => {
          if (eventSourceRef.current) eventSourceRef.current.close();
          setupSSE();
        }, 5000);
      };
    } catch (e) {
      console.error('SSE setup error:', e);
    }
  };

  const loadData = async () => {
    try {
      const [itemsRes, offersRes] = await Promise.all([
        axios.get(`${API_URL}/menu`),
        axios.get(`${API_URL}/offers`)
      ]);
      setItems(itemsRes.data);
      setOffers(offersRes.data.filter(o => o.isActive));
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Calculate discount percentage
  const getDiscountPercentage = (item) => {
    if (!item.originalPrice || item.originalPrice <= item.price) return 0;
    return Math.round(((item.originalPrice - item.price) / item.originalPrice) * 100);
  };

  // Filter items that have at least one offer type
  const itemsWithOfferTypes = items.filter(item => {
    const itemOfferTypes = Array.isArray(item.offerType) ? item.offerType : (item.offerType ? [item.offerType] : []);
    return itemOfferTypes.length > 0;
  });

  // Apply offer type filter
  const filteredItems = selectedOfferType 
    ? itemsWithOfferTypes.filter(item => {
        const itemOfferTypes = Array.isArray(item.offerType) ? item.offerType : (item.offerType ? [item.offerType] : []);
        return itemOfferTypes.includes(selectedOfferType);
      })
    : itemsWithOfferTypes; // Show all items with offer types when no specific offer selected

  // Get unique offer types from offers
  const offerTypes = [...new Set(offers.map(o => o.offerType).filter(Boolean))];

  const handleOfferTypeChange = (offerType) => {
    setSelectedOfferType(offerType === selectedOfferType ? '' : offerType);
    
    // Smooth scroll to items grid
    setTimeout(() => {
      if (itemsGridRef.current) {
        const yOffset = -100; // Offset from top (adjust as needed)
        const element = itemsGridRef.current;
        const y = element.getBoundingClientRect().top + window.pageYOffset + yOffset;
        
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    }, 100);
  };

  const handlePrevOffer = () => {
    if (offers.length === 0) return;
    const newIndex = currentOfferIndex <= 0 ? offers.length - 1 : currentOfferIndex - 1;
    
    // Synchronize both banner and header offer
    setCurrentOfferIndex(newIndex);
    setCurrentBannerIndex(newIndex);
    
    // Update selected offer type and URL
    const offer = offers[newIndex];
    if (offer?.offerType) {
      setSelectedOfferType(offer.offerType);
      setSearchParams({ offerType: offer.offerType });
    }
  };

  const handleNextOffer = () => {
    if (offers.length === 0) return;
    const newIndex = currentOfferIndex >= offers.length - 1 ? 0 : currentOfferIndex + 1;
    
    // Synchronize both banner and header offer
    setCurrentOfferIndex(newIndex);
    setCurrentBannerIndex(newIndex);
    
    // Update selected offer type and URL
    const offer = offers[newIndex];
    if (offer?.offerType) {
      setSelectedOfferType(offer.offerType);
      setSearchParams({ offerType: offer.offerType });
    }
  };

  const handleAddToCart = (item) => {
    if (!addToCart) return;
    addToCart(item);
  };

  const handleToggleWishlist = (item) => {
    if (!addToWishlist || !removeFromWishlist || !isInWishlist) return;
    if (isInWishlist(item._id)) {
      removeFromWishlist(item._id);
    } else {
      addToWishlist(item);
    }
  };

  const handleWhatsAppOrder = (item, e) => {
    e?.stopPropagation();
    
    // Format food type
    const foodTypeLabel = item.foodType === 'veg' ? '🌿 Veg' : 
                          item.foodType === 'nonveg' ? '🍗 Non-Veg' : 
                          item.foodType === 'egg' ? '🥚 Egg' : '';
    
    // Rating display with gold stars
    let ratingDisplay = '';
    if (item.totalRatings > 0) {
      const fullStars = Math.floor(item.avgRating || 0);
      const emptyStars = 5 - fullStars;
      const goldStars = '★'.repeat(fullStars) + '☆'.repeat(emptyStars);
      ratingDisplay = `${goldStars} ${item.avgRating} (${item.totalRatings} reviews)`;
    } else {
      ratingDisplay = '☆☆☆☆☆ No ratings yet';
    }
    
    // Build message like chatbot format
    let msg = `*${item.name}*${foodTypeLabel ? ` ${foodTypeLabel}` : ''}\n\n`;
    msg += `${ratingDisplay}\n\n`;
    msg += `💰 *Price:* ₹${item.price}`;
    if (item.originalPrice && item.originalPrice > item.price) {
      const discount = Math.round(((item.originalPrice - item.price) / item.originalPrice) * 100);
      msg += ` (${discount}% OFF - Was ₹${item.originalPrice})`;
    }
    msg += ` / ${item.unitQty || 1} ${item.unit || 'piece'}\n`;
    msg += `⏱️ *Prep Time:* ${item.preparationTime || 15} mins\n`;
    if (item.tags?.length) msg += `🏷️ *Tags:* ${item.tags.join(', ')}\n`;
    msg += `\n📝 ${item.description || 'Delicious dish prepared fresh!'}`;
    
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  // Open item detail dialog
  const openItemDialog = (item) => {
    setSelectedItem(item);
    setDialogQuantity(cart?.find(c => c._id === item._id)?.quantity || 1);
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    if (window.lenis) window.lenis.stop();
  };

  // Close item detail dialog
  const closeItemDialog = () => {
    setSelectedItem(null);
    setDialogQuantity(1);
    document.body.style.overflow = '';
    document.body.style.touchAction = '';
    if (window.lenis) window.lenis.start();
  };

  // Add to cart from dialog
  const handleDialogAddToCart = () => {
    if (!selectedItem || !addToCart) return;
    for (let i = 0; i < dialogQuantity; i++) {
      addToCart(selectedItem);
    }
    closeItemDialog();
  };

  // WhatsApp order from dialog with quantity
  const handleDialogWhatsApp = () => {
    if (!selectedItem) return;
    const item = selectedItem;
    
    const foodTypeLabel = item.foodType === 'veg' ? '🌿 Veg' : 
                          item.foodType === 'nonveg' ? '🍗 Non-Veg' : 
                          item.foodType === 'egg' ? '🥚 Egg' : '';
    
    let msg = `Hi! I'd like to order:\n\n`;
    msg += `*${item.name}*${foodTypeLabel ? ` ${foodTypeLabel}` : ''}\n`;
    msg += `📦 *Quantity:* ${dialogQuantity}\n`;
    msg += `💰 *Price:* ₹${item.price} x ${dialogQuantity} = ₹${item.price * dialogQuantity}\n`;
    msg += `\nPlease confirm my order. Thank you!`;
    
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`, '_blank');
    closeItemDialog();
  };

  // Get current offer for header rotation
  const currentHeaderOffer = offers[currentOfferIndex];
  const currentBannerOffer = offers[currentBannerIndex];

  // Helper function to get responsive image based on screen width
  const getResponsiveImage = (offer) => {
    if (!offer) return null;
    
    const width = window.innerWidth;
    let imageUrl;
    
    // Mobile: < 768px
    if (width < 768) {
      imageUrl = offer.imageMobile || offer.imageTablet || offer.imageDesktop || offer.image;
    }
    // Tablet: 768px - 1024px
    else if (width < 1024) {
      imageUrl = offer.imageTablet || offer.imageDesktop || offer.imageMobile || offer.image;
    }
    // Desktop: >= 1024px
    else {
      imageUrl = offer.imageDesktop || offer.imageTablet || offer.imageMobile || offer.image;
    }
    
    // Add cache-busting timestamp to force refresh
    if (imageUrl) {
      const separator = imageUrl.includes('?') ? '&' : '?';
      return `${imageUrl}${separator}t=${offer.updatedAt || Date.now()}`;
    }
    
    return imageUrl;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Banner - Clean clickable image without overlays */}
      <section 
        className="relative cursor-pointer transition-all duration-1000"
        style={{ 
          backgroundImage: currentBannerOffer 
            ? `url('${getResponsiveImage(currentBannerOffer)}')` 
            : `url('/banner-delicious-tacos.jpg')`,
          backgroundPosition: 'center center',
          backgroundSize: 'cover',
          minHeight: '350px'
        }}
        onClick={() => {
          if (currentHeaderOffer?.offerType) {
            handleOfferTypeChange(currentHeaderOffer.offerType);
          }
        }}
      >
        {/* Left Navigation Area - Invisible */}
        {offers.length > 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handlePrevOffer();
            }}
            className="absolute left-0 top-0 bottom-0 w-1/4 md:w-1/6 z-10 cursor-pointer"
            aria-label="Previous offer"
          />
        )}

        {/* Right Navigation Area - Invisible */}
        {offers.length > 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleNextOffer();
            }}
            className="absolute right-0 top-0 bottom-0 w-1/4 md:w-1/6 z-10 cursor-pointer"
            aria-label="Next offer"
          />
        )}

        {/* Offer indicators - Only navigation dots */}
        {offers.length > 1 && (
          <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex justify-center gap-2 z-20">
            {offers.map((_, index) => (
              <button
                key={index}
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentOfferIndex(index);
                  setCurrentBannerIndex(index);
                  const offer = offers[index];
                  if (offer?.offerType) {
                    setSelectedOfferType(offer.offerType);
                    setSearchParams({ offerType: offer.offerType });
                  }
                }}
                className={`h-2 rounded-full transition-all duration-300 ${
                  index === currentOfferIndex 
                    ? 'w-8 bg-white' 
                    : 'w-2 bg-white/50 hover:bg-white/80'
                }`}
              />
            ))}
          </div>
        )}
      </section>

      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* Items Grid - Same style as Menu Page */}
        {filteredItems.length === 0 ? (
          <div className="text-center py-12" ref={itemsGridRef}>
            <Tag className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              {selectedOfferType ? 'No items found for this offer' : 'No offers available'}
            </h3>
            <p className="text-gray-600">
              {selectedOfferType ? 'Try selecting a different offer type' : 'Check back later for amazing deals!'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6" ref={itemsGridRef}>
            {filteredItems.map(item => {
              const inCart = isInCart ? isInCart(item._id) : false;
              const cartItem = cart?.find(c => c._id === item._id);
              const discount = getDiscountPercentage(item);
              const rating = item.avgRating || 0;
              const totalRatings = item.totalRatings || 0;

              const renderStars = () => {
                const stars = [];
                for (let i = 1; i <= 5; i++) {
                  stars.push(
                    <Star 
                      key={i} 
                      className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${i <= Math.round(rating) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} 
                    />
                  );
                }
                return stars;
              };

              return (
                <div 
                  key={item._id} 
                  className="group relative bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 flex flex-col cursor-pointer"
                  onClick={() => openItemDialog(item)}
                >
                  {/* Image Container */}
                  <div className="relative aspect-square overflow-hidden bg-gradient-to-br from-orange-50 to-orange-100">
                    {item.image ? (
                      <img 
                        src={item.image} 
                        alt={item.name} 
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" 
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="text-7xl">🍽️</span>
                      </div>
                    )}
                    
                    {/* Discount Badge - Top Left (only show if there's a discount) */}
                    {discount > 0 && (
                      <div className="absolute top-3 left-3 bg-gradient-to-r from-green-500 to-green-600 text-white px-3 py-1.5 rounded-full text-sm font-bold shadow-lg">
                        {discount}% OFF
                      </div>
                    )}
                    
                    {/* Food Type Badge - Top Right */}
                    {item.foodType && item.foodType !== 'none' && (
                      <div className="absolute top-3 right-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full font-medium border-2 ${
                          item.foodType === 'veg' ? 'border-green-500 text-green-600 bg-green-50' :
                          item.foodType === 'nonveg' ? 'border-red-500 text-red-600 bg-red-50' :
                          'border-yellow-500 text-yellow-600 bg-yellow-50'
                        }`}>
                          <span className={`w-2 h-2 rounded-full ${
                            item.foodType === 'veg' ? 'bg-green-500' :
                            item.foodType === 'nonveg' ? 'bg-red-500' :
                            'bg-yellow-500'
                          }`} />
                          {item.foodType === 'veg' ? 'Veg' : item.foodType === 'nonveg' ? 'Non-Veg' : 'Egg'}
                        </span>
                      </div>
                    )}
                    
                    {/* WhatsApp Button - Bottom Right on Image */}
                    <button 
                      onClick={(e) => handleWhatsAppOrder(item, e)} 
                      className="absolute bottom-3 right-3 w-10 h-10 bg-green-500 text-white rounded-full flex items-center justify-center hover:bg-green-600 transition-all hover:scale-110 shadow-lg z-10"
                      title="Order via WhatsApp"
                    >
                      <WhatsAppIcon className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Content */}
                  <div className="p-4 flex flex-col flex-grow">
                    {/* Name & Wishlist */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-bold text-gray-900 text-base line-clamp-2 flex-1 min-h-[48px]">{item.name}</h3>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleToggleWishlist(item); }} 
                        className="p-1.5 hover:scale-110 transition-transform flex-shrink-0 bg-gray-50 rounded-full"
                      >
                        <Heart className={`w-5 h-5 ${isInWishlist && isInWishlist(item._id) ? 'fill-red-500 text-red-500' : 'text-gray-400'}`} />
                      </button>
                    </div>

                    {/* Offer Type Tags - Fixed height container */}
                    <div className="min-h-[28px] mb-2">
                      {item.offerType && (Array.isArray(item.offerType) ? item.offerType : [item.offerType]).length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {(Array.isArray(item.offerType) ? item.offerType : [item.offerType]).map((offerType, index) => (
                            <span key={index} className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs font-semibold">
                              <Tag className="w-3 h-3" />
                              {offerType}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Rating */}
                    <div className="flex items-center gap-1 mb-3">
                      <div className="flex">{renderStars()}</div>
                      <span className="text-xs text-gray-500 font-medium">({totalRatings})</span>
                    </div>

                    {/* Description - Fixed height */}
                    <p className="text-sm text-gray-600 line-clamp-2 mb-3 h-[40px]">
                      {item.description || '\u00A0'}
                    </p>

                    {/* Spacer to push price and button to bottom */}
                    <div className="flex-grow"></div>

                    {/* Price Section */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl font-bold text-orange-600">₹{item.price}</span>
                        {item.originalPrice && item.originalPrice > item.price && (
                          <span className="text-sm text-gray-400 line-through">₹{item.originalPrice}</span>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2">
                      {inCart ? (
                        <button 
                          onClick={(e) => { e.stopPropagation(); setSidebarOpen(true); setActiveTab('cart'); }} 
                          className="flex-1 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-xl font-semibold hover:from-green-600 hover:to-green-700 transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
                        >
                          <ShoppingCart className="w-5 h-5" />
                          <span className="hidden sm:inline">View Cart ({cartItem?.quantity})</span>
                          <span className="sm:hidden">Cart ({cartItem?.quantity})</span>
                        </button>
                      ) : (
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleAddToCart(item); }} 
                          className="flex-1 py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-xl font-semibold hover:from-orange-600 hover:to-orange-700 transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
                        >
                          <ShoppingCart className="w-5 h-5" />
                          <span className="hidden sm:inline">Add to Cart</span>
                          <span className="sm:hidden">Add</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Item Detail Dialog */}
      {selectedItem && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ touchAction: 'none' }}
          onClick={closeItemDialog}
          onTouchMove={(e) => e.preventDefault()}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          
          {/* Dialog - Horizontal on PC, Vertical on Mobile */}
          <div 
            className="relative bg-white rounded-2xl sm:rounded-3xl w-full max-w-md lg:max-w-5xl max-h-[95vh] lg:h-[85vh] overflow-hidden shadow-2xl flex flex-col lg:flex-row"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              onClick={closeItemDialog}
              className="absolute top-3 right-3 z-10 bg-white/90 hover:bg-white text-gray-700 p-2 rounded-full shadow-lg transition-all hover:scale-110"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Left Side - Image (PC) / Top (Mobile) */}
            <div className="relative h-48 sm:h-56 lg:h-auto lg:w-[45%] bg-gradient-to-br from-orange-50 to-orange-100 flex items-center justify-center flex-shrink-0">
              {selectedItem.image ? (
                <img 
                  src={selectedItem.image} 
                  alt={selectedItem.name}
                  className="max-h-full max-w-full object-contain p-6 lg:p-8"
                />
              ) : (
                <span className="text-7xl lg:text-8xl">🍽️</span>
              )}
              
              {/* Food Type Badge */}
              {selectedItem.foodType && selectedItem.foodType !== 'none' && (
                <div className="absolute top-3 left-3">
                  <span className={`inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-full font-medium border-2 ${
                    selectedItem.foodType === 'veg' ? 'border-green-500 text-green-600 bg-green-50' :
                    selectedItem.foodType === 'nonveg' ? 'border-red-500 text-red-600 bg-red-50' :
                    'border-yellow-500 text-yellow-600 bg-yellow-50'
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${
                      selectedItem.foodType === 'veg' ? 'bg-green-500' :
                      selectedItem.foodType === 'nonveg' ? 'bg-red-500' :
                      'bg-yellow-500'
                    }`} />
                    {selectedItem.foodType === 'veg' ? 'Veg' : selectedItem.foodType === 'nonveg' ? 'Non-Veg' : 'Egg'}
                  </span>
                </div>
              )}
            </div>

            {/* Right Side - Details (PC) / Bottom (Mobile) */}
            <div 
              className="flex-1 overflow-y-auto scrollbar-dialog p-5 sm:p-6 lg:p-8" 
              style={{ 
                maxHeight: 'calc(95vh - 100px)',
                overscrollBehavior: 'contain',
                WebkitOverflowScrolling: 'touch'
              }}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              {/* Name & Wishlist */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 flex-1">{selectedItem.name}</h2>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isInWishlist && isInWishlist(selectedItem._id)) {
                      removeFromWishlist(selectedItem._id);
                    } else {
                      addToWishlist(selectedItem);
                    }
                  }}
                  className="p-2 hover:scale-110 transition-transform flex-shrink-0 bg-gray-50 rounded-full"
                >
                  <Heart className={`w-6 h-6 ${isInWishlist && isInWishlist(selectedItem._id) ? 'fill-red-500 text-red-500' : 'text-gray-400'}`} />
                </button>
              </div>

              {/* Price */}
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                {/* Sale Price - Large and prominent */}
                <div className="text-3xl sm:text-4xl lg:text-5xl font-bold text-orange-500">
                  ₹{selectedItem.price}
                </div>
                
                {/* Original Price & Discount Badge - Only if there's a discount */}
                {selectedItem.originalPrice && selectedItem.originalPrice > selectedItem.price && (
                  <>
                    <span className="text-lg sm:text-xl text-gray-400 line-through">₹{selectedItem.originalPrice}</span>
                    <div className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm font-bold">
                      {Math.round(((selectedItem.originalPrice - selectedItem.price) / selectedItem.originalPrice) * 100)}% OFF
                    </div>
                  </>
                )}
              </div>

              {/* Offer Type Tags */}
              {selectedItem.offerType && (Array.isArray(selectedItem.offerType) ? selectedItem.offerType : [selectedItem.offerType]).length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {(Array.isArray(selectedItem.offerType) ? selectedItem.offerType : [selectedItem.offerType]).map((offerType, index) => (
                    <span key={index} className="inline-flex items-center gap-1 px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-sm font-semibold">
                      <Tag className="w-4 h-4" />
                      {offerType}
                    </span>
                  ))}
                </div>
              )}

              {/* Rating */}
              <div className="flex items-center gap-2 mb-4">
                <div className="flex">
                  {[1, 2, 3, 4, 5].map(i => (
                    <Star 
                      key={i} 
                      className={`w-4 h-4 sm:w-5 sm:h-5 ${i <= Math.round(selectedItem.avgRating || 0) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} 
                    />
                  ))}
                </div>
                <span className="text-sm text-gray-500">
                  {selectedItem.avgRating?.toFixed(1) || '0.0'} ({selectedItem.totalRatings || 0} reviews)
                </span>
              </div>

              {/* Description */}
              {selectedItem.description && (
                <p className="text-gray-600 text-sm sm:text-base lg:text-base mb-4 leading-relaxed">
                  {selectedItem.description}
                </p>
              )}

              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                {/* Preparation Time */}
                <div className="flex items-center gap-2 bg-gray-50 rounded-xl p-3">
                  <Clock className="w-5 h-5 text-orange-500" />
                  <div>
                    <p className="text-xs text-gray-500">Prep Time</p>
                    <p className="font-semibold text-gray-900">{selectedItem.preparationTime || 15} mins</p>
                  </div>
                </div>

                {/* Unit */}
                <div className="flex items-center gap-2 bg-gray-50 rounded-xl p-3">
                  <Package className="w-5 h-5 text-orange-500" />
                  <div>
                    <p className="text-xs text-gray-500">Unit</p>
                    <p className="font-semibold text-gray-900">{selectedItem.unitQty || 1} {selectedItem.unit || 'piece'}</p>
                  </div>
                </div>
              </div>

              {/* Quantity Selector */}
              <div className="flex items-center justify-between bg-gray-50 rounded-xl p-3 mb-5">
                <span className="font-medium text-gray-700">Quantity</span>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setDialogQuantity(Math.max(1, dialogQuantity - 1))}
                    className="w-9 h-9 bg-white border border-gray-200 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-8 text-center font-bold text-lg">{dialogQuantity}</span>
                  <button 
                    onClick={() => setDialogQuantity(dialogQuantity + 1)}
                    className="w-9 h-9 bg-white border border-gray-200 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Total Price */}
              <div className="flex items-center justify-between mb-5 pb-4 border-b border-gray-100">
                <span className="text-gray-600">Total</span>
                <span className="text-2xl font-bold text-gray-900">₹{selectedItem.price * dialogQuantity}</span>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleDialogWhatsApp}
                  className="flex-1 flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white py-3 px-4 rounded-xl font-semibold transition-colors"
                >
                  <WhatsAppIcon className="w-5 h-5" />
                  <span>WhatsApp</span>
                </button>

                <button
                  onClick={handleDialogAddToCart}
                  className="flex-[2] flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white py-3 px-4 rounded-xl font-semibold transition-colors"
                >
                  <ShoppingCart className="w-5 h-5" />
                  Add to Cart
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
