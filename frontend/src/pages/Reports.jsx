import { useState, useEffect } from 'react';
import { 
  Calendar, TrendingUp, TrendingDown, Package, DollarSign, Users, 
  ShoppingBag, BarChart3, PieChart, ArrowUp, ArrowDown, Download,
  ChevronDown, Filter, RefreshCw
} from 'lucide-react';
import api from '../api';

const REPORT_TYPES = [
  { id: 'today', label: 'Today', icon: Calendar },
  { id: 'weekly', label: 'This Week', icon: Calendar },
  { id: 'monthly', label: 'This Month', icon: Calendar },
  { id: 'yearly', label: 'This Year', icon: Calendar },
  { id: 'custom', label: 'Custom Range', icon: Filter }
];

// Simple Bar Chart Component
const BarChart = ({ data, title, valueKey = 'value', labelKey = 'label', color = 'primary' }) => {
  const maxValue = Math.max(...data.map(d => d[valueKey] || 0), 1);
  const colors = {
    primary: 'bg-primary-500',
    green: 'bg-green-500',
    orange: 'bg-orange-500',
    blue: 'bg-blue-500'
  };

  return (
    <div className="bg-white rounded-xl p-4 shadow-card">
      <h3 className="font-semibold text-dark-900 mb-4">{title}</h3>
      <div className="space-y-3">
        {data.slice(0, 10).map((item, idx) => (
          <div key={idx} className="flex items-center gap-3">
            <span className="text-sm text-dark-600 w-24 truncate">{item[labelKey]}</span>
            <div className="flex-1 h-6 bg-dark-100 rounded-full overflow-hidden">
              <div 
                className={`h-full ${colors[color]} rounded-full transition-all duration-500`}
                style={{ width: `${(item[valueKey] / maxValue) * 100}%` }}
              />
            </div>
            <span className="text-sm font-medium text-dark-900 w-16 text-right">{item[valueKey]}</span>
          </div>
        ))}
        {data.length === 0 && (
          <p className="text-dark-400 text-center py-4">No data available</p>
        )}
      </div>
    </div>
  );
};

