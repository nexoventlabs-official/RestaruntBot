import { Outlet, Link, useLocation } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useCart } from '../hooks/useCart';
import CartSidebar from './CartSidebar';
import WhatsAppFloat from './WhatsAppFloat';
import OfferPopup from './OfferPopup';
import { 
  HeartIcon, CartIcon, MenuIcon, CloseIcon, 
  HomeIcon, FoodIcon, InfoIcon, PhoneIcon, SearchIcon 
} from './Icons';

const WHATSAPP_NUMBER = '15551858897';
const API_URL = 'https://restaruntbot.onrender.com/api/public';
const SSE_URL = 'https://restaruntbot.onrender.com/api/events';

const navLinks = [
  { path: '/', label: 'Home', icon: HomeIcon },
  { path: '/menu', label: 'Menu', icon: FoodIcon },
  { path: '/about', label: 'About', icon: InfoIcon },
  { path: '/contact', label: 'Contact', icon: PhoneIcon },
];

export default function UserLayout() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('cart');
  const [scrolled, setScrolled] = useState(false);
  const [availableItems, setAvailableItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const eventSourceRef = useRef(null);

  const { 
    cart, wishlist, cartTotal, cartCount, 
    addToCart, removeFromCart, updateQuantity, clearCart, 
    addToWishlist, removeFromWishlist, isInWishlist, isInCart 
  } = useCart();

  // Fetch available items and categories
  const loadAvailableItems = async () => {
    try {
      const [catRes, itemRes] = await Promise.all([
        axios.get(`${API_URL}/categories`),
        axios.get(`${API_URL}/menu`)
      ]);
      setCategories(catRes.data);
      
      // Filter items based on active categories
      const activeCategoryNames = catRes.data
        .filter(cat => cat.isActive && !cat.isPaused)
        .map(cat => cat.name);
      
      const available = itemRes.data.filter(item => {
        const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
        return itemCategories.some(cat => activeCategoryNames.includes(cat));
      });
      
      setAvailableItems(available);
    } catch (err) {
      console.error('Error loading available items:', err);
    }
  };

  // Setup SSE for real-time updates
  const setupSSE = () => {
    try {
      eventSourceRef.current = new EventSource(SSE_URL);
      eventSourceRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'menu') loadAvailableItems();
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

  // Load available items on mount and setup SSE
  useEffect(() => {
    loadAvailableItems();
    setupSSE();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

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
      <footer 
        className="text-white relative bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/footer.jpg')" }}
      >
        {/* Dark Overlay */}
        <div className="absolute inset-0 bg-black/70" />
        
        {/* Left Decorative Image */}
        <img 
          src="/footer-left.png" 
          alt="" 
          className="absolute left-0 bottom-0 h-full max-h-[400px] object-contain pointer-events-none opacity-60 hidden lg:block" 
        />

        <div className="relative max-w-7xl mx-auto px-4 py-16">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            {/* Brand */}
            <div className="md:col-span-2">
              <Link to="/" className="flex items-center gap-2 mb-4">
                <div className="w-12 h-12 bg-orange-500 rounded-xl flex items-center justify-center shadow-lg">
                  <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                  </svg>
                </div>
                <span className="text-2xl font-bold">FoodieSpot</span>
              </Link>
              <p className="text-gray-300 mb-6 max-w-md leading-relaxed">
                Delicious food delivered fresh to your doorstep. Experience the best flavors from our kitchen with love and care.
              </p>
              {/* Social Icons */}
              <div className="flex items-center gap-3">
                <a href="#" className="w-10 h-10 bg-white/10 hover:bg-orange-500 rounded-full flex items-center justify-center transition-all">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                  </svg>
                </a>
                <a href="#" className="w-10 h-10 bg-white/10 hover:bg-orange-500 rounded-full flex items-center justify-center transition-all">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                  </svg>
                </a>
                <a href="#" className="w-10 h-10 bg-white/10 hover:bg-orange-500 rounded-full flex items-center justify-center transition-all">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/>
                  </svg>
                </a>
              </div>
            </div>

            {/* Quick Links */}
            <div>
              <h3 className="font-semibold text-lg mb-4 text-orange-400">Quick Links</h3>
              <ul className="space-y-3">
                {navLinks.map(link => (
                  <li key={link.path}>
                    <Link to={link.path} className="text-gray-300 hover:text-orange-400 transition-colors flex items-center gap-2">
                      <svg className="w-3 h-3 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Contact */}
            <div>
              <h3 className="font-semibold text-lg mb-4 text-orange-400">Contact Us</h3>
              <ul className="space-y-3 text-gray-300">
                <li className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-orange-500/20 rounded-lg flex items-center justify-center">
                    <PhoneIcon className="w-4 h-4 text-orange-400" />
                  </div>
                  +1 555-185-8897
                </li>
                <li className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-orange-500/20 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  10 AM - 10 PM
                </li>
                <li className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-orange-500/20 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  123 Food Street, City
                </li>
              </ul>
            </div>
          </div>

          {/* Bottom Bar */}
          <div className="border-t border-white/10 mt-12 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-gray-400 text-sm">
              © 2026 <span className="text-orange-400">FoodieSpot</span>. All rights reserved.
            </p>
            <div className="flex items-center gap-6 text-sm text-gray-400">
              <a href="#" className="hover:text-orange-400 transition-colors">Privacy Policy</a>
              <a href="#" className="hover:text-orange-400 transition-colors">Terms of Service</a>
            </div>
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
