import { useState, useEffect } from 'react';
import axios from 'axios';
import { Clock, Star, ShoppingCart, Heart, MessageCircle, Plus, Minus } from 'lucide-react';
import { useCart } from '../hooks/useCart';
import CartSidebar from '../components/CartSidebar';

const API_URL = 'https://restaruntbot.onrender.com/api/public';
const WHATSAPP_NUMBER = '15551858897';

export default function UserMenu() {
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [foodType, setFoodType] = useState('all');
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('cart');

  const { cart, wishlist, cartTotal, cartCount, addToCart, removeFromCart, updateQuantity, clearCart, addToWishlist, removeFromWishlist, isInWishlist, isInCart } = useCart();

  useEffect(() => { loadData(); }, []);
  useEffect(() => { loadItems(); }, [selectedCategory, foodType]);

  const loadData = async () => {
    try {
      const [catRes, itemRes] = await Promise.all([axios.get(`${API_URL}/categories`), axios.get(`${API_URL}/menu`)]);
      setCategories(catRes.data);
      setItems(itemRes.data);
    } catch (err) { console.error('Error loading data:', err); }
    finally { setLoading(false); }
  };

  const loadItems = async () => {
    setItemsLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedCategory !== 'all') params.append('category', selectedCategory);
      if (foodType !== 'all') params.append('foodType', foodType);
      const res = await axios.get(`${API_URL}/menu?${params}`);
      setItems(res.data);
    } catch (err) { console.error('Error loading items:', err); }
    finally { setItemsLoading(false); }
  };

  const handleOrderSingle = (item) => {
    const msg = encodeURIComponent(`Hi! I'd like to order:\n\n🍽️ *${item.name}*\n💰 Price: ₹${item.price}\n\nPlease confirm availability!`);
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`, '_blank');
  };

  const handleToggleWishlist = (item, e) => {
    e.stopPropagation();
    isInWishlist(item._id) ? removeFromWishlist(item._id) : addToWishlist(item);
  };

  const handleAddToCart = (item, e) => { e.stopPropagation(); addToCart(item); };

  const filteredCategories = [...new Set(items.flatMap(i => Array.isArray(i.category) ? i.category : [i.category]))];

  const MenuItemSkeleton = () => (
    <div className="bg-white rounded-2xl shadow-md overflow-hidden animate-pulse">
      <div className="h-44 bg-gray-200"></div>
      <div className="p-4">
        <div className="flex justify-between mb-2"><div className="h-5 w-24 bg-gray-200 rounded"></div><div className="h-5 w-12 bg-gray-200 rounded"></div></div>
        <div className="h-3 w-16 bg-gray-200 rounded mb-3"></div>
        <div className="h-4 w-full bg-gray-200 rounded mb-2"></div>
        <div className="h-4 w-3/4 bg-gray-200 rounded"></div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow-sm sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-4 py-4"><h1 className="text-2xl font-bold text-orange-600">🍽️ Our Menu</h1></div>
        </header>
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
            <MenuItemSkeleton /><MenuItemSkeleton /><MenuItemSkeleton /><MenuItemSkeleton />
            <MenuItemSkeleton /><MenuItemSkeleton /><MenuItemSkeleton /><MenuItemSkeleton />
          </div>
        </div>
      </div>
    );
  }

  const renderItemCard = (item) => {
    const inCart = isInCart(item._id);
    const cartItem = cart.find(c => c._id === item._id);
    return (
      <div key={item._id} className="bg-white rounded-2xl shadow-md overflow-hidden hover:shadow-lg transition-shadow group">
        <div className="h-44 bg-gray-100 relative overflow-hidden">
          {item.image ? <img src={item.image} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" /> : <div className="w-full h-full flex items-center justify-center"><span className="text-4xl">🍽️</span></div>}
          {item.foodType && <div className="absolute top-3 left-3"><span className={`w-5 h-5 rounded border-2 flex items-center justify-center ${item.foodType === 'veg' ? 'border-green-600 bg-white' : item.foodType === 'egg' ? 'border-yellow-500 bg-white' : 'border-red-600 bg-white'}`}><span className={`w-2.5 h-2.5 rounded-full ${item.foodType === 'veg' ? 'bg-green-600' : item.foodType === 'egg' ? 'bg-yellow-500' : 'bg-red-600'}`}></span></span></div>}
          <button onClick={(e) => handleToggleWishlist(item, e)} className="absolute top-3 right-3 p-2 bg-white/90 rounded-full shadow-md hover:bg-white transition-colors"><Heart className={`w-4 h-4 ${isInWishlist(item._id) ? 'fill-red-500 text-red-500' : 'text-gray-400'}`} /></button>
        </div>
        <div className="p-4">
          <div className="flex items-start justify-between gap-2 mb-1"><h3 className="font-semibold text-gray-900 line-clamp-1">{item.name}</h3><span className="text-orange-600 font-bold whitespace-nowrap">₹{item.price}</span></div>
          <p className="text-xs text-gray-400 mb-2">{item.quantity || 1} {item.unit || 'piece'}</p>
          {item.description && <p className="text-sm text-gray-500 line-clamp-2 mb-3">{item.description}</p>}
          <div className="flex items-center justify-between text-xs text-gray-400 mb-3">
            <div className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /><span>{item.preparationTime || 15} min</span></div>
            {item.totalRatings > 0 ? <div className="flex items-center gap-1"><Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" /><span className="font-medium text-gray-700">{item.avgRating}</span><span>({item.totalRatings})</span></div> : <div className="flex items-center gap-1 text-gray-300"><Star className="w-3.5 h-3.5" /><span>No ratings</span></div>}
          </div>
          <div className="flex gap-2">
            {inCart ? (
              <div className="flex-1 flex items-center justify-center gap-2 bg-orange-50 rounded-lg py-2">
                <button onClick={(e) => { e.stopPropagation(); updateQuantity(item._id, cartItem.quantity - 1); }} className="p-1 bg-white rounded-full shadow hover:bg-gray-50"><Minus className="w-4 h-4 text-orange-600" /></button>
                <span className="w-6 text-center font-semibold text-orange-600">{cartItem?.quantity || 0}</span>
                <button onClick={(e) => { e.stopPropagation(); addToCart(item); }} className="p-1 bg-white rounded-full shadow hover:bg-gray-50"><Plus className="w-4 h-4 text-orange-600" /></button>
              </div>
            ) : <button onClick={(e) => handleAddToCart(item, e)} className="flex-1 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 transition-colors flex items-center justify-center gap-1"><Plus className="w-4 h-4" />Add</button>}
            <button onClick={() => handleOrderSingle(item)} className="p-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors" title="Order via WhatsApp"><MessageCircle className="w-5 h-5" /></button>
          </div>
        </div>
      </div>
    );
  };


  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-orange-600">🍽️ Our Menu</h1>
          <div className="flex items-center gap-3">
            <button onClick={() => { setActiveTab('wishlist'); setSidebarOpen(true); }} className="relative p-2 hover:bg-gray-100 rounded-full transition-colors">
              <Heart className={`w-6 h-6 ${wishlist.length > 0 ? 'fill-red-500 text-red-500' : 'text-gray-600'}`} />
              {wishlist.length > 0 && <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">{wishlist.length}</span>}
            </button>
            <button onClick={() => { setActiveTab('cart'); setSidebarOpen(true); }} className="relative p-2 hover:bg-gray-100 rounded-full transition-colors">
              <ShoppingCart className="w-6 h-6 text-gray-600" />
              {cartCount > 0 && <span className="absolute -top-1 -right-1 w-5 h-5 bg-orange-500 text-white text-xs rounded-full flex items-center justify-center">{cartCount}</span>}
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center gap-1 bg-white rounded-xl p-1 shadow-md w-fit flex-wrap">
          <button onClick={() => setFoodType('all')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${foodType === 'all' ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>All</button>
          <button onClick={() => setFoodType('veg')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${foodType === 'veg' ? 'bg-green-500 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
            <span className={`w-3 h-3 rounded border-2 flex items-center justify-center ${foodType === 'veg' ? 'border-white' : 'border-green-600'}`}><span className={`w-1.5 h-1.5 rounded-full ${foodType === 'veg' ? 'bg-white' : 'bg-green-600'}`}></span></span>Veg
          </button>
          <button onClick={() => setFoodType('nonveg')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${foodType === 'nonveg' ? 'bg-red-500 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
            <span className={`w-3 h-3 rounded border-2 flex items-center justify-center ${foodType === 'nonveg' ? 'border-white' : 'border-red-600'}`}><span className={`w-1.5 h-1.5 rounded-full ${foodType === 'nonveg' ? 'bg-white' : 'bg-red-600'}`}></span></span>Non-Veg
          </button>
          <button onClick={() => setFoodType('egg')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${foodType === 'egg' ? 'bg-yellow-500 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
            <span className={`w-3 h-3 rounded border-2 flex items-center justify-center ${foodType === 'egg' ? 'border-white' : 'border-yellow-500'}`}><span className="w-1.5 h-1.5 rounded-full bg-yellow-500"></span></span>Egg
          </button>
        </div>

        <div className="bg-white rounded-xl p-4 shadow-md">
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
            <button onClick={() => setSelectedCategory('all')} className="flex flex-col items-center min-w-[80px] transition-all">
              <div className="w-16 h-16 rounded-full overflow-hidden mb-2">
                <div className={`w-full h-full flex items-center justify-center ${selectedCategory === 'all' ? 'bg-gradient-to-br from-orange-400 to-orange-600' : 'bg-gray-200'}`}>
                  <span className={`text-xl font-bold ${selectedCategory === 'all' ? 'text-white' : 'text-gray-500'}`}>All</span>
                </div>
              </div>
              <span className={`text-sm font-medium ${selectedCategory === 'all' ? 'text-orange-600' : 'text-gray-600'}`}>All Items</span>
              {selectedCategory === 'all' && <div className="w-8 h-1 bg-orange-500 rounded-full mt-1"></div>}
            </button>
            {categories.map(cat => (
              <button key={cat._id} onClick={() => setSelectedCategory(cat.name)} className="flex flex-col items-center min-w-[80px] transition-all">
                <div className="w-16 h-16 rounded-full overflow-hidden mb-2 bg-gray-100">
                  {cat.image ? <img src={cat.image} alt={cat.name} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-gray-200 flex items-center justify-center"><span className="text-gray-400 text-xl">🍽️</span></div>}
                </div>
                <span className={`text-sm font-medium ${selectedCategory === cat.name ? 'text-orange-600' : 'text-gray-600'}`}>{cat.name}</span>
                {selectedCategory === cat.name && <div className="w-8 h-1 bg-orange-500 rounded-full mt-1"></div>}
              </button>
            ))}
          </div>
        </div>

        <div className={`space-y-8 transition-opacity duration-300 ${itemsLoading ? 'opacity-50' : 'opacity-100'}`}>
          {itemsLoading && <div className="flex justify-center py-8"><div className="w-8 h-8 border-3 border-orange-500 border-t-transparent rounded-full animate-spin"></div></div>}
          {!itemsLoading && (selectedCategory !== 'all' ? [selectedCategory] : filteredCategories).map(cat => {
            const itemsInCategory = items.filter(i => (Array.isArray(i.category) ? i.category : [i.category]).includes(cat));
            if (itemsInCategory.length === 0) return null;
            return (
              <div key={cat}>
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="text-lg font-bold text-gray-900">{cat}</h2>
                  <span className="px-2.5 py-1 bg-gray-100 rounded-full text-xs font-medium text-gray-500">{itemsInCategory.length} items</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
                  {itemsInCategory.map(renderItemCard)}
                </div>
              </div>
            );
          })}
          {!itemsLoading && filteredCategories.length === 0 && (
            <div className="bg-white rounded-2xl shadow-md p-12 text-center">
              <span className="text-6xl mb-4 block">🍽️</span>
              <h3 className="text-lg font-semibold text-gray-700">No items found</h3>
              <p className="text-gray-400 mt-1">Try a different filter</p>
            </div>
          )}
        </div>
      </div>

      {cartCount > 0 && (
        <button onClick={() => { setActiveTab('cart'); setSidebarOpen(true); }} className="fixed bottom-6 right-6 bg-orange-500 text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-2 hover:bg-orange-600 transition-colors md:hidden z-40">
          <ShoppingCart className="w-5 h-5" /><span className="font-semibold">{cartCount} items</span><span className="font-bold">₹{cartTotal}</span>
        </button>
      )}

      <CartSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} activeTab={activeTab} setActiveTab={setActiveTab} cart={cart} wishlist={wishlist} cartTotal={cartTotal} cartCount={cartCount} updateQuantity={updateQuantity} removeFromCart={removeFromCart} clearCart={clearCart} addToCart={addToCart} removeFromWishlist={removeFromWishlist} whatsappNumber={WHATSAPP_NUMBER} />

      <footer className="bg-white border-t mt-8 py-6">
        <div className="max-w-6xl mx-auto px-4 text-center text-gray-500 text-sm"><p>Order via WhatsApp for delivery! 📱</p></div>
      </footer>
    </div>
  );
}
