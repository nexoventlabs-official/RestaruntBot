import { useState, useEffect } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import axios from 'axios';
import HeroCarousel from '../components/HeroCarousel';
import { 
  ArrowRightIcon, TruckIcon, ClockIcon, CheckCircleIcon 
} from '../components/Icons';
import { Star, Heart, ShoppingCart, Plus, Minus } from 'lucide-react';

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
    <div className="relative pt-28">
      <div className="absolute -top-8 left-1/2 -translate-x-1/2 z-10 w-56 h-56">
        <div className="w-full h-full bg-gray-300 rounded-full animate-pulse"></div>
      </div>
      <div className="bg-white rounded-3xl pt-24 px-5 pb-5 shadow-[0_2px_15px_rgba(0,0,0,0.08)] border border-gray-100 animate-pulse">
        <div className="flex justify-between mb-2">
          <div className="h-5 w-28 bg-gray-200 rounded"></div>
          <div className="h-5 w-5 bg-gray-200 rounded-full"></div>
        </div>
        <div className="flex gap-1 mb-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-4 w-4 bg-gray-200 rounded"></div>)}
        </div>
        <div className="h-4 w-full bg-gray-200 rounded mb-1"></div>
        <div className="h-4 w-3/4 bg-gray-200 rounded mb-4"></div>
        <div className="flex justify-between items-center">
          <div className="h-7 w-16 bg-gray-200 rounded"></div>
          <div className="h-12 w-12 bg-gray-200 rounded-xl"></div>
        </div>
      </div>
    </div>
  );

  const renderItemCard = (item) => {
    const inCart = isInCart ? isInCart(item._id) : false;
    const cartItem = cart?.find(c => c._id === item._id);
    const rating = item.avgRating || 0;
    const totalRatings = item.totalRatings || 0;

    const renderStars = () => {
      const stars = [];
      for (let i = 1; i <= 5; i++) {
        stars.push(
          <Star 
            key={i} 
            className={`w-3.5 h-3.5 ${i <= Math.round(rating) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} 
          />
        );
      }
      return stars;
    };

    return (
      <div key={item._id} className="group relative pt-28">
        {/* Floating Image */}
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 z-10 w-56 h-56 flex items-center justify-center">
          {item.image ? (
            <img 
              src={item.image} 
              alt={item.name} 
              className="max-h-full max-w-full object-contain group-hover:scale-110 transition-transform duration-300 drop-shadow-xl" 
            />
          ) : (
            <div className="w-40 h-40 bg-gradient-to-br from-orange-100 to-orange-200 rounded-full flex items-center justify-center">
              <span className="text-6xl">🍽️</span>
            </div>
          )}
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl pt-24 px-5 pb-5 shadow-[0_2px_15px_rgba(0,0,0,0.08)] border border-gray-100 hover:shadow-[0_4px_20px_rgba(0,0,0,0.12)] transition-shadow">
          {/* Name & Wishlist */}
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="font-bold text-gray-900 uppercase text-sm tracking-wide line-clamp-1">{item.name}</h3>
            <button 
              onClick={(e) => handleToggleWishlist(item, e)} 
              className="p-1 hover:scale-110 transition-transform flex-shrink-0"
            >
              <Heart className={`w-5 h-5 ${isInWishlist && isInWishlist(item._id) ? 'fill-red-500 text-red-500' : 'text-gray-400'}`} />
            </button>
          </div>

          {/* Rating */}
          <div className="flex items-center gap-1 mb-3">
            <div className="flex">{renderStars()}</div>
            <span className="text-xs text-gray-500">({totalRatings})</span>
          </div>

          {/* Description */}
          {item.description && (
            <p className="text-sm text-gray-500 line-clamp-2 mb-4 min-h-[40px]">{item.description}</p>
          )}

          {/* Price & Cart Button */}
          <div className="flex items-center justify-between">
            <span className="text-xl font-bold text-green-600">₹{item.price}</span>
            {inCart ? (
              <div className="flex items-center gap-1 bg-green-600 rounded-xl px-2 py-1.5">
                <button 
                  onClick={(e) => { e.stopPropagation(); updateQuantity(item._id, cartItem.quantity - 1); }} 
                  className="p-1 text-white hover:bg-green-700 rounded"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="w-6 text-center font-semibold text-white">{cartItem?.quantity || 0}</span>
                <button 
                  onClick={(e) => { e.stopPropagation(); addToCart(item); }} 
                  className="p-1 text-white hover:bg-green-700 rounded"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button 
                onClick={(e) => handleAddToCart(item, e)} 
                className="w-12 h-12 bg-green-600 text-white rounded-xl flex items-center justify-center hover:bg-green-700 transition-colors shadow-md"
              >
                <ShoppingCart className="w-5 h-5" />
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
      <section className="py-16 bg-[#EDEAE3]">
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8 pt-8">
              <ItemSkeleton />
              <ItemSkeleton />
              <ItemSkeleton />
              <ItemSkeleton />
            </div>
          ) : topItems.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8 pt-8">
              {topItems.map(renderItemCard)}
            </div>
          ) : (
            <div className="text-center py-16 bg-white rounded-2xl">
              <span className="text-6xl mb-4 block">🍽️</span>
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