// Stat Card Component
const StatCard = ({ title, value, subtitle, icon: Icon, trend, trendValue, color = 'primary' }) => {
  const colors = {
    primary: 'bg-primary-50 text-primary-600',
    green: 'bg-green-50 text-green-600',
    orange: 'bg-orange-50 text-orange-600',
    blue: 'bg-blue-50 text-blue-600',
    red: 'bg-red-50 text-red-600'
  };

  return (
    <div className="bg-white rounded-xl p-4 shadow-card">
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg ${colors[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-xs font-medium ${trend === 'up' ? 'text-green-600' : 'text-red-600'}`}>
            {trend === 'up' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
            {trendValue}
          </div>
        )}
      </div>
      <p className="text-2xl font-bold text-dark-900">{value}</p>
      <p className="text-sm text-dark-400 mt-1">{title}</p>
      {subtitle && <p className="text-xs text-dark-300 mt-0.5">{subtitle}</p>}
    </div>
  );
};

// Revenue Chart Component
const RevenueChart = ({ data, title }) => {
  const maxValue = Math.max(...data.map(d => d.revenue || 0), 1);
  
  return (
    <div className="bg-white rounded-xl p-4 shadow-card">
      <h3 className="font-semibold text-dark-900 mb-4">{title}</h3>
      <div className="flex items-end gap-2 h-48">
        {data.map((item, idx) => (
          <div key={idx} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full bg-dark-100 rounded-t-lg relative" style={{ height: '160px' }}>
              <div 
                className="absolute bottom-0 w-full bg-gradient-to-t from-primary-600 to-primary-400 rounded-t-lg transition-all duration-500"
                style={{ height: `${(item.revenue / maxValue) * 100}%` }}
              />
            </div>
            <span className="text-xs text-dark-400 truncate w-full text-center">{item.label}</span>
          </div>
        ))}
        {data.length === 0 && (
          <p className="text-dark-400 text-center py-4 w-full">No data available</p>
        )}
      </div>
    </div>
  );
};

export default function Reports() {
  const [reportType, setReportType] = useState('today');
  const [loading, setLoading] = useState(true);
  const [reportData, setReportData] = useState(null);
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const [showCustomPicker, setShowCustomPicker] = useState(false);

  const fetchReport = async (type, startDate = null, endDate = null) => {
    setLoading(true);
    try {
      let url = `/analytics/report?type=${type}`;
      if (type === 'custom' && startDate && endDate) {
        url += `&startDate=${startDate}&endDate=${endDate}`;
      }
      const res = await api.get(url);
      setReportData(res.data);
    } catch (err) {
      console.error('Failed to fetch report:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (reportType !== 'custom') {
      fetchReport(reportType);
    }
  }, [reportType]);

  const handleCustomRange = () => {
    if (customRange.start && customRange.end) {
      fetchReport('custom', customRange.start, customRange.end);
      setShowCustomPicker(false);
    }
  };

  const formatCurrency = (val) => `₹${(val || 0).toLocaleString()}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-dark-900">Reports & Analytics</h1>
          <p className="text-sm text-dark-400">Detailed insights about your business</p>
        </div>
        <button 
          onClick={() => fetchReport(reportType, customRange.start, customRange.end)}
          className="flex items-center gap-2 px-4 py-2 bg-dark-100 rounded-xl text-dark-700 hover:bg-dark-200 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Report Type Tabs */}
      <div className="flex flex-wrap gap-2">
        {REPORT_TYPES.map(type => (
          <button
            key={type.id}
            onClick={() => {
              setReportType(type.id);
              if (type.id === 'custom') setShowCustomPicker(true);
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all ${
              reportType === type.id 
                ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/30' 
                : 'bg-white text-dark-600 hover:bg-dark-50 shadow-card'
            }`}
          >
            <type.icon className="w-4 h-4" />
            {type.label}
          </button>
        ))}
      </div>

      {/* Custom Date Range Picker */}
      {showCustomPicker && (
        <div className="bg-white rounded-xl p-4 shadow-card flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-sm font-medium text-dark-700 mb-1">Start Date</label>
            <input
              type="date"
              value={customRange.start}
              onChange={(e) => setCustomRange({ ...customRange, start: e.target.value })}
              className="px-3 py-2 border border-dark-200 rounded-lg focus:border-primary-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-dark-700 mb-1">End Date</label>
            <input
              type="date"
              value={customRange.end}
              onChange={(e) => setCustomRange({ ...customRange, end: e.target.value })}
              className="px-3 py-2 border border-dark-200 rounded-lg focus:border-primary-500 outline-none"
            />
          </div>
          <button
            onClick={handleCustomRange}
            className="px-4 py-2 bg-primary-500 text-white rounded-lg font-medium hover:bg-primary-600 transition-colors"
          >
            Generate Report
          </button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-4 shadow-card animate-pulse">
              <div className="w-10 h-10 bg-dark-100 rounded-lg mb-3" />
              <div className="h-6 w-20 bg-dark-100 rounded mb-2" />
              <div className="h-4 w-16 bg-dark-100 rounded" />
            </div>
          ))}
        </div>
      ) : reportData ? (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              title="Total Revenue"
              value={formatCurrency(reportData.totalRevenue)}
              icon={DollarSign}
              color="green"
            />
            <StatCard
              title="Total Orders"
              value={reportData.totalOrders || 0}
              icon={ShoppingBag}
              color="blue"
            />
            <StatCard
              title="Items Sold"
              value={reportData.totalItemsSold || 0}
              icon={Package}
              color="orange"
            />
            <StatCard
              title="Avg Order Value"
              value={formatCurrency(reportData.avgOrderValue)}
              icon={TrendingUp}
              color="primary"
            />
          </div>

          {/* Order Status Breakdown */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatCard title="Delivered" value={reportData.deliveredOrders || 0} icon={Package} color="green" />
            <StatCard title="Cancelled" value={reportData.cancelledOrders || 0} icon={Package} color="red" />
            <StatCard title="Refunded" value={reportData.refundedOrders || 0} icon={Package} color="orange" />
            <StatCard title="COD Orders" value={reportData.codOrders || 0} icon={DollarSign} color="blue" />
            <StatCard title="UPI Orders" value={reportData.upiOrders || 0} icon={DollarSign} color="primary" />
          </div>

          {/* Charts Row */}
          <div className="grid md:grid-cols-2 gap-4">
            <BarChart 
              data={reportData.topSellingItems || []} 
              title="🔥 Top Selling Items" 
              valueKey="quantity" 
              labelKey="name"
              color="green"
            />
            <BarChart 
              data={reportData.leastSellingItems || []} 
              title="📉 Least Selling Items" 
              valueKey="quantity" 
              labelKey="name"
              color="orange"
            />
          </div>

          {/* Revenue by Category */}
          <BarChart 
            data={reportData.revenueByCategory || []} 
            title="💰 Revenue by Category" 
            valueKey="revenue" 
            labelKey="category"
            color="blue"
          />

          {/* Revenue Trend */}
          {reportData.revenueTrend && reportData.revenueTrend.length > 0 && (
            <RevenueChart data={reportData.revenueTrend} title="📈 Revenue Trend" />
          )}

          {/* Items Breakdown Table */}
          <div className="bg-white rounded-xl shadow-card overflow-hidden">
            <div className="p-4 border-b border-dark-100">
              <h3 className="font-semibold text-dark-900">📦 All Items Sold</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-dark-50">
                  <tr>
                    <th className="text-left px-4 py-3 text-sm font-medium text-dark-600">Item Name</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-dark-600">Category</th>
                    <th className="text-right px-4 py-3 text-sm font-medium text-dark-600">Qty Sold</th>
                    <th className="text-right px-4 py-3 text-sm font-medium text-dark-600">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-100">
                  {(reportData.allItemsSold || []).map((item, idx) => (
                    <tr key={idx} className="hover:bg-dark-50">
                      <td className="px-4 py-3 text-sm text-dark-900">{item.name}</td>
                      <td className="px-4 py-3 text-sm text-dark-500">{item.category || '-'}</td>
                      <td className="px-4 py-3 text-sm text-dark-900 text-right">{item.quantity}</td>
                      <td className="px-4 py-3 text-sm text-dark-900 text-right">{formatCurrency(item.revenue)}</td>
                    </tr>
                  ))}
                  {(!reportData.allItemsSold || reportData.allItemsSold.length === 0) && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-dark-400">No items sold in this period</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-white rounded-xl p-12 shadow-card text-center">
          <BarChart3 className="w-16 h-16 text-dark-200 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-dark-700">No Report Data</h3>
          <p className="text-dark-400 mt-1">Select a report type to view analytics</p>
        </div>
      )}
    </div>
  );
}
