import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { useCart } from '../hooks/useCart';
import CartSidebar from '../components/CartSidebar';

const API_URL = 'https://restaruntbot.onrender.com/api';
const SSE_URL = 'https://restaruntbot.onrender.com/api/events';
const WHATSAPP_NUMBER = '15551858897';

// SVG Icons
const Icons = {
  Clock: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  Star: ({ filled }) => <svg className={`w-4 h-4 ${filled ? 'text-amber-400 fill-amber-400' : 'text-gray-300'}`} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>,
  Heart: ({ filled }) => <svg className={`w-5 h-5 ${filled ? 'text-red-500 fill-red-500' : 'text-gray-400'}`} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>,
  Cart: () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>,
  Plus: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>,
  Minus: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>,
  WhatsApp: () => <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>,
  X: () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>,
  ChevronLeft: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>,
  ChevronRight: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>,
  Search: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>,
  Menu: () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>,
};

// Food type indicator
const FoodTypeIndicator = ({ type }) => {
  const colors = { veg: 'border-green-600 bg-green-600', nonveg: 'border-red-600 bg-red-600', egg: 'border-amber-500 bg-amber-500' };
  return (
    <span className={`w-4 h-4 rounded border-2 flex items-center justify-center ${colors[type]?.split(' ')[0] || 'border-gray-400'} bg-white`}>
      <span className={`w-2 h-2 rounded-full ${colors[type]?.split(' ')[1] || 'bg-gray-400'}`}></span>
    </span>
  );
};

