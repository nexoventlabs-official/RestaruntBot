import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  RefreshCw, X, Truck, ChefHat, CheckCircle, Package, Clock, 
  Filter, Search, MapPin, CreditCard, ExternalLink, ChevronDown, ChevronUp, User,
  History
} from 'lucide-react';
import api from '../api';

// Smart diff function to detect actual changes
const getOrderChanges = (oldOrders, newOrders) => {
  const changedIds = new Set();
  const oldMap = new Map(oldOrders.map(o => [o._id, o]));
  const newMap = new Map(newOrders.map(o => [o._id, o]));
  
  // Check for new or modified orders
  newOrders.forEach(newOrder => {
    const oldOrder = oldMap.get(newOrder._id);
    if (!oldOrder) {
      changedIds.add(newOrder._id); // New order
    } else if (
      oldOrder.status !== newOrder.status ||
      oldOrder.paymentStatus !== newOrder.paymentStatus ||
      oldOrder.refundStatus !== newOrder.refundStatus ||
      oldOrder.deliveryPartnerName !== newOrder.deliveryPartnerName ||
      oldOrder.assignedTo !== newOrder.assignedTo ||
      oldOrder.updatedAt !== newOrder.updatedAt
    ) {
      changedIds.add(newOrder._id); // Modified order
    }
  });
  
  // Check for removed orders
  oldOrders.forEach(oldOrder => {
    if (!newMap.has(oldOrder._id)) {
      changedIds.add(oldOrder._id);
    }
  });
  
  return changedIds;
};

