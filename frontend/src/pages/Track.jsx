import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';

const API_URL = 'https://restaruntbot.onrender.com/api/public';

// SVG Icons
const Icons = {
  Back: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>,
  Check: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>,
  Clock: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  Cooking: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" /></svg>,
  Package: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>,
  Truck: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>,
  Home: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
  X: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>,
  Refresh: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>,
  Location: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
  Sad: () => <svg className="w-16 h-16 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
};

const statusConfig = {
  pending: { icon: Icons.Clock, label: 'Order Placed', color: 'amber', bg: 'bg-amber-500' },
  confirmed: { icon: Icons.Check, label: 'Confirmed', color: 'blue', bg: 'bg-blue-500' },
  preparing: { icon: Icons.Cooking, label: 'Preparing', color: 'orange', bg: 'bg-orange-500' },
  ready: { icon: Icons.Package, label: 'Ready', color: 'purple', bg: 'bg-purple-500' },
  out_for_delivery: { icon: Icons.Truck, label: 'On the Way', color: 'indigo', bg: 'bg-indigo-500' },
  delivered: { icon: Icons.Home, label: 'Delivered', color: 'green', bg: 'bg-green-500' },
  cancelled: { icon: Icons.X, label: 'Cancelled', color: 'red', bg: 'bg-red-500' },
  refunded: { icon: Icons.Refresh, label: 'Refunded', color: 'green', bg: 'bg-green-500' },
};

const statusOrder = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered'];

export default function Track() {
  const { orderId } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadOrder();
    const interval = setInterval(loadOrder, 30000);
    return () => clearInterval(interval);
  }, [orderId]);

  const loadOrder = async () => {
    try {
      const res = await axios.get(`${API_URL}/track/${orderId}`);
      setOrder(res.data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Order not found');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-amber-800 font-medium">Tracking your order...</p>
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

  const config = statusConfig[order.status] || statusConfig.pending;
  const currentIndex = statusOrder.indexOf(order.status);
  const isCancelled = order.status === 'cancelled' || order.status === 'refunded';

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-lg sticky top-0 z-50 border-b border-amber-100">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <Link to="/" className="inline-flex items-center gap-2 text-amber-600 hover:text-amber-700 text-sm font-medium">
            <Icons.Back /> Back to Menu
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">Track Order</h1>
          <p className="text-amber-600 text-sm font-medium">#{order.orderId}</p>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Status Card */}
        <div className={`rounded-3xl p-6 text-white ${config.bg}`}>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center">
              <config.icon />
            </div>
            <div>
              <p className="text-white/80 text-sm">Current Status</p>
              <h2 className="text-2xl font-bold">{config.label}</h2>
            </div>
          </div>
        </div>

        {/* Progress Steps */}
        {!isCancelled && (
          <div className="bg-white rounded-2xl shadow-sm p-6 border border-amber-100">
            <div className="flex justify-between relative">
              <div className="absolute top-5 left-0 right-0 h-1 bg-gray-100 -z-10">
                <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500" style={{ width: `${(currentIndex / (statusOrder.length - 1)) * 100}%` }} />
              </div>
              {statusOrder.map((status, idx) => {
                const stepConfig = statusConfig[status];
                const isCompleted = idx <= currentIndex;
                const isCurrent = idx === currentIndex;
                return (
                  <div key={status} className="flex flex-col items-center z-10">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isCompleted ? 'bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-lg' : 'bg-gray-100 text-gray-400'} ${isCurrent ? 'ring-4 ring-amber-200 scale-110' : ''}`}>
                      <stepConfig.icon />
                    </div>
                    <span className={`text-xs mt-2 font-medium ${isCompleted ? 'text-amber-600' : 'text-gray-400'}`}>{stepConfig.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Order Details */}
        <div className="bg-white rounded-2xl shadow-sm p-6 border border-amber-100">
          <h3 className="font-semibold text-gray-800 mb-4">Order Details</h3>
          <div className="space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Payment Method</span>
              <span className="font-medium text-gray-800">{order.paymentMethod?.toUpperCase()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Payment Status</span>
              <span className={`font-medium px-2 py-0.5 rounded-full text-xs ${order.paymentStatus === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                {order.paymentStatus === 'paid' ? 'Paid' : 'Pending'}
              </span>
            </div>
            {order.deliveryAddress && (
              <div className="pt-4 border-t border-gray-100">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center text-amber-600 flex-shrink-0">
                    <Icons.Location />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Delivery Address</p>
                    <p className="font-medium text-gray-800">{order.deliveryAddress}</p>
                  </div>
                </div>
              </div>
            )}
            {order.estimatedDeliveryTime && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Estimated Delivery</span>
                <span className="font-medium text-gray-800">
                  {new Date(order.estimatedDeliveryTime).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Items */}
        <div className="bg-white rounded-2xl shadow-sm p-6 border border-amber-100">
          <h3 className="font-semibold text-gray-800 mb-4">Order Items</h3>
          <div className="space-y-3">
            {order.items?.map((item, idx) => (
              <div key={idx} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center text-amber-600 font-bold text-sm">{item.quantity}</span>
                  <span className="text-gray-800">{item.name}</span>
                </div>
                <span className="font-medium text-gray-800">₹{item.price * item.quantity}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between">
            <span className="font-semibold text-gray-800">Total</span>
            <span className="text-xl font-bold text-amber-600">₹{order.totalAmount}</span>
          </div>
        </div>

        {/* Timeline */}
        {order.trackingUpdates && order.trackingUpdates.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-6 border border-amber-100">
            <h3 className="font-semibold text-gray-800 mb-4">Timeline</h3>
            <div className="space-y-4">
              {order.trackingUpdates.slice().reverse().map((update, idx) => {
                const updateConfig = statusConfig[update.status] || { icon: Icons.Check, color: 'gray' };
                return (
                  <div key={idx} className="flex gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${updateConfig.bg} text-white`}>
                      <updateConfig.icon />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-800">{update.message}</p>
                      <p className="text-sm text-gray-400">
                        {new Date(update.timestamp).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Auto-refresh notice */}
        <p className="text-center text-sm text-gray-400 pb-6">
          Auto-refreshing every 30 seconds
        </p>
      </div>
    </div>
  );
}
