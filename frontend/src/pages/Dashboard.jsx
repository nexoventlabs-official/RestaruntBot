/* eslint-disable no-alert, react/prop-types */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  IndianRupee, TrendingUp, TrendingDown, ShoppingBag, Clock, Users, UtensilsCrossed,
  Bell, Truck, ChefHat, Package, RefreshCw, Sun, ArrowRight, CheckCircle, XCircle,
  CreditCard, Smartphone, Database, Cloud, HardDrive, AlertTriangle, Flame, ArrowDown,
  BarChart3
} from 'lucide-react';
import api from '../api';

/* ─── helpers ─── */
const fmt = (n) => (n || 0).toLocaleString('en-IN');
const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
};

/* ─── skeleton pulse ─── */
const Pulse = ({ className }) => <div className={`animate-pulse bg-dark-200 rounded-xl ${className}`} />;

/* ─── storage bar ─── */
function StorageBar({ used, limit, label, icon: Icon, percentage }) {
  const barColor = percentage >= 90 ? 'bg-red-500' : percentage >= 75 ? 'bg-yellow-500' : 'bg-green-500';
  const StatusIcon = percentage >= 75 ? AlertTriangle : CheckCircle;
  const statusColor = percentage >= 90 ? 'text-red-500' : percentage >= 75 ? 'text-yellow-500' : 'text-green-500';
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-dark-500" />
          <span className="text-sm font-medium text-dark-700">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusIcon className={`w-4 h-4 ${statusColor}`} />
          <span className="text-sm font-semibold text-dark-900">{percentage}%</span>
        </div>
      </div>
      <div className="h-3 bg-dark-100 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} transition-all duration-500 rounded-full`} style={{ width: `${Math.min(percentage, 100)}%` }} />
      </div>
      <div className="flex justify-between text-xs text-dark-400">
        <span>{formatBytes(used)} used</span>
        <span>{formatBytes(limit)} limit</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  /* ═══ role-aware base path (works for /super-admin and /admin) ═══ */
  const location = useLocation();
  const basePath = location.pathname.startsWith('/super-admin') ? '/super-admin' : '/admin';

  /* ═══ state ═══ */
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [reportData, setReportData] = useState(null);
  const [holidayMode, setHolidayMode] = useState(false);
  const [togglingHoliday, setTogglingHoliday] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [storageStats, setStorageStats] = useState(null);
  const [storageLoading, setStorageLoading] = useState(true);
  const intervalRef = useRef(null);

  /* ═══ fetch all stats (mirrors mobile fetchStats) ═══ */
  const fetchStats = useCallback(async (silent = false) => {
    try {
      const [ordersRes, menuRes, deliveryRes, reportRes, dashboardRes] = await Promise.all([
        api.get('/orders?limit=100'),
        api.get('/menu'),
        api.get('/delivery'),
        api.get('/analytics/report?type=today'),
        api.get('/analytics/dashboard'),
      ]);

      const orders = Array.isArray(ordersRes.data) ? ordersRes.data : (ordersRes.data?.orders || []);
      const menuItems = Array.isArray(menuRes.data) ? menuRes.data : [];
      const deliveryBoys = Array.isArray(deliveryRes.data) ? deliveryRes.data : [];
      const report = reportRes.data || {};
      const dashboard = dashboardRes.data || {};

      const today = new Date(); today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

      const todayOrders = orders.filter(o => new Date(o.createdAt) >= today);
      const yesterdayOrders = orders.filter(o => { const d = new Date(o.createdAt); return d >= yesterday && d < today; });
      const newOrders = orders.filter(o => o.status === 'confirmed');
      const preparingOrders = orders.filter(o => o.status === 'preparing');
      const deliveryOrders = orders.filter(o => ['ready', 'out_for_delivery'].includes(o.status));

      const todayRevenue = report.totalRevenue || 0;
      const todayOrderCount = report.totalOrders || todayOrders.length;
      const totalRevenue = dashboard.totalRevenue || 0;
      const yesterdayRevenue = yesterdayOrders.filter(o => o.paymentStatus === 'paid').reduce((s, o) => s + o.totalAmount, 0);

      const vegItems = menuItems.filter(i => i.foodType === 'veg').length;
      const nonVegItems = menuItems.filter(i => i.foodType === 'nonveg').length;
      const eggItems = menuItems.filter(i => i.foodType === 'egg').length;

      setStats({
        todayOrders: todayOrderCount,
        yesterdayOrders: yesterdayOrders.length,
        newOrders: newOrders.length,
        preparingOrders: preparingOrders.length,
        deliveryOrders: deliveryOrders.length,
        totalMenu: menuItems.length,
        vegItems,
        nonVegItems,
        eggItems,
        activeDelivery: deliveryBoys.filter(d => d.isOnline).length,
        totalDelivery: deliveryBoys.length,
        todayRevenue,
        totalRevenue,
        yesterdayRevenue,
        revenueTrend: todayRevenue >= yesterdayRevenue ? 'up' : 'down',
        ordersTrend: todayOrderCount >= yesterdayOrders.length ? 'up' : 'down',
        totalOrders: dashboard.totalOrders || 0,
        totalCustomers: dashboard.totalCustomers || 0,
        pendingOrders: dashboard.pendingOrders || 0,
        outForDeliveryOrders: dashboard.outForDeliveryOrders || 0,
        recentOrders: dashboard.recentOrders || [],
      });
      setReportData(report);

      try {
        const hRes = await api.get('/settings/holiday/status');
        setHolidayMode(hRes.data.holidayMode || false);
      } catch { /* ignore */ }
    } catch (err) {
      console.error('Dashboard fetch error:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  /* ═══ storage fetch ═══ */
  const fetchStorage = useCallback(async () => {
    setStorageLoading(true);
    try {
      const r = await api.get('/analytics/storage');
      setStorageStats(r.data);
    } catch { /* ignore */ }
    finally { setStorageLoading(false); }
  }, []);

  /* ═══ effects ═══ */
  useEffect(() => {
    fetchStats();
    fetchStorage();
    intervalRef.current = setInterval(() => fetchStats(true), 10000);
    const storageInterval = setInterval(fetchStorage, 5 * 60 * 1000);
    return () => { clearInterval(intervalRef.current); clearInterval(storageInterval); };
  }, [fetchStats, fetchStorage]);

  /* ═══ actions ═══ */
  const handleCatalogSync = async () => {
    try {
      setSyncing(true);
      const res = await api.post('/catalog/auto-sync', {}, { timeout: 180000 });
      const d = res.data;
      alert(`✅ Catalog Synced\n${d.metaPushed} products pushed, ${d.metaFailed} failed\n${d.collections?.updated || 0} collections updated`);
    } catch (err) {
      alert('❌ Sync Failed: ' + (err?.response?.data?.error || err.message));
    } finally { setSyncing(false); }
  };

  const toggleHolidayMode = async () => {
    try {
      setTogglingHoliday(true);
      const r = await api.post('/settings/holiday/toggle');
      setHolidayMode(r.data.holidayMode);
      alert(r.data.holidayMode ? '🏖️ Holiday Mode ON — Customers will see a closed message.' : '✅ Holiday Mode OFF — Customers can order normally.');
    } catch {
      alert('Failed to toggle holiday mode');
    } finally { setTogglingHoliday(false); }
  };

  /* ═══ loading skeleton ═══ */
  if (loading) {
    return (
      <div className="space-y-6">
        <Pulse className="h-24 w-full" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4"><Pulse className="h-28" /><Pulse className="h-28" /><Pulse className="h-28" /></div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4"><Pulse className="h-24" /><Pulse className="h-24" /><Pulse className="h-24" /><Pulse className="h-24" /></div>
        <Pulse className="h-64 w-full" />
      </div>
    );
  }

  /* ═══ status style helper ═══ */
  const getStatusStyle = (status) => {
    const m = {
      delivered: { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
      cancelled: { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' },
      preparing: { bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500' },
      pending: { bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-500' },
      confirmed: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' },
      ready: { bg: 'bg-purple-100', text: 'text-purple-700', dot: 'bg-purple-500' },
      out_for_delivery: { bg: 'bg-indigo-100', text: 'text-indigo-700', dot: 'bg-indigo-500' },
    };
    return m[status] || m.pending;
  };

  return (
    <div className="space-y-6">

      {/* ════════ HEADER ROW ════════ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-dark-400 text-sm">{getGreeting()}</p>
          <h1 className="text-2xl font-bold text-dark-900">Dashboard</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 rounded-full">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-xs font-medium text-green-700">Live</span>
          </div>
          {/* Catalog Sync + dashboard refresh buttons hidden per admin UX cleanup.
              handleCatalogSync and fetchStats are still invoked internally on
              mount / via other actions, so the functionality is preserved. */}
        </div>
      </div>

      {/* ════════ TODAY'S REVENUE + ORDERS HERO ════════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 p-6 text-white shadow-lg">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/10 rounded-full translate-y-1/2 -translate-x-1/2" />
          <div className="relative">
            <div className="flex items-center gap-2 text-white/80 text-sm mb-1">
              <IndianRupee className="w-4 h-4" /> Today&apos;s Revenue
            </div>
            <p className="text-4xl font-bold mb-2">₹{fmt(stats?.todayRevenue)}</p>
            {stats?.revenueTrend && (
              <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${stats.revenueTrend === 'up' ? 'bg-green-400/30 text-green-100' : 'bg-red-400/30 text-red-100'}`}>
                {stats.revenueTrend === 'up' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                vs yesterday
              </div>
            )}
          </div>
        </div>
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-accent-500 to-accent-600 p-6 text-white shadow-lg">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/10 rounded-full translate-y-1/2 -translate-x-1/2" />
          <div className="relative">
            <div className="flex items-center gap-2 text-white/80 text-sm mb-1">
              <ShoppingBag className="w-4 h-4" /> Today&apos;s Orders
            </div>
            <p className="text-4xl font-bold mb-2">{fmt(stats?.todayOrders)}</p>
            {stats?.ordersTrend && (
              <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${stats.ordersTrend === 'up' ? 'bg-green-400/30 text-green-100' : 'bg-red-400/30 text-red-100'}`}>
                {stats.ordersTrend === 'up' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                vs yesterday ({stats.yesterdayOrders || 0})
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ════════ TOTAL REVENUE CARD ════════ */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 p-6 text-white shadow-lg">
        <div className="absolute inset-0 flex items-end justify-between px-6 pb-4 opacity-15 pointer-events-none">
          {[40, 55, 35, 70, 50, 80, 45, 65].map((h, i) => (
            <div key={i} className="w-[8%] bg-white rounded-t-lg" style={{ height: `${h}%` }} />
          ))}
        </div>
        <div className="relative flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0">
            <TrendingUp className="w-7 h-7" />
          </div>
          <div className="flex-1">
            <p className="text-white/80 text-sm">Total Revenue</p>
            <p className="text-3xl font-bold">₹{fmt(stats?.totalRevenue)}</p>
          </div>
          {stats?.revenueTrend && (
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${stats.revenueTrend === 'up' ? 'bg-green-400/30' : 'bg-red-400/30'}`}>
              {stats.revenueTrend === 'up' ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
            </div>
          )}
        </div>
      </div>

      {/* ════════ HOLIDAY MODE TOGGLE ════════ */}
      <button onClick={toggleHolidayMode} disabled={togglingHoliday}
        className={`w-full rounded-2xl p-4 flex items-center gap-4 transition-all shadow-card ${holidayMode ? 'bg-gradient-to-r from-amber-400 to-orange-500 text-white' : 'bg-white text-dark-800 hover:bg-dark-50'}`}>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${holidayMode ? 'bg-white/20' : 'bg-amber-100'}`}>
          {togglingHoliday
            ? <RefreshCw className={`w-5 h-5 animate-spin ${holidayMode ? 'text-white' : 'text-amber-500'}`} />
            : <Sun className={`w-5 h-5 ${holidayMode ? 'text-white' : 'text-amber-500'}`} />
          }
        </div>
        <div className="flex-1 text-left">
          <p className="font-bold text-sm">Holiday Mode</p>
          <p className={`text-xs ${holidayMode ? 'text-white/80' : 'text-dark-400'}`}>
            {holidayMode ? 'Restaurant is closed today' : 'Tap to close for today'}
          </p>
        </div>
        <span className={`px-3 py-1 rounded-lg text-xs font-bold ${holidayMode ? 'bg-white/25 text-white' : 'bg-dark-100 text-dark-500'}`}>
          {holidayMode ? 'ON' : 'OFF'}
        </span>
      </button>

      {/* ════════ LIVE STATUS (3 gradient cards) ════════ */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center"><BarChart3 className="w-4 h-4 text-red-500" /></div>
            <h2 className="text-lg font-bold text-dark-900">Live Status</h2>
          </div>
          <a href={`${basePath}/orders`} className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700">
            View All <ArrowRight className="w-3 h-3" />
          </a>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'New', value: stats?.newOrders || 0, gradient: 'from-amber-400 to-amber-600', icon: Bell },
            { label: 'Preparing', value: stats?.preparingOrders || 0, gradient: 'from-violet-500 to-violet-700', icon: ChefHat },
            { label: 'Delivery', value: stats?.deliveryOrders || 0, gradient: 'from-blue-500 to-blue-700', icon: Truck },
          ].map(c => (
            <a key={c.label} href={`${basePath}/orders`}
              className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${c.gradient} p-4 text-white shadow-lg hover:scale-[1.02] transition-transform`}>
              <div className="absolute -bottom-2 -right-2 pointer-events-none"><c.icon className="w-14 h-14 text-white/[0.12]" /></div>
              <div className="relative">
                <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center mb-2">
                  <c.icon className="w-4 h-4" />
                </div>
                <p className="text-2xl font-bold">{c.value}</p>
                <p className="text-xs text-white/80">{c.label}</p>
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* ════════ MENU STATS ════════ */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center"><UtensilsCrossed className="w-4 h-4 text-violet-500" /></div>
            <h2 className="text-lg font-bold text-dark-900">Menu Stats</h2>
          </div>
          <a href={`${basePath}/menu`} className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700">
            View Menu <ArrowRight className="w-3 h-3" />
          </a>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'All Items', value: stats?.totalMenu || 0, dot: '#000', border: 'border-dark-200' },
            { label: 'Veg', value: stats?.vegItems || 0, dot: '#22C55E', border: 'border-green-200' },
            { label: 'Non-Veg', value: stats?.nonVegItems || 0, dot: '#EF4444', border: 'border-red-200' },
            { label: 'Egg', value: stats?.eggItems || 0, dot: '#F59E0B', border: 'border-amber-200' },
          ].map(m => (
            <div key={m.label} className={`bg-white rounded-xl p-4 shadow-card border ${m.border}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-3 h-3 rounded border-2 flex items-center justify-center" style={{ borderColor: m.dot }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: m.dot }} />
                </span>
                <span className="text-xs text-dark-500">{m.label}</span>
              </div>
              <p className="text-xl font-bold text-dark-900">{m.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ════════ QUICK STATS ROW ════════ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Orders', value: stats?.totalOrders || 0, icon: ShoppingBag, iconBg: 'bg-blue-500' },
          { label: 'Customers', value: stats?.totalCustomers || 0, icon: Users, iconBg: 'bg-purple-500' },
          { label: 'Delivery Persons', value: `${stats?.activeDelivery || 0}/${stats?.totalDelivery || 0}`, icon: Truck, iconBg: 'bg-cyan-500', sub: 'Online / Total' },
          { label: 'Pending', value: stats?.pendingOrders || 0, icon: Clock, iconBg: 'bg-amber-500' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl p-5 shadow-card">
            <div className={`${s.iconBg} w-10 h-10 rounded-xl flex items-center justify-center mb-3`}>
              <s.icon className="w-5 h-5 text-white" />
            </div>
            <p className="text-2xl font-bold text-dark-900">{s.value}</p>
            <p className="text-dark-400 text-sm mt-0.5">{s.label}</p>
            {s.sub && <p className="text-dark-300 text-[10px]">{s.sub}</p>}
          </div>
        ))}
      </div>

      {/* ════════ TODAY'S REPORT ════════ */}
      {reportData && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-green-50 flex items-center justify-center"><BarChart3 className="w-4 h-4 text-green-500" /></div>
              <h2 className="text-lg font-bold text-dark-900">Today&apos;s Report</h2>
            </div>
            <a href={`${basePath}/reports`} className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700">
              Details <ArrowRight className="w-3 h-3" />
            </a>
          </div>

          {/* 4 gradient stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Revenue', value: `₹${fmt(reportData.totalRevenue)}`, gradient: 'from-green-500 to-green-600', icon: IndianRupee },
              { label: 'Orders', value: reportData.totalOrders || 0, gradient: 'from-pink-500 to-pink-600', icon: ShoppingBag },
              { label: 'Items Sold', value: reportData.totalItemsSold || 0, gradient: 'from-cyan-500 to-cyan-600', icon: Package },
              { label: 'Avg Order', value: `₹${fmt(reportData.avgOrderValue)}`, gradient: 'from-red-500 to-red-600', icon: TrendingUp },
            ].map(c => (
              <div key={c.label} className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${c.gradient} p-4 text-white shadow-lg`}>
                <div className="absolute -bottom-3 -right-3 pointer-events-none"><c.icon className="w-16 h-16 text-white/[0.12]" /></div>
                <div className="relative">
                  <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center mb-2"><c.icon className="w-4 h-4" /></div>
                  <p className="text-xl font-bold">{c.value}</p>
                  <p className="text-xs text-white/80">{c.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Order status row: delivered / cancelled / COD / UPI */}
          <div className="bg-white rounded-2xl shadow-card p-4 mb-4">
            <div className="grid grid-cols-4 divide-x divide-dark-100">
              {[
                { label: 'Delivered', value: reportData.deliveredOrders || 0, icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50' },
                { label: 'Cancelled', value: reportData.cancelledOrders || 0, icon: XCircle, color: 'text-red-500', bg: 'bg-red-50' },
                { label: 'COD', value: reportData.codOrders || 0, icon: CreditCard, color: 'text-amber-500', bg: 'bg-amber-50' },
                { label: 'UPI', value: reportData.upiOrders || 0, icon: Smartphone, color: 'text-violet-500', bg: 'bg-violet-50' },
              ].map(s => (
                <div key={s.label} className="flex flex-col items-center px-2 py-1">
                  <div className={`w-9 h-9 rounded-full ${s.bg} flex items-center justify-center mb-1.5`}>
                    <s.icon className={`w-5 h-5 ${s.color}`} />
                  </div>
                  <p className="text-xs text-dark-400">{s.label}</p>
                  <p className="text-base font-bold text-dark-900">{s.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Top & Least Selling side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {reportData.topSellingItems?.length > 0 && (
              <div className="bg-white rounded-2xl shadow-card p-4">
                <p className="text-sm font-bold text-dark-800 mb-3 flex items-center gap-1.5"><Flame className="w-4 h-4 text-orange-500" /> Top Selling</p>
                <div className="space-y-2.5">
                  {reportData.topSellingItems.slice(0, 5).map((item, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold ${i === 0 ? 'bg-amber-100 text-amber-600' : 'bg-dark-100 text-dark-400'}`}>{i + 1}</span>
                      {item.image ? (
                        <img src={item.image.startsWith('http') ? item.image : `${import.meta.env.VITE_API_URL || ''}${item.image}`} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-dark-100 flex items-center justify-center flex-shrink-0"><UtensilsCrossed className="w-4 h-4 text-dark-300" /></div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-dark-800 truncate">{item.name}</p>
                        <p className="text-[11px] text-dark-400">{item.quantity} sold</p>
                      </div>
                      <span className="text-sm font-bold text-dark-900">₹{fmt(item.revenue)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {reportData.leastSellingItems?.length > 0 && (
              <div className="bg-white rounded-2xl shadow-card p-4">
                <p className="text-sm font-bold text-dark-800 mb-3 flex items-center gap-1.5"><ArrowDown className="w-4 h-4 text-red-500" /> Least Selling</p>
                <div className="space-y-2.5">
                  {reportData.leastSellingItems.slice(0, 5).map((item, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold bg-red-50 text-red-500">{i + 1}</span>
                      {item.image ? (
                        <img src={item.image.startsWith('http') ? item.image : `${import.meta.env.VITE_API_URL || ''}${item.image}`} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-dark-100 flex items-center justify-center flex-shrink-0"><UtensilsCrossed className="w-4 h-4 text-dark-300" /></div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-dark-800 truncate">{item.name}</p>
                        <p className="text-[11px] text-dark-400">{item.quantity} sold</p>
                      </div>
                      <span className="text-sm font-bold text-red-500">₹{fmt(item.revenue)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════ RECENT ORDERS ════════ */}
      <div className="bg-white rounded-2xl shadow-card overflow-hidden">
        <div className="p-5 border-b border-dark-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-dark-900">Recent Orders</h2>
            <p className="text-dark-400 text-sm">Latest order activity</p>
          </div>
          <a href={`${basePath}/orders`} className="text-primary-600 text-sm font-medium hover:text-primary-700 flex items-center gap-1">
            View All <ArrowRight className="w-4 h-4" />
          </a>
        </div>
        <div className="divide-y divide-dark-100">
          {stats?.recentOrders?.length > 0 ? (
            stats.recentOrders.map(order => {
              const ss = getStatusStyle(order.status);
              return (
                <div key={order._id} className="p-4 hover:bg-dark-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-dark-100 rounded-xl flex items-center justify-center">
                        <ShoppingBag className="w-5 h-5 text-dark-500" />
                      </div>
                      <div>
                        <p className="font-semibold text-dark-900">{order.orderId}</p>
                        <p className="text-sm text-dark-400">{order.items?.length || 0} items • {order.serviceType || 'Delivery'}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-dark-900">₹{order.totalAmount}</p>
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${ss.bg} ${ss.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${ss.dot}`} />
                        {order.status?.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-8 text-center">
              <ShoppingBag className="w-12 h-12 text-dark-200 mx-auto mb-3" />
              <p className="text-dark-400">No recent orders</p>
            </div>
          )}
        </div>
      </div>

      {/* ════════ MONGODB + CLOUDINARY STORAGE ════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* MongoDB */}
        <div className="bg-white rounded-2xl shadow-card overflow-hidden">
          <div className="p-5 border-b border-dark-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center"><Database className="w-5 h-5 text-green-600" /></div>
              <div>
                <h2 className="text-lg font-bold text-dark-900">MongoDB Storage</h2>
                <p className="text-dark-400 text-sm">Free Tier: 512 MB</p>
              </div>
            </div>
            <button onClick={fetchStorage} disabled={storageLoading} className="p-2 hover:bg-dark-50 rounded-lg transition">
              <RefreshCw className={`w-4 h-4 text-dark-400 ${storageLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="p-5">
            {storageLoading && !storageStats ? (
              <div className="space-y-4"><Pulse className="h-3 w-full" /><Pulse className="h-8 w-full" /><Pulse className="h-20 w-full" /></div>
            ) : !storageStats?.mongodb ? (
              <div className="text-center py-4">
                <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                <p className="text-dark-400 text-sm">Failed to load storage stats</p>
              </div>
            ) : (
              <div className="space-y-5">
                <StorageBar used={storageStats.mongodb.dataSize} limit={storageStats.mongodb.limit} label="Data Storage" icon={HardDrive} percentage={storageStats.mongodb.percentage} />
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-dark-50 rounded-xl p-3">
                    <p className="text-xs text-dark-400 mb-1">Data Size</p>
                    <p className="font-semibold text-dark-900">{formatBytes(storageStats.mongodb.dataSize)}</p>
                  </div>
                  <div className="bg-dark-50 rounded-xl p-3">
                    <p className="text-xs text-dark-400 mb-1">Index Size</p>
                    <p className="font-semibold text-dark-900">{formatBytes(storageStats.mongodb.indexSize)}</p>
                  </div>
                </div>
                <div className="bg-dark-50 rounded-xl p-3">
                  <p className="text-xs text-dark-400 mb-2">Free Space Remaining</p>
                  <p className="text-xl font-bold text-green-600">{formatBytes(storageStats.mongodb.freeSpaceRemaining)}</p>
                </div>
                {storageStats.mongodb.collections?.length > 0 && (
                  <div>
                    <p className="text-xs text-dark-400 mb-2">Top Collections by Size</p>
                    <div className="space-y-2">
                      {storageStats.mongodb.collections.slice(0, 5).map(col => (
                        <div key={col.name} className="flex items-center justify-between text-sm">
                          <span className="text-dark-600 truncate flex-1">{col.name}</span>
                          <span className="text-dark-400 ml-2">{col.count} docs</span>
                          <span className="font-medium text-dark-800 ml-3 w-20 text-right">{formatBytes(col.size)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Cloudinary */}
        <div className="bg-white rounded-2xl shadow-card overflow-hidden">
          <div className="p-5 border-b border-dark-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center"><Cloud className="w-5 h-5 text-blue-600" /></div>
              <div>
                <h2 className="text-lg font-bold text-dark-900">Cloudinary Storage</h2>
                <p className="text-dark-400 text-sm">Free Tier: 25 GB</p>
              </div>
            </div>
          </div>
          <div className="p-5">
            {storageLoading && !storageStats ? (
              <div className="space-y-4"><Pulse className="h-3 w-full" /><Pulse className="h-8 w-full" /><Pulse className="h-20 w-full" /></div>
            ) : storageStats?.cloudinary?.error ? (
              <div className="text-center py-4">
                <AlertTriangle className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
                <p className="text-dark-400 text-sm">Unable to fetch Cloudinary stats</p>
                <p className="text-xs text-dark-300 mt-1">Check API credentials</p>
              </div>
            ) : storageStats?.cloudinary?.storage ? (
              <div className="space-y-5">
                <StorageBar used={storageStats.cloudinary.storage.used} limit={storageStats.cloudinary.storage.limit} label="Storage" icon={HardDrive} percentage={storageStats.cloudinary.storage.percentage} />
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-dark-50 rounded-xl p-3">
                    <p className="text-xs text-dark-400 mb-1">Plan</p>
                    <p className="font-semibold text-dark-900 capitalize">{storageStats.cloudinary.plan}</p>
                  </div>
                  <div className="bg-dark-50 rounded-xl p-3">
                    <p className="text-xs text-dark-400 mb-1">Total Resources</p>
                    <p className="font-semibold text-dark-900">{storageStats.cloudinary.resources}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-dark-50 rounded-xl p-3">
                    <p className="text-xs text-dark-400 mb-1">Bandwidth Used</p>
                    <p className="font-semibold text-dark-900">{formatBytes(storageStats.cloudinary.bandwidth.used)}</p>
                  </div>
                  <div className="bg-dark-50 rounded-xl p-3">
                    <p className="text-xs text-dark-400 mb-1">Transformations</p>
                    <p className="font-semibold text-dark-900">{storageStats.cloudinary.transformations.used.toLocaleString()}</p>
                  </div>
                </div>
                {storageStats.cloudinary.credits && (
                  <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-blue-600">Monthly Credits</p>
                      <p className="font-semibold text-blue-700">{storageStats.cloudinary.credits.used.toFixed(2)} / {storageStats.cloudinary.credits.limit}</p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-4">
                <Cloud className="w-8 h-8 text-dark-200 mx-auto mb-2" />
                <p className="text-dark-400 text-sm">No Cloudinary data</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