const statusConfig = {
  pending: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500', icon: Clock, label: 'Pending' },
  confirmed: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500', icon: CheckCircle, label: 'Confirmed' },
  preparing: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-500', icon: ChefHat, label: 'Preparing' },
  ready: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-500', icon: Package, label: 'Ready' },
  out_for_delivery: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', dot: 'bg-indigo-500', icon: Truck, label: 'On the Way' },
  delivered: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', dot: 'bg-green-500', icon: CheckCircle, label: 'Delivered' },
  cancelled: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', dot: 'bg-red-500', icon: X, label: 'Cancelled' },
  refunded: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300', dot: 'bg-green-600', icon: RefreshCw, label: 'Refunded' },
  refund_failed: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300', dot: 'bg-red-600', icon: X, label: 'Refund Failed' },
  refund_processing: { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200', dot: 'bg-pink-500', icon: RefreshCw, label: 'Refund Processing' }
};

const filterOptions = [
  { value: '', label: 'All Orders', color: 'bg-dark-100 text-dark-700' },
  { value: 'pending', label: 'Pending', color: 'bg-amber-50 text-amber-700' },
  { value: 'confirmed', label: 'Confirmed', color: 'bg-blue-50 text-blue-700' },
  { value: 'preparing', label: 'Preparing', color: 'bg-orange-50 text-orange-700' },
  { value: 'ready', label: 'Ready', color: 'bg-purple-50 text-purple-700' },
  { value: 'out_for_delivery', label: 'On the Way', color: 'bg-indigo-50 text-indigo-700' },
  { value: 'delivered', label: 'Delivered', color: 'bg-green-50 text-green-700' },
  { value: 'cancelled', label: 'Cancelled', color: 'bg-red-50 text-red-700' },
];

// Custom Dropdown Component
const StatusDropdown = ({ value, onChange, options }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const selected = options.find(opt => opt.value === value) || options[0];

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 pl-3 pr-8 py-2.5 bg-white border border-dark-200 rounded-xl cursor-pointer focus:border-primary-500 transition-colors min-w-[160px]"
      >
        <Filter className="w-4 h-4 text-dark-400" />
        <span className={`px-2 py-0.5 rounded-md text-sm font-medium ${selected.color}`}>
          {selected.label}
        </span>
        <svg className={`absolute right-3 w-4 h-4 text-dark-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-full bg-white border border-dark-200 rounded-xl shadow-lg z-50 overflow-hidden">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              className={`w-full px-3 py-2.5 text-left text-sm font-medium transition-colors flex items-center gap-2
                ${value === opt.value ? 'bg-primary-50' : 'hover:bg-dark-50'}
              `}
            >
              <span className={`w-2 h-2 rounded-full ${opt.color.replace('bg-', 'bg-').replace('-50', '-500').replace('-100', '-500')}`}></span>
              <span className={opt.color.split(' ')[1]}>{opt.label}</span>
              {value === opt.value && (
                <CheckCircle className="w-4 h-4 text-primary-500 ml-auto" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// API base URL for images
const API_BASE_URL = (import.meta.env.VITE_API_URL || 'https://restaruntbot.onrender.com/api').replace('/api', '');

// Scrollable Items List Component
const ScrollableItemsList = ({ items }) => {
  const scrollRef = useRef(null);
  const [showDownArrow, setShowDownArrow] = useState(false);
  const [showUpArrow, setShowUpArrow] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isAtTop = el.scrollTop <= 5;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 5;
    const hasScroll = el.scrollHeight > el.clientHeight;
    
    setShowUpArrow(hasScroll && !isAtTop);
    setShowDownArrow(hasScroll && !isAtBottom);
  }, []);

  useEffect(() => {
    checkScroll();
  }, [items, checkScroll]);

  const scrollToEnd = (direction) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({
      top: direction === 'down' ? el.scrollHeight : 0,
      behavior: 'smooth'
    });
  };

  return (
    <div className="relative">
      <div 
        ref={scrollRef} 
        className="space-y-2.5 max-h-64 overflow-y-auto pr-1" 
        onScroll={checkScroll}
      >
        {items?.map((item, i) => {
          // Resolve image: item.image > variant image from populated menuItem > menuItem.image
          const variantImg = item.variantIndex !== null && item.menuItem?.variants?.[item.variantIndex]?.image 
            ? item.menuItem.variants[item.variantIndex].image 
            : null;
          const rawImg = item.image || variantImg || item.menuItem?.image;
          const imgSrc = rawImg ? (rawImg.startsWith('http') ? rawImg : `${API_BASE_URL}${rawImg}`) : null;
          
          return (
            <div key={i} className="flex items-center gap-3 bg-white rounded-xl p-2.5 shadow-sm border border-dark-100/60">
              {/* Item Image */}
              <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-dark-100">
                {imgSrc ? (
                  <img 
                    src={imgSrc} 
                    alt={item.name} 
                    className="w-full h-full object-cover"
                    onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                  />
                ) : null}
                <div className={`w-full h-full items-center justify-center bg-primary-50 ${imgSrc ? 'hidden' : 'flex'}`}>
                  <span className="text-lg">🍽️</span>
                </div>
              </div>
              {/* Item Details */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-dark-800 truncate">{item.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-dark-400">Qty: {item.quantity}</span>
                  {item.unitQty && item.unit && (
                    <span className="text-xs text-dark-400">• {item.unitQty} {item.unit}</span>
                  )}
                  <span className="text-xs text-dark-400">• ₹{item.price} each</span>
                </div>
              </div>
              {/* Item Total Price */}
              <div className="flex-shrink-0 text-right">
                <p className="text-sm font-bold text-dark-900">₹{item.price * item.quantity}</p>
              </div>
            </div>
          );
        })}
      </div>
      {(showDownArrow || showUpArrow) && (
        <button
          onClick={() => scrollToEnd(showDownArrow ? 'down' : 'up')}
          className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-6 h-6 bg-white rounded-full shadow-md flex items-center justify-center hover:bg-dark-50 transition-colors border border-dark-100"
        >
          {showDownArrow ? (
            <ChevronDown className="w-4 h-4 text-dark-500" />
          ) : (
            <ChevronUp className="w-4 h-4 text-dark-500" />
          )}
        </button>
      )}
    </div>
  );
};

// Skeleton Component
const OrderSkeleton = () => (
  <div className="bg-white rounded-2xl shadow-card overflow-hidden animate-pulse">
    <div className="px-5 py-4 border-b border-dark-100">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-dark-100"></div>
          <div>
            <div className="h-4 w-24 bg-dark-100 rounded mb-1.5"></div>
            <div className="h-3 w-16 bg-dark-100 rounded"></div>
          </div>
        </div>
        <div className="h-6 w-20 bg-dark-100 rounded-lg"></div>
      </div>
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 bg-dark-100 rounded-full"></div>
        <div>
          <div className="h-4 w-20 bg-dark-100 rounded mb-1"></div>
          <div className="h-3 w-24 bg-dark-100 rounded"></div>
        </div>
      </div>
    </div>
    <div className="p-5 space-y-4">
      <div className="bg-dark-50 rounded-xl p-3">
        <div className="flex items-center justify-between mb-2.5">
          <div className="h-3 w-20 bg-dark-200 rounded"></div>
          <div className="h-3 w-12 bg-dark-200 rounded"></div>
        </div>
        <div className="space-y-2">
          <div className="bg-white rounded-lg px-3 py-2 flex items-center gap-2">
            <div className="w-6 h-6 bg-dark-100 rounded-md"></div>
            <div className="h-4 flex-1 bg-dark-100 rounded"></div>
          </div>
          <div className="bg-white rounded-lg px-3 py-2 flex items-center gap-2">
            <div className="w-6 h-6 bg-dark-100 rounded-md"></div>
            <div className="h-4 w-3/4 bg-dark-100 rounded"></div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-dark-100">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-dark-100 rounded"></div>
          <div className="h-4 w-16 bg-dark-100 rounded"></div>
        </div>
        <div className="h-6 w-16 bg-dark-100 rounded"></div>
      </div>
    </div>
  </div>
);

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [updatedIds, setUpdatedIds] = useState(new Set());
  const [updatingId, setUpdatingId] = useState(null);
  const [deliveryPartners, setDeliveryPartners] = useState([]);
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [loadingPartners, setLoadingPartners] = useState(false);
  const ordersRef = useRef([]);
  const hashRef = useRef('');
  const initialLoadDone = useRef(false);
  const isPollingRef = useRef(false);
  
  // New filters matching mobile app
  const [serviceTypeTab, setServiceTypeTab] = useState('all'); // all, delivery, pickup
  const [paymentFilter, setPaymentFilter] = useState('all'); // all, paid, pending, cod
  const [sortBy, setSortBy] = useState('newest'); // newest, oldest, amount_high, amount_low
  const [dateFilter, setDateFilter] = useState('all'); // all, today, week, month
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [activeTab, setActiveTab] = useState('live'); // live, history
  const [orderHistory, setOrderHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [orderDetailModal, setOrderDetailModal] = useState(null);

  // Fetch delivery partners
  const fetchDeliveryPartners = useCallback(async () => {
    setLoadingPartners(true);
    try {
      const res = await api.get('/delivery');
      // Show all delivery partners, not just active ones
      setDeliveryPartners(res.data || []);
    } catch (err) {
      console.error('Failed to fetch delivery partners:', err);
    } finally {
      setLoadingPartners(false);
    }
  }, []);

  // Fetch full orders data
  const fetchOrders = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground && !initialLoadDone.current) setLoading(true);
      const res = await api.get(`/orders${filter ? `?status=${filter}` : ''}`);
      const newOrders = res.data?.orders || [];
      const newHash = res.data?.hash || '';
      
      // Only update if there are actual changes (background refresh)
      if (isBackground && ordersRef.current.length > 0) {
        const changedIds = getOrderChanges(ordersRef.current, newOrders);
        if (changedIds.size > 0) {
          setUpdatedIds(changedIds);
          setTimeout(() => setUpdatedIds(new Set()), 2000);
        }
      }
      
      ordersRef.current = newOrders;
      hashRef.current = newHash;
      setOrders(newOrders);
      initialLoadDone.current = true;
    } catch {
      if (!isBackground) setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // Lightweight check for updates (minimal backend load)
  const checkForUpdates = useCallback(async () => {
    if (isPollingRef.current) return;
    isPollingRef.current = true;
    
    try {
      const params = new URLSearchParams();
      if (filter) params.append('status', filter);
      if (hashRef.current) params.append('lastHash', hashRef.current);
      
      const res = await api.get(`/orders/check-updates?${params}`);
      
      // Only fetch full data if there are changes
      if (res.data?.hasChanges) {
        await fetchOrders(true);
      }
    } catch {
      // Silent fail for background checks
    } finally {
      isPollingRef.current = false;
    }
  }, [filter, fetchOrders]);

  // Initial load
  useEffect(() => { 
    initialLoadDone.current = false;
    hashRef.current = '';
    fetchOrders(false); 
  }, [fetchOrders]);

  // SSE for real-time updates (primary method)
  useEffect(() => {
    let eventSource = null;
    let reconnectTimeout = null;
    const connect = () => {
      const baseUrl = api.defaults.baseURL?.replace('/api', '') || '';
      const token = localStorage.getItem('token');
      eventSource = new EventSource(`${baseUrl}/api/events${token ? '?token=' + token : ''}`);
      
      eventSource.onmessage = (event) => {
        try {
          const { type } = JSON.parse(event.data);
          // Immediately fetch orders when SSE event received for instant updates
          if (type === 'orders') fetchOrders(true);
        } catch { /* ignored */ }
      };
      
      eventSource.onerror = () => {
        eventSource?.close();
        reconnectTimeout = setTimeout(connect, 3000);
      };
    };
    
    connect();
    
    return () => {
      eventSource?.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkForUpdates]);

  // Fallback polling (only if SSE fails, checks every 30s)
  useEffect(() => {
    const pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        checkForUpdates();
      }
    }, 30000);
    
    // Also check when tab becomes visible
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkForUpdates();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    
    return () => {
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [checkForUpdates]);

  const updateStatus = async (id, status, deliveryBoyId = null) => {
    if (updatingId === id) return;
    setUpdatingId(id);
    setOrders(prev => prev.map(o => o._id === id ? { ...o, status } : o));
    ordersRef.current = ordersRef.current.map(o => o._id === id ? { ...o, status } : o);
    setUpdatedIds(new Set([id]));
    setTimeout(() => setUpdatedIds(new Set()), 1500);
    try {
      await api.put(`/orders/${id}/status`, { status });
      // If delivery partner is selected, assign them
      if (deliveryBoyId) {
        await api.put(`/orders/${id}/assign-delivery`, { deliveryBoyId });
      }
    } catch {
      alert('Failed to update status');
      fetchOrders(false);
    } finally {
      setUpdatingId(null);
      setShowDeliveryModal(false);
      setSelectedOrder(null);
    }
  };

  // Handle start preparing with delivery partner selection
  const handleStartPreparing = async (order) => {
    if (order.serviceType === 'delivery') {
      setSelectedOrder(order);
      await fetchDeliveryPartners();
      setShowDeliveryModal(true);
    } else {
      // For non-delivery orders, just update status
      updateStatus(order._id, 'preparing');
    }
  };

  // Assign delivery partner and update status
  const assignAndPrepare = (deliveryBoyId) => {
    if (selectedOrder) {
      updateStatus(selectedOrder._id, 'preparing', deliveryBoyId);
    }
  };

  const processRefund = async (orderId) => {
    if (updatingId) return;
    if (!confirm(`Process refund for order ${orderId}?`)) return;
    
    const order = orders.find(o => o.orderId === orderId);
    if (!order) return;
    
    setUpdatingId(order._id);
    try {
      await api.post(`/payment/process-refund/${orderId}`);
      fetchOrders(false);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to process refund');
      fetchOrders(false);
    } finally {
      setUpdatingId(null);
    }
  };

  const filteredOrders = orders.filter(order => {
    const matchesSearch = order.orderId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.customer?.phone?.includes(searchTerm) ||
      order.customer?.name?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesServiceType = serviceTypeTab === 'all' || order.serviceType === serviceTypeTab;
    const matchesPayment = paymentFilter === 'all' || 
      (paymentFilter === 'paid' && order.paymentStatus === 'paid') ||
      (paymentFilter === 'pending' && order.paymentStatus === 'pending') ||
      (paymentFilter === 'cod' && order.paymentMethod === 'cod');
    
    // Date filter
    let matchesDate = true;
    if (dateFilter !== 'all') {
      const orderDate = new Date(order.createdAt);
      const now = new Date();
      if (dateFilter === 'today') {
        matchesDate = orderDate.toDateString() === now.toDateString();
      } else if (dateFilter === 'week') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        matchesDate = orderDate >= weekAgo;
      } else if (dateFilter === 'month') {
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        matchesDate = orderDate >= monthAgo;
      }
    }
    
    return matchesSearch && matchesServiceType && matchesPayment && matchesDate;
  }).sort((a, b) => {
    if (sortBy === 'newest') return new Date(b.createdAt) - new Date(a.createdAt);
    if (sortBy === 'oldest') return new Date(a.createdAt) - new Date(b.createdAt);
    if (sortBy === 'amount_high') return (b.totalAmount || 0) - (a.totalAmount || 0);
    if (sortBy === 'amount_low') return (a.totalAmount || 0) - (b.totalAmount || 0);
    return 0;
  });

  // Fetch order history (from Google Sheets)
  const fetchOrderHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await api.get('/orders/history?limit=1000');
      setOrderHistory(res.data?.orders || res.data || []);
    } catch (err) {
      console.error('Failed to fetch order history:', err);
      setOrderHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Load history when tab changes
  useEffect(() => {
    if (activeTab === 'history' && orderHistory.length === 0) {
      fetchOrderHistory();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, fetchOrderHistory]);

  const filteredHistory = orderHistory.filter(order =>
    (order.orderId || order['Order ID'] || '').toLowerCase().includes(historySearchTerm.toLowerCase()) ||
    (order.customerPhone || order['Customer Phone'] || '').includes(historySearchTerm)
  );

  const getActionButton = (order) => {
    if (order.refundStatus === 'completed' || order.refundStatus === 'pending') return null;
    const actions = {
      confirmed: { label: 'Start Preparing', status: 'preparing', color: 'bg-orange-500 hover:bg-orange-600', useDeliveryModal: true },
      preparing: { label: 'Mark Ready', status: 'ready', color: 'bg-purple-500 hover:bg-purple-600' },
      ready: { label: 'Out for Delivery', status: 'out_for_delivery', color: 'bg-indigo-500 hover:bg-indigo-600' },
      out_for_delivery: { label: 'Mark Delivered', status: 'delivered', color: 'bg-green-500 hover:bg-green-600' },
    };
    const action = actions[order.status];
    if (!action) return null;
    
    // For confirmed orders with delivery service type, show delivery partner modal
    if (action.useDeliveryModal && order.serviceType === 'delivery') {
      return (
        <button onClick={() => handleStartPreparing(order)} disabled={updatingId === order._id}
          className={`${action.color} text-white px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-50 flex items-center gap-2`}>
          {updatingId === order._id && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
          {action.label}
        </button>
      );
    }
    
    return (
      <button onClick={() => updateStatus(order._id, action.status)} disabled={updatingId === order._id}
        className={`${action.color} text-white px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-50 flex items-center gap-2`}>
        {updatingId === order._id && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
        {action.label}
      </button>
    );
  };

  const showSkeleton = loading && orders.length === 0;

  return (
    <div className="space-y-6">
      {/* Tabs: Live Orders / Order History */}
      <div className="flex items-center gap-1 bg-white rounded-xl p-1 shadow-card w-fit">
        <button
          onClick={() => setActiveTab('live')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'live' ? 'bg-primary-500 text-white shadow-md' : 'text-dark-600 hover:bg-dark-50'}`}
        >
          <Package className="w-4 h-4" /> Live Orders
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'history' ? 'bg-primary-500 text-white shadow-md' : 'text-dark-600 hover:bg-dark-50'}`}
        >
          <History className="w-4 h-4" /> Order History
        </button>
      </div>

      {activeTab === 'live' ? (
        <>
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 rounded-full">
            <span className="w-2 h-2 bg-green-500 rounded-full live-indicator"></span>
            <span className="text-xs font-medium text-green-700">Live</span>
          </div>
          <span className="text-dark-400 text-sm">{filteredOrders.length} orders</span>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
            <input type="text" placeholder="Search orders..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2.5 bg-white border border-dark-200 rounded-xl w-full sm:w-64 focus:border-primary-500 transition-colors" />
          </div>
          <StatusDropdown 
            value={filter} 
            onChange={setFilter} 
            options={filterOptions} 
          />
          <button
            onClick={() => setShowFilterPanel(!showFilterPanel)}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-colors ${showFilterPanel ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white border-dark-200 text-dark-600 hover:bg-dark-50'}`}
          >
            <Filter className="w-4 h-4" />
            <span className="text-sm font-medium">Filters</span>
          </button>
        </div>
      </div>

      {/* Service Type Tabs */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 bg-white rounded-xl p-1 shadow-card">
          {[
            { value: 'all', label: 'All' },
            { value: 'delivery', label: 'Delivery', icon: Truck },
            { value: 'pickup', label: 'Pickup', icon: Package }
          ].map(tab => (
            <button
              key={tab.value}
              onClick={() => setServiceTypeTab(tab.value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${serviceTypeTab === tab.value ? 'bg-dark-800 text-white' : 'text-dark-600 hover:bg-dark-50'}`}
            >
              {tab.icon && <tab.icon className="w-3.5 h-3.5" />}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Advanced Filter Panel */}
      {showFilterPanel && (
        <div className="bg-white rounded-xl p-4 shadow-card flex flex-wrap gap-4 items-end">
          {/* Payment Filter */}
          <div>
            <label className="block text-xs font-semibold text-dark-500 mb-1.5 uppercase tracking-wide">Payment</label>
            <div className="flex items-center gap-1 bg-dark-50 rounded-lg p-0.5">
              {['all', 'paid', 'pending', 'cod'].map(opt => (
                <button key={opt} onClick={() => setPaymentFilter(opt)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all capitalize ${paymentFilter === opt ? 'bg-white text-dark-900 shadow-sm' : 'text-dark-500 hover:text-dark-700'}`}>
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* Date Filter */}
          <div>
            <label className="block text-xs font-semibold text-dark-500 mb-1.5 uppercase tracking-wide">Date</label>
            <div className="flex items-center gap-1 bg-dark-50 rounded-lg p-0.5">
              {[
                { value: 'all', label: 'All' },
                { value: 'today', label: 'Today' },
                { value: 'week', label: 'This Week' },
                { value: 'month', label: 'This Month' }
              ].map(opt => (
                <button key={opt.value} onClick={() => setDateFilter(opt.value)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${dateFilter === opt.value ? 'bg-white text-dark-900 shadow-sm' : 'text-dark-500 hover:text-dark-700'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sort */}
          <div>
            <label className="block text-xs font-semibold text-dark-500 mb-1.5 uppercase tracking-wide">Sort By</label>
            <div className="flex items-center gap-1 bg-dark-50 rounded-lg p-0.5">
              {[
                { value: 'newest', label: 'Newest' },
                { value: 'oldest', label: 'Oldest' },
                { value: 'amount_high', label: '₹ High' },
                { value: 'amount_low', label: '₹ Low' }
              ].map(opt => (
                <button key={opt.value} onClick={() => setSortBy(opt.value)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${sortBy === opt.value ? 'bg-white text-dark-900 shadow-sm' : 'text-dark-500 hover:text-dark-700'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Reset Filters */}
          <button onClick={() => { setPaymentFilter('all'); setDateFilter('all'); setSortBy('newest'); setServiceTypeTab('all'); setShowFilterPanel(false); }}
            className="px-3 py-2 text-xs font-medium text-dark-500 hover:text-dark-700 hover:bg-dark-100 rounded-lg transition-colors">
            Reset All
          </button>
        </div>
      )}

      {showSkeleton ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          <OrderSkeleton />
          <OrderSkeleton />
          <OrderSkeleton />
          <OrderSkeleton />
          <OrderSkeleton />
          <OrderSkeleton />
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-card p-12 text-center">
          <div className="w-20 h-20 bg-dark-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Package className="w-10 h-10 text-dark-300" />
          </div>
          <h3 className="text-lg font-semibold text-dark-700">No orders found</h3>
          <p className="text-dark-400 mt-1">{searchTerm || filter ? 'Try adjusting your filters' : 'Orders will appear here'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredOrders.map(order => {
            const config = statusConfig[order.status] || statusConfig.pending;
            const StatusIcon = config.icon;
            const isUpdated = updatedIds.has(order._id);
            const totalItems = order.items?.reduce((sum, item) => sum + item.quantity, 0) || 0;
            return (
              <div key={order._id} className={`bg-white rounded-2xl shadow-card overflow-hidden transition-all duration-300 hover:shadow-lg flex flex-col ${isUpdated ? 'ring-2 ring-primary-400 scale-[1.01]' : ''}`}>
                {/* Header */}
                <div className="px-5 py-4 border-b border-dark-100">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-lg ${config.bg} flex items-center justify-center`}>
                        <StatusIcon className={`w-4 h-4 ${config.text}`} />
                      </div>
                      <div>
                        <p className="font-bold text-dark-900 text-sm">{order.orderId}</p>
                        <p className="text-xs text-dark-400 capitalize">{order.serviceType}</p>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${config.bg} ${config.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`}></span>
                      {config.label}
                    </span>
                  </div>
                  {/* Customer Info */}
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 bg-gradient-to-br from-primary-100 to-primary-200 rounded-full flex items-center justify-center">
                      <span className="text-xs font-bold text-primary-700">{(order.customer?.name || 'C')[0].toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-dark-800 truncate">{order.customer?.name || 'Customer'}</p>
                      <p className="text-xs text-dark-400">{order.customer?.phone}</p>
                    </div>
                  </div>
                  {/* Delivery Partner */}
                  {order.deliveryPartnerName && (
                    <div className="flex items-center gap-2 mt-2 px-2 py-1.5 bg-indigo-50 rounded-lg">
                      <Truck className="w-3.5 h-3.5 text-indigo-500" />
                      <span className="text-xs font-medium text-indigo-700">{order.deliveryPartnerName}</span>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="p-5 space-y-4 flex-1 flex flex-col">
                  {/* Items Section */}
                  <div className="bg-dark-50 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-xs font-semibold text-dark-500 uppercase tracking-wide">Order Items</span>
                      <span className="text-xs text-dark-400">{totalItems} item{totalItems !== 1 ? 's' : ''}</span>
                    </div>
                    <ScrollableItemsList items={order.items} />
                  </div>

                  {/* Delivery Address */}
                  {order.deliveryAddress?.address && (
                    <div className="flex items-start gap-2.5">
                      <div className="w-7 h-7 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                        <MapPin className="w-3.5 h-3.5 text-blue-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-dark-400 mb-0.5">Delivery to</p>
                        <p className="text-sm text-dark-700 line-clamp-2">{order.deliveryAddress.address}</p>
                        {order.deliveryAddress.latitude && order.deliveryAddress.longitude && (
                          <a href={`https://www.google.com/maps?q=${order.deliveryAddress.latitude},${order.deliveryAddress.longitude}`}
                            target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 mt-1 font-medium">
                            Open in Maps <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Refund Status - only show for COD orders */}
                  {order.refundStatus && order.refundStatus !== 'none' && order.paymentMethod === 'cod' && (
                    <div className={`flex items-center justify-between gap-2 p-2.5 rounded-lg ${order.refundStatus === 'pending' ? 'bg-amber-50' : order.refundStatus === 'completed' ? 'bg-green-50' : 'bg-red-50'}`}>
                      <div className="flex items-center gap-2">
                        <RefreshCw className={`w-3.5 h-3.5 ${order.refundStatus === 'pending' ? 'text-amber-600' : order.refundStatus === 'completed' ? 'text-green-600' : 'text-red-600'}`} />
                        <span className={`text-xs font-medium ${order.refundStatus === 'pending' ? 'text-amber-700' : order.refundStatus === 'completed' ? 'text-green-700' : 'text-red-700'}`}>
                          Refund {order.refundStatus}{order.refundAmount ? ` • ₹${order.refundAmount}` : ''}
                        </span>
                      </div>
                      {(order.refundStatus === 'pending' || order.refundStatus === 'failed') && (
                        <button 
                          onClick={() => processRefund(order.orderId)} 
                          disabled={updatingId === order._id}
                          className="px-2 py-1 bg-green-500 hover:bg-green-600 text-white text-xs font-medium rounded-lg transition-all disabled:opacity-50 flex items-center gap-1"
                        >
                          {updatingId === order._id ? (
                            <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                          Process
                        </button>
                      )}
                    </div>
                  )}

                  {/* Payment & Total */}
                  <div className="flex items-center justify-between pt-2 border-t border-dark-100 mt-auto">
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-dark-300" />
                      <span className="text-sm text-dark-500">{order.paymentMethod?.toUpperCase()}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        order.paymentStatus === 'paid' ? 'bg-green-50 text-green-700' : 
                        order.paymentStatus === 'refunded' ? 'bg-red-100 text-red-700' : 
                        order.paymentStatus === 'refund_processing' ? 'bg-pink-50 text-pink-700' :
                        'bg-amber-50 text-amber-700'
                      }`}>
                        {order.paymentMethod === 'cod' && order.paymentStatus === 'pending' ? 'COD' : 
                         order.paymentStatus === 'refund_processing' ? 'Refund Processing' : 
                         order.paymentStatus}
                      </span>
                    </div>
                    <span className="text-lg font-bold text-dark-900">₹{order.totalAmount}</span>
                  </div>
                </div>

                {/* Actions */}
                {(getActionButton(order) || (!['delivered', 'cancelled', 'refunded'].includes(order.status) && order.refundStatus !== 'completed' && order.refundStatus !== 'pending' && order.paymentMethod === 'cod')) && (
                  <div className="px-5 pb-5 flex items-center gap-2">
                    {getActionButton(order)}
                    {!['delivered', 'cancelled', 'refunded'].includes(order.status) && order.refundStatus !== 'completed' && order.refundStatus !== 'pending' && order.paymentMethod === 'cod' && (
                      <button onClick={() => { if(confirm('Cancel this order?')) updateStatus(order._id, 'cancelled'); }} disabled={updatingId === order._id}
                        className="px-4 py-2 bg-white border border-dark-200 text-dark-600 rounded-xl text-sm font-medium hover:bg-dark-50 hover:border-dark-300 transition-all disabled:opacity-50">
                        Cancel
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Delivery Partner Selection Modal */}
      {showDeliveryModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[80vh] overflow-hidden">
            <div className="px-5 py-4 border-b border-dark-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-dark-900">Select Delivery Partner</h3>
                <p className="text-sm text-dark-400">Order #{selectedOrder?.orderId}</p>
              </div>
              <button onClick={() => { setShowDeliveryModal(false); setSelectedOrder(null); }} 
                className="w-8 h-8 rounded-lg bg-dark-100 flex items-center justify-center hover:bg-dark-200 transition-colors">
                <X className="w-4 h-4 text-dark-500" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto max-h-[60vh]">
              {loadingPartners ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-8 h-8 border-3 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
                </div>
              ) : deliveryPartners.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-dark-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <User className="w-8 h-8 text-dark-300" />
                  </div>
                  <p className="text-dark-500">No delivery partners found</p>
                  <p className="text-dark-400 text-sm mt-1">Add delivery partners in the Delivery section</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Sort: Online first, then by name */}
                  {[...deliveryPartners]
                    .sort((a, b) => {
                      if (a.isOnline && !b.isOnline) return -1;
                      if (!a.isOnline && b.isOnline) return 1;
                      return a.name.localeCompare(b.name);
                    })
                    .map(partner => (
                    <button
                      key={partner._id}
                      onClick={() => partner.isActive && assignAndPrepare(partner._id)}
                      disabled={updatingId || !partner.isActive}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl transition-colors text-left ${
                        !partner.isActive 
                          ? 'bg-dark-100 opacity-60 cursor-not-allowed' 
                          : 'bg-dark-50 hover:bg-primary-50'
                      } disabled:opacity-50`}
                    >
                      <div className="relative">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0 ${
                          partner.isActive ? 'bg-gradient-to-br from-primary-100 to-primary-200' : 'bg-dark-200'
                        }`}>
                          {partner.photo ? (
                            <img src={partner.photo} alt={partner.name} className="w-full h-full object-cover" />
                          ) : (
                            <span className={`text-lg font-bold ${partner.isActive ? 'text-primary-700' : 'text-dark-400'}`}>
                              {partner.name[0].toUpperCase()}
                            </span>
                          )}
                        </div>
                        {/* Online/Offline indicator dot */}
                        <span className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-white ${
                          partner.isOnline ? 'bg-green-500' : 'bg-dark-300'
                        }`}></span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-dark-900 truncate">{partner.name}</p>
                          {!partner.isActive && (
                            <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Inactive</span>
                          )}
                        </div>
                        <p className="text-sm text-dark-400">{partner.phone}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                            partner.isOnline 
                              ? 'bg-green-100 text-green-700' 
                              : 'bg-dark-100 text-dark-500'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${partner.isOnline ? 'bg-green-500' : 'bg-dark-400'}`}></span>
                            {partner.isOnline ? 'Online' : 'Offline'}
                          </span>
                          {partner.avgRating > 0 && (
                            <span className="text-xs text-amber-600 font-medium">⭐ {partner.avgRating.toFixed(1)}</span>
                          )}
                        </div>
                      </div>
                      <Truck className={`w-5 h-5 ${partner.isActive ? 'text-primary-400' : 'text-dark-300'}`} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-dark-100 bg-dark-50">
              <button 
                onClick={() => updateStatus(selectedOrder?._id, 'preparing')}
                disabled={updatingId}
                className="w-full py-2.5 text-sm font-medium text-dark-500 hover:text-dark-700 transition-colors disabled:opacity-50"
              >
                Skip - Assign Later
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      ) : (
        /* Order History Tab */
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-dark-900">Order History</h2>
              <p className="text-sm text-dark-400">{filteredHistory.length} archived orders</p>
            </div>
            <div className="flex gap-3 w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-initial">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
                <input type="text" placeholder="Search history..." value={historySearchTerm} onChange={(e) => setHistorySearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2.5 bg-white border border-dark-200 rounded-xl w-full sm:w-64 focus:border-primary-500 transition-colors" />
              </div>
              <button onClick={fetchOrderHistory}
                disabled={historyLoading}
                className="flex items-center gap-2 px-4 py-2.5 bg-dark-100 rounded-xl text-dark-700 hover:bg-dark-200 transition-colors disabled:opacity-50">
                <RefreshCw className={`w-4 h-4 ${historyLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {historyLoading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              <OrderSkeleton /><OrderSkeleton /><OrderSkeleton />
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-card p-12 text-center">
              <div className="w-20 h-20 bg-dark-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <History className="w-10 h-10 text-dark-300" />
              </div>
              <h3 className="text-lg font-semibold text-dark-700">No order history</h3>
              <p className="text-dark-400 mt-1">Completed orders will appear here</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-dark-50">
                    <tr>
                      <th className="text-left px-4 py-3 text-sm font-medium text-dark-600">Order ID</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-dark-600">Customer</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-dark-600">Items</th>
                      <th className="text-center px-4 py-3 text-sm font-medium text-dark-600">Status</th>
                      <th className="text-center px-4 py-3 text-sm font-medium text-dark-600">Payment</th>
                      <th className="text-right px-4 py-3 text-sm font-medium text-dark-600">Amount</th>
                      <th className="text-right px-4 py-3 text-sm font-medium text-dark-600">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-100">
                    {filteredHistory.map((order, idx) => {
                      const orderId = order.orderId || order['Order ID'] || `#${idx + 1}`;
                      const customerName = order.customer?.name || order['Customer Name'] || order.customerName || '-';
                      const customerPhone = order.customer?.phone || order['Customer Phone'] || order.customerPhone || '';
                      const items = order.items || [];
                      const itemsSummary = typeof items === 'string' ? items : items.map(i => `${i.name} x${i.quantity}`).join(', ');
                      const status = order.status || order['Status'] || 'delivered';
                      const paymentMethod = order.paymentMethod || order['Payment Method'] || '-';
                      const totalAmount = order.totalAmount || order['Total Amount'] || 0;
                      const date = order.createdAt || order['Date'] || '';
                      const config = statusConfig[status] || statusConfig.delivered;
                      
                      return (
                        <tr key={idx} className="hover:bg-dark-50 cursor-pointer" onClick={() => setOrderDetailModal(order)}>
                          <td className="px-4 py-3 text-sm font-mono font-bold text-dark-800">{orderId}</td>
                          <td className="px-4 py-3">
                            <p className="text-sm font-medium text-dark-800">{customerName}</p>
                            <p className="text-xs text-dark-400">{customerPhone}</p>
                          </td>
                          <td className="px-4 py-3 text-sm text-dark-600 max-w-[200px] truncate">{itemsSummary || '-'}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold ${config.bg} ${config.text}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`}></span>
                              {config.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center text-sm text-dark-600 uppercase">{paymentMethod}</td>
                          <td className="px-4 py-3 text-right text-sm font-bold text-dark-900">₹{totalAmount}</td>
                          <td className="px-4 py-3 text-right text-xs text-dark-400">
                            {date ? new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Order Detail Modal */}
      {orderDetailModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setOrderDetailModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-dark-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <h3 className="text-lg font-semibold text-dark-900">Order Details</h3>
                <p className="text-sm text-dark-400">{orderDetailModal.orderId || orderDetailModal['Order ID']}</p>
              </div>
              <button onClick={() => setOrderDetailModal(null)} className="w-8 h-8 rounded-lg bg-dark-100 flex items-center justify-center hover:bg-dark-200">
                <X className="w-4 h-4 text-dark-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Customer */}
              <div className="flex items-center gap-3 p-3 bg-dark-50 rounded-xl">
                <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                  <User className="w-5 h-5 text-primary-600" />
                </div>
                <div>
                  <p className="font-medium text-dark-800">{orderDetailModal.customer?.name || orderDetailModal.customerName || '-'}</p>
                  <p className="text-sm text-dark-400">{orderDetailModal.customer?.phone || orderDetailModal.customerPhone || ''}</p>
                </div>
              </div>
              {/* Items */}
              <div>
                <h4 className="text-xs font-bold text-dark-500 uppercase mb-2">Items</h4>
                <div className="space-y-2">
                  {(orderDetailModal.items || []).map((item, i) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-dark-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        {item.image && (
                          <img src={item.image.startsWith('http') ? item.image : `${API_BASE_URL}${item.image}`} alt="" className="w-8 h-8 rounded object-cover" />
                        )}
                        <div>
                          <p className="text-sm font-medium text-dark-800">{item.name}</p>
                          <p className="text-xs text-dark-400">Qty: {item.quantity} x ₹{item.price}</p>
                        </div>
                      </div>
                      <span className="text-sm font-bold text-dark-900">₹{item.price * item.quantity}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Summary */}
              <div className="flex items-center justify-between p-3 bg-primary-50 rounded-xl">
                <span className="font-medium text-dark-700">Total</span>
                <span className="text-xl font-bold text-primary-600">₹{orderDetailModal.totalAmount || orderDetailModal['Total Amount'] || 0}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
