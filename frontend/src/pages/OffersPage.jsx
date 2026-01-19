import { useState, useEffect } from 'react';
import { useSearchParams, useOutletContext } from 'react-router-dom';
import axios from 'axios';
import { Tag, ShoppingCart, Plus, Minus, Heart, Star } from 'lucide-react';

const API_URL = 'https://restaruntbot.onrender.com/api/public';
const WHATSAPP_NUMBER = '15551858897';

// WhatsApp Icon Component
const WhatsAppIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

const DISCOUNT_FILTERS = [
  { label: 'All Offers', value: 'all', min: 0, max: 100 },
  { label: '0-10% OFF', value: '0-10', min: 0, max: 10 },
  { label: '10-20% OFF', value: '10-20', min: 10, max: 20 },
  { label: '20-30% OFF', value: '20-30', min: 20, max: 30 },
  { label: '30-40% OFF', value: '30-40', min: 30, max: 40 },
  { label: '40-50% OFF', value: '40-50', min: 40, max: 50 },
  { label: '50%+ OFF', value: '50+', min: 50, max: 100 },
];

export default function OffersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState(searchParams.get('filter') || 'all');
  const [selectedOfferType, setSelectedOfferType] = useState(searchParams.get('offerType') || '');

  // Get cart functions from UserLayout context
  const context = useOutletContext();
  const { 
    cart, addToCart, updateQuantity, 
    addToWishlist, removeFromWishlist, isInWishlist, isInCart,
    setSidebarOpen, setActiveTab
  } = context || {};

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    // Update URL when filters change
    const params = {};
    if (selectedFilter !== 'all') params.filter = selectedFilter;
    if (selectedOfferType) params.offerType = selectedOfferType;
    setSearchParams(params);
  }, [selectedFilter, selectedOfferType, setSearchParams]);

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

  // Filter items with discounts
  const itemsWithDiscounts = items.filter(item => getDiscountPercentage(item) > 0);

  // Apply discount filter
  const filteredItems = itemsWithDiscounts.filter(item => {
    const discount = getDiscountPercentage(item);
    const filter = DISCOUNT_FILTERS.find(f => f.value === selectedFilter);
    
    // Apply discount filter
    const matchesDiscount = !filter || filter.value === 'all' || (discount >= filter.min && discount <= filter.max);
    
    // Apply offer type filter
    const matchesOfferType = !selectedOfferType || item.offerType === selectedOfferType;
    
    return matchesDiscount && matchesOfferType;
  });

  // Get unique offer types from offers
  const offerTypes = [...new Set(offers.map(o => o.offerType).filter(Boolean))];

  const handleFilterChange = (filterValue) => {
    setSelectedFilter(filterValue);
  };

  const handleOfferTypeChange = (offerType) => {
    setSelectedOfferType(offerType === selectedOfferType ? '' : offerType);
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Banner */}
      <section 
        className="relative text-white pt-28 pb-16 bg-cover bg-center"
        style={{ backgroundImage: `url('/banner-delicious-tacos.jpg')` }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-orange-600/90 to-red-600/90"></div>
        <div className="relative max-w-6xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full mb-4">
            <Tag className="w-5 h-5" />
            <span className="font-semibold">Limited Time Offers</span>
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-4 drop-shadow-lg">
            Special <span className="text-yellow-300">Offers</span>
          </h1>
          <p className="text-lg md:text-xl text-white/90 font-light drop-shadow-md max-w-2xl mx-auto">
            Grab amazing deals on your favorite items! Save up to 50% OFF
          </p>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* Offer Type Banners */}
        {offerTypes.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Browse by Offer Type</h2>
            <div className="grid grid-cols-2 gap-4">
              {offers.map(offer => offer.offerType && (
                <button
                  key={offer._id}
                  onClick={() => handleOfferTypeChange(offer.offerType)}
                  className={`relative rounded-xl overflow-hidden shadow-md hover:shadow-lg transition-all ${
                    selectedOfferType === offer.offerType ? 'ring-4 ring-orange-500' : ''
                  }`}
                >
                  <img
                    src={offer.image}
                    alt={offer.offerType}
                    className="w-full aspect-video object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent flex items-end p-3">
                    <span className="text-white font-bold text-sm">{offer.offerType}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Discount Filters */}
        <div className="mb-6">
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {DISCOUNT_FILTERS.map(filter => (
              <button
                key={filter.value}
                onClick={() => handleFilterChange(filter.value)}
                className={`px-4 py-2 rounded-full whitespace-nowrap font-medium transition-colors ${
                  selectedFilter === filter.value
                    ? 'bg-orange-500 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {/* Items Grid - Same style as Menu Page */}
        {filteredItems.length === 0 ? (
          <div className="text-center py-12">
            <Tag className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No offers found</h3>
            <p className="text-gray-600">Try selecting a different filter</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
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
                <div key={item._id} className="group relative bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300">
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
                    
                    {/* Discount Badge - Top Left */}
                    <div className="absolute top-3 left-3 bg-gradient-to-r from-green-500 to-green-600 text-white px-3 py-1.5 rounded-full text-sm font-bold shadow-lg">
                      {discount}% OFF
                    </div>
                    
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
                  <div className="p-4">
                    {/* Name & Wishlist */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-bold text-gray-900 text-base line-clamp-2 flex-1">{item.name}</h3>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleToggleWishlist(item); }} 
                        className="p-1.5 hover:scale-110 transition-transform flex-shrink-0 bg-gray-50 rounded-full"
                      >
                        <Heart className={`w-5 h-5 ${isInWishlist && isInWishlist(item._id) ? 'fill-red-500 text-red-500' : 'text-gray-400'}`} />
                      </button>
                    </div>

                    {/* Rating */}
                    <div className="flex items-center gap-1 mb-3">
                      <div className="flex">{renderStars()}</div>
                      <span className="text-xs text-gray-500 font-medium">({totalRatings})</span>
                    </div>

                    {/* Description */}
                    {item.description && (
                      <p className="text-sm text-gray-600 line-clamp-2 mb-3 min-h-[40px]">{item.description}</p>
                    )}

                    {/* Price Section */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl font-bold text-orange-600">₹{item.price}</span>
                        <span className="text-sm text-gray-400 line-through">₹{item.originalPrice}</span>
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
    </div>
  );
}
