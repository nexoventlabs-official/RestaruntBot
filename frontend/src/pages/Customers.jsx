import { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, Mail, ShoppingBag, IndianRupee, User, MapPin, Search, X, MessageCircle, TrendingUp, RefreshCw } from 'lucide-react';
import api from '../api';

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  const customersRef = useRef([]);
  const intervalRef = useRef(null);

  const fetchCustomers = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    
    try {
      const res = await api.get('/customers');
      // Handle both array response and object with customers property
      const newCustomers = Array.isArray(res.data) ? res.data : (res.data?.customers || []);
      
      if (JSON.stringify(newCustomers) !== JSON.stringify(customersRef.current)) {
        customersRef.current = newCustomers;
        setCustomers(newCustomers);
      }
    } catch (err) {
      console.error('Failed to fetch customers:', err);
      // Set empty array on error to prevent filter issues
      if (!isBackground) setCustomers([]);
    } finally {
      // Always stop loading regardless of success/failure
      setLoading(false);
    }
  }, []);

  const viewCustomer = async (id) => {
    try {
      const res = await api.get(`/customers/${id}`);
      setSelected(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCustomers();
    
    intervalRef.current = setInterval(() => {
      fetchCustomers(true);
    }, 30000);
    
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchCustomers]);

  const filteredCustomers = customers.filter(c => 
    c.phone?.includes(searchTerm) || 
    c.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalCustomers = customers.length;
  const totalRevenue = customers.reduce((sum, c) => sum + (c.totalSpent || 0), 0);
  const totalOrders = customers.reduce((sum, c) => sum + (c.totalOrders || 0), 0);
  const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  const getStatusColor = (status) => {
    const colors = {
      delivered: 'bg-green-100 text-green-700',
      confirmed: 'bg-blue-100 text-blue-700',
      preparing: 'bg-orange-100 text-orange-700',
      pending: 'bg-yellow-100 text-yellow-700',
      cancelled: 'bg-red-100 text-red-700',
      refunded: 'bg-gray-100 text-gray-600'
    };
    return colors[status] || 'bg-gray-100 text-gray-600';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Customers</h1>
          <p className="text-gray-500 text-sm mt-1">Manage your customer relationships</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm">Total Customers</p>
              <p className="text-2xl font-bold mt-1">{totalCustomers}</p>
            </div>
            <div className="bg-white/20 p-3 rounded-lg">
              <User className="w-6 h-6" />
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm">Total Revenue</p>
              <p className="text-2xl font-bold mt-1">₹{totalRevenue.toLocaleString()}</p>
            </div>
            <div className="bg-white/20 p-3 rounded-lg">
              <IndianRupee className="w-6 h-6" />
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-purple-100 text-sm">Total Orders</p>
              <p className="text-2xl font-bold mt-1">{totalOrders}</p>
            </div>
            <div className="bg-white/20 p-3 rounded-lg">
              <ShoppingBag className="w-6 h-6" />
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-orange-100 text-sm">Avg Order Value</p>
              <p className="text-2xl font-bold mt-1">₹{avgOrderValue}</p>
            </div>
            <div className="bg-white/20 p-3 rounded-lg">
              <TrendingUp className="w-6 h-6" />
            </div>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          placeholder="Search by phone or name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
        />
        {searchTerm && (
          <button 
            onClick={() => setSearchTerm('')}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Customer List */}
        <div className="lg:col-span-2 space-y-3">
          {filteredCustomers.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-12 text-center">
              <User className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-600">No customers found</h3>
              <p className="text-gray-400 mt-1">
                {searchTerm ? 'Try a different search term' : 'Customers will appear here when they place orders'}
              </p>
            </div>
          ) : (
            filteredCustomers.map(customer => (
              <div
                key={customer._id}
                onClick={() => viewCustomer(customer._id)}
                className={`bg-white rounded-xl shadow-sm p-4 cursor-pointer transition-all hover:shadow-md hover:scale-[1.01] ${
                  selected?._id === customer._id ? 'ring-2 ring-green-500 bg-green-50' : ''
                }`}
              >
                <div className="flex items-center gap-4">
                  {/* Avatar */}
                  <div className="w-12 h-12 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center text-white font-bold text-lg">
                    {customer.name ? customer.name.charAt(0).toUpperCase() : customer.phone?.slice(-2)}
                  </div>
                  
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-800 truncate">
                        {customer.name || 'Unknown'}
                      </h3>
                      {customer.totalOrders >= 5 && (
                        <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded-full">
                          ⭐ Loyal
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-gray-500 text-sm mt-0.5">
                      <Phone className="w-3.5 h-3.5" />
                      <span>{customer.phone}</span>
                    </div>
                  </div>
                  
                  {/* Stats */}
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-green-600 font-semibold">
                      <IndianRupee className="w-4 h-4" />
                      <span>{customer.totalSpent?.toLocaleString() || 0}</span>
                    </div>
                    <div className="text-gray-400 text-sm">
                      {customer.totalOrders || 0} orders
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Customer Details Panel */}
        <div className="lg:col-span-1">
          {selected ? (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden sticky top-4">
              {/* Header */}
              <div className="bg-gradient-to-br from-green-500 to-green-600 p-6 text-white">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center text-2xl font-bold">
                    {selected.name ? selected.name.charAt(0).toUpperCase() : selected.phone?.slice(-2)}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">{selected.name || 'Unknown'}</h2>
                    <p className="text-green-100 text-sm">Customer since {new Date(selected.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
                
                {/* Quick Stats */}
                <div className="grid grid-cols-2 gap-4 mt-6">
                  <div className="bg-white/10 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold">{selected.totalOrders || 0}</p>
                    <p className="text-green-100 text-xs">Orders</p>
                  </div>
                  <div className="bg-white/10 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold">₹{selected.totalSpent?.toLocaleString() || 0}</p>
                    <p className="text-green-100 text-xs">Total Spent</p>
                  </div>
                </div>
              </div>
              
              {/* Contact Info */}
              <div className="p-6 border-b">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Contact Info</h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-gray-700">
                    <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                      <Phone className="w-5 h-5 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">Phone</p>
                      <p className="font-medium">{selected.phone}</p>
                    </div>
                  </div>
                  
                  {selected.email && (
                    <div className="flex items-center gap-3 text-gray-700">
                      <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center">
                        <Mail className="w-5 h-5 text-purple-500" />
                      </div>
                      <div>
                        <p className="text-sm text-gray-400">Email</p>
                        <p className="font-medium">{selected.email}</p>
                      </div>
                    </div>
                  )}
                  
                  {selected.deliveryAddress?.address && (
                    <div className="flex items-center gap-3 text-gray-700">
                      <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center">
                        <MapPin className="w-5 h-5 text-orange-500" />
                      </div>
                      <div>
                        <p className="text-sm text-gray-400">Last Address</p>
                        <p className="font-medium text-sm">{selected.deliveryAddress.address}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Order History */}
              <div className="p-6">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
                  Order History ({selected.orderHistory?.length || 0})
                </h3>
                
                {selected.orderHistory?.length > 0 ? (
                  <div className="space-y-3 max-h-72 overflow-y-auto pr-2">
                    {selected.orderHistory.map(order => (
                      <div key={order._id} className="bg-gray-50 rounded-lg p-3 hover:bg-gray-100 transition-colors">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-mono text-sm font-medium text-gray-800">{order.orderId}</span>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                            {order.status}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-500">
                            {new Date(order.createdAt).toLocaleDateString()}
                          </span>
                          <span className="font-semibold text-green-600">₹{order.totalAmount}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 text-gray-400">
                    <ShoppingBag className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No orders yet</p>
                  </div>
                )}
              </div>

              {/* Action Button */}
              <div className="p-4 bg-gray-50 border-t">
                <a
                  href={`https://wa.me/${selected.phone}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors"
                >
                  <MessageCircle className="w-5 h-5" />
                  Message on WhatsApp
                </a>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm p-8 text-center sticky top-4">
              <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <User className="w-10 h-10 text-gray-300" />
              </div>
              <h3 className="text-lg font-medium text-gray-600">Select a Customer</h3>
              <p className="text-gray-400 text-sm mt-2">Click on a customer to view their details and order history</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
