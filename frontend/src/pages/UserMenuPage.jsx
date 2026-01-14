import { useState, useEffect, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import axios from 'axios';
import { Star, Plus, Minus, Heart, ShoppingCart, X, Clock, Package } from 'lucide-react';
import { useCachedData } from '../hooks/useImagePreloader';

const API_URL = 'https://restaruntbot.onrender.com/api/public';
const SSE_URL = 'https://restaruntbot.onrender.com/api/events';
const WHATSAPP_NUMBER = '15551858897';

// WhatsApp Icon Component
const WhatsAppIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

// Food Type Badge Component
const FoodTypeBadge = ({ type, size = 'md' }) => {
  const config = {
    veg: { color: 'green', label: 'Veg', icon: '🥦' },
    nonveg: { color: 'red', label: 'Non-Veg', icon: '🍗' },
    egg: { color: 'yellow', label: 'Egg', icon: '🥚' }
  };
  const { color, label, icon } = config[type] || config.veg;
  const sizeClasses = size === 'lg' ? 'px-3 py-1.5 text-sm' : 'px-2 py-1 text-xs';
  
  return (
    <span className={`inline-flex items-center gap-1 ${sizeClasses} rounded-full font-medium border-2 ${
      color === 'green' ? 'border-green-500 text-green-600 bg-green-50' :
      color === 'red' ? 'border-red-500 text-red-600 bg-red-50' :
      'border-yellow-500 text-yellow-600 bg-yellow-50'
    }`}>
      <span className={`w-2 h-2 rounded-full ${
        color === 'green' ? 'bg-green-500' :
        color === 'red' ? 'bg-red-500' :
        'bg-yellow-500'
      }`} />
      {label}
    </span>
  );
};

export default function UserMenuPage() {
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [foodType, setFoodType] = useState('all');
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [bannerFading, setBannerFading] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [dialogQuantity, setDialogQuantity] = useState(1);
  const eventSourceRef = useRef(null);

  // Get cached data from preloader
  const cachedData = useCachedData();

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

  // Handle food type change with fade effect
  const handleFoodTypeChange = (type) => {
    if (type === foodType) return;
    setBannerFading(true);
    setTimeout(() => {
      setFoodType(type);
      setTimeout(() => setBannerFading(false), 50);
    }, 300);
  };

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
      // Use cached data if available
      if (cachedData.isLoaded && cachedData.categories && cachedData.menu) {
        setCategories(cachedData.categories);
        setItems(cachedData.menu);
        setAllItems(cachedData.menu);
        setLoading(false);
        return;
      }
      
      const [catRes, itemRes] = await Promise.all([
        axios.get(`${API_URL}/categories`), 
        axios.get(`${API_URL}/menu`)
      ]);
      setCategories(catRes.data);
      setItems(itemRes.data);
      setAllItems(itemRes.data);
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

  // Get item count for a category from all items (not filtered)
  const getCategoryItemCount = (categoryName) => {
    return allItems.filter(item => {
      const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
      return itemCategories.includes(categoryName) && itemCategories.some(cat => activeCategoryNames.includes(cat));
    }).length;
  };

  // Get total items count
  const getTotalItemsCount = () => {
    return allItems.filter(item => {
      const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
      return itemCategories.some(cat => activeCategoryNames.includes(cat));
    }).length;
  };

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
    e?.stopPropagation();
    if (!isItemAvailable(item._id)) return;
    
    // Format food type
    const foodTypeLabel = item.foodType === 'veg' ? '🥦 Veg' : 
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
    msg += `💰 *Price:* ₹${item.price} / ${item.unitQty || 1} ${item.unit || 'piece'}\n`;
    msg += `⏱️ *Prep Time:* ${item.preparationTime || 15} mins\n`;
    if (item.tags?.length) msg += `🏷️ *Tags:* ${item.tags.join(', ')}\n`;
    msg += `\n📝 ${item.description || 'Delicious dish prepared fresh!'}`;
    
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  // Open item detail dialog
  const openItemDialog = (item) => {
    setSelectedItem(item);
    setDialogQuantity(cart?.find(c => c._id === item._id)?.quantity || 1);
    // Prevent body scroll when dialog is open
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    // Stop Lenis if it exists
    if (window.lenis) window.lenis.stop();
  };

  // Close item detail dialog
  const closeItemDialog = () => {
    setSelectedItem(null);
    setDialogQuantity(1);
    // Restore body scroll
    document.body.style.overflow = '';
    document.body.style.touchAction = '';
    // Start Lenis if it exists
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
    
    const foodTypeLabel = item.foodType === 'veg' ? '🥦 Veg' : 
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

  const filteredCategories = [...new Set(availableItems.flatMap(i => Array.isArray(i.category) ? i.category : [i.category]))]
    .filter(cat => activeCategoryNames.includes(cat));

  const MenuItemSkeleton = () => (
    <div className="relative pt-20 sm:pt-24">
      <div className="absolute -top-6 sm:-top-8 left-1/2 -translate-x-1/2 z-10 w-36 h-36 sm:w-44 sm:h-44 md:w-48 md:h-48">
        <div className="w-full h-full bg-gray-300 rounded-full animate-pulse"></div>
      </div>
      <div className="bg-[rgb(245,241,232)] rounded-2xl sm:rounded-3xl pt-16 sm:pt-20 md:pt-22 px-3 sm:px-4 md:px-5 pb-3 sm:pb-4 md:pb-5 shadow-[0_2px_15px_rgba(0,0,0,0.08)] border border-gray-100 animate-pulse">
        <div className="flex justify-between mb-2">
          <div className="h-4 sm:h-5 w-20 sm:w-28 bg-gray-200 rounded"></div>
          <div className="h-4 sm:h-5 w-4 sm:w-5 bg-gray-200 rounded-full"></div>
        </div>
        <div className="flex gap-0.5 sm:gap-1 mb-2 sm:mb-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-3 w-3 sm:h-4 sm:w-4 bg-gray-200 rounded"></div>)}
        </div>
        <div className="h-3 sm:h-4 w-full bg-gray-200 rounded mb-1"></div>
        <div className="h-3 sm:h-4 w-3/4 bg-gray-200 rounded mb-2 sm:mb-4"></div>
        <div className="flex justify-between items-center">
          <div className="h-6 sm:h-7 w-14 sm:w-16 bg-gray-200 rounded"></div>
          <div className="h-8 sm:h-10 md:h-11 w-8 sm:w-10 md:w-11 bg-gray-200 rounded-lg sm:rounded-xl"></div>
        </div>
      </div>
    </div>
  );

  // Banner data for each food type
  const bannerData = {
    all: {
      title: 'Our Menu',
      subtitle: 'Explore our delicious collection of dishes',
      image: '/banner-delicious-tacos.jpg',
      align: 'center'
    },
    veg: {
      title: 'Vegetarian Menu',
      subtitle: 'Fresh and healthy vegetarian delights',
      image: '/vegetables-with-salt-corn-cob.jpg',
      align: 'left'
    },
    nonveg: {
      title: 'Non-Veg Menu',
      subtitle: 'Savor our premium meat selections',
      image: '/preparing-raw-barbeque-chicken-cooking.jpg',
      align: 'right'
    },
    egg: {
      title: 'Egg Specials',
      subtitle: 'Delicious egg-based dishes for you',
      image: '/friied-eggs-with-vegetables.jpg',
      align: 'left'
    }
  };

  const currentBanner = bannerData[foodType] || bannerData.all;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#ffffff]">
        {/* Hero Banner Skeleton */}
        <section className="relative pt-28 pb-16 bg-gray-300 animate-pulse">
          <div className="max-w-6xl mx-auto px-4 text-center">
            <div className="h-10 w-64 bg-gray-400 rounded mx-auto mb-4"></div>
            <div className="h-6 w-96 bg-gray-400 rounded mx-auto"></div>
          </div>
        </section>
        <div className="max-w-7xl mx-auto px-4 py-8">
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
            className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${i <= Math.round(rating) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} 
          />
        );
      }
      return stars;
    };
    
    return (
      <div 
        key={item._id} 
        className={`group relative pt-20 sm:pt-24 cursor-pointer ${!available ? 'opacity-60' : ''}`}
        onClick={() => available && openItemDialog(item)}
      >
        {/* Floating Image */}
        <div className="absolute -top-6 sm:-top-8 left-1/2 -translate-x-1/2 z-10 w-36 h-36 sm:w-44 sm:h-44 md:w-48 md:h-48 flex items-center justify-center">
          {item.image ? (
            <img 
              src={item.image} 
              alt={item.name} 
              className={`max-h-full max-w-full object-contain group-hover:scale-110 transition-transform duration-300 drop-shadow-xl ${!available ? 'grayscale' : ''}`} 
            />
          ) : (
            <div className="w-28 h-28 sm:w-32 sm:h-32 md:w-36 md:h-36 bg-gradient-to-br from-orange-100 to-orange-200 rounded-full flex items-center justify-center">
              <span className="text-4xl sm:text-5xl md:text-6xl">🍽️</span>
            </div>
          )}
          {!available && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="bg-red-500 text-white px-2 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium">Unavailable</span>
            </div>
          )}
        </div>

        {/* Card */}
        <div className="bg-[rgb(245,241,232)] rounded-2xl sm:rounded-3xl pt-16 sm:pt-20 md:pt-22 px-3 sm:px-4 md:px-5 pb-3 sm:pb-4 md:pb-5 shadow-[0_2px_15px_rgba(0,0,0,0.08)] border border-gray-100 hover:shadow-[0_4px_20px_rgba(0,0,0,0.12)] transition-shadow relative">
          {/* WhatsApp Button - Top Right */}
          {available && (
            <button 
              onClick={(e) => handleWhatsAppOrder(item, e)} 
              className="absolute top-2 right-2 sm:top-3 sm:right-3 w-7 h-7 sm:w-8 sm:h-8 bg-green-500 text-white rounded-full flex items-center justify-center hover:bg-green-600 transition-colors shadow-md z-10"
              title="Order via WhatsApp"
            >
              <WhatsAppIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          )}
          
          {/* Name & Wishlist */}
          <div className="flex items-center justify-between gap-1 sm:gap-2 mb-1 pr-8 sm:pr-10">
            <h3 className="font-bold text-gray-900 uppercase text-xs sm:text-sm tracking-wide line-clamp-1">{item.name}</h3>
            <button 
              onClick={(e) => handleToggleWishlist(item, e)} 
              className="p-0.5 sm:p-1 hover:scale-110 transition-transform flex-shrink-0"
            >
              <Heart className={`w-4 h-4 sm:w-5 sm:h-5 ${isInWishlist && isInWishlist(item._id) ? 'fill-red-500 text-red-500' : 'text-gray-400'}`} />
            </button>
          </div>

          {/* Rating */}
          <div className="flex items-center gap-0.5 sm:gap-1 mb-2 sm:mb-3">
            <div className="flex">{renderStars()}</div>
            <span className="text-[10px] sm:text-xs text-gray-500">({totalRatings})</span>
          </div>

          {/* Description */}
          {item.description && (
            <p className="text-xs sm:text-sm text-gray-500 line-clamp-2 mb-2 sm:mb-4 min-h-[32px] sm:min-h-[40px]">{item.description}</p>
          )}

          {/* Price & Action Buttons */}
          <div className="flex items-center justify-between">
            <div className="relative">
              <img src="/button.png" alt="" className="h-6 sm:h-7 md:h-8 w-auto" style={{ filter: 'brightness(0) saturate(100%) invert(19%) sepia(97%) saturate(7043%) hue-rotate(359deg) brightness(101%) contrast(117%)' }} />
              <span className="absolute inset-0 flex items-center justify-center text-white font-bold text-[10px] sm:text-xs md:text-sm">
                ₹{item.price}
              </span>
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              {/* Cart Button */}
              {!available ? (
                <div className="w-8 h-8 sm:w-10 sm:h-10 md:w-11 md:h-11 bg-gray-300 text-gray-500 rounded-lg sm:rounded-xl flex items-center justify-center cursor-not-allowed">
                  <ShoppingCart className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
              ) : inCart ? (
                <div className="flex items-center gap-0.5 sm:gap-1 bg-green-600 rounded-lg sm:rounded-xl px-1.5 sm:px-2 py-1 sm:py-1.5">
                  <button 
                    onClick={(e) => { e.stopPropagation(); updateQuantity(item._id, cartItem.quantity - 1); }} 
                    className="p-0.5 sm:p-1 text-white hover:bg-green-700 rounded"
                  >
                    <Minus className="w-3 h-3 sm:w-4 sm:h-4" />
                  </button>
                  <span className="w-4 sm:w-6 text-center font-semibold text-white text-xs sm:text-sm">{cartItem?.quantity || 0}</span>
                  <button 
                    onClick={(e) => { e.stopPropagation(); addToCart(item); }} 
                    className="p-0.5 sm:p-1 text-white hover:bg-green-700 rounded"
                  >
                    <Plus className="w-3 h-3 sm:w-4 sm:h-4" />
                  </button>
                </div>
              ) : (
                <button 
                  onClick={(e) => handleAddToCart(item, e)} 
                  className="w-8 h-8 sm:w-10 sm:h-10 md:w-11 md:h-11 bg-orange-500 text-white rounded-lg sm:rounded-xl flex items-center justify-center hover:bg-orange-600 transition-colors shadow-md"
                >
                  <ShoppingCart className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#ffffff]">
      {/* Hero Banner Section */}
      <section 
        className={`relative text-white pt-28 pb-16 bg-cover bg-center transition-opacity duration-300 ${bannerFading ? 'opacity-0' : 'opacity-100'}`}
        style={{ backgroundImage: `url('${currentBanner.image}')` }}
      >
        <div className={`relative max-w-6xl mx-auto px-4 ${
          currentBanner.align === 'left' ? 'text-left' : 
          currentBanner.align === 'right' ? 'text-right' : 'text-center'
        }`}>
          <span className="inline-block px-4 py-1.5 bg-[#3f9065] text-white text-sm font-medium rounded-full mb-4 tracking-wide uppercase">
            {foodType === 'all' ? 'Explore' : foodType === 'veg' ? '🥦 Pure Veg' : foodType === 'nonveg' ? '🍗 Non-Veg' : '🥚 Egg Special'}
          </span>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-4 drop-shadow-lg">
            <span className="text-white">{currentBanner.title.split(' ')[0]}</span>{' '}
            <span className="text-[#ff9924]">{currentBanner.title.split(' ').slice(1).join(' ')}</span>
          </h1>
          <p className={`text-lg md:text-xl text-gray-100 font-light drop-shadow-md ${
            currentBanner.align === 'center' ? 'max-w-2xl mx-auto' : 'max-w-xl'
          } ${currentBanner.align === 'right' ? 'ml-auto' : ''}`}>
            {currentBanner.subtitle}
          </p>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Food Type Filter */}
        <div className="flex items-center justify-center gap-4 md:gap-8 mb-8 py-6">
          {/* All */}
          <button 
            onClick={() => handleFoodTypeChange('all')} 
            className="flex flex-col items-center gap-2 group"
          >
            <div className={`w-20 h-20 md:w-24 md:h-24 rounded-full overflow-hidden border-4 transition-all duration-300 ${
              foodType === 'all' 
                ? 'border-gray-900 shadow-lg scale-110' 
                : 'border-transparent hover:border-gray-300'
            }`}>
              <img src="/all.png" alt="All" className="w-full h-full object-cover" />
            </div>
            <span className={`text-sm font-medium transition-colors ${
              foodType === 'all' ? 'text-gray-900' : 'text-gray-500 group-hover:text-gray-700'
            }`}>All</span>
          </button>

          {/* Veg */}
          <button 
            onClick={() => handleFoodTypeChange('veg')} 
            className="flex flex-col items-center gap-2 group"
          >
            <div className={`w-20 h-20 md:w-24 md:h-24 rounded-full overflow-hidden border-4 transition-all duration-300 ${
              foodType === 'veg' 
                ? 'border-green-500 shadow-lg scale-110' 
                : 'border-transparent hover:border-green-300'
            }`}>
              <img src="/veg.png" alt="Veg" className="w-full h-full object-cover" />
            </div>
            <span className={`text-sm font-medium transition-colors flex items-center gap-1 ${
              foodType === 'veg' ? 'text-green-600' : 'text-gray-500 group-hover:text-green-600'
            }`}>
              <span className="w-3 h-3 rounded border-2 border-green-500 flex items-center justify-center">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              </span>
              Veg
            </span>
          </button>

          {/* Non-Veg */}
          <button 
            onClick={() => handleFoodTypeChange('nonveg')} 
            className="flex flex-col items-center gap-2 group"
          >
            <div className={`w-20 h-20 md:w-24 md:h-24 rounded-full overflow-hidden border-4 transition-all duration-300 ${
              foodType === 'nonveg' 
                ? 'border-red-500 shadow-lg scale-110' 
                : 'border-transparent hover:border-red-300'
            }`}>
              <img src="/non-veg.png" alt="Non-Veg" className="w-full h-full object-cover" />
            </div>
            <span className={`text-sm font-medium transition-colors flex items-center gap-1 ${
              foodType === 'nonveg' ? 'text-red-600' : 'text-gray-500 group-hover:text-red-600'
            }`}>
              <span className="w-3 h-3 rounded border-2 border-red-500 flex items-center justify-center">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              </span>
              Non-Veg
            </span>
          </button>

          {/* Egg */}
          <button 
            onClick={() => handleFoodTypeChange('egg')} 
            className="flex flex-col items-center gap-2 group"
          >
            <div className={`w-20 h-20 md:w-24 md:h-24 rounded-full overflow-hidden border-4 transition-all duration-300 ${
              foodType === 'egg' 
                ? 'border-yellow-500 shadow-lg scale-110' 
                : 'border-transparent hover:border-yellow-300'
            }`}>
              <img src="/egg.png" alt="Egg" className="w-full h-full object-cover" />
            </div>
            <span className={`text-sm font-medium transition-colors flex items-center gap-1 ${
              foodType === 'egg' ? 'text-yellow-600' : 'text-gray-500 group-hover:text-yellow-600'
            }`}>
              <span className="w-3 h-3 rounded border-2 border-yellow-500 flex items-center justify-center">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
              </span>
              Egg
            </span>
          </button>
        </div>

        {/* Category Filter */}
        <div 
          className="mb-8 overflow-x-auto pb-4 scrollbar-hide"
          style={{ 
            WebkitOverflowScrolling: 'touch',
            overscrollBehaviorX: 'contain',
            touchAction: 'pan-x'
          }}
          data-lenis-prevent
        >
          <div className="flex gap-4 md:gap-6 px-1" style={{ minWidth: 'min-content' }}>
            {/* All Items */}
            <button 
              onClick={() => setSelectedCategory('all')} 
              className="flex-shrink-0 group"
            >
              <div className="relative overflow-hidden w-36 md:w-44">
                <div className={`${selectedCategory === 'all' ? 'bg-[#3f9065]' : 'bg-[#F5F1E8] group-hover:bg-[#3f9065]'} rounded-t-full rounded-b-3xl pt-6 pb-14 px-4 transition-all duration-300`}>
                  <div className="flex justify-center mb-4">
                    <div className={`w-20 h-20 md:w-24 md:h-24 rounded-full flex items-center justify-center ${selectedCategory === 'all' ? 'bg-white/20' : 'bg-orange-100'} transition-all duration-300`}>
                      <span className={`text-lg md:text-xl font-bold ${selectedCategory === 'all' ? 'text-white' : 'text-orange-500 group-hover:text-white'} transition-colors duration-300`}>All</span>
                    </div>
                  </div>
                  <div className="text-center">
                    <h3 className={`font-semibold text-sm md:text-base transition-colors duration-300 ${selectedCategory === 'all' ? 'text-yellow-400' : 'text-gray-900 group-hover:text-white'}`}>All Items</h3>
                    <p className={`text-xs mt-0.5 transition-colors duration-300 ${selectedCategory === 'all' ? 'text-white/80' : 'text-gray-400 group-hover:text-white/80'}`}>{getTotalItemsCount()} Items</p>
                  </div>
                </div>
                <img 
                  src="/cat-1-bottom.png" 
                  alt="" 
                  className="absolute -bottom-2 left-0 right-0 w-full h-auto pointer-events-none"
                />
              </div>
            </button>

            {/* Category Items */}
            {categories.filter(cat => cat.isActive && !cat.isPaused).map(cat => {
              const itemCount = getCategoryItemCount(cat.name);
              
              return (
                <button 
                  key={cat._id} 
                  onClick={() => setSelectedCategory(cat.name)} 
                  className="flex-shrink-0 group"
                >
                  <div className="relative overflow-hidden w-36 md:w-44">
                    <div className={`${selectedCategory === cat.name ? 'bg-[#3f9065]' : 'bg-[#F5F1E8] group-hover:bg-[#3f9065]'} rounded-t-full rounded-b-3xl pt-6 pb-14 px-4 transition-all duration-300`}>
                      <div className="flex justify-center mb-4">
                        {cat.image ? (
                          <img 
                            src={cat.image} 
                            alt={cat.name} 
                            className="w-20 h-20 md:w-24 md:h-24 object-contain drop-shadow-lg transition-transform group-hover:scale-110"
                          />
                        ) : (
                          <div className="w-20 h-20 md:w-24 md:h-24 bg-orange-100 rounded-full flex items-center justify-center">
                            <span className="text-3xl">🍽️</span>
                          </div>
                        )}
                      </div>
                      <div className="text-center">
                        <h3 className={`font-semibold text-sm md:text-base transition-colors duration-300 line-clamp-1 ${selectedCategory === cat.name ? 'text-yellow-400' : 'text-gray-900 group-hover:text-white'}`}>{cat.name}</h3>
                        <p className={`text-xs mt-0.5 transition-colors duration-300 ${selectedCategory === cat.name ? 'text-white/80' : 'text-gray-400 group-hover:text-white/80'}`}>{itemCount} Items</p>
                      </div>
                    </div>
                    <img 
                      src="/cat-1-bottom.png" 
                      alt="" 
                      className="absolute -bottom-2 left-0 right-0 w-full h-auto pointer-events-none"
                    />
                  </div>
                </button>
              );
            })}
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
            className="relative bg-white rounded-2xl sm:rounded-3xl w-full max-w-md lg:max-w-4xl max-h-[90vh] lg:max-h-[80vh] overflow-hidden shadow-2xl flex flex-col lg:flex-row"
            style={{ overscrollBehavior: 'contain', touchAction: 'pan-y' }}
            data-lenis-prevent
            onClick={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
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
              {selectedItem.foodType && (
                <div className="absolute top-3 left-3">
                  <FoodTypeBadge type={selectedItem.foodType} size="lg" />
                </div>
              )}
            </div>

            {/* Right Side - Details (PC) / Bottom (Mobile) */}
            <div className="flex-1 overflow-y-auto scrollbar-dialog p-5 sm:p-6 lg:p-8">
              {/* Name & Price */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900">{selectedItem.name}</h2>
                <div className="text-xl sm:text-2xl lg:text-3xl font-bold text-orange-500 whitespace-nowrap">
                  ₹{selectedItem.price}
                </div>
              </div>

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
