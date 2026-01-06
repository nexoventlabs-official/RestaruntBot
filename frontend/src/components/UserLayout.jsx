import { Outlet, Link, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useCart } from '../hooks/useCart';
import CartSidebar from './CartSidebar';
import WhatsAppFloat from './WhatsAppFloat';
import OfferPopup from './OfferPopup';
import { 
  HeartIcon, CartIcon, MenuIcon, CloseIcon, 
  HomeIcon, FoodIcon, InfoIcon, PhoneIcon, SearchIcon 
} from './Icons';

const WHATSAPP_NUMBER = '15551858897';

const navLinks = [
  { path: '/', label: 'Home', icon: HomeIcon },
  { path: '/menu', label: 'Menu', icon: FoodIcon },
  { path: '/about', label: 'About', icon: InfoIcon },
  { path: '/contact', label: 'Contact', icon: PhoneIcon },
];

export default function UserLayout({ availableItems = [] }) {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('cart');
  const [scrolled, setScrolled] = useState(false);

  const { 
    cart, wishlist, cartTotal, cartCount, 
    addToCart, removeFromCart, updateQuantity, clearCart, 
    addToWishlist, removeFromWishlist, isInWishlist, isInCart 
  } = useCart();

  // Handle scroll for navbar background
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const isHomePage = location.pathname === '/';

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex flex-col">
      {/* Offer Popup */}
      <OfferPopup />

      {/* Header */}
      <header 
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled || !isHomePage
            ? 'bg-white shadow-md' 
            : 'bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-16 md:h-20">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 group">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                scrolled || !isHomePage ? 'bg-orange-500' : 'bg-white/20 backdrop-blur-sm'
              }`}>
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                </svg>
              </div>
              <span className={`text-xl font-bold transition-colors ${
                scrolled || !isHomePage ? 'text-gray-900' : 'text-white'
              }`}>
                FoodieSpot
              </span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-1">
              {navLinks.map(link => {
                const Icon = link.icon;
                const isActive = location.pathname === link.path;
                return (
                  <Link
                    key={link.path}
                    to={link.path}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-all ${
                      isActive
                        ? 'bg-orange-500 text-white'
                        : scrolled || !isHomePage
                          ? 'text-gray-600 hover:bg-gray-100'
                          : 'text-white/90 hover:bg-white/10'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {link.label}
                  </Link>
                );
              })}
            </nav>

            {/* Right Icons */}
            <div className="flex items-center gap-2">
              {/* Wishlist */}
              <button 
                onClick={() => { setActiveTab('wishlist'); setSidebarOpen(true); }} 
                className={`relative p-2.5 rounded-full transition-all ${
                  scrolled || !isHomePage
                    ? 'hover:bg-gray-100 text-gray-600'
                    : 'hover:bg-white/10 text-white'
                }`}
              >
                <HeartIcon className="w-6 h-6" filled={wishlist.length > 0} />
                {wishlist.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-medium">
                    {wishlist.length}
                  </span>
                )}
              </button>

              {/* Cart */}
              <button 
                onClick={() => { setActiveTab('cart'); setSidebarOpen(true); }} 
                className={`relative p-2.5 rounded-full transition-all ${
                  scrolled || !isHomePage
                    ? 'hover:bg-gray-100 text-gray-600'
                    : 'hover:bg-white/10 text-white'
                }`}
              >
                <CartIcon className="w-6 h-6" />
                {cartCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-orange-500 text-white text-xs rounded-full flex items-center justify-center font-medium">
                    {cartCount}
                  </span>
                )}
              </button>

              {/* Mobile Menu Button */}
              <button 
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className={`md:hidden p-2.5 rounded-full transition-all ${
                  scrolled || !isHomePage
                    ? 'hover:bg-gray-100 text-gray-600'
                    : 'hover:bg-white/10 text-white'
                }`}
              >
                {mobileMenuOpen ? <CloseIcon className="w-6 h-6" /> : <MenuIcon className="w-6 h-6" />}
              </button>
            </div>
          </div>

          {/* Mobile Navigation */}
          <div className={`md:hidden overflow-hidden transition-all duration-300 ${
            mobileMenuOpen ? 'max-h-64 pb-4' : 'max-h-0'
          }`}>
            <nav className={`flex flex-col gap-1 pt-2 border-t ${
              scrolled || !isHomePage ? 'border-gray-100' : 'border-white/20'
            }`}>
              {navLinks.map(link => {
                const Icon = link.icon;
                const isActive = location.pathname === link.path;
                return (
                  <Link
                    key={link.path}
                    to={link.path}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all ${
                      isActive
                        ? 'bg-orange-500 text-white'
                        : scrolled || !isHomePage
                          ? 'text-gray-600 hover:bg-gray-100'
                          : 'text-white/90 hover:bg-white/10'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        <Outlet context={{ 
          cart, wishlist, cartTotal, cartCount,
          addToCart, removeFromCart, updateQuantity, clearCart,
          addToWishlist, removeFromWishlist, isInWishlist, isInCart,
          setSidebarOpen, setActiveTab, availableItems
        }} />
      </main>

      {/* Footer */}
      <footer className="bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            {/* Brand */}
            <div className="md:col-span-2">
              <Link to="/" className="flex items-center gap-2 mb-4">
                <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                  </svg>
                </div>
                <span className="text-xl font-bold">FoodieSpot</span>
              </Link>
              <p className="text-gray-400 mb-4 max-w-md">
                Delicious food delivered fresh to your doorstep. Experience the best flavors from our kitchen.
              </p>
            </div>

            {/* Quick Links */}
            <div>
              <h3 className="font-semibold mb-4">Quick Links</h3>
              <ul className="space-y-2">
                {navLinks.map(link => (
                  <li key={link.path}>
                    <Link to={link.path} className="text-gray-400 hover:text-white transition-colors">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Contact */}
            <div>
              <h3 className="font-semibold mb-4">Contact Us</h3>
              <ul className="space-y-2 text-gray-400">
                <li className="flex items-center gap-2">
                  <PhoneIcon className="w-4 h-4" />
                  +1 555-185-8897
                </li>
                <li>Open: 10 AM - 10 PM</li>
              </ul>
            </div>
          </div>

          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-gray-500 text-sm">
            <p>© 2026 FoodieSpot. All rights reserved.</p>
          </div>
        </div>
      </footer>

      {/* WhatsApp Float */}
      <WhatsAppFloat />

      {/* Floating Cart Button - Mobile */}
      {cartCount > 0 && (
        <button 
          onClick={() => { setActiveTab('cart'); setSidebarOpen(true); }} 
          className="fixed bottom-6 right-6 bg-orange-500 text-white px-5 py-3 rounded-full shadow-lg flex items-center gap-2 hover:bg-orange-600 transition-all md:hidden z-40 hover:scale-105"
        >
          <CartIcon className="w-5 h-5" />
          <span className="font-semibold">{cartCount}</span>
          <span className="w-px h-4 bg-white/30" />
          <span className="font-bold">₹{cartTotal}</span>
        </button>
      )}

      {/* Cart Sidebar */}
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
    </div>
  );
}
