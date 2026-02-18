/* eslint-disable no-alert */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, X, Filter, Phone, Truck, ShoppingBag, Clock, CheckCircle, Package, ArrowRight, RefreshCw, User, MapPin, CreditCard, Image, ChevronLeft } from 'lucide-react';
import api from '../api';

/* ─── constants ─── */
const STATUS_CONFIG = {
  pending:          { color: '#F59E0B', bg: '#FEF3C7', label: 'Pending' },
  confirmed:        { color: '#3B82F6', bg: '#DBEAFE', label: 'Confirmed' },
  preparing:        { color: '#8B5CF6', bg: '#EDE9FE', label: 'Preparing' },
  ready:            { color: '#10B981', bg: '#D1FAE5', label: 'Ready' },
  out_for_delivery: { color: '#06B6D4', bg: '#CFFAFE', label: 'Out for Delivery' },
  delivered:        { color: '#22C55E', bg: '#DCFCE7', label: 'Delivered' },
  cancelled:        { color: '#EF4444', bg: '#FEE2E2', label: 'Cancelled' },
  refunded:         { color: '#6B7280', bg: '#F3F4F6', label: 'Refunded' },
};
const DELIVERY_STATUS_FLOW = ['pending','confirmed','preparing','ready','out_for_delivery','delivered'];
const PICKUP_STATUS_FLOW = ['pending','confirmed','ready','delivered'];
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'oldest', label: 'Oldest First' },
  { value: 'amount_high', label: 'Amount: High → Low' },
  { value: 'amount_low', label: 'Amount: Low → High' },
];
const HISTORY_PAYMENT_STATUS = {
  paid: { color: '#22C55E', label: 'Paid' },
  'upi/app': { color: '#3B82F6', label: 'UPI/App' },
  'paid (upi)': { color: '#22C55E', label: 'Paid (UPI)' },
  'paid (cash)': { color: '#22C55E', label: 'Paid (Cash)' },
  'paid at hotel': { color: '#22C55E', label: 'Paid at Hotel' },
  unpaid: { color: '#EF4444', label: 'Unpaid' },
  refunded: { color: '#8B5CF6', label: 'Refunded' },
  pending: { color: '#F59E0B', label: 'Pending' },
  cod: { color: '#22C55E', label: 'COD Paid' },
  cancelled_upi: { color: '#EF4444', label: 'UPI/App' },
  cancelled_payathotel: { color: '#EF4444', label: 'Pay at Hotel' },
  cancelled_cod: { color: '#EF4444', label: 'COD' },
  cancelled: { color: '#EF4444', label: 'Cancelled' },
};

/* helpers */
const fmtDate = (d) => { if (!d) return ''; const dt = new Date(d); return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); };
const fmtTime = (d) => { if (!d) return ''; return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); };
const isToday = (d) => { const dt = new Date(d); const now = new Date(); return dt.toDateString() === now.toDateString(); };
const isYesterday = (d) => { const dt = new Date(d); const y = new Date(); y.setDate(y.getDate() - 1); return dt.toDateString() === y.toDateString(); };
const isThisWeek = (d) => { const dt = new Date(d); const now = new Date(); const diff = now - dt; return diff < 7 * 86400000; };
const isThisMonth = (d) => { const dt = new Date(d); const now = new Date(); return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear(); };

/* parse history item strings: "Name Qty: 1 × ₹99 = ₹99" */
const parseItemString = (str) => {
  if (!str) return null;
  const m = str.trim().match(/^(.+?)\s*Qty:\s*(\d+)\s*[×x]\s*₹([\d.]+)\s*=\s*₹([\d.]+)$/);
  if (m) return { name: m[1].trim(), quantity: parseInt(m[2]), price: parseFloat(m[3]), totalPrice: parseFloat(m[4]) };
  const m2 = str.trim().match(/^(.+?)\s*x(\d+)\s*\(₹([\d.]+)\)$/);
  if (m2) return { name: m2[1].trim(), quantity: parseInt(m2[2]), totalPrice: parseFloat(m2[3]), price: parseFloat(m2[3]) / parseInt(m2[2]) };
  return { name: str.trim(), quantity: 1, price: 0, totalPrice: 0 };
};

