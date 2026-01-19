import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Tag, ShoppingCart, Plus, Minus, Heart } from 'lucide-react';
import { useCart } from '../hooks/useCart';

const API_URL = 'https://restaruntbot.onrender.com/api/public';

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

  const { cart, addToCart, updateQuantity, isInCart, addToWishlist, removeFromWishlist, isInWishlist } = useCart();

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
    if (!filter || filter.value === 'all') return true;
    return discount >= filter.min && discount <= filter.max;
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
    addToCart(item);
  };

  const handleToggleWishlist = (item) => {
    if (isInWishlist(item._id)) {
      removeFromWishlist(item._id);
    } else {
      addToWishlist(item);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">Special Offers</h1>
          <p className="text-gray-600">Grab amazing deals on your favorite items!</p>
        </div>

        {/* Offer Type Banners */}
        {offerTypes.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Browse by Offer Type</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
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

        {/* Items Grid */}
        {filteredItems.length === 0 ? (
          <div className="text-center py-12">
            <Tag className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No offers found</h3>
            <p className="text-gray-600">Try selecting a different filter</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredItems.map(item => {
              const inCart = isInCart(item._id);
              const cartItem = cart.find(c => c._id === item._id);
              const discount = getDiscountPercentage(item);

              return (
                <div key={item._id} className="bg-white rounded-xl shadow-md hover:shadow-lg transition-shadow overflow-hidden">
                  {/* Image */}
                  <div className="relative aspect-square">
                    <img
                      src={item.image || 'https://via.placeholder.com/300'}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                    {/* Discount Badge */}
                    <div className="absolute top-3 left-3 bg-green-500 text-white px-3 py-1 rounded-full font-bold text-sm shadow-lg">
                      {discount}% OFF
                    </div>
                    {/* Wishlist */}
                    <button
                      onClick={() => handleToggleWishlist(item)}
                      className="absolute top-3 right-3 p-2 bg-white/90 rounded-full shadow-md hover:bg-white transition-colors"
                    >
                      <Heart className={`w-5 h-5 ${isInWishlist(item._id) ? 'fill-red-500 text-red-500' : 'text-gray-400'}`} />
                    </button>
                  </div>

                  {/* Content */}
                  <div className="p-4">
                    <h3 className="font-semibold text-gray-900 mb-2 line-clamp-1">{item.name}</h3>
                    
                    {/* Price */}
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xl font-bold text-orange-600">₹{item.price}</span>
                      <span className="text-sm text-gray-400 line-through">₹{item.originalPrice}</span>
                    </div>

                    {/* Add to Cart */}
                    {inCart ? (
                      <div className="flex items-center justify-center gap-3 bg-orange-50 rounded-lg py-2">
                        <button
                          onClick={() => updateQuantity(item._id, cartItem.quantity - 1)}
                          className="p-1 bg-white rounded-full shadow hover:bg-gray-50"
                        >
                          <Minus className="w-4 h-4 text-orange-600" />
                        </button>
                        <span className="w-8 text-center font-semibold text-orange-600">{cartItem?.quantity || 0}</span>
                        <button
                          onClick={() => addToCart(item)}
                          className="p-1 bg-white rounded-full shadow hover:bg-gray-50"
                        >
                          <Plus className="w-4 h-4 text-orange-600" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleAddToCart(item)}
                        className="w-full py-2 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 transition-colors flex items-center justify-center gap-2"
                      >
                        <ShoppingCart className="w-4 h-4" />
                        Add to Cart
                      </button>
                    )}
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
