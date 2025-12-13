import { ShoppingBag, DollarSign, Users, UtensilsCrossed, Clock, RefreshCw } from 'lucide-react';
import { useDashboardRefresh } from '../hooks/useSmartRefresh';

export default function Dashboard() {
  const { data: stats, loading, error, lastUpdated } = useDashboardRefresh(10000);

  if (loading && !stats) return <div className="flex items-center justify-center h-64">Loading...</div>;
  
  if (error && !stats) return (
    <div className="flex items-center justify-center h-64 text-red-500">
      Failed to load dashboard data. Please check your connection.
    </div>
  );

  const cards = [
    { label: 'Total Orders', value: stats?.totalOrders || 0, icon: ShoppingBag, color: 'bg-blue-500' },
    { label: 'Today Orders', value: stats?.todayOrders || 0, icon: Clock, color: 'bg-green-500' },
    { label: 'Total Revenue', value: `₹${stats?.totalRevenue || 0}`, icon: DollarSign, color: 'bg-purple-500' },
    { label: 'Today Revenue', value: `₹${stats?.todayRevenue || 0}`, icon: DollarSign, color: 'bg-yellow-500' },
    { label: 'Customers', value: stats?.totalCustomers || 0, icon: Users, color: 'bg-pink-500' },
    { label: 'Menu Items', value: stats?.menuItems || 0, icon: UtensilsCrossed, color: 'bg-indigo-500' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        {lastUpdated && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <RefreshCw className="w-3 h-3 animate-spin-slow" />
            <span>Auto-refresh active</span>
          </div>
        )}
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {cards.map(card => (
          <div key={card.label} className="bg-white rounded-xl p-6 shadow-sm transition-all duration-300">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm">{card.label}</p>
                <p className="text-2xl font-bold mt-1">{card.value}</p>
              </div>
              <div className={`${card.color} p-3 rounded-lg`}>
                <card.icon className="w-6 h-6 text-white" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Pending Actions</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
              <span>Pending Orders</span>
              <span className="bg-yellow-500 text-white px-3 py-1 rounded-full text-sm">{stats?.pendingOrders || 0}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
              <span>Preparing</span>
              <span className="bg-blue-500 text-white px-3 py-1 rounded-full text-sm">{stats?.preparingOrders || 0}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Recent Orders</h2>
          <div className="space-y-3">
            {stats?.recentOrders?.map(order => (
              <div key={order._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg transition-all duration-300">
                <div>
                  <p className="font-medium">{order.orderId}</p>
                  <p className="text-sm text-gray-500">₹{order.totalAmount}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-sm ${
                  order.status === 'delivered' ? 'bg-green-100 text-green-700' :
                  order.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                  'bg-yellow-100 text-yellow-700'
                }`}>
                  {order.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
