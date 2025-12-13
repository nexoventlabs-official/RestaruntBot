import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, X, Truck, ChefHat, CheckCircle, Package, Clock } from 'lucide-react';
import api from '../api';

const statusColors = {
  pending: 'bg-yellow-100 text-yellow-700',
  confirmed: 'bg-blue-100 text-blue-700',
  preparing: 'bg-orange-100 text-orange-700',
  ready: 'bg-purple-100 text-purple-700',
  out_for_delivery: 'bg-indigo-100 text-indigo-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  refunded: 'bg-gray-100 text-gray-700'
};

const statusIcons = {
  pending: Clock, confirmed: CheckCircle, preparing: ChefHat, ready: Package,
  out_for_delivery: Truck, delivered: CheckCircle, cancelled: X, refunded: RefreshCw
};

const statusLabels = {
  pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing', ready: 'Ready',
  out_for_delivery: 'On the Way', delivered: 'Delivered', cancelled: 'Cancelled', refunded: 'Refunded'
};

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [updatedIds, setUpdatedIds] = useState(new Set());
  const [updatingId, setUpdatingId] = useState(null);
  
  const ordersRef = useRef([]);
  const intervalRef = useRef(null);

  // Smart fetch that only updates changed orders
  const fetchOrders = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      
      const res = await api.get(`/orders${filter ? `?status=${filter}` : ''}`);
      const newOrders = res.data?.orders || [];
      
      if (isBackground && ordersRef.current.length > 0) {
        // Find changed orders for highlight effect
        const changedIds = new Set();
        const oldOrdersMap = new Map(ordersRef.current.map(o => [o._id, o]));
        
        newOrders.forEach(newOrder => {
          const oldOrder = oldOrdersMap.get(newOrder._id);
          if (!oldOrder || JSON.stringify(oldOrder) !== JSON.stringify(newOrder)) {
            changedIds.add(newOrder._id);
          }
        });
        
        // Check for new orders
        const oldIds = new Set(ordersRef.current.map(o => o._id));
        newOrders.forEach(o => {
          if (!oldIds.has(o._id)) changedIds.add(o._id);
        });
        
        if (changedIds.size > 0) {
          setUpdatedIds(changedIds);
          setTimeout(() => setUpdatedIds(new Set()), 2000);
        }
      }
      
      ordersRef.current = newOrders;
      setOrders(newOrders);
    } catch (err) {
      console.error('Failed to fetch orders:', err);
      // Set empty array on error to prevent infinite loading
      if (!isBackground) setOrders([]);
    } finally {
      // Always stop loading
      setLoading(false);
    }
  }, [filter]);

  // Initial fetch and filter change
  useEffect(() => {
    fetchOrders(false);
  }, [fetchOrders]);

  // Background polling every 5 seconds
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      fetchOrders(true);
    }, 5000);

    return () => clearInterval(intervalRef.current);
  }, [fetchOrders]);

  const updateStatus = async (id, status) => {
    if (updatingId === id) return; // Prevent double-click
    
    // Instant optimistic update BEFORE API call
    setUpdatingId(id);
    setOrders(prev => prev.map(o => o._id === id ? { ...o, status } : o));
    ordersRef.current = ordersRef.current.map(o => o._id === id ? { ...o, status } : o);
    if (selected?._id === id) setSelected({ ...selected, status });
    
    // Highlight the updated order
    setUpdatedIds(new Set([id]));
    setTimeout(() => setUpdatedIds(new Set()), 1500);
    
    try {
      await api.put(`/orders/${id}/status`, { status });
    } catch (err) {
      // Revert on error
      alert('Failed to update status');
      fetchOrders(false);
    } finally {
      setUpdatingId(null);
    }
  };

  const approveRefund = async (id) => {
    if (!confirm('Approve refund for this order? Money will be refunded to customer.')) return;
    try {
      await api.put(`/orders/${id}/refund/approve`);
      fetchOrders(false);
      alert('Refund approved and processed');
    } catch (err) {
      alert('Refund failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const rejectRefund = async (id) => {
    const reason = prompt('Enter reason for rejection:');
    if (!reason) return;
    try {
      await api.put(`/orders/${id}/refund/reject`, { reason });
      fetchOrders(false);
      alert('Refund rejected');
    } catch (err) {
      alert('Failed: ' + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Orders</h1>
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <RefreshCw className="w-3 h-3 animate-spin" style={{ animationDuration: '3s' }} />
            <span>Live</span>
          </div>
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="px-4 py-2 border rounded-lg"
        >
          <option value="">All Orders</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="preparing">Preparing</option>
          <option value="ready">Ready</option>
          <option value="out_for_delivery">On the Way</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center py-8">Loading...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {orders.map(order => {
            const Icon = statusIcons[order.status] || Clock;
            const isUpdated = updatedIds.has(order._id);
            return (
              <div 
                key={order._id} 
                className={`bg-white rounded-xl shadow-sm overflow-hidden transition-all duration-500 ${
                  isUpdated ? 'ring-2 ring-green-400 scale-[1.02]' : ''
                }`}
              >
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-bold">{order.orderId}</span>
                    <span className={`px-3 py-1 rounded-full text-xs ${statusColors[order.status]}`}>
                      <Icon className="w-3 h-3 inline mr-1" />
                      {statusLabels[order.status] || order.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="space-y-2 text-sm">
                    <p><span className="text-gray-500">Phone:</span> {order.customer?.phone}</p>
                    <p><span className="text-gray-500">Service:</span> {order.serviceType}</p>
                    <p><span className="text-gray-500">Amount:</span> <span className="font-semibold">₹{order.totalAmount}</span></p>
                    <p><span className="text-gray-500">Payment:</span> <span className={`font-medium ${order.paymentStatus === 'paid' ? 'text-green-600' : order.paymentStatus === 'refunded' ? 'text-blue-600' : 'text-yellow-600'}`}>{order.paymentMethod === 'cod' && order.paymentStatus === 'pending' ? 'COD (Pay on delivery)' : order.paymentStatus}</span> <span className="text-gray-400">({order.paymentMethod?.toUpperCase()})</span></p>
                    {order.refundStatus && order.refundStatus !== 'none' && (
                      <p><span className="text-gray-500">Refund:</span> <span className={`font-medium ${order.refundStatus === 'pending' ? 'text-yellow-600' : order.refundStatus === 'completed' ? 'text-green-600' : 'text-red-600'}`}>{order.refundStatus} {order.refundAmount ? `(₹${order.refundAmount})` : ''}</span></p>
                    )}
                    {order.deliveryAddress?.address && (
                      <div className="mt-2 p-2 bg-blue-50 rounded">
                        <p className="text-gray-600 text-xs font-medium">📍 Delivery Address:</p>
                        <p className="text-gray-800 text-xs">{order.deliveryAddress.address}</p>
                        {order.deliveryAddress.latitude && order.deliveryAddress.longitude && (
                          <a 
                            href={`https://www.google.com/maps?q=${order.deliveryAddress.latitude},${order.deliveryAddress.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 text-xs hover:underline"
                          >
                            View on Map →
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mt-4 pt-4 border-t">
                    <p className="text-xs text-gray-500 mb-2">Items:</p>
                    {order.items?.slice(0, 2).map((item, i) => (
                      <p key={i} className="text-sm">{item.name} x {item.quantity}</p>
                    ))}
                    {order.items?.length > 2 && <p className="text-xs text-gray-400">+{order.items.length - 2} more</p>}
                  </div>
                </div>
                <div className="bg-gray-50 px-4 py-3 flex gap-2 flex-wrap">
                  {order.refundStatus !== 'completed' && order.refundStatus !== 'pending' && (
                    <>
                      {order.status === 'confirmed' && (
                        <button onClick={() => updateStatus(order._id, 'preparing')} disabled={updatingId === order._id} className="px-3 py-1 bg-orange-500 text-white rounded text-xs disabled:opacity-50">Start Preparing</button>
                      )}
                      {order.status === 'preparing' && (
                        <button onClick={() => updateStatus(order._id, 'ready')} disabled={updatingId === order._id} className="px-3 py-1 bg-purple-500 text-white rounded text-xs disabled:opacity-50">Mark Ready</button>
                      )}
                      {order.status === 'ready' && (
                        <button onClick={() => updateStatus(order._id, 'out_for_delivery')} disabled={updatingId === order._id} className="px-3 py-1 bg-indigo-500 text-white rounded text-xs disabled:opacity-50">On the Way</button>
                      )}
                      {order.status === 'out_for_delivery' && (
                        <button onClick={() => updateStatus(order._id, 'delivered')} disabled={updatingId === order._id} className="px-3 py-1 bg-green-500 text-white rounded text-xs disabled:opacity-50">Delivered</button>
                      )}
                      {!['delivered', 'cancelled', 'refunded'].includes(order.status) && (
                        <button onClick={() => { if(confirm('Cancel this order?')) updateStatus(order._id, 'cancelled'); }} disabled={updatingId === order._id} className="px-3 py-1 bg-red-500 text-white rounded text-xs disabled:opacity-50">Cancel</button>
                      )}
                    </>
                  )}
                  {(order.refundStatus === 'completed' || order.refundStatus === 'pending') && (
                    <span className="text-sm text-gray-500">Refund {order.refundStatus === 'completed' ? 'completed' : 'processing'} - No actions available</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!loading && orders.length === 0 && (
        <div className="text-center py-12 text-gray-500">No orders found</div>
      )}
    </div>
  );
}
