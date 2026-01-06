import { useState, useEffect, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import axios from 'axios';
import { Star, Plus, Minus, Heart, ShoppingCart } from 'lucide-react';

const API_URL = 'https://restaruntbot.onrender.com/api/public';
const SSE_URL = 'https://restaruntbot.onrender.com/api/events';
const WHATSAPP_NUMBER = '15551858897';

// WhatsApp Icon Component
const WhatsAppIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

export default function UserMenuPage() {
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [foodType, setFoodType] = useState('all');
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const eventSourceRef = useRef(null);

  const context = useOutletContext();
  const { 
    cart, addToCart, updateQuantity, 
    addToWishlist, removeFromWishlist, isInWishlist, isInCart 
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
  
  useEffect(() => { loadItems(); }, [selectedCategory, foodType]);

  const setupSSE = () => {
    try {
      eventSourceRef.current = new EventSource(SSE_URL);
      eventSourceRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'menu') loadData();
        } catch (e) {}
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
      const [catRes, itemRes] = await Promise.all([
        axios.get(`${API_URL}/categories`), 
        axios.get(`${API_URL}/menu`)
      ]);
      setCategories(catRes.data);
      setItems(itemRes.data);
    } catch (err) { 
      console.error('Error loading data:', err); 
    } finally { 
      setLoading(false); 
    }
  };

  const loadItems = async () => {
    setItemsLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedCategory !== 'all') params.append('category', selectedCategory);
      if (foodType !== 'all') params.append('foodType', foodType);
      const res = await axios.get(`${API_URL}/menu?${params}`);
      setItems(res.data);
    } catch (err) { 
      console.error('Error loading items:', err); 
    } finally { 
      setItemsLoading(false); 
    }
  };

  const activeCategoryNames = categories
    .filter(cat => cat.isActive && !cat.isPaused)
    .map(cat => cat.name);

  const availableItems = items.filter(item => {
    const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
    return itemCategories.some(cat => activeCategoryNames.includes(cat));
  });

  const isItemAvailable = (itemId) => {
    const item = items.find(i => i._id === itemId);
    if (!item) return false;
    const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
    return itemCategories.some(cat => activeCategoryNames.includes(cat));
  };

  const handleToggleWishlist = (item, e) => {
    e.stopPropagation();
    if (!addToWishlist || !removeFromWishlist) return;
    isInWishlist(item._id) ? removeFromWishlist(item._id) : addToWishlist(item);
  };

  const handleAddToCart = (item, e) => { 
    e.stopPropagation(); 
    if (!isItemAvailable(item._id) || !addToCart) return;
    addToCart(item); 
  };

  const handleWhatsAppOrder = (item, e) => {
    e.stopPropagation();
    if (!isItemAvailable(item._id)) return;
    
    // Format food type
    const foodTypeLabel = item.foodType === 'veg' ? '🥦 Veg' : 
                          item.foodType === 'nonveg' ? '🍗 Non-Veg' : 
                          item.foodType === 'egg' ? '🥚 Egg' : '';
    
    // Rating display
    let ratingDisplay = '';
    if (item.totalRatings > 0) {
      const stars = '⭐'.repeat(Math.floor(item.avgRating || 0));
      ratingDisplay = `${stars} ${item.avgRating} (${item.totalRatings} reviews)`;
    } else {
      ratingDisplay = '☆☆☆☆☆ No ratings yet';
    }
    
    // Build message like chatbot format
    let msg = `*${item.name}*${foodTypeLabel ? ` ${foodTypeLabel}` : ''}\n\n`;
    msg += `${ratingDisplay}\n\n`;
    msg += `💰 *Price:* ₹${item.price} / ${item.unitQty || 1} ${item.unit || 'piece'}\n`;
    msg += `⏱️ *Prep Time:* ${item.preparationTime || 15} mins\n`;
    if (item.tags?.length) msg += `🏷️ *Tags:* ${item.tags.join(', ')}\n`;
    msg += `\n📝 ${item.description || 'Delicious dish prepared fresh!'}`;
    
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const filteredCategories = [...new Set(availableItems.flatMap(i => Array.isArray(i.category) ? i.category : [i.category]))]
    .filter(cat => activeCategoryNames.includes(cat));

  const MenuItemSkeleton = () => (
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

  if (loading) {
    return (
      <div className="pt-20 min-h-screen bg-[#EDEAE3]">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-6">Our Menu</h1>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 md:gap-8 pt-8">
            {[...Array(8)].map((_, i) => <MenuItemSkeleton key={i} />)}
          </div>
        </div>
      </div>
    );
  }

  const renderItemCard = (item) => {
    const inCart = isInCart ? isInCart(item._id) : false;
    const cartItem = cart?.find(c => c._id === item._id);
    const available = isItemAvailable(item._id);
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
      <div key={item._id} className={`group relative pt-28 ${!available ? 'opacity-60' : ''}`}>
        {/* Floating Image */}
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 z-10 w-56 h-56 flex items-center justify-center">
          {item.image ? (
            <img 
              src={item.image} 
              alt={item.name} 
              className={`max-h-full max-w-full object-contain group-hover:scale-110 transition-transform duration-300 drop-shadow-xl ${!available ? 'grayscale' : ''}`} 
            />
          ) : (
            <div className="w-40 h-40 bg-gradient-to-br from-orange-100 to-orange-200 rounded-full flex items-center justify-center">
              <span className="text-6xl">🍽️</span>
            </div>
          )}
          {!available && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="bg-red-500 text-white px-3 py-1 rounded-full text-sm font-medium">Unavailable</span>
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

          {/* Price & Action Buttons */}
          <div className="flex items-center justify-between">
            <span className="text-xl font-bold text-green-600">₹{item.price}</span>
            <div className="flex items-center gap-2">
              {/* WhatsApp Button */}
              {available && (
                <button 
                  onClick={(e) => handleWhatsAppOrder(item, e)} 
                  className="w-10 h-10 bg-green-500 text-white rounded-xl flex items-center justify-center hover:bg-green-600 transition-colors shadow-md"
                  title="Order via WhatsApp"
                >
                  <WhatsAppIcon className="w-5 h-5" />
                </button>
              )}
              {/* Cart Button */}
              {!available ? (
                <div className="w-12 h-12 bg-gray-300 text-gray-500 rounded-xl flex items-center justify-center cursor-not-allowed">
                  <ShoppingCart className="w-5 h-5" />
                </div>
              ) : inCart ? (
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
                  className="w-12 h-12 bg-orange-500 text-white rounded-xl flex items-center justify-center hover:bg-orange-600 transition-colors shadow-md"
                >
                  <ShoppingCart className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="pt-20 min-h-screen bg-[#EDEAE3]">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900">Our Menu</h1>
          <p className="text-gray-500 mt-2">Explore our delicious dishes</p>
        </div>

        {/* Food Type Filter */}
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2">
          <button 
            onClick={() => setFoodType('all')} 
            className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
              foodType === 'all' 
                ? 'bg-gray-900 text-white shadow-lg' 
                : 'bg-white text-gray-600 hover:bg-gray-100 shadow-sm'
            }`}
          >
            All
          </button>
          <button 
            onClick={() => setFoodType('veg')} 
            className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all flex items-center gap-2 whitespace-nowrap ${
              foodType === 'veg' 
                ? 'bg-green-500 text-white shadow-lg' 
                : 'bg-white text-gray-600 hover:bg-gray-100 shadow-sm'
            }`}
          >
            <span className={`w-3 h-3 rounded border-2 flex items-center justify-center ${foodType === 'veg' ? 'border-white' : 'border-green-500'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${foodType === 'veg' ? 'bg-white' : 'bg-green-500'}`} />
            </span>
            Veg
          </button>
          <button 
            onClick={() => setFoodType('nonveg')} 
            className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all flex items-center gap-2 whitespace-nowrap ${
              foodType === 'nonveg' 
                ? 'bg-red-500 text-white shadow-lg' 
                : 'bg-white text-gray-600 hover:bg-gray-100 shadow-sm'
            }`}
          >
            <span className={`w-3 h-3 rounded border-2 flex items-center justify-center ${foodType === 'nonveg' ? 'border-white' : 'border-red-500'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${foodType === 'nonveg' ? 'bg-white' : 'bg-red-500'}`} />
            </span>
            Non-Veg
          </button>
          <button 
            onClick={() => setFoodType('egg')} 
            className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all flex items-center gap-2 whitespace-nowrap ${
              foodType === 'egg' 
                ? 'bg-yellow-500 text-white shadow-lg' 
                : 'bg-white text-gray-600 hover:bg-gray-100 shadow-sm'
            }`}
          >
            <span className={`w-3 h-3 rounded border-2 flex items-center justify-center ${foodType === 'egg' ? 'border-white' : 'border-yellow-500'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${foodType === 'egg' ? 'bg-white' : 'bg-yellow-500'}`} />
            </span>
            Egg
          </button>
        </div>

        {/* Category Filter */}
        <div className="bg-white rounded-2xl p-4 shadow-sm mb-8">
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
            <button 
              onClick={() => setSelectedCategory('all')} 
              className="flex flex-col items-center min-w-[80px] transition-all group"
            >
              <div className={`w-16 h-16 rounded-2xl overflow-hidden mb-2 transition-all ${
                selectedCategory === 'all' 
                  ? 'ring-2 ring-orange-500 ring-offset-2' 
                  : 'group-hover:ring-2 group-hover:ring-gray-200'
              }`}>
                <div className={`w-full h-full flex items-center justify-center ${
                  selectedCategory === 'all' 
                    ? 'bg-gradient-to-br from-orange-400 to-orange-600' 
                    : 'bg-gray-100'
                }`}>
                  <span className={`text-lg font-bold ${selectedCategory === 'all' ? 'text-white' : 'text-gray-500'}`}>All</span>
                </div>
              </div>
              <span className={`text-sm font-medium ${selectedCategory === 'all' ? 'text-orange-600' : 'text-gray-600'}`}>All Items</span>
            </button>
            {categories.filter(cat => cat.isActive && !cat.isPaused).map(cat => (
              <button 
                key={cat._id} 
                onClick={() => setSelectedCategory(cat.name)} 
                className="flex flex-col items-center min-w-[80px] transition-all group"
              >
                <div className={`w-16 h-16 rounded-2xl overflow-hidden mb-2 transition-all ${
                  selectedCategory === cat.name 
                    ? 'ring-2 ring-orange-500 ring-offset-2' 
                    : 'group-hover:ring-2 group-hover:ring-gray-200'
                }`}>
                  {cat.image ? (
                    <img src={cat.image} alt={cat.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                      <span className="text-2xl">🍽️</span>
                    </div>
                  )}
                </div>
                <span className={`text-sm font-medium text-center line-clamp-1 ${
                  selectedCategory === cat.name ? 'text-orange-600' : 'text-gray-600'
                }`}>{cat.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Items Grid */}
        <div className={`space-y-10 transition-opacity duration-300 ${itemsLoading ? 'opacity-50' : 'opacity-100'}`}>
          {itemsLoading && (
            <div className="flex justify-center py-8">
              <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          )}
          
          {!itemsLoading && (selectedCategory !== 'all' ? [selectedCategory] : filteredCategories).map(cat => {
            const itemsInCategory = availableItems.filter(i => 
              (Array.isArray(i.category) ? i.category : [i.category]).includes(cat)
            );
            if (itemsInCategory.length === 0) return null;
            
            return (
              <div key={cat}>
                <div className="flex items-center gap-3 mb-6">
                  <h2 className="text-xl font-bold text-gray-900">{cat}</h2>
                  <span className="px-3 py-1 bg-orange-100 text-orange-600 rounded-full text-sm font-medium">
                    {itemsInCategory.length} items
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 md:gap-8 pt-8">
                  {itemsInCategory.map(renderItemCard)}
                </div>
              </div>
            );
          })}
          
          {!itemsLoading && filteredCategories.length === 0 && (
            <div className="bg-white rounded-2xl shadow-sm p-12 text-center">
              <span className="text-6xl mb-4 block">🍽️</span>
              <h3 className="text-lg font-semibold text-gray-700">No items found</h3>
              <p className="text-gray-400 mt-1">Try a different filter</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
