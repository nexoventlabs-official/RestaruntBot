import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';

const API_URL = 'https://restaruntbot.onrender.com/api/public';

const statusConfig = {
  pending: { emoji: '⏳', label: 'Pending', color: 'bg-yellow-100 text-yellow-800', description: 'Waiting for confirmation' },
  confirmed: { emoji: '✅', label: 'Confirmed', color: 'bg-green-100 text-green-800', description: 'Order confirmed' },
  preparing: { emoji: '👨‍🍳', label: 'Preparing', color: 'bg-blue-100 text-blue-800', description: 'Your food is being prepared' },
  ready: { emoji: '📦', label: 'Ready', color: 'bg-purple-100 text-purple-800', description: 'Ready for pickup/delivery' },
  out_for_delivery: { emoji: '🛵', label: 'On the Way', color: 'bg-orange-100 text-orange-800', description: 'Your order is on the way' },
  delivered: { emoji: '✅', label: 'Delivered', color: 'bg-green-100 text-green-800', description: 'Order delivered successfully' },
  cancelled: { emoji: '❌', label: 'Cancelled', color: 'bg-red-100 text-red-800', description: 'Order was cancelled' },
  refunded: { emoji: '💰', label: 'Refunded', color: 'bg-gray-100 text-gray-800', description: 'Payment refunded' }
};

const statusOrder = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered'];

export default function Track() {
  const { orderId } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadOrder();
    // Auto-refresh every 30 seconds
    const interval = setInterval(loadOrder, 30000);
    return () => clearInterval(interval);
  }, [orderId]);

  const loadOrder = async () => {
    try {
      const res = await axios.get(`${API_URL}/track/${orderId}`);
      setOrder(res.data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load order');
    } finally {
      setLoading(false);
    }
  };

  const getStatusIndex = (status) => {
    const idx = statusOrder.indexOf(status);
    return idx >= 0 ? idx : -1;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading order details...</p>
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

  const currentStatus = statusConfig[order.status] || statusConfig.pending;
  const currentStatusIndex = getStatusIndex(order.status);
  const isCancelled = order.status === 'cancelled' || order.status === 'refunded';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <Link to="/" className="text-orange-600 hover:text-orange-700 text-sm">← Back to Menu</Link>
          <h1 className="text-2xl font-bold text-gray-800 mt-2">Track Your Order</h1>
          <p className="text-gray-500 text-sm">Order #{order.orderId}</p>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Current Status Card */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center gap-4">
            <div className="text-5xl">{currentStatus.emoji}</div>
            <div className="flex-1">
              <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${currentStatus.color}`}>
                {currentStatus.label}
              </span>
              <p className="text-gray-600 mt-2">{currentStatus.description}</p>
            </div>
          </div>
        </div>

        {/* Progress Tracker (only for non-cancelled orders) */}
        {!isCancelled && (
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h3 className="font-semibold text-gray-800 mb-4">Order Progress</h3>
            <div className="relative">
              {statusOrder.map((status, index) => {
                const config = statusConfig[status];
                const isCompleted = index < currentStatusIndex;
                const isCurrent = index === currentStatusIndex;
                const isLast = index === statusOrder.length - 1;
                
                return (
                  <div key={status} className="flex items-start mb-4 last:mb-0">
                    <div className="flex flex-col items-center mr-4">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${
                        isCompleted || isCurrent 
                          ? 'bg-green-500 text-white' 
                          : 'bg-gray-200 text-gray-400'
                      }`}>
                        {isCompleted ? '✓' : config.emoji}
                      </div>
                      {!isLast && (
                        <div className={`w-0.5 h-8 ${
                          isCompleted ? 'bg-green-500' : 'bg-gray-200'
                        }`}></div>
                      )}
                    </div>
                    <div className="pt-2">
                      <p className={`font-medium ${
                        isCompleted || isCurrent ? 'text-gray-800' : 'text-gray-400'
                      }`}>
                        {config.label}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Order Details */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="font-semibold text-gray-800 mb-4">Order Details</h3>
          
          <div className="space-y-3">
            {order.items.map((item, index) => (
              <div key={index} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                <div>
                  <p className="font-medium text-gray-800">{item.name}</p>
                  <p className="text-sm text-gray-500">
                    {item.unitQty} {item.unit} × {item.quantity}
                  </p>
                </div>
                <p className="font-medium text-gray-800">₹{item.price * item.quantity}</p>
              </div>
            ))}
          </div>
          
          <div className="border-t border-gray-200 mt-4 pt-4">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-gray-800">Total</span>
              <span className="font-bold text-xl text-orange-600">₹{order.totalAmount}</span>
            </div>
          </div>
        </div>

        {/* Payment & Delivery Info */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="font-semibold text-gray-800 mb-4">Order Info</h3>
          
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Payment Method</span>
              <span className="font-medium text-gray-800">
                {order.paymentMethod === 'cod' ? 'Cash on Delivery' : 'UPI/Online'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Payment Status</span>
              <span className={`font-medium ${
                order.paymentStatus === 'paid' ? 'text-green-600' : 
                order.paymentStatus === 'refunded' ? 'text-blue-600' : 'text-yellow-600'
              }`}>
                {order.paymentStatus === 'paid' ? '✅ Paid' : 
                 order.paymentStatus === 'refunded' ? '💰 Refunded' : '⏳ Pending'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Service Type</span>
              <span className="font-medium text-gray-800 capitalize">
                {order.serviceType?.replace('_', ' ') || 'Delivery'}
              </span>
            </div>
            {order.deliveryAddress && (
              <div className="pt-2 border-t border-gray-100">
                <span className="text-gray-500 block mb-1">Delivery Address</span>
                <span className="font-medium text-gray-800">{order.deliveryAddress}</span>
              </div>
            )}
            {order.estimatedDeliveryTime && (
              <div className="flex justify-between">
                <span className="text-gray-500">Estimated Delivery</span>
                <span className="font-medium text-gray-800">
                  {new Date(order.estimatedDeliveryTime).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Timeline */}
        {order.trackingUpdates && order.trackingUpdates.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h3 className="font-semibold text-gray-800 mb-4">Timeline</h3>
            
            <div className="space-y-4">
              {order.trackingUpdates.slice().reverse().map((update, index) => {
                const config = statusConfig[update.status] || { emoji: '•', label: update.status };
                return (
                  <div key={index} className="flex gap-3">
                    <div className="text-xl">{config.emoji}</div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-800">{update.message}</p>
                      <p className="text-sm text-gray-500">
                        {new Date(update.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Auto-refresh notice */}
        <p className="text-center text-sm text-gray-400">
          This page auto-refreshes every 30 seconds
        </p>
      </div>
    </div>
  );
}
