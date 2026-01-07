import { useState, useEffect } from 'react';
import axios from 'axios';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

const API_URL = 'https://restaruntbot.onrender.com/api/public';

export default function OfferPopup() {
  const [offers, setOffers] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    const hasSeenOffers = sessionStorage.getItem('hasSeenAllOffers');
    if (!hasSeenOffers) {
      loadPopupOffers();
    }
  }, []);

  const loadPopupOffers = async () => {
    try {
      const res = await axios.get(`${API_URL}/offers`);
      // Get all active offers, sorted by most recent first
      const activeOffers = res.data.filter(o => o.isActive);
      if (activeOffers.length > 0) {
        setOffers(activeOffers);
        setCurrentIndex(0);
        setTimeout(() => setIsVisible(true), 1500);
      }
    } catch (err) {
      console.error('Error loading popup offers:', err);
    }
  };

  const handleClose = () => {
    // If there are more offers, show the next one
    if (currentIndex < offers.length - 1) {
      setIsClosing(true);
      setTimeout(() => {
        setCurrentIndex(prev => prev + 1);
        setIsClosing(false);
      }, 300);
    } else {
      // All offers seen, close popup
      setIsClosing(true);
      setTimeout(() => {
        setIsVisible(false);
        setOffers([]);
        sessionStorage.setItem('hasSeenAllOffers', 'true');
      }, 300);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setIsClosing(true);
      setTimeout(() => {
        setCurrentIndex(prev => prev - 1);
        setIsClosing(false);
      }, 200);
    }
  };

  const handleNext = () => {
    if (currentIndex < offers.length - 1) {
      setIsClosing(true);
      setTimeout(() => {
        setCurrentIndex(prev => prev + 1);
        setIsClosing(false);
      }, 200);
    }
  };

  if (offers.length === 0 || !isVisible) return null;

  const currentOffer = offers[currentIndex];

  return (
    <div 
      className={`fixed inset-0 z-[100] flex items-center justify-center p-8 transition-all duration-300 ${
        isClosing ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />
      
      {/* Popup Container */}
      <div 
        className={`relative flex flex-col items-center transform transition-all duration-300 ${
          isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100'
        }`}
      >
        {/* Image Container */}
        <div className="relative">
          {/* Close Button */}
          <button
            onClick={handleClose}
            className="absolute -top-4 -right-4 z-20 bg-white hover:bg-gray-100 text-gray-700 p-2.5 rounded-full shadow-xl transition-all hover:scale-110"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Navigation Arrows - Only show if multiple offers */}
          {offers.length > 1 && (
            <>
              {currentIndex > 0 && (
                <button
                  onClick={handlePrev}
                  className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-14 z-10 bg-white hover:bg-gray-100 text-gray-700 p-2.5 rounded-full shadow-xl transition-all hover:scale-110"
                  aria-label="Previous"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
              )}
              {currentIndex < offers.length - 1 && (
                <button
                  onClick={handleNext}
                  className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-14 z-10 bg-white hover:bg-gray-100 text-gray-700 p-2.5 rounded-full shadow-xl transition-all hover:scale-110"
                  aria-label="Next"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              )}
            </>
          )}

          {/* Offer Image */}
          <div className="rounded-2xl overflow-hidden shadow-2xl">
            <img 
              src={currentOffer.image} 
              alt="Special Offer"
              style={{ maxWidth: '85vw', maxHeight: '70vh', width: 'auto', height: 'auto' }}
              className="block"
            />
          </div>
        </div>

        {/* Dots Indicator - Only show if multiple offers */}
        {offers.length > 1 && (
          <div className="flex justify-center gap-2 mt-4">
            {offers.map((_, index) => (
              <button
                key={index}
                onClick={() => {
                  setIsClosing(true);
                  setTimeout(() => {
                    setCurrentIndex(index);
                    setIsClosing(false);
                  }, 200);
                }}
                className={`w-2.5 h-2.5 rounded-full transition-all ${
                  index === currentIndex 
                    ? 'bg-white w-6' 
                    : 'bg-white/50 hover:bg-white/70'
                }`}
                aria-label={`Go to offer ${index + 1}`}
              />
            ))}
          </div>
        )}

        {/* Counter */}
        {offers.length > 1 && (
          <p className="text-center text-white/80 text-sm mt-2">
            {currentIndex + 1} of {offers.length} offers
          </p>
        )}
      </div>
    </div>
  );
}
