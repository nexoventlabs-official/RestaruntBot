/* eslint-disable react/prop-types */
import { useState, useEffect, useCallback } from 'react';
import {
  IndianRupee, ShoppingBag, Package, TrendingUp, TrendingDown, Minus,
  CheckCircle, XCircle, CreditCard, Smartphone, Flame, ArrowDown,
  Calendar, RefreshCw, FileDown, Mail, Star, BarChart3, UtensilsCrossed,
  X, AlertCircle
} from 'lucide-react';
import api from '../api';

/* ─── helpers ─── */
const fmt = (n) => (n || 0).toLocaleString('en-IN');
const fmtCurrency = (v) => `₹${fmt(v)}`;

const REPORT_TYPES = [
  { id: 'today', label: 'Today', icon: Calendar },
  { id: 'weekly', label: 'Week', icon: Calendar },
  { id: 'monthly', label: 'Month', icon: Calendar },
  { id: 'yearly', label: 'Year', icon: Calendar },
  { id: 'custom', label: 'Custom', icon: Calendar },
];

/* ─── Skeleton ─── */
const Pulse = ({ className }) => <div className={`animate-pulse bg-dark-200 rounded-xl ${className}`} />;

/* ─── Dialog ─── */
const Dialog = ({ isOpen, onClose, title, message, type = 'info', onConfirm, confirmText = 'OK', showCancel = false }) => {
  if (!isOpen) return null;
  const icons = {
    success: <CheckCircle className="w-12 h-12 text-green-500" />,
    error: <AlertCircle className="w-12 h-12 text-red-500" />,
    confirm: <Mail className="w-12 h-12 text-blue-500" />,
    info: <AlertCircle className="w-12 h-12 text-blue-500" />,
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
        <button onClick={onClose} className="absolute top-4 right-4 text-dark-400 hover:text-dark-600"><X className="w-5 h-5" /></button>
        <div className="text-center">
          <div className="flex justify-center mb-4">{icons[type]}</div>
          <h3 className="text-lg font-semibold text-dark-900 mb-2">{title}</h3>
          <p className="text-dark-500 mb-6">{message}</p>
          <div className="flex gap-3 justify-center">
            {showCancel && <button onClick={onClose} className="px-6 py-2 bg-dark-100 text-dark-700 rounded-xl font-medium hover:bg-dark-200 transition">Cancel</button>}
            <button onClick={onConfirm || onClose}
              className={`px-6 py-2 rounded-xl font-medium transition text-white ${type === 'error' ? 'bg-red-500 hover:bg-red-600' : type === 'success' ? 'bg-green-500 hover:bg-green-600' : 'bg-primary-500 hover:bg-primary-600'}`}>
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ─── Interest badge ─── */
const InterestBadge = ({ level }) => {
  const cfg = {
    high: { Icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50', label: 'High' },
    constant: { Icon: Minus, color: 'text-yellow-600', bg: 'bg-yellow-50', label: 'Stable' },
    low: { Icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-50', label: 'Low' },
  };
  const { Icon, color, bg, label } = cfg[level] || cfg.low;
  return (
    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${bg}`}>
      <Icon className={`w-3 h-3 ${color}`} />
      <span className={`text-[11px] font-medium ${color}`}>{label}</span>
    </div>
  );
};

const getInterestLevel = (quantity, allItems) => {
  if (!allItems?.length) return 'low';
  const avg = allItems.reduce((s, i) => s + (i.quantity || 0), 0) / allItems.length;
  if (quantity >= avg * 1.5) return 'high';
  if (quantity >= avg * 0.5) return 'constant';
  return 'low';
};

/* ════════════════════════════════════════ */
export default function Reports() {
  const [reportType, setReportType] = useState('today');
  const [loading, setLoading] = useState(true);
  const [reportData, setReportData] = useState(null);
  const [dialog, setDialog] = useState({ isOpen: false, title: '', message: '', type: 'info' });
  const [sendingEmail, setSendingEmail] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  /* custom date state */
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [customApplied, setCustomApplied] = useState(false);

  /* ═══ fetch ═══ */
  const fetchReport = useCallback(async (type, from = null, to = null) => {
    setLoading(true);
    try {
      let url = `/analytics/report?type=${type}`;
      if (type === 'custom' && from && to) url += `&startDate=${new Date(from).toISOString()}&endDate=${new Date(to).toISOString()}`;
      const res = await api.get(url);
      setReportData(res.data);
    } catch {
      setReportData({ totalRevenue: 0, totalOrders: 0, totalItemsSold: 0, avgOrderValue: 0, deliveredOrders: 0, cancelledOrders: 0, refundedOrders: 0, codOrders: 0, upiOrders: 0, topSellingItems: [], leastSellingItems: [], allItemsSold: [], revenueTrend: [] });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (reportType !== 'custom') { setCustomApplied(false); fetchReport(reportType); }
  }, [reportType, fetchReport]);

  const handleCustomApply = () => {
    if (!fromDate || !toDate) return;
    if (new Date(toDate) < new Date(fromDate)) { setDialog({ isOpen: true, title: 'Invalid Range', message: '"To" date cannot be before "From" date', type: 'error' }); return; }
    setCustomApplied(true);
    fetchReport('custom', fromDate, toDate);
  };

  const handleTabChange = (id) => {
    setReportType(id);
    if (id === 'custom') {
      const today = new Date().toISOString().split('T')[0];
      const week = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      setFromDate(week); setToDate(today); setCustomApplied(false);
    }
  };

  /* ═══ helper: read error from blob response ═══ */
  const parseErrorMessage = async (err, fallback) => {
    try {
      if (err.response?.data instanceof Blob) {
        const text = await err.response.data.text();
        const json = JSON.parse(text);
        return json.error || fallback;
      }
      return err.response?.data?.error || fallback;
    } catch { return fallback; }
  };

  /* ═══ PDF download ═══ */
  const handleDownloadPdf = async () => {
    if (!reportData || generatingPdf) return;
    setGeneratingPdf(true);
    try {
      const r = await api.post('/analytics/report/download-pdf', { reportData, reportType }, { responseType: 'blob', timeout: 120000 });
      const url = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
      const a = document.createElement('a'); a.href = url;
      a.setAttribute('download', `FoodAdmin_${reportType}_Report_${new Date().toISOString().split('T')[0]}.pdf`);
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF download error:', err);
      const msg = await parseErrorMessage(err, 'Failed to generate PDF report');
      setDialog({ isOpen: true, title: 'Download Failed', message: msg, type: 'error' });
    } finally { setGeneratingPdf(false); }
  };

  /* ═══ email ═══ */
  const handleSendEmail = () => {
    if (!reportData) return;
    setDialog({
      isOpen: true, title: 'Send Report', message: 'Send this report via email to the configured address?',
      type: 'confirm', showCancel: true, confirmText: 'Send',
      onConfirm: async () => {
        setDialog({ isOpen: false });
        setSendingEmail(true);
        try {
          const r = await api.post('/analytics/report/send-email', { reportData, reportType }, { timeout: 120000 });
          setDialog({ isOpen: true, title: 'Sent!', message: r.data.message || 'Report emailed successfully', type: 'success' });
        } catch (err) {
          console.error('Email send error:', err);
          setDialog({ isOpen: true, title: 'Failed', message: err.response?.data?.error || 'Failed to send email', type: 'error' });
        } finally { setSendingEmail(false); }
      },
    });
  };

  /* ═══ revenue chart ═══ */
  const RevenueTrendChart = ({ data }) => {
    if (!data?.length) return null;
    const max = Math.max(...data.map(d => d.revenue || 0), 1);
    return (
      <div className="bg-white rounded-2xl shadow-card p-5">
        <h3 className="font-bold text-dark-900 mb-4 flex items-center gap-2"><TrendingUp className="w-5 h-5 text-primary-500" /> Revenue Trend</h3>
        <div className="flex items-end gap-1.5 h-44">
          {data.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[10px] text-dark-400 font-medium">₹{fmt(d.revenue)}</span>
              <div className="w-full bg-dark-100 rounded-t-lg relative" style={{ height: '120px' }}>
                <div className="absolute bottom-0 w-full bg-gradient-to-t from-primary-600 to-primary-400 rounded-t-lg transition-all duration-500" style={{ height: `${(d.revenue / max) * 100}%` }} />
              </div>
              <span className="text-[10px] text-dark-400 truncate w-full text-center">{d.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  /* ═══════════════════════════════════════ RENDER ═══════════════════════════════════════ */
  return (
    <div className="space-y-6">

      {/* ════ HEADER ════ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-dark-900">Reports & Analytics</h1>
          <p className="text-dark-400 text-sm">Track your business performance</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleDownloadPdf} disabled={!reportData || loading || generatingPdf}
            className="flex items-center gap-1.5 px-3 py-2 bg-green-500 text-white rounded-xl text-sm font-medium hover:bg-green-600 transition disabled:opacity-50" title="Download PDF">
            {generatingPdf ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            <span className="hidden sm:inline">{generatingPdf ? 'Generating…' : 'PDF'}</span>
          </button>
          <button onClick={handleSendEmail} disabled={!reportData || loading || sendingEmail}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium hover:bg-blue-600 transition disabled:opacity-50" title="Email Report">
            {sendingEmail ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            <span className="hidden sm:inline">{sendingEmail ? 'Sending…' : 'Email'}</span>
          </button>
          <button onClick={() => fetchReport(reportType, fromDate, toDate)} className="p-2 bg-dark-100 rounded-xl hover:bg-dark-200 transition">
            <RefreshCw className="w-4 h-4 text-dark-600" />
          </button>
        </div>
      </div>

      {/* ════ REPORT TABS ════ */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {REPORT_TYPES.map(t => (
          <button key={t.id} onClick={() => handleTabChange(t.id)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${
              reportType === t.id ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/25' : 'bg-white text-dark-600 shadow-card hover:bg-dark-50'
            }`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* ════ CUSTOM DATE PICKER ════ */}
      {reportType === 'custom' && (
        <div className="bg-white rounded-2xl shadow-card p-4">
          <p className="text-xs text-dark-400 mb-3">{!customApplied ? 'Select a date range to view report' : 'Tap dates to change range'}</p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-dark-600 mb-1">From</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                className="px-3 py-2 border border-dark-200 rounded-xl text-sm focus:border-primary-500 outline-none" />
            </div>
            <span className="text-dark-300 pb-2">→</span>
            <div>
              <label className="block text-xs font-medium text-dark-600 mb-1">To</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                className="px-3 py-2 border border-dark-200 rounded-xl text-sm focus:border-primary-500 outline-none" />
            </div>
            <button onClick={handleCustomApply}
              className="px-5 py-2 bg-primary-500 text-white rounded-xl text-sm font-medium hover:bg-primary-600 transition">
              Apply
            </button>
          </div>
          {customApplied && (
            <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 bg-primary-50 rounded-full">
              <Calendar className="w-3.5 h-3.5 text-primary-600" />
              <span className="text-xs font-medium text-primary-700">{new Date(fromDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} – {new Date(toDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
            </div>
          )}
        </div>
      )}

      {/* ════ LOADING SKELETON ════ */}
      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4"><Pulse className="h-32" /><Pulse className="h-32" /><Pulse className="h-32" /><Pulse className="h-32" /></div>
          <Pulse className="h-20 w-full" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4"><Pulse className="h-64" /><Pulse className="h-64" /></div>
        </div>
      ) : reportData ? (
        <>
          {/* ════ 4 GRADIENT STAT CARDS (like mobile ReportDetailScreen) ════ */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Revenue', value: fmtCurrency(reportData.totalRevenue), gradient: 'from-green-500 to-green-600', icon: IndianRupee },
              { label: 'Orders', value: reportData.totalOrders || 0, gradient: 'from-pink-500 to-pink-600', icon: ShoppingBag },
              { label: 'Items Sold', value: reportData.totalItemsSold || 0, gradient: 'from-cyan-500 to-cyan-600', icon: Package },
              { label: 'Avg Order', value: fmtCurrency(reportData.avgOrderValue), gradient: 'from-red-500 to-red-600', icon: TrendingUp },
            ].map(c => (
              <div key={c.label} className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${c.gradient} p-5 text-white shadow-lg`}>
                <div className="absolute -bottom-3 -right-3 pointer-events-none"><c.icon className="w-16 h-16 text-white/[0.12]" /></div>
                <div className="relative">
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center mb-3"><c.icon className="w-5 h-5" /></div>
                  <p className="text-2xl font-bold">{c.value}</p>
                  <p className="text-sm text-white/80 mt-0.5">{c.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* ════ ORDER & PAYMENT STATUS ROW (like mobile) ════ */}
          <div className="bg-white rounded-2xl shadow-card p-5">
            <div className="grid grid-cols-4 divide-x divide-dark-100">
              {[
                { label: 'Delivered', value: reportData.deliveredOrders || 0, icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50' },
                { label: 'Cancelled', value: reportData.cancelledOrders || 0, icon: XCircle, color: 'text-red-500', bg: 'bg-red-50' },
                { label: 'COD', value: reportData.codOrders || 0, icon: CreditCard, color: 'text-amber-500', bg: 'bg-amber-50' },
                { label: 'UPI', value: reportData.upiOrders || 0, icon: Smartphone, color: 'text-violet-500', bg: 'bg-violet-50' },
              ].map(s => (
                <div key={s.label} className="flex flex-col items-center px-2 py-1">
                  <div className={`w-10 h-10 rounded-full ${s.bg} flex items-center justify-center mb-1.5`}>
                    <s.icon className={`w-5 h-5 ${s.color}`} />
                  </div>
                  <p className="text-xs text-dark-400">{s.label}</p>
                  <p className="text-lg font-bold text-dark-900">{s.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ════ REVENUE TREND CHART ════ */}
          {reportData.revenueTrend?.length > 0 && <RevenueTrendChart data={reportData.revenueTrend} />}

          {/* ════ TOP & LEAST SELLING (side by side like mobile) ════ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top Selling */}
            {reportData.topSellingItems?.length > 0 && (
              <div className="bg-white rounded-2xl shadow-card p-5">
                <h3 className="font-bold text-dark-900 mb-3 flex items-center gap-1.5"><Flame className="w-5 h-5 text-orange-500" /> Top Selling</h3>
                <div className="space-y-2.5">
                  {reportData.topSellingItems.slice(0, 5).map((item, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${i < 3 ? 'bg-amber-100 text-amber-600' : 'bg-dark-100 text-dark-400'}`}>{i + 1}</span>
                      {item.image ? (
                        <img src={item.image.startsWith('http') ? item.image : `${import.meta.env.VITE_API_URL || ''}${item.image}`} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-dark-100 flex items-center justify-center flex-shrink-0"><UtensilsCrossed className="w-4 h-4 text-dark-300" /></div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-dark-800 truncate">{item.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-dark-400">{item.quantity} sold</span>
                          {item.avgRating > 0 && (
                            <span className="flex items-center gap-0.5 text-[11px] text-amber-500"><Star className="w-3 h-3 fill-amber-400 text-amber-400" />{item.avgRating.toFixed(1)}</span>
                          )}
                        </div>
                      </div>
                      <span className="text-sm font-bold text-green-600">₹{fmt(item.revenue)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Least Selling */}
            {reportData.leastSellingItems?.length > 0 && (
              <div className="bg-white rounded-2xl shadow-card p-5">
                <h3 className="font-bold text-dark-900 mb-3 flex items-center gap-1.5"><ArrowDown className="w-5 h-5 text-red-500" /> Least Selling</h3>
                <div className="space-y-2.5">
                  {reportData.leastSellingItems.slice(0, 5).map((item, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold bg-red-50 text-red-500">{i + 1}</span>
                      {item.image ? (
                        <img src={item.image.startsWith('http') ? item.image : `${import.meta.env.VITE_API_URL || ''}${item.image}`} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-dark-100 flex items-center justify-center flex-shrink-0"><UtensilsCrossed className="w-4 h-4 text-dark-300" /></div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-dark-800 truncate">{item.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-dark-400">{item.quantity} sold</span>
                          {item.avgRating > 0 && (
                            <span className="flex items-center gap-0.5 text-[11px] text-amber-500"><Star className="w-3 h-3 fill-amber-400 text-amber-400" />{item.avgRating.toFixed(1)}</span>
                          )}
                        </div>
                      </div>
                      <span className="text-sm font-bold text-red-500">₹{fmt(item.revenue)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ════ ALL ITEMS SOLD TABLE ════ */}
          {reportData.allItemsSold?.length > 0 && (
            <div className="bg-white rounded-2xl shadow-card overflow-hidden">
              <div className="p-5 border-b border-dark-100">
                <h3 className="font-bold text-dark-900 flex items-center gap-2"><Package className="w-5 h-5 text-blue-500" /> All Items Sold</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-dark-50">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-medium text-dark-500 w-10">#</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-dark-500 w-12"></th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-dark-500">Item Name</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-dark-500">Rating</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-dark-500">Interest</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-dark-500">Qty</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-dark-500">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-100">
                    {reportData.allItemsSold.map((item, idx) => (
                      <tr key={idx} className="hover:bg-dark-50 transition-colors">
                        <td className="px-4 py-3 text-sm text-dark-400">{idx + 1}</td>
                        <td className="px-4 py-2">
                          {item.image ? (
                            <img src={item.image.startsWith('http') ? item.image : `${import.meta.env.VITE_API_URL || ''}${item.image}`} alt="" className="w-9 h-9 rounded-lg object-cover" />
                          ) : (
                            <div className="w-9 h-9 rounded-lg bg-dark-100 flex items-center justify-center"><UtensilsCrossed className="w-4 h-4 text-dark-300" /></div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-dark-900">{item.name}</td>
                        <td className="px-4 py-3 text-center">
                          {item.totalRatings > 0 ? (
                            <span className="inline-flex items-center gap-1 text-sm"><Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />{item.avgRating?.toFixed(1)}<span className="text-dark-300 text-xs">({item.totalRatings})</span></span>
                          ) : <span className="text-dark-300 text-sm">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center"><InterestBadge level={getInterestLevel(item.quantity, reportData.allItemsSold)} /></td>
                        <td className="px-4 py-3 text-sm text-dark-900 text-right font-medium">{item.quantity}</td>
                        <td className="px-4 py-3 text-sm text-dark-900 text-right font-medium">₹{fmt(item.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ════ EMPTY STATE ════ */}
          {!reportData.totalOrders && (
            <div className="bg-white rounded-2xl shadow-card p-12 text-center">
              <div className="w-20 h-20 bg-dark-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <BarChart3 className="w-10 h-10 text-dark-300" />
              </div>
              <h3 className="text-lg font-semibold text-dark-700">No data for this period</h3>
              <p className="text-dark-400 mt-1 text-sm">Orders will appear in reports once placed</p>
            </div>
          )}
        </>
      ) : (
        <div className="bg-white rounded-2xl shadow-card p-12 text-center">
          <BarChart3 className="w-16 h-16 text-dark-200 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-dark-700">No Report Data</h3>
          <p className="text-dark-400 mt-1">Select a report type to view analytics</p>
        </div>
      )}

      <Dialog isOpen={dialog.isOpen} onClose={() => setDialog({ ...dialog, isOpen: false })} title={dialog.title} message={dialog.message}
        type={dialog.type} onConfirm={dialog.onConfirm} confirmText={dialog.confirmText || 'OK'} showCancel={dialog.showCancel} />
    </div>
  );
}
