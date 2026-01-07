import { useState, useEffect } from 'react';
import axios from 'axios';
import { X } from 'lucide-react';

const API_URL = 'https://restaruntbot.onrender.com/api/public';

export default function OfferPopup() {
  const [offer, setOffer] = useState(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    const hasSeenOffer = sessionStorage.getItem('hasSeenOffer');
    if (!hasSeenOffer) {
      loadPopupOffer();
    }
  }, []);

  const loadPopupOffer = async () => {
    try {
      const res = await axios.get(`${API_URL}/offers`);
      // Get first active offer
      const activeOffer = res.data.find(o => o.isActive);
      if (activeOffer) {
        setOffer(activeOffer);
        setTimeout(() => setIsVisible(true), 1500);
      }
    } catch (err) {
      console.error('Error loading popup offer:', err);
    }
  };

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsVisible(false);
      setOffer(null);
      sessionStorage.setItem('hasSeenOffer', 'true');
    }, 300);
  };

  if (!offer || !isVisible) return null;

  return (
    <div 
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4 transition-all duration-300 ${
        isClosing ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />
      
      {/* Popup - Just the image with close button */}
      <div 
        className={`relative max-w-sm w-full transform transition-all duration-300 ${
          isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100'
        }`}
      >
        {/* Close Button */}
        <button
          onClick={handleClose}
          className="absolute -top-3 -right-3 z-10 bg-white hover:bg-gray-100 text-gray-700 p-2 rounded-full shadow-xl transition-all hover:scale-110"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Offer Image Card */}
        <div className="rounded-2xl overflow-hidden shadow-2xl">
          <img 
            src={offer.image} 
            alt="Special Offer"
            className="w-full h-auto"
          />
        </div>
      </div>
    </div>
  );
}