export default function Orders() {
  /* ═══════════ STATE ═══════════ */
  const [mainTab, setMainTab] = useState('live'); // 'live' | 'history'
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [serviceTypeTab, setServiceTypeTab] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [dateFilter, setDateFilter] = useState('all');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  // Order detail
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Delivery partner modal
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [deliveryPartners, setDeliveryPartners] = useState([]);
  const [loadingPartners, setLoadingPartners] = useState(false);
  const [assigningPartnerId, setAssigningPartnerId] = useState(null);

  // Payment method modal (pickup completion)
  const [showPaymentMethodModal, setShowPaymentMethodModal] = useState(false);

  // Cancel confirm
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // History
  const [historyOrders, setHistoryOrders] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState('all');
  const [historyDisplayCount, setHistoryDisplayCount] = useState(15);
  const [menuItems, setMenuItems] = useState([]);
  const historyLoaded = useRef(false);

  // SSE / polling
  const sseRef = useRef(null);
  const pollRef = useRef(null);
  const POLL_INTERVAL = 15000;

  /* ═══════════ LIVE ORDERS FETCH ═══════════ */
  const fetchOrders = useCallback(async () => {
    try {
      const r = await api.get('/orders');
      setOrders(r.data || []);
    } catch { /* silent */ }
  }, []);

  /* ═══════════ SSE + POLLING ═══════════ */
  const connectSSE = useCallback(() => {
    try {
      const token = localStorage.getItem('token');
      const baseURL = (import.meta.env.VITE_API_URL || 'https://restaruntbot.onrender.com/api').replace('/api', '');
      const es = new EventSource(`${baseURL}/api/events?token=${token}`);
      es.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (data.type === 'new_order' || data.type === 'order_update' || data.type === 'order_status') {
            fetchOrders();
          }
        } catch { /* ignore */ }
      };
      es.onerror = () => { es.close(); sseRef.current = null; startPolling(); };
      sseRef.current = es;
    } catch { startPolling(); }
  }, [fetchOrders, startPolling]);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(fetchOrders, POLL_INTERVAL);
  }, [fetchOrders]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => {
    fetchOrders().finally(() => setLoading(false));
    connectSSE();
    return () => { sseRef.current?.close(); stopPolling(); };
  }, [fetchOrders, connectSSE, stopPolling]);

  /* ═══════════ HISTORY FETCH ═══════════ */
  const fetchHistory = useCallback(async (force = false) => {
    if (historyLoaded.current && !force) return;
    setHistoryLoading(true);
    try {
      const [hRes, mRes] = await Promise.all([api.get('/orders/history?limit=1000'), api.get('/menu')]);
      setHistoryOrders(hRes.data || []);
      setMenuItems(mRes.data || []);
      historyLoaded.current = true;
    } catch { /* silent */ }
    finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { if (mainTab === 'history') fetchHistory(); }, [mainTab, fetchHistory]);

  /* ═══════════ FILTERED LIVE ORDERS ═══════════ */
  const filteredOrders = useMemo(() => {
    let f = orders;
    if (serviceTypeTab !== 'all') f = f.filter(o => o.serviceType === serviceTypeTab);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      f = f.filter(o => o.orderId?.toLowerCase().includes(q) || o.customer?.name?.toLowerCase().includes(q) || o.customer?.phone?.includes(q) || o.items?.some(i => i.name?.toLowerCase().includes(q)));
    }
    if (statusFilter !== 'all') f = f.filter(o => o.status === statusFilter);
    if (paymentFilter !== 'all') f = f.filter(o => o.paymentStatus === paymentFilter);
    if (dateFilter === 'today') f = f.filter(o => isToday(o.createdAt));
    else if (dateFilter === 'yesterday') f = f.filter(o => isYesterday(o.createdAt));
    else if (dateFilter === 'week') f = f.filter(o => isThisWeek(o.createdAt));
    else if (dateFilter === 'month') f = f.filter(o => isThisMonth(o.createdAt));
    if (minAmount) f = f.filter(o => (o.totalAmount || 0) >= parseFloat(minAmount));
    if (maxAmount) f = f.filter(o => (o.totalAmount || 0) <= parseFloat(maxAmount));
    f = [...f].sort((a, b) => {
      if (sortBy === 'oldest') return new Date(a.createdAt) - new Date(b.createdAt);
      if (sortBy === 'amount_high') return (b.totalAmount || 0) - (a.totalAmount || 0);
      if (sortBy === 'amount_low') return (a.totalAmount || 0) - (b.totalAmount || 0);
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    return f;
  }, [orders, serviceTypeTab, searchTerm, statusFilter, paymentFilter, dateFilter, minAmount, maxAmount, sortBy]);

  const filterCount = useMemo(() => {
    let c = 0;
    if (paymentFilter !== 'all') c++;
    if (dateFilter !== 'all') c++;
    if (minAmount || maxAmount) c++;
    if (sortBy !== 'newest') c++;
    return c;
  }, [paymentFilter, dateFilter, minAmount, maxAmount, sortBy]);

  /* ═══════════ FILTERED HISTORY ═══════════ */
  const filteredHistory = useMemo(() => {
    let f = historyOrders;
    if (historyStatusFilter !== 'all') f = f.filter(o => o.status === historyStatusFilter);
    if (historySearchQuery.trim()) {
      const q = historySearchQuery.toLowerCase().trim();
      f = f.filter(o => o.orderId?.toLowerCase().includes(q) || o.customerName?.toLowerCase().includes(q) || o.phone?.includes(q) || o.items?.toLowerCase().includes(q));
    }
    return f;
  }, [historyOrders, historyStatusFilter, historySearchQuery]);

  const visibleHistory = useMemo(() => filteredHistory.slice(0, historyDisplayCount), [filteredHistory, historyDisplayCount]);
  const hasMoreHistory = historyDisplayCount < filteredHistory.length;

  /* ═══════════ ORDER DETAIL HELPERS ═══════════ */
  const getNextStatus = useCallback((order) => {
    if (!order) return null;
    const flow = order.serviceType === 'pickup' ? PICKUP_STATUS_FLOW : DELIVERY_STATUS_FLOW;
    const idx = flow.indexOf(order.status);
    return idx >= 0 && idx < flow.length - 1 ? flow[idx + 1] : null;
  }, []);

  const getPaymentDisplay = useCallback((order) => {
    if (!order) return { method: '', status: '', statusColor: '' };
    const isPickup = order.serviceType === 'pickup';
    const isCOD = order.paymentMethod === 'cod';
    const isDone = order.status === 'delivered';
    const isCancelled = order.status === 'cancelled';

    const method = isCOD ? (isPickup ? 'Pay at Hotel' : 'COD') : 'UPI/App';
    let status = '';
    let statusColor = '';

    if (isCancelled) { status = 'Cancelled'; statusColor = '#EF4444'; }
    else if (isCOD) {
      if (isDone) {
        const apm = order.actualPaymentMethod;
        if (apm === 'upi') { status = 'Paid (UPI)'; statusColor = '#22C55E'; }
        else { status = 'Paid (Cash)'; statusColor = '#22C55E'; }
      } else { status = 'Pending'; statusColor = '#F59E0B'; }
    } else {
      if (order.paymentStatus === 'paid') { status = 'Paid'; statusColor = '#22C55E'; }
      else { status = 'Unpaid'; statusColor = '#EF4444'; }
    }
    return { method, status, statusColor };
  }, []);

  /* ═══════════ STATUS UPDATE ═══════════ */
  const handleStatusAction = useCallback((order) => {
    const nextStatus = getNextStatus(order);
    if (!nextStatus) return;

    // Delivery order + next is preparing → show partner picker
    if (order.serviceType === 'delivery' && nextStatus === 'preparing') {
      setLoadingPartners(true);
      setShowDeliveryModal(true);
      api.get('/delivery').then(r => setDeliveryPartners(r.data || [])).catch(() => {}).finally(() => setLoadingPartners(false));
      return;
    }

    // Pickup + delivered + COD → ask payment method
    if (order.serviceType === 'pickup' && nextStatus === 'delivered' && order.paymentMethod === 'cod') {
      setShowPaymentMethodModal(true);
      return;
    }

    // Regular status update
    confirmStatusUpdate(order, nextStatus);
  }, [getNextStatus, confirmStatusUpdate]);

  const confirmStatusUpdate = useCallback(async (order, newStatus, deliveryBoyId = null, actualPaymentMethod = null) => {
    setUpdatingStatus(true);
    try {
      const body = { status: newStatus };
      if (actualPaymentMethod) body.actualPaymentMethod = actualPaymentMethod;
      const res = await api.put(`/orders/${order._id}/status`, body);
      if (deliveryBoyId) await api.put(`/orders/${order._id}/assign-delivery`, { deliveryBoyId });
      setSelectedOrder(res.data || { ...order, status: newStatus });
      setShowDeliveryModal(false);
      setShowPaymentMethodModal(false);
      await fetchOrders();
    } catch (err) { alert(err.response?.data?.error || 'Failed to update status'); }
    finally { setUpdatingStatus(false); setAssigningPartnerId(null); }
  }, [fetchOrders]);

  const handleAssignPartner = useCallback((partner) => {
    if (!selectedOrder) return;
    setAssigningPartnerId(partner._id);
    confirmStatusUpdate(selectedOrder, 'preparing', partner._id);
  }, [selectedOrder, confirmStatusUpdate]);

  const handleSkipAssignment = useCallback(() => {
    if (!selectedOrder) return;
    confirmStatusUpdate(selectedOrder, 'preparing');
  }, [selectedOrder, confirmStatusUpdate]);

  const handlePaymentMethodSelect = useCallback((method) => {
    if (!selectedOrder) return;
    confirmStatusUpdate(selectedOrder, 'delivered', null, method);
  }, [selectedOrder, confirmStatusUpdate]);

  const handleCancelOrder = useCallback(async () => {
    if (!selectedOrder) return;
    setUpdatingStatus(true);
    try {
      const res = await api.put(`/orders/${selectedOrder._id}/status`, { status: 'cancelled' });
      setSelectedOrder(res.data || { ...selectedOrder, status: 'cancelled' });
      setShowCancelConfirm(false);
      await fetchOrders();
    } catch (err) { alert(err.response?.data?.error || 'Failed to cancel'); }
    finally { setUpdatingStatus(false); }
  }, [selectedOrder, fetchOrders]);

  /* ═══════════ HISTORY CARD IMAGE LOOKUP ═══════════ */
  const findItemImage = useCallback((itemName) => {
    if (!itemName || menuItems.length === 0) return null;
    const q = itemName.toLowerCase().trim();
    for (const mi of menuItems) {
      if (mi.variants) {
        for (const v of mi.variants) {
          if (v.label?.toLowerCase().trim() === q && v.image) return v.image;
        }
      }
      if (mi.name?.toLowerCase().trim() === q) return mi.image || mi.variants?.[0]?.image;
    }
    return null;
  }, [menuItems]);

  /* Open history order in detail */
  const openHistoryOrderDetail = useCallback((ho) => {
    const mapped = {
      ...ho,
      _id: ho._id || ho.orderId,
      customer: { name: ho.customerName || '', phone: ho.phone || '' },
      deliveryAddress: { address: ho.address || '' },
      serviceType: ho.sheetType === 'selfpick' ? 'pickup' : (ho.serviceType || 'delivery'),
      items: typeof ho.items === 'string' ? ho.items.split(',').map(s => parseItemString(s)).filter(Boolean) : (ho.items || []),
      createdAt: ho.time || ho.createdAt,
      _fromHistory: true,
    };
    setSelectedOrder(mapped);
  }, []);

  /* ═══════════ LOADING ═══════════ */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  /* ═══════════ RENDER ═══════════ */
  return (
    <div className="space-y-4">
      {/* ── HEADER ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark-900">Orders</h1>
          <p className="text-dark-500 mt-0.5">{orders.length} active &bull; Real-time</p>
        </div>
        <button onClick={() => fetchOrders()} className="p-2 bg-dark-100 rounded-lg hover:bg-dark-200 transition-colors">
          <RefreshCw className="w-4 h-4 text-dark-600" />
        </button>
      </div>

      {/* ── MAIN TABS ── */}
      <div className="flex bg-dark-100 rounded-xl p-1">
        {['live','history'].map(t => (
          <button key={t} onClick={() => { setMainTab(t); setSelectedOrder(null); }}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all capitalize ${mainTab === t ? 'bg-white text-dark-900 shadow-sm' : 'text-dark-500 hover:text-dark-700'}`}>
            {t === 'live' ? `Live Orders (${orders.length})` : 'History'}
          </button>
        ))}
      </div>

      {/* ═══════════ LIVE ORDERS TAB ═══════════ */}
      {mainTab === 'live' && !selectedOrder && (
        <>
          {/* Service type tabs */}
          <div className="flex gap-2">
            {[{ key: 'all', label: 'All', icon: Package }, { key: 'delivery', label: 'Delivery', icon: Truck }, { key: 'pickup', label: 'Pickup', icon: ShoppingBag }].map(st => (
              <button key={st.key} onClick={() => setServiceTypeTab(st.key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${serviceTypeTab === st.key ? 'bg-primary-500 text-white' : 'bg-white text-dark-600 border border-dark-200'}`}>
                <st.icon className="w-3.5 h-3.5" /> {st.label}
              </button>
            ))}
          </div>

          {/* Search + filter */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
              <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search orders..."
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-dark-200 rounded-xl text-sm" />
            </div>
            <button onClick={() => setShowFilterPanel(!showFilterPanel)}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium border transition-all relative ${showFilterPanel ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white border-dark-200 text-dark-600'}`}>
              <Filter className="w-4 h-4" /> Filters
              {filterCount > 0 && <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold">{filterCount}</span>}
            </button>
          </div>

          {/* Status filter chips */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
            {['all', ...Object.keys(STATUS_CONFIG)].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all capitalize ${statusFilter === s ? 'text-white' : 'bg-white text-dark-600 border border-dark-200'}`}
                style={statusFilter === s ? { backgroundColor: s === 'all' ? '#6366F1' : STATUS_CONFIG[s]?.color } : {}}>
                {s === 'all' ? `All (${orders.length})` : STATUS_CONFIG[s]?.label}
              </button>
            ))}
          </div>

          {/* Filter panel */}
          {showFilterPanel && (
            <div className="bg-white rounded-2xl border border-dark-200 p-4 space-y-4 shadow-lg">
              <div>
                <label className="block text-xs font-semibold text-dark-500 mb-1.5">Payment</label>
                <div className="flex gap-1.5 flex-wrap">
                  {['all','paid','pending','failed','refunded'].map(p => (
                    <button key={p} onClick={() => setPaymentFilter(p)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium capitalize ${paymentFilter === p ? 'bg-primary-500 text-white' : 'bg-dark-100 text-dark-600'}`}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-dark-500 mb-1.5">Date</label>
                <div className="flex gap-1.5 flex-wrap">
                  {['all','today','yesterday','week','month'].map(d => (
                    <button key={d} onClick={() => setDateFilter(d)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium capitalize ${dateFilter === d ? 'bg-primary-500 text-white' : 'bg-dark-100 text-dark-600'}`}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-dark-500 mb-1">Min Amount</label>
                  <input type="number" value={minAmount} onChange={e => setMinAmount(e.target.value)} placeholder="₹0"
                    className="w-full px-3 py-2 bg-dark-50 border border-dark-200 rounded-lg text-xs" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-dark-500 mb-1">Max Amount</label>
                  <input type="number" value={maxAmount} onChange={e => setMaxAmount(e.target.value)} placeholder="₹∞"
                    className="w-full px-3 py-2 bg-dark-50 border border-dark-200 rounded-lg text-xs" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-dark-500 mb-1.5">Sort By</label>
                <div className="flex gap-1.5 flex-wrap">
                  {SORT_OPTIONS.map(s => (
                    <button key={s.value} onClick={() => setSortBy(s.value)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium ${sortBy === s.value ? 'bg-primary-500 text-white' : 'bg-dark-100 text-dark-600'}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={() => { setPaymentFilter('all'); setDateFilter('all'); setMinAmount(''); setMaxAmount(''); setSortBy('newest'); }}
                className="w-full py-2 text-xs font-medium text-red-500 border border-red-200 rounded-lg hover:bg-red-50">
                Clear All Filters
              </button>
            </div>
          )}

          {/* Order cards */}
          {filteredOrders.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center">
              <Package className="w-16 h-16 text-dark-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-dark-900 mb-2">No Orders Found</h3>
              <p className="text-dark-500">Try adjusting your filters.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredOrders.map(order => {
                const sc = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
                const isPickup = order.serviceType === 'pickup';
                const displayStatus = isPickup && order.status === 'delivered' ? 'Completed' : sc.label;
                return (
                  <button key={order._id} onClick={() => setSelectedOrder(order)}
                    className="bg-white rounded-2xl p-4 shadow-card text-left hover:shadow-lg transition-all border border-transparent hover:border-primary-200 w-full">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-dark-900">#{order.orderId}</span>
                        {isPickup && <span className="px-1.5 py-0.5 text-[9px] font-bold bg-blue-100 text-blue-700 rounded">PICKUP</span>}
                      </div>
                      <span className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ backgroundColor: sc.bg, color: sc.color }}>
                        {displayStatus}
                      </span>
                    </div>
                    {/* Customer */}
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded-full bg-dark-100 flex items-center justify-center flex-shrink-0">
                        <User className="w-4 h-4 text-dark-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-dark-800 truncate">{order.customer?.name || 'Customer'}</p>
                        <p className="text-[11px] text-dark-400">{order.customer?.phone}</p>
                      </div>
                    </div>
                    {/* Items preview */}
                    <div className="mb-2">
                      <p className="text-xs text-dark-500 truncate">
                        {order.items?.map(i => `${i.name} ×${i.quantity}`).join(', ') || 'No items'}
                      </p>
                    </div>
                    {/* Footer */}
                    <div className="flex items-center justify-between pt-2 border-t border-dark-100">
                      <span className="text-sm font-bold text-dark-900">₹{order.totalAmount || 0}</span>
                      <div className="flex items-center gap-2">
                        {order.paymentMethod === 'cod' ?
                          <span className="text-[10px] font-bold px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded">{isPickup ? 'Pay at Hotel' : 'COD'}</span> :
                          order.paymentStatus === 'paid' ?
                            <span className="text-[10px] font-bold px-1.5 py-0.5 bg-green-100 text-green-700 rounded">Paid</span> :
                            <span className="text-[10px] font-bold px-1.5 py-0.5 bg-red-100 text-red-700 rounded">Unpaid</span>
                        }
                        <span className="text-[10px] text-dark-400">{fmtTime(order.createdAt)}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ═══════════ ORDER DETAIL VIEW ═══════════ */}
      {selectedOrder && (
        <div className="bg-white rounded-2xl shadow-card overflow-hidden">
          {/* Detail header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-dark-100">
            <button onClick={() => setSelectedOrder(null)} className="p-2 hover:bg-dark-100 rounded-lg">
              <ChevronLeft className="w-5 h-5 text-dark-600" />
            </button>
            <div className="flex-1">
              <h2 className="font-bold text-lg text-dark-900">Order #{selectedOrder.orderId}</h2>
              <p className="text-xs text-dark-400">{fmtDate(selectedOrder.createdAt)}</p>
            </div>
            {selectedOrder.serviceType === 'pickup' && <span className="px-2.5 py-1 text-xs font-bold bg-blue-100 text-blue-700 rounded-lg">PICKUP</span>}
          </div>

          <div className="p-5 space-y-5">
            {/* Status card */}
            {(() => {
              const sc = STATUS_CONFIG[selectedOrder.status] || STATUS_CONFIG.pending;
              const isPickup = selectedOrder.serviceType === 'pickup';
              const displayLabel = isPickup && selectedOrder.status === 'delivered' ? 'Completed' : sc.label;
              return (
                <div className="rounded-xl p-4" style={{ backgroundColor: sc.bg }}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: sc.color + '22' }}>
                      <CheckCircle className="w-5 h-5" style={{ color: sc.color }} />
                    </div>
                    <div>
                      <p className="font-bold text-base" style={{ color: sc.color }}>{displayLabel}</p>
                      <p className="text-xs text-dark-500">{isPickup ? 'Pickup Order' : 'Delivery Order'}</p>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Status stepper */}
            {(() => {
              const flow = selectedOrder.serviceType === 'pickup' ? PICKUP_STATUS_FLOW : DELIVERY_STATUS_FLOW;
              const currentIdx = flow.indexOf(selectedOrder.status);
              if (selectedOrder.status === 'cancelled' || selectedOrder.status === 'refunded') return null;
              return (
                <div className="flex items-center gap-0">
                  {flow.map((step, i) => {
                    const sc = STATUS_CONFIG[step];
                    const isDone = i <= currentIdx;
                    const isCurrent = i === currentIdx;
                    return (
                      <div key={step} className="flex items-center flex-1 min-w-0">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold border-2 transition-all ${
                          isDone ? 'text-white border-transparent' : 'border-dark-200 text-dark-400 bg-white'
                        } ${isCurrent ? 'ring-2 ring-offset-1' : ''}`}
                          style={isDone ? { backgroundColor: sc.color, ...(isCurrent ? { ringColor: sc.color } : {}) } : (isCurrent ? { ringColor: sc.color } : {})}>
                          {isDone ? '✓' : i + 1}
                        </div>
                        {i < flow.length - 1 && <div className={`h-0.5 flex-1 mx-1 rounded ${i < currentIdx ? 'bg-green-400' : 'bg-dark-200'}`} />}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Customer details */}
            <div className="rounded-xl bg-dark-50 p-4 space-y-3">
              <p className="text-xs font-bold text-dark-500 uppercase tracking-wide">Customer</p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                  <User className="w-5 h-5 text-primary-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-dark-900">{selectedOrder.customer?.name || selectedOrder.customerName || 'Customer'}</p>
                  <p className="text-xs text-dark-500">{selectedOrder.customer?.phone || selectedOrder.phone || ''}</p>
                </div>
                {(selectedOrder.customer?.phone || selectedOrder.phone) && (
                  <a href={`tel:${selectedOrder.customer?.phone || selectedOrder.phone}`}
                    className="w-9 h-9 bg-green-100 text-green-600 rounded-full flex items-center justify-center hover:bg-green-200 transition-colors">
                    <Phone className="w-4 h-4" />
                  </a>
                )}
              </div>
              {(selectedOrder.deliveryAddress?.address || selectedOrder.address) && (
                <div className="flex items-start gap-2 pt-2 border-t border-dark-200/50">
                  <MapPin className="w-4 h-4 text-dark-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-dark-600">{selectedOrder.deliveryAddress?.address || selectedOrder.address || selectedOrder.customer?.address || ''}</p>
                </div>
              )}
            </div>

            {/* Order items */}
            <div className="rounded-xl bg-dark-50 p-4 space-y-3">
              <p className="text-xs font-bold text-dark-500 uppercase tracking-wide">Items</p>
              <div className="space-y-2">
                {(selectedOrder.items || []).map((item, i) => (
                  <div key={i} className="flex items-center gap-3 py-1.5">
                    <div className="w-10 h-10 rounded-lg bg-dark-100 overflow-hidden flex-shrink-0">
                      {(item.image || item.variantImage || findItemImage(item.name)) ?
                        <img src={item.image || item.variantImage || findItemImage(item.name)} alt="" className="w-full h-full object-cover" /> :
                        <div className="w-full h-full flex items-center justify-center"><Image className="w-4 h-4 text-dark-300" /></div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-dark-800 truncate">{item.name}</p>
                      <p className="text-[11px] text-dark-400">×{item.quantity} &bull; ₹{item.price || item.totalPrice || 0}</p>
                    </div>
                    <span className="text-sm font-bold text-dark-900">₹{item.totalPrice || (item.price * item.quantity) || 0}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-dark-200/50 pt-3 space-y-1.5">
                <div className="flex justify-between text-xs text-dark-500">
                  <span>Items Total</span>
                  <span>₹{selectedOrder.items?.reduce((s, i) => s + (i.totalPrice || i.price * i.quantity || 0), 0) || selectedOrder.totalAmount || 0}</span>
                </div>
                {selectedOrder.serviceType === 'delivery' && (
                  <div className="flex justify-between text-xs text-dark-500">
                    <span>Delivery Charge</span>
                    <span className={selectedOrder.deliveryCharge === 0 ? 'text-green-600 font-medium' : ''}>
                      {selectedOrder.deliveryCharge === 0 || !selectedOrder.deliveryCharge ? 'FREE' : `₹${selectedOrder.deliveryCharge}`}
                    </span>
                  </div>
                )}
                {selectedOrder.distance && (
                  <div className="flex justify-between text-xs text-dark-500">
                    <span>Distance</span><span>{selectedOrder.distance} km</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold text-dark-900 pt-1.5 border-t border-dark-200/50">
                  <span>Total</span><span>₹{selectedOrder.totalAmount || 0}</span>
                </div>
              </div>
            </div>

            {/* Payment info */}
            {(() => {
              const pd = getPaymentDisplay(selectedOrder);
              return (
                <div className="rounded-xl bg-dark-50 p-4 space-y-2">
                  <p className="text-xs font-bold text-dark-500 uppercase tracking-wide">Payment</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-dark-400" />
                      <span className="text-sm font-medium text-dark-800">{pd.method}</span>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg text-xs font-bold" style={{ backgroundColor: pd.statusColor + '22', color: pd.statusColor }}>
                      {pd.status}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Delivery partner */}
            {selectedOrder.assignedTo && (
              <div className="rounded-xl bg-dark-50 p-4 space-y-2">
                <p className="text-xs font-bold text-dark-500 uppercase tracking-wide">Delivery Partner</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-cyan-100 flex items-center justify-center">
                    <Truck className="w-5 h-5 text-cyan-600" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-sm text-dark-900">{selectedOrder.assignedTo?.name || 'Assigned'}</p>
                    <p className="text-xs text-cyan-600">On the way</p>
                  </div>
                </div>
              </div>
            )}

            {/* Action buttons */}
            {!selectedOrder._fromHistory && !['delivered','cancelled','refunded'].includes(selectedOrder.status) && (
              <div className="space-y-3 pt-2">
                {(() => {
                  const next = getNextStatus(selectedOrder);
                  if (!next) return null;
                  const nsc = STATUS_CONFIG[next];
                  const isPickup = selectedOrder.serviceType === 'pickup';
                  let label = '';
                  if (next === 'preparing' && selectedOrder.serviceType === 'delivery') label = 'Start Preparing';
                  else if (next === 'delivered' && isPickup) label = 'Complete Order';
                  else label = `Mark as ${nsc?.label || next}`;
                  return (
                    <button onClick={() => handleStatusAction(selectedOrder)} disabled={updatingStatus}
                      className="w-full py-3.5 rounded-xl text-white font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50"
                      style={{ backgroundColor: nsc?.color || '#6366F1' }}>
                      {updatingStatus ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                      {label}
                    </button>
                  );
                })()}
                {selectedOrder.paymentMethod === 'cod' && (
                  <button onClick={() => setShowCancelConfirm(true)} disabled={updatingStatus}
                    className="w-full py-3 rounded-xl font-medium text-sm text-red-600 border border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50">
                    Cancel Order
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════ HISTORY TAB ═══════════ */}
      {mainTab === 'history' && !selectedOrder && (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
            <input type="text" value={historySearchQuery} onChange={e => { setHistorySearchQuery(e.target.value); setHistoryDisplayCount(15); }}
              placeholder="Search by order ID, name, phone..."
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-dark-200 rounded-xl text-sm" />
          </div>
          <div className="flex gap-2">
            {['all','delivered','cancelled'].map(s => (
              <button key={s} onClick={() => { setHistoryStatusFilter(s); setHistoryDisplayCount(15); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${historyStatusFilter === s ? 'bg-primary-500 text-white' : 'bg-white text-dark-600 border border-dark-200'}`}>
                {s === 'all' ? `All (${historyOrders.length})` : s}
              </button>
            ))}
            <button onClick={() => fetchHistory(true)} disabled={historyLoading}
              className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium bg-dark-100 text-dark-600 hover:bg-dark-200 disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${historyLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {historyLoading && visibleHistory.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : visibleHistory.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center">
              <Clock className="w-16 h-16 text-dark-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-dark-900 mb-2">No History</h3>
              <p className="text-dark-500">Completed orders will appear here.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleHistory.map((ho, idx) => {
                const isDelivered = ho.status === 'delivered';
                const sc = isDelivered ? STATUS_CONFIG.delivered : STATUS_CONFIG.cancelled;
                const isPickup = ho.sheetType === 'selfpick' || ho.serviceType === 'pickup';

                // Parse items for display
                const parsedItems = typeof ho.items === 'string'
                  ? ho.items.split(',').map(s => parseItemString(s)).filter(Boolean)
                  : (ho.items || []);

                // Payment display
                const payKey = (ho.paymentStatus || ho.paymentMethod || 'pending').toLowerCase();
                const payConf = HISTORY_PAYMENT_STATUS[payKey] || HISTORY_PAYMENT_STATUS.pending;

                return (
                  <button key={ho._id || idx} onClick={() => openHistoryOrderDetail(ho)}
                    className="w-full bg-white rounded-xl p-3.5 shadow-card text-left hover:shadow-md transition-all border border-transparent hover:border-dark-200">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-dark-900">#{ho.orderId}</span>
                        {isPickup && <span className="px-1.5 py-0.5 text-[9px] font-bold bg-blue-100 text-blue-700 rounded">PICKUP</span>}
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ backgroundColor: sc.bg, color: sc.color }}>
                        {isDelivered ? (isPickup ? 'Completed' : 'Delivered') : 'Cancelled'}
                      </span>
                    </div>
                    {/* Customer */}
                    <div className="flex items-center gap-2 text-xs text-dark-600 mb-1.5">
                      <User className="w-3 h-3 text-dark-400" />
                      <span className="truncate">{ho.customerName || 'Customer'}</span>
                      {ho.phone && <><span className="text-dark-300">|</span><span>{ho.phone}</span></>}
                    </div>
                    {/* Items */}
                    <div className="flex gap-1.5 mb-2 overflow-hidden">
                      {parsedItems.slice(0, 3).map((pi, i) => {
                        const img = findItemImage(pi.name);
                        return (
                          <div key={i} className="flex items-center gap-1 px-1.5 py-0.5 bg-dark-50 rounded text-[10px] text-dark-600 flex-shrink-0">
                            {img && <img src={img} alt="" className="w-4 h-4 rounded object-cover" />}
                            <span className="truncate max-w-[80px]">{pi.name}</span>
                            <span className="text-dark-400">×{pi.quantity}</span>
                          </div>
                        );
                      })}
                      {parsedItems.length > 3 && <span className="text-[10px] text-dark-400 self-center">+{parsedItems.length - 3}</span>}
                    </div>
                    {/* Footer */}
                    <div className="flex items-center justify-between text-xs pt-1.5 border-t border-dark-50">
                      <span className="font-bold text-dark-900">₹{ho.totalAmount || ho.total || 0}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-bold px-1.5 py-0.5 rounded text-[9px]" style={{ backgroundColor: payConf.color + '22', color: payConf.color }}>
                          {payConf.label}
                        </span>
                        <span className="text-dark-400">{ho.time ? fmtTime(ho.time) : fmtTime(ho.createdAt)}</span>
                      </div>
                    </div>
                  </button>
                );
              })}

              {/* Load more */}
              {hasMoreHistory && (
                <button onClick={() => setHistoryDisplayCount(c => c + 20)}
                  className="w-full py-3 text-sm font-medium text-primary-600 bg-primary-50 rounded-xl hover:bg-primary-100 transition-colors">
                  Load More ({filteredHistory.length - historyDisplayCount} remaining)
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* ═══════════ DELIVERY PARTNER MODAL ═══════════ */}
      {showDeliveryModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col">
            <div className="border-b border-dark-100 px-6 py-4 flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-bold text-dark-900">Assign Delivery Partner</h3>
              <button onClick={() => setShowDeliveryModal(false)} className="p-2 hover:bg-dark-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-2">
              {loadingPartners ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-3 border-primary-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : deliveryPartners.length === 0 ? (
                <p className="text-center text-dark-500 py-8">No delivery partners found.</p>
              ) : (
                [...deliveryPartners].sort((a, b) => (b.isOnline ? 1 : 0) - (a.isOnline ? 1 : 0) || a.name.localeCompare(b.name)).map(p => (
                  <button key={p._id} onClick={() => handleAssignPartner(p)} disabled={assigningPartnerId === p._id}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${p.isOnline ? 'border-green-200 hover:bg-green-50' : 'border-dark-200 hover:bg-dark-50 opacity-60'} ${assigningPartnerId === p._id ? 'opacity-50' : ''}`}>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${p.isOnline ? 'bg-green-100' : 'bg-dark-100'}`}>
                      <Truck className={`w-5 h-5 ${p.isOnline ? 'text-green-600' : 'text-dark-400'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-dark-800">{p.name}</p>
                      <p className="text-[11px] text-dark-500">{p.phone}</p>
                    </div>
                    <div className="text-right">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${p.isOnline ? 'bg-green-100 text-green-700' : 'bg-dark-100 text-dark-500'}`}>
                        {p.isOnline ? 'Online' : 'Offline'}
                      </span>
                      {p.rating && <p className="text-[10px] text-dark-400 mt-0.5">⭐ {p.rating}</p>}
                    </div>
                  </button>
                ))
              )}
            </div>
            <div className="border-t border-dark-100 p-4">
              <button onClick={handleSkipAssignment} disabled={updatingStatus}
                className="w-full py-2.5 border border-dark-200 rounded-xl text-sm font-medium text-dark-600 hover:bg-dark-50 disabled:opacity-50">
                Skip — Assign Later
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ PAYMENT METHOD MODAL (Pickup Completion) ═══════════ */}
      {showPaymentMethodModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-lg font-bold text-dark-900">Complete Order</h3>
            <p className="text-sm text-dark-500">How did the customer pay?</p>
            <div className="space-y-2">
              <button onClick={() => handlePaymentMethodSelect('cash')} disabled={updatingStatus}
                className="w-full py-3 bg-green-50 text-green-700 rounded-xl font-medium hover:bg-green-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                💵 Cash
              </button>
              <button onClick={() => handlePaymentMethodSelect('upi')} disabled={updatingStatus}
                className="w-full py-3 bg-blue-50 text-blue-700 rounded-xl font-medium hover:bg-blue-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                📱 UPI
              </button>
            </div>
            <button onClick={() => setShowPaymentMethodModal(false)}
              className="w-full py-2 text-dark-500 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* ═══════════ CANCEL CONFIRM MODAL ═══════════ */}
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-lg font-bold text-dark-900">Cancel Order?</h3>
            <p className="text-sm text-dark-500">Are you sure you want to cancel this order? This action cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowCancelConfirm(false)} className="flex-1 py-2.5 border border-dark-200 rounded-xl font-medium text-dark-700">No</button>
              <button onClick={handleCancelOrder} disabled={updatingStatus}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 disabled:opacity-50">
                {updatingStatus ? 'Cancelling...' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
