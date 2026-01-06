import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { CloseIcon, TagIcon } from './Icons';

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
      const res = await axios.get(`${API_URL}/popup-offers`);
      if (res.data) {
        setOffer(res.data);
        setTimeout(() => setIsVisible(true), 1000);
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
      
      {/* Popup Card */}
      <div 
        className={`relative bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden transform transition-all duration-300 ${
          isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100'
        }`}
      >
        {/* Close Button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 z-10 bg-white/90 hover:bg-white text-gray-700 p-2 rounded-full shadow-lg transition-all hover:scale-110"
          aria-label="Close offer"
        >
          <CloseIcon className="w-5 h-5" />
        </button>

        {/* Offer Image */}
        <div className="relative h-48 md:h-56 overflow-hidden">
          <img 
            src={offer.image} 
            alt={offer.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
          
          {/* Discount Badge */}
          {offer.discountType !== 'none' && offer.discountValue > 0 && (
            <div className="absolute top-4 left-4 bg-red-500 text-white px-3 py-1 rounded-full text-sm font-bold flex items-center gap-1">
              <TagIcon className="w-4 h-4" />
              {offer.discountType === 'percentage' ? `${offer.discountValue}% OFF` : `₹${offer.discountValue} OFF`}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{offer.title}</h2>
          
          {offer.description && (
            <p className="text-gray-600 mb-4">{offer.description}</p>
          )}

          {/* Offer Code */}
          {offer.code && (
            <div className="bg-orange-50 border-2 border-dashed border-orange-300 rounded-xl p-3 mb-4">
              <p className="text-xs text-gray-500 mb-1">Use code</p>
              <p className="text-lg font-bold text-orange-600 tracking-wider">{offer.code}</p>
            </div>
          )}

          {/* Min Order */}
          {offer.minOrderAmount > 0 && (
            <p className="text-sm text-gray-500 mb-4">
              *Minimum order: ₹{offer.minOrderAmount}
            </p>
          )}

          {/* CTA Button */}
          <Link
            to={offer.buttonLink || '/menu'}
            onClick={handleClose}
            className="block w-full bg-gradient-to-r from-orange-500 to-orange-600 text-white text-center py-3 rounded-xl font-semibold hover:from-orange-600 hover:to-orange-700 transition-all shadow-lg hover:shadow-xl"
          >
            {offer.buttonText || 'Order Now'}
          </Link>

          {/* Valid Until */}
          {offer.validUntil && (
            <p className="text-xs text-gray-400 text-center mt-3">
              Valid until {new Date(offer.validUntil).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
