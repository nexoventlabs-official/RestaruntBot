import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';

const API_URL = 'https://restaruntbot.onrender.com/api/public';

// SVG Icons
const Icons = {
  Star: ({ filled, size = 'w-8 h-8' }) => (
    <svg className={`${size} ${filled ? 'text-amber-400 fill-amber-400' : 'text-gray-200 fill-gray-200'} transition-all`} viewBox="0 0 24 24">
      <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
    </svg>
  ),
  Back: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>,
  Check: () => <svg className="w-16 h-16 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  Sad: () => <svg className="w-16 h-16 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  Delivery: () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>,
};

export default function Review() {
  const { phone, orderId } = useParams();
  const [order, setOrder] = useState(null);
  const [ratings, setRatings] = useState({});
  const [deliveryRating, setDeliveryRating] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { loadOrder(); }, [phone, orderId]);

  const loadOrder = async () => {
    try {
      const res = await axios.get(`${API_URL}/review/${phone}/${orderId}`);
      setOrder(res.data);
      const existingRatings = {};
      res.data.items.forEach(item => {
        if (item.existingRating) existingRatings[item.menuItemId] = item.existingRating;
      });
      setRatings(existingRatings);
      if (res.data.deliveryPartner?.existingRating) setDeliveryRating(res.data.deliveryPartner.existingRating);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load order');
    } finally {
      setLoading(false);
    }
  };

  const handleRating = (menuItemId, rating) => setRatings(prev => ({ ...prev, [menuItemId]: rating }));

  const handleSubmit = async () => {
    const ratingsArray = Object.entries(ratings).map(([menuItemId, rating]) => ({ menuItemId, rating }));
    if (ratingsArray.length === 0 && !deliveryRating) {
      alert('Please rate at least one item or the delivery partner');
      return;
    }
    setSubmitting(true);
    try {
      await axios.post(`${API_URL}/review/${phone}/${orderId}`, { ratings: ratingsArray, deliveryRating: deliveryRating || null });
      setSubmitted(true);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to submit review');
    } finally {
      setSubmitting(false);
    }
  };

  const StarRating = ({ itemId, isDelivery = false }) => {
    const currentRating = isDelivery ? deliveryRating : (ratings[itemId] || 0);
    return (
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map(star => (
          <button key={star} onClick={() => isDelivery ? setDeliveryRating(star) : handleRating(itemId, star)} className="transition-transform hover:scale-125 active:scale-95">
            <Icons.Star filled={star <= currentRating} />
          </button>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-amber-800 font-medium">Loading your order...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-xl p-8 max-w-md w-full text-center">
          <Icons.Sad />
          <h2 className="text-2xl font-bold text-gray-800 mt-4 mb-2">Order Not Found</h2>
          <p className="text-gray-500 mb-6">{error}</p>
          <Link to="/" className="inline-block bg-gradient-to-r from-amber-500 to-orange-500 text-white px-8 py-3 rounded-xl font-semibold hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg">
            View Our Menu
          </Link>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Icons.Check />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Thank You!</h2>
          <p className="text-gray-500 mb-6">Your feedback helps us serve you better!</p>
          <Link to="/" className="inline-block bg-gradient-to-r from-amber-500 to-orange-500 text-white px-8 py-3 rounded-xl font-semibold hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg">
            Order Again
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-lg sticky top-0 z-50 border-b border-amber-100">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <Link to="/" className="inline-flex items-center gap-2 text-amber-600 hover:text-amber-700 text-sm font-medium">
            <Icons.Back /> Back to Menu
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">Rate Your Order</h1>
          <p className="text-amber-600 text-sm font-medium">Order #{order.orderId}</p>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Order Summary */}
        <div className="bg-white rounded-2xl shadow-sm p-5 border border-amber-100">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm text-gray-500">Delivered on</p>
              <p className="font-semibold text-gray-800">{new Date(order.deliveredAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">Total Amount</p>
              <p className="text-2xl font-bold text-amber-600">₹{order.totalAmount}</p>
            </div>
          </div>
        </div>

        {/* Delivery Partner Rating */}
        {order.deliveryPartner && (
          <div className="bg-white rounded-2xl shadow-sm p-5 border border-amber-100">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center text-amber-600">
                <Icons.Delivery />
              </div>
              <h3 className="font-semibold text-gray-800">Rate Your Delivery Partner</h3>
            </div>
            <div className="flex gap-4 items-center">
              <div className="w-20 h-20 rounded-2xl bg-amber-50 overflow-hidden flex-shrink-0 border-2 border-amber-100">
                {order.deliveryPartner.photo ? (
                  <img src={order.deliveryPartner.photo} alt={order.deliveryPartner.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-amber-400 text-3xl">
                    <Icons.Delivery />
                  </div>
                )}
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-gray-800 text-lg">{order.deliveryPartner.name}</h4>
                {order.deliveryPartner.avgRating > 0 && (
                  <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
                    <Icons.Star filled size="w-4 h-4" />
                    <span>{order.deliveryPartner.avgRating}</span>
                    <span className="text-gray-400">({order.deliveryPartner.totalRatings} reviews)</span>
                  </div>
                )}
                <div className="mt-3">
                  <StarRating isDelivery={true} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Items to Rate */}
        <div>
          <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <span className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center text-amber-600">🍽️</span>
            Rate Your Food
          </h3>
          <div className="space-y-4">
            {order.items.map(item => (
              <div key={item.menuItemId} className="bg-white rounded-2xl shadow-sm p-5 border border-amber-100">
                <div className="flex gap-4">
                  <div className="w-24 h-24 rounded-xl bg-amber-50 overflow-hidden flex-shrink-0">
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-3xl">🍽️</div>
                    )}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-800">{item.name}</h3>
                    <p className="text-sm text-gray-500">{item.quantity} × ₹{item.price}</p>
                    {item.avgRating > 0 && (
                      <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
                        <Icons.Star filled size="w-4 h-4" />
                        <span>{item.avgRating}</span>
                        <span className="text-gray-400">({item.totalRatings})</span>
                      </div>
                    )}
                    <div className="mt-3">
                      <StarRating itemId={item.menuItemId} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Submit Button */}
        <div className="pb-8">
          <button onClick={handleSubmit} disabled={submitting || (Object.keys(ratings).length === 0 && !deliveryRating)} className={`w-full py-4 rounded-2xl font-semibold text-white transition-all shadow-lg ${submitting || (Object.keys(ratings).length === 0 && !deliveryRating) ? 'bg-gray-300 cursor-not-allowed' : 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-amber-200'}`}>
            {submitting ? 'Submitting...' : 'Submit Review'}
          </button>
          <p className="text-center text-sm text-gray-400 mt-3">
            {Object.keys(ratings).length} of {order.items.length} items rated
            {order.deliveryPartner && (deliveryRating ? ' • Delivery rated ✓' : '')}
          </p>
        </div>
      </div>
    </div>
  );
}
