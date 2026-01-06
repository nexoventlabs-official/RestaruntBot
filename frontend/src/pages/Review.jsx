import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';

const API_URL = 'https://restaruntbot.onrender.com/api/public';

export default function Review() {
  const { phone, orderId } = useParams();
  const [order, setOrder] = useState(null);
  const [ratings, setRatings] = useState({});
  const [deliveryRating, setDeliveryRating] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadOrder();
  }, [phone, orderId]);

  const loadOrder = async () => {
    try {
      const res = await axios.get(`${API_URL}/review/${phone}/${orderId}`);
      setOrder(res.data);
      // Pre-fill existing ratings
      const existingRatings = {};
      res.data.items.forEach(item => {
        if (item.existingRating) {
          existingRatings[item.menuItemId] = item.existingRating;
        }
      });
      setRatings(existingRatings);
      // Pre-fill delivery partner rating if exists
      if (res.data.deliveryPartner?.existingRating) {
        setDeliveryRating(res.data.deliveryPartner.existingRating);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load order');
    } finally {
      setLoading(false);
    }
  };

  const handleRating = (menuItemId, rating) => {
    setRatings(prev => ({ ...prev, [menuItemId]: rating }));
  };

  const handleSubmit = async () => {
    const ratingsArray = Object.entries(ratings).map(([menuItemId, rating]) => ({
      menuItemId,
      rating
    }));

    if (ratingsArray.length === 0 && !deliveryRating) {
      alert('Please rate at least one item or the delivery partner');
      return;
    }

    setSubmitting(true);
    try {
      await axios.post(`${API_URL}/review/${phone}/${orderId}`, { 
        ratings: ratingsArray,
        deliveryRating: deliveryRating || null
      });
      setSubmitted(true);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to submit review');
    } finally {
      setSubmitting(false);
    }
  };

  const StarRating = ({ itemId, currentRating, onRate, isDelivery = false }) => (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(star => (
        <button
          key={star}
          onClick={() => isDelivery ? setDeliveryRating(star) : handleRating(itemId, star)}
          className={`text-3xl transition-transform hover:scale-110 ${
            star <= (isDelivery ? deliveryRating : (ratings[itemId] || 0)) ? 'text-yellow-400' : 'text-gray-300'
          }`}
        >
          ★
        </button>
      ))}
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading your order...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">😕</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Order Not Found</h2>
          <p className="text-gray-500 mb-6">{error}</p>
          <Link to="/" className="inline-block bg-orange-500 text-white px-6 py-3 rounded-lg font-medium hover:bg-orange-600 transition">
            View Our Menu
          </Link>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Thank You!</h2>
          <p className="text-gray-500 mb-6">Your feedback helps us serve you better!</p>
          <Link to="/" className="inline-block bg-orange-500 text-white px-6 py-3 rounded-lg font-medium hover:bg-orange-600 transition">
            View Our Menu
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <Link to="/" className="text-orange-600 hover:text-orange-700 text-sm">← Back to Menu</Link>
          <h1 className="text-2xl font-bold text-gray-800 mt-2">Rate Your Order</h1>
          <p className="text-gray-500 text-sm">Order #{order.orderId}</p>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Order Summary */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
          <div className="flex justify-between items-center text-sm text-gray-500">
            <span>Delivered on {new Date(order.deliveredAt).toLocaleDateString()}</span>
            <span className="font-semibold text-gray-800">₹{order.totalAmount}</span>
          </div>
        </div>

        {/* Delivery Partner Rating */}
        {order.deliveryPartner && (
          <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
            <h3 className="font-semibold text-gray-800 mb-4">Rate Your Delivery Partner</h3>
            <div className="flex gap-4 items-center">
              <div className="w-16 h-16 rounded-full bg-gray-100 overflow-hidden flex-shrink-0">
                {order.deliveryPartner.photo ? (
                  <img src={order.deliveryPartner.photo} alt={order.deliveryPartner.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400 text-2xl">🚴</div>
                )}
              </div>
              <div className="flex-1">
                <h4 className="font-medium text-gray-800">{order.deliveryPartner.name}</h4>
                {order.deliveryPartner.avgRating > 0 && (
                  <p className="text-xs text-gray-400">
                    Avg rating: {order.deliveryPartner.avgRating} ★ ({order.deliveryPartner.totalRatings} reviews)
                  </p>
                )}
                <div className="mt-2">
                  <p className="text-sm text-gray-600 mb-2">
                    {order.deliveryPartner.existingRating ? 'Update your rating:' : 'Rate delivery:'}
                  </p>
                  <StarRating isDelivery={true} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Items to Rate */}
        <h3 className="font-semibold text-gray-800 mb-3">Rate Your Food</h3>
        <div className="space-y-4">
          {order.items.map(item => (
            <div key={item.menuItemId} className="bg-white rounded-xl shadow-sm p-4">
              <div className="flex gap-4">
                {item.image && (
                  <img src={item.image} alt={item.name} className="w-20 h-20 rounded-lg object-cover" />
                )}
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-800">{item.name}</h3>
                  <p className="text-sm text-gray-500">Qty: {item.quantity} × ₹{item.price}</p>
                  {item.avgRating > 0 && (
                    <p className="text-xs text-gray-400 mt-1">
                      Avg rating: {item.avgRating} ★ ({item.totalRatings} reviews)
                    </p>
                  )}
                  <div className="mt-3">
                    <p className="text-sm text-gray-600 mb-2">
                      {item.existingRating ? 'Update your rating:' : 'Rate this item:'}
                    </p>
                    <StarRating itemId={item.menuItemId} currentRating={item.existingRating} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Submit Button */}
        <div className="mt-8">
          <button
            onClick={handleSubmit}
            disabled={submitting || (Object.keys(ratings).length === 0 && !deliveryRating)}
            className={`w-full py-4 rounded-xl font-semibold text-white transition ${
              submitting || (Object.keys(ratings).length === 0 && !deliveryRating)
                ? 'bg-gray-300 cursor-not-allowed'
                : 'bg-orange-500 hover:bg-orange-600'
            }`}
          >
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