export default function UserMenu() {
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [banners, setBanners] = useState([]);
  const [offer, setOffer] = useState(null);
  const [showOffer, setShowOffer] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [foodType, setFoodType] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('cart');
  const [currentBanner, setCurrentBanner] = useState(0);
  const eventSourceRef = useRef(null);
  const bannerIntervalRef = useRef(null);

  const { cart, wishlist, cartTotal, cartCount, addToCart, removeFromCart, updateQuantity, clearCart, addToWishlist, removeFromWishlist, isInWishlist, isInCart } = useCart();

  useEffect(() => { 
    loadData(); 
    setupSSE();
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (bannerIntervalRef.current) clearInterval(bannerIntervalRef.current);
    };
  }, []);

  // Auto-rotate banners
  useEffect(() => {
    if (banners.length > 1) {
      bannerIntervalRef.current = setInterval(() => {
        setCurrentBanner(prev => (prev + 1) % banners.length);
      }, 3000);
    }
    return () => {
      if (bannerIntervalRef.current) clearInterval(bannerIntervalRef.current);
    };
  }, [banners.length]);

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
    } catch (e) {}
  };

  const loadData = async () => {
    try {
      const [catRes, itemRes, bannerRes, offerRes] = await Promise.all([
        axios.get(`${API_URL}/public/categories`),
        axios.get(`${API_URL}/public/menu`),
        axios.get(`${API_URL}/banners`),
        axios.get(`${API_URL}/offers/popup`)
      ]);
      setCategories(catRes.data);
      setItems(itemRes.data);
      setBanners(bannerRes.data);
      if (offerRes.data) {
        setOffer(offerRes.data);
        const dismissed = sessionStorage.getItem('offerDismissed');
        if (!dismissed) setShowOffer(true);
      }
    } catch (err) { console.error('Error loading data:', err); }
    finally { setLoading(false); }
  };

  const dismissOffer = () => {
    setShowOffer(false);
    sessionStorage.setItem('offerDismissed', 'true');
  };

  // Filter logic
  const activeCategoryNames = categories.filter(cat => cat.isActive && !cat.isPaused).map(cat => cat.name);
  const availableItems = items.filter(item => {
    const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
    return itemCategories.some(cat => activeCategoryNames.includes(cat));
  });
  const filteredCategories = [...new Set(availableItems.flatMap(i => Array.isArray(i.category) ? i.category : [i.category]))].filter(cat => activeCategoryNames.includes(cat));

  const isItemAvailable = (itemId) => {
    const item = items.find(i => i._id === itemId);
    if (!item) return false;
    const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
    return itemCategories.some(cat => activeCategoryNames.includes(cat));
  };

  const handleOrderSingle = (item) => {
    if (!isItemAvailable(item._id)) return;
    const cartItem = cart.find(c => c._id === item._id);
    const qty = cartItem?.quantity || 1;
    const msg = encodeURIComponent(`Hi! I'd like to order:\n\n🍽️ *${item.name}* x${qty}\n💰 Total: ₹${item.price * qty}\n\nPlease confirm!`);
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`, '_blank');
  };

  const displayedItems = availableItems.filter(item => {
    const matchesCategory = selectedCategory === 'all' || (Array.isArray(item.category) ? item.category : [item.category]).includes(selectedCategory);
    const matchesFoodType = foodType === 'all' || item.foodType === foodType;
    const matchesSearch = !searchTerm || item.name.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesFoodType && matchesSearch;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-amber-800 font-medium">Loading delicious menu...</p>
        </div>
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50/50 to-orange-50/50">
      {/* Offer Popup */}
      {showOffer && offer && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-3xl max-w-md w-full overflow-hidden shadow-2xl animate-scale-in">
            {offer.image && (
              <div className="aspect-[3/2] bg-amber-100">
                <img src={offer.image} alt={offer.title} className="w-full h-full object-cover" />
              </div>
            )}
            <div className="p-6 text-center">
              <h3 className="text-2xl font-bold text-gray-900">{offer.title}</h3>
              {offer.description && <p className="text-gray-600 mt-2">{offer.description}</p>}
              {offer.code && (
                <div className="mt-4 inline-block px-6 py-2 bg-amber-100 rounded-xl">
                  <span className="text-sm text-amber-700">Use code:</span>
                  <span className="ml-2 font-bold text-amber-900 font-mono">{offer.code}</span>
                </div>
              )}
              {offer.discount && <p className="mt-3 text-2xl font-bold text-amber-600">{offer.discount}</p>}
              <button onClick={dismissOffer} className="mt-6 w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-semibold hover:from-amber-600 hover:to-orange-600 transition-all">
                Start Ordering
              </button>
            </div>
            <button onClick={dismissOffer} className="absolute top-4 right-4 p-2 bg-white/90 rounded-full shadow-lg hover:bg-white transition">
              <Icons.X />
            </button>
          </div>
        </div>
      )}

      {/* Navbar */}
      <nav className="bg-white/80 backdrop-blur-lg sticky top-0 z-50 border-b border-amber-100">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl flex items-center justify-center shadow-lg">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Foodie</h1>
                <p className="text-xs text-amber-600">Fresh & Delicious</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button onClick={() => { setActiveTab('wishlist'); setSidebarOpen(true); }} className="relative p-2.5 hover:bg-amber-50 rounded-xl transition">
                <Icons.Heart filled={wishlist.length > 0} />
                {wishlist.length > 0 && <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-medium">{wishlist.length}</span>}
              </button>
              <button onClick={() => { setActiveTab('cart'); setSidebarOpen(true); }} className="relative p-2.5 hover:bg-amber-50 rounded-xl transition">
                <Icons.Cart />
                {cartCount > 0 && <span className="absolute -top-1 -right-1 w-5 h-5 bg-amber-500 text-white text-xs rounded-full flex items-center justify-center font-medium">{cartCount}</span>}
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Banners */}
      {banners.length > 0 && (
        <div className="relative overflow-hidden">
          <div className="flex transition-transform duration-500 ease-out" style={{ transform: `translateX(-${currentBanner * 100}%)` }}>
            {banners.map((banner, idx) => (
              <div key={banner._id} className="w-full flex-shrink-0">
                <div className="aspect-[3/1] md:aspect-[4/1] bg-amber-100">
                  <img src={banner.image} alt={banner.title || 'Banner'} className="w-full h-full object-cover" />
                </div>
              </div>
            ))}
          </div>
          {banners.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
              {banners.map((_, idx) => (
                <button key={idx} onClick={() => setCurrentBanner(idx)} className={`w-2 h-2 rounded-full transition-all ${idx === currentBanner ? 'bg-white w-6' : 'bg-white/50'}`} />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Icons.Search />
            <input type="text" placeholder="Search dishes..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-12 pr-4 py-3 bg-white rounded-2xl border border-amber-100 focus:border-amber-300 focus:ring-2 focus:ring-amber-100 transition-all" style={{ paddingLeft: '3rem' }} />
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"><Icons.Search /></div>
          </div>
          
          <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0">
            {[{ value: 'all', label: 'All' }, { value: 'veg', label: 'Veg', color: 'green' }, { value: 'nonveg', label: 'Non-Veg', color: 'red' }, { value: 'egg', label: 'Egg', color: 'amber' }].map(opt => (
              <button key={opt.value} onClick={() => setFoodType(opt.value)} className={`px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all flex items-center gap-2 ${foodType === opt.value ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg' : 'bg-white text-gray-600 hover:bg-amber-50 border border-amber-100'}`}>
                {opt.color && <FoodTypeIndicator type={opt.value} />}
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Categories */}
        <div className="mb-8">
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
            <button onClick={() => setSelectedCategory('all')} className={`flex flex-col items-center min-w-[80px] transition-all ${selectedCategory === 'all' ? 'scale-105' : ''}`}>
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-2 transition-all ${selectedCategory === 'all' ? 'bg-gradient-to-br from-amber-500 to-orange-500 shadow-lg' : 'bg-white border border-amber-100'}`}>
                <span className={`text-lg font-bold ${selectedCategory === 'all' ? 'text-white' : 'text-amber-600'}`}>All</span>
              </div>
              <span className={`text-xs font-medium ${selectedCategory === 'all' ? 'text-amber-600' : 'text-gray-500'}`}>All Items</span>
            </button>
            {categories.filter(cat => cat.isActive && !cat.isPaused).map(cat => (
              <button key={cat._id} onClick={() => setSelectedCategory(cat.name)} className={`flex flex-col items-center min-w-[80px] transition-all ${selectedCategory === cat.name ? 'scale-105' : ''}`}>
                <div className={`w-16 h-16 rounded-2xl overflow-hidden mb-2 transition-all ${selectedCategory === cat.name ? 'ring-2 ring-amber-500 ring-offset-2' : 'border border-amber-100'}`}>
                  {cat.image ? <img src={cat.image} alt={cat.name} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-amber-100 flex items-center justify-center text-amber-400 text-2xl">🍽️</div>}
                </div>
                <span className={`text-xs font-medium ${selectedCategory === cat.name ? 'text-amber-600' : 'text-gray-500'}`}>{cat.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Menu Items */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {displayedItems.map(item => {
            const inCart = isInCart(item._id);
            const cartItem = cart.find(c => c._id === item._id);
            const available = isItemAvailable(item._id);
            
            return (
              <div key={item._id} className={`bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 group ${!available ? 'opacity-60' : ''}`}>
                <div className="aspect-square bg-amber-50 relative overflow-hidden">
                  {item.image ? <img src={item.image} alt={item.name} className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ${!available ? 'grayscale' : ''}`} /> : <div className="w-full h-full flex items-center justify-center text-4xl">🍽️</div>}
                  {item.foodType && <div className="absolute top-3 left-3"><FoodTypeIndicator type={item.foodType} /></div>}
                  {!available && <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><span className="bg-red-500 text-white px-3 py-1 rounded-full text-sm font-medium">Unavailable</span></div>}
                  <button onClick={() => isInWishlist(item._id) ? removeFromWishlist(item._id) : addToWishlist(item)} className="absolute top-3 right-3 p-2 bg-white/90 backdrop-blur rounded-full shadow-lg hover:bg-white transition opacity-0 group-hover:opacity-100">
                    <Icons.Heart filled={isInWishlist(item._id)} />
                  </button>
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900 line-clamp-1 text-sm">{item.name}</h3>
                    <span className="text-amber-600 font-bold whitespace-nowrap">₹{item.price}</span>
                  </div>
                  <p className="text-xs text-gray-400 mb-2">{item.quantity || 1} {item.unit || 'piece'}</p>
                  <div className="flex items-center justify-between text-xs text-gray-400 mb-3">
                    <div className="flex items-center gap-1"><Icons.Clock /><span>{item.preparationTime || 15} min</span></div>
                    {item.totalRatings > 0 ? <div className="flex items-center gap-1"><Icons.Star filled /><span className="font-medium text-gray-700">{item.avgRating}</span></div> : <span className="text-gray-300">No ratings</span>}
                  </div>
                  <div className="flex gap-2">
                    {!available ? (
                      <div className="flex-1 py-2.5 bg-gray-100 text-gray-400 rounded-xl text-sm font-medium text-center">Unavailable</div>
                    ) : inCart ? (
                      <div className="flex-1 flex items-center justify-center gap-3 bg-amber-50 rounded-xl py-1.5">
                        <button onClick={() => updateQuantity(item._id, cartItem.quantity - 1)} className="p-1.5 bg-white rounded-lg shadow hover:bg-gray-50 transition"><Icons.Minus /></button>
                        <span className="w-6 text-center font-bold text-amber-600">{cartItem?.quantity || 0}</span>
                        <button onClick={() => addToCart(item)} className="p-1.5 bg-white rounded-lg shadow hover:bg-gray-50 transition"><Icons.Plus /></button>
                      </div>
                    ) : (
                      <button onClick={() => addToCart(item)} className="flex-1 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl text-sm font-medium hover:from-amber-600 hover:to-orange-600 transition-all flex items-center justify-center gap-1 shadow-lg shadow-amber-200">
                        <Icons.Plus /> Add
                      </button>
                    )}
                    <button onClick={() => handleOrderSingle(item)} disabled={!available} className={`p-2.5 rounded-xl transition-all ${available ? 'bg-green-500 text-white hover:bg-green-600 shadow-lg shadow-green-200' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
                      <Icons.WhatsApp />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {displayedItems.length === 0 && (
          <div className="text-center py-16">
            <div className="w-24 h-24 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-12 h-12 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-700">No items found</h3>
            <p className="text-gray-400 mt-1">Try adjusting your filters</p>
          </div>
        )}
      </div>

      {/* Floating WhatsApp Button */}
      <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer" className="fixed bottom-24 md:bottom-6 right-6 w-14 h-14 bg-green-500 rounded-full flex items-center justify-center shadow-2xl hover:bg-green-600 transition-all hover:scale-110 z-40">
        <Icons.WhatsApp />
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full animate-ping"></span>
      </a>

      {/* Floating Cart Button - Mobile */}
      {cartCount > 0 && (
        <button onClick={() => { setActiveTab('cart'); setSidebarOpen(true); }} className="md:hidden fixed bottom-6 left-4 right-20 bg-gradient-to-r from-amber-500 to-orange-500 text-white py-4 rounded-2xl shadow-2xl flex items-center justify-center gap-3 z-40">
          <Icons.Cart />
          <span className="font-semibold">{cartCount} items</span>
          <span className="font-bold">₹{cartTotal}</span>
        </button>
      )}

      <CartSidebar 
        isOpen={sidebarOpen} 
        onClose={() => setSidebarOpen(false)} 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        cart={cart} 
        wishlist={wishlist} 
        cartTotal={cartTotal} 
        cartCount={cartCount} 
        updateQuantity={updateQuantity} 
        removeFromCart={removeFromCart} 
        clearCart={clearCart} 
        addToCart={addToCart} 
        removeFromWishlist={removeFromWishlist} 
        whatsappNumber={WHATSAPP_NUMBER}
        availableItems={availableItems}
      />

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes scale-in { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .animate-scale-in { animation: scale-in 0.3s ease-out; }
      `}</style>
    </div>
  );
}
