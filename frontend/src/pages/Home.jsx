import { useState, useEffect } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import axios from 'axios';
import HeroCarousel from '../components/HeroCarousel';
import { 
  StarIcon, HeartIcon, CartIcon, PlusIcon, MinusIcon, 
  ArrowRightIcon, TruckIcon, ClockIcon, CheckCircleIcon 
} from '../components/Icons';

const API_URL = 'https://restaruntbot.onrender.com/api/public';

export default function Home() {
  const [topItems, setTopItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const context = useOutletContext();
  const { 
    cart, addToCart, updateQuantity, 
    addToWishlist, removeFromWishlist, isInWishlist, isInCart 
  } = context || {};

  useEffect(() => {
    loadTopItems();
  }, []);

  const loadTopItems = async () => {
    try {
      const res = await axios.get(`${API_URL}/menu`);
      const sorted = res.data
        .filter(item => item.isActive !== false)
        .sort((a, b) => (b.totalRatings || 0) - (a.totalRatings || 0))
        .slice(0, 4);
      setTopItems(sorted);
    } catch (err) {
      console.error('Error loading top items:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleWishlist = (item, e) => {
    e.stopPropagation();
    if (!addToWishlist || !removeFromWishlist) return;
    isInWishlist(item._id) ? removeFromWishlist(item._id) : addToWishlist(item);
  };

  const handleAddToCart = (item, e) => {
    e.stopPropagation();
    if (!addToCart) return;
    addToCart(item);
  };

  const ItemSkeleton = () => (
    <div className="bg-white rounded-2xl overflow-hidden shadow-sm animate-pulse">
      <div className="h-48 bg-gray-200" />
      <div className="p-4">
        <div className="h-5 bg-gray-200 rounded w-3/4 mb-2" />
        <div className="h-4 bg-gray-200 rounded w-1/2 mb-3" />
        <div className="flex justify-between items-center">
          <div className="h-6 bg-gray-200 rounded w-16" />
          <div className="h-10 w-10 bg-gray-200 rounded-xl" />
        </div>
      </div>
    </div>
  );

  const renderStars = (rating) => {
    return [...Array(5)].map((_, i) => (
      <StarIcon 
        key={i} 
        className={`w-4 h-4 ${i < Math.round(rating) ? 'text-yellow-400' : 'text-gray-300'}`}
        filled={i < Math.round(rating)}
      />
    ));
  };

  const renderItemCard = (item) => {
    const inCart = isInCart ? isInCart(item._id) : false;
    const cartItem = cart?.find(c => c._id === item._id);
    const rating = item.avgRating || 0;
    const totalRatings = item.totalRatings || 0;

    return (
      <div key={item._id} className="group bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300">
        {/* Image */}
        <div className="relative h-48 overflow-hidden">
          {item.image ? (
            <img 
              src={item.image} 
              alt={item.name} 
              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" 
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-orange-100 to-orange-200 flex items-center justify-center">
              <svg className="w-16 h-16 text-orange-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
          )}
          
          {/* Wishlist Button */}
          <button 
            onClick={(e) => handleToggleWishlist(item, e)} 
            className="absolute top-3 right-3 p-2 bg-white/90 backdrop-blur-sm rounded-full shadow-md hover:scale-110 transition-transform"
          >
            <HeartIcon 
              className={`w-5 h-5 ${isInWishlist && isInWishlist(item._id) ? 'text-red-500' : 'text-gray-400'}`}
              filled={isInWishlist && isInWishlist(item._id)}
            />
          </button>

          {/* Food Type Badge */}
          {item.foodType && (
            <div className={`absolute top-3 left-3 w-5 h-5 rounded border-2 flex items-center justify-center ${
              item.foodType === 'veg' ? 'border-green-500' : 'border-red-500'
            }`}>
              <div className={`w-2.5 h-2.5 rounded-full ${
                item.foodType === 'veg' ? 'bg-green-500' : 'bg-red-500'
              }`} />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-4">
          <h3 className="font-semibold text-gray-900 mb-1 line-clamp-1">{item.name}</h3>
          
          {/* Rating */}
          <div className="flex items-center gap-1 mb-2">
            <div className="flex">{renderStars(rating)}</div>
            <span className="text-xs text-gray-500">({totalRatings})</span>
          </div>

          {/* Description */}
          {item.description && (
            <p className="text-sm text-gray-500 line-clamp-2 mb-3 min-h-[40px]">{item.description}</p>
          )}

          {/* Price & Cart */}
          <div className="flex items-center justify-between">
            <span className="text-xl font-bold text-orange-600">₹{item.price}</span>
            
            {inCart ? (
              <div className="flex items-center gap-1 bg-orange-500 rounded-xl px-2 py-1">
                <button 
                  onClick={(e) => { e.stopPropagation(); updateQuantity(item._id, cartItem.quantity - 1); }} 
                  className="p-1.5 text-white hover:bg-orange-600 rounded-lg transition-colors"
                >
                  <MinusIcon className="w-4 h-4" />
                </button>
                <span className="w-8 text-center font-semibold text-white">{cartItem?.quantity || 0}</span>
                <button 
                  onClick={(e) => { e.stopPropagation(); addToCart(item); }} 
                  className="p-1.5 text-white hover:bg-orange-600 rounded-lg transition-colors"
                >
                  <PlusIcon className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button 
                onClick={(e) => handleAddToCart(item, e)} 
                className="w-11 h-11 bg-orange-500 text-white rounded-xl flex items-center justify-center hover:bg-orange-600 transition-colors shadow-md hover:shadow-lg"
              >
                <CartIcon className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* Hero Carousel */}
      <HeroCarousel />

      {/* Features Section */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="flex items-center gap-4 p-6 bg-orange-50 rounded-2xl">
              <div className="w-14 h-14 bg-orange-500 rounded-xl flex items-center justify-center flex-shrink-0">
                <TruckIcon className="w-7 h-7 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">Fast Delivery</h3>
                <p className="text-sm text-gray-500">Within 30 minutes</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4 p-6 bg-green-50 rounded-2xl">
              <div className="w-14 h-14 bg-green-500 rounded-xl flex items-center justify-center flex-shrink-0">
                <CheckCircleIcon className="w-7 h-7 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">Fresh Ingredients</h3>
                <p className="text-sm text-gray-500">Quality guaranteed</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4 p-6 bg-blue-50 rounded-2xl">
              <div className="w-14 h-14 bg-blue-500 rounded-xl flex items-center justify-center flex-shrink-0">
                <ClockIcon className="w-7 h-7 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">Easy Ordering</h3>
                <p className="text-sm text-gray-500">Order via WhatsApp</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Top Items Section */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between mb-10">
            <div>
              <h2 className="text-3xl font-bold text-gray-900">Most Popular</h2>
              <p className="text-gray-500 mt-1">Our customers' favorites</p>
            </div>
            <Link 
              to="/menu" 
              className="hidden md:flex items-center gap-2 text-orange-600 font-medium hover:text-orange-700 transition-colors"
            >
              View All <ArrowRightIcon className="w-4 h-4" />
            </Link>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <ItemSkeleton />
              <ItemSkeleton />
              <ItemSkeleton />
              <ItemSkeleton />
            </div>
          ) : topItems.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {topItems.map(renderItemCard)}
            </div>
          ) : (
            <div className="text-center py-16 bg-white rounded-2xl">
              <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              <p className="text-gray-500">No items available yet</p>
            </div>
          )}

          <Link 
            to="/menu" 
            className="md:hidden flex items-center justify-center gap-2 mt-8 text-orange-600 font-medium"
          >
            View All Menu <ArrowRightIcon className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4">
          <div className="bg-gradient-to-r from-orange-500 to-red-500 rounded-3xl p-8 md:p-16 text-center text-white relative overflow-hidden">
            {/* Background Pattern */}
            <div className="absolute inset-0 opacity-10">
              <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
                  <circle cx="5" cy="5" r="1" fill="white" />
                </pattern>
                <rect width="100" height="100" fill="url(#grid)" />
              </svg>
            </div>
            
            <div className="relative">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to Order?</h2>
              <p className="text-white/90 mb-8 max-w-md mx-auto">
                Browse our menu and order your favorite dishes. We'll deliver them fresh and hot!
              </p>
              <Link 
                to="/menu" 
                className="inline-flex items-center gap-2 bg-white text-orange-600 px-8 py-4 rounded-full font-semibold hover:bg-orange-50 transition-all shadow-lg hover:shadow-xl hover:scale-105"
              >
                Order Now <ArrowRightIcon className="w-5 h-5" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
