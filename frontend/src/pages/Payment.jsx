import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle } from 'lucide-react';
import api from '../api';

// UPI App configurations with proper deep link schemes
const UPI_APPS = [
  { id: 'gpay', name: 'Google Pay', icon: '💳' },
  { id: 'phonepe', name: 'PhonePe', icon: '💜' },
  { id: 'paytm', name: 'Paytm', icon: '🔵' },
  { id: 'bhim', name: 'BHIM UPI', icon: '🇮🇳' },
  { id: 'cred', name: 'CRED', icon: '⚫' },
  { id: 'other', name: 'Other UPI', icon: '📱' }
];

export default function Payment() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isPaid, setIsPaid] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [selectedApp, setSelectedApp] = useState(null);
  const [razorpayOrder, setRazorpayOrder] = useState(null);
  const [checkingPayment, setCheckingPayment] = useState(false);

  useEffect(() => {
    fetchOrder();
  }, [orderId]);

  // Poll for payment status after UPI app redirect
  useEffect(() => {
    let interval;
    if (checkingPayment) {
      interval = setInterval(async () => {
        try {
          const res = await api.get(`/public/order/${orderId}`);
          if (res.data?.paymentStatus === 'paid') {
            setCheckingPayment(false);
            setIsPaid(true);
            setOrder(res.data);
            clearInterval(interval);
          }
        } catch (err) {
          console.error('Payment check error:', err);
        }
      }, 3000); // Check every 3 seconds
    }
    return () => clearInterval(interval);
  }, [checkingPayment, orderId]);

  const fetchOrder = async () => {
    try {
      const res = await api.get(`/public/order/${orderId}`);
      if (res.data) {
        setOrder(res.data);
        if (res.data.paymentStatus === 'paid') {
          setIsPaid(true);
        } else if (res.data.status === 'cancelled') {
          setError('This order has been cancelled.');
        } else {
          await createRazorpayOrder(res.data);
        }
      } else {
        setError('Order not found');
      }
    } catch (err) {
      setError('Failed to load order details');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const createRazorpayOrder = async (orderData) => {
    try {
      const res = await api.post('/payment/create-upi-order', {
        orderId: orderData.orderId,
        amount: orderData.totalAmount
      });
      setRazorpayOrder(res.data);
    } catch (err) {
      console.error('Failed to create Razorpay order:', err);
    }
  };

  // Generate UPI intent URL
  const generateUPIUrl = () => {
    if (!order || !razorpayOrder) return null;
    
    // Use merchant VPA from backend or fallback
    const vpa = razorpayOrder.merchantVpa;
    if (!vpa) return null;
    
    const merchantName = razorpayOrder.merchantName || 'Restaurant';
    const amount = order.totalAmount.toFixed(2);
    const txnRef = razorpayOrder.razorpayOrderId;
    const txnNote = `Order ${order.orderId}`;
    
    // Build UPI URL with proper encoding
    const params = new URLSearchParams();
    params.append('pa', vpa);
    params.append('pn', merchantName);
    params.append('am', amount);
    params.append('cu', 'INR');
    params.append('tn', txnNote);
    params.append('tr', txnRef);
    
    return `upi://pay?${params.toString()}`;
  };

  // Open UPI app directly via Razorpay
  const openUPIApp = async (app) => {
    if (!order || !razorpayOrder) return;
    
    setSelectedApp(app.id);
    setPaymentLoading(true);
    
    // Always use Razorpay checkout for proper payment tracking
    openRazorpayCheckout();
  };

  // Razorpay checkout fallback
  const openRazorpayCheckout = async () => {
    try {
      if (!window.Razorpay) {
        await loadRazorpayScript();
      }

      const options = {
        key: razorpayOrder.keyId,
        amount: razorpayOrder.amount,
        currency: 'INR',
        name: razorpayOrder.merchantName || 'Restaurant Order',
        description: `Order #${order.orderId}`,
        order_id: razorpayOrder.razorpayOrderId,
        prefill: {
          contact: order.customer?.phone || ''
        },
        notes: {
          orderId: order.orderId
        },
        theme: {
          color: '#f97316'
        },
        handler: function(response) {
          handlePaymentSuccess(response);
        },
        modal: {
          ondismiss: function() {
            setPaymentLoading(false);
            setSelectedApp(null);
            setCheckingPayment(false);
          }
        }
      };

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', function(response) {
        handlePaymentFailure(response.error);
      });
      rzp.open();
    } catch (err) {
      console.error('Payment error:', err);
      setError('Failed to initiate payment. Please try again.');
      setPaymentLoading(false);
      setSelectedApp(null);
    }
  };

  const handlePaymentSuccess = async (response) => {
    try {
      await api.post('/payment/verify-upi', {
        orderId: order.orderId,
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_order_id: response.razorpay_order_id,
        razorpay_signature: response.razorpay_signature
      });
      navigate(`/payment-success/${order.orderId}`);
    } catch (err) {
      console.error('Verification error:', err);
      setError('Payment verification failed. Please contact support.');
    } finally {
      setPaymentLoading(false);
      setSelectedApp(null);
      setCheckingPayment(false);
    }
  };

  const handlePaymentFailure = (error) => {
    console.error('Payment failed:', error);
    setError(`Payment failed: ${error.description || 'Please try again'}`);
    setPaymentLoading(false);
    setSelectedApp(null);
    setCheckingPayment(false);
  };

  const loadRazorpayScript = () => {
    return new Promise((resolve, reject) => {
      if (document.querySelector('script[src*="razorpay"]')) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-orange-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-orange-500 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600">Loading order details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-orange-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">⚠️</div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Payment Issue</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => { setError(null); fetchOrder(); }}
            className="px-6 py-3 bg-orange-500 text-white rounded-xl font-semibold hover:bg-orange-600 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Show paid receipt/bill
  if (isPaid && order) {
    const paidDate = order.updatedAt ? new Date(order.updatedAt) : new Date();
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-green-100 p-4">
        <div className="max-w-md mx-auto">
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="bg-gradient-to-r from-green-500 to-green-600 p-6 text-white text-center">
              <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <CheckCircle className="w-10 h-10" />
              </div>
              <h1 className="text-2xl font-bold">Payment Successful</h1>
              <p className="text-green-100 mt-1">Thank you for your order!</p>
            </div>
            <div className="p-6">
              <div className="flex justify-between items-center pb-4 border-b border-dashed">
                <div>
                  <p className="text-sm text-gray-500">Order ID</p>
                  <p className="font-bold text-gray-800">{order.orderId}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-500">Date</p>
                  <p className="font-medium text-gray-800">
                    {paidDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                </div>
              </div>
              <div className="py-4 border-b border-dashed">
                <p className="text-sm font-semibold text-gray-500 mb-3">ORDER ITEMS</p>
                {order.items?.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-800">{item.name}</span>
                      <span className="text-gray-400 text-sm">×{item.quantity}</span>
                    </div>
                    <span className="font-medium text-gray-800">₹{item.price * item.quantity}</span>
                  </div>
                ))}
              </div>
              <div className="py-4 border-b border-dashed">
                <div className="flex justify-between items-center text-lg font-bold">
                  <span className="text-gray-800">Total Paid</span>
                  <span className="text-green-600">₹{order.totalAmount}</span>
                </div>
              </div>
              <div className="py-4">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-500">Payment Method</span>
                  <span className="font-medium text-gray-800">UPI / Online</span>
                </div>
                <div className="flex justify-between items-center text-sm mt-2">
                  <span className="text-gray-500">Payment Status</span>
                  <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">✓ Paid</span>
                </div>
                <div className="flex justify-between items-center text-sm mt-2">
                  <span className="text-gray-500">Order Status</span>
                  <span className="font-medium text-gray-800 capitalize">{order.status?.replace('_', ' ')}</span>
                </div>
              </div>
              <div className="bg-green-50 rounded-xl p-4 mt-4 text-center">
                <p className="text-green-700 text-sm">🎉 Your order is being prepared!<br/>Check WhatsApp for live updates.</p>
              </div>
            </div>
            <div className="px-6 pb-6">
              <button onClick={() => window.close()} className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition-colors">Close</button>
            </div>
          </div>
          <p className="text-center text-xs text-gray-400 mt-4">🔒 Secured by Razorpay</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-orange-100 p-4">
      <div className="max-w-md mx-auto">
        {/* Order Summary */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-gray-800">Complete Payment</h1>
            <p className="text-gray-500">Order #{order?.orderId}</p>
          </div>
          <div className="border-t border-b py-4 mb-4">
            {order?.items?.map((item, idx) => (
              <div key={idx} className="flex justify-between items-center py-2">
                <div>
                  <p className="font-medium text-gray-800">{item.name}</p>
                  <p className="text-sm text-gray-500">Qty: {item.quantity}</p>
                </div>
                <p className="font-semibold text-gray-800">₹{item.price * item.quantity}</p>
              </div>
            ))}
          </div>
          <div className="flex justify-between items-center text-xl font-bold">
            <span>Total Amount</span>
            <span className="text-orange-600">₹{order?.totalAmount}</span>
          </div>
        </div>

        {/* Checking Payment Status */}
        {checkingPayment && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent mx-auto mb-3"></div>
            <p className="text-blue-700 font-medium">Waiting for payment confirmation...</p>
            <p className="text-blue-600 text-sm mt-1">Complete payment in your UPI app</p>
          </div>
        )}

        {/* UPI Apps Selection */}
        <div className="bg-white rounded-2xl shadow-xl p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4 text-center">
            Pay ₹{order?.totalAmount} with UPI
          </h2>
          
          <div className="grid grid-cols-3 gap-4">
            {UPI_APPS.map((app) => (
              <button
                key={app.id}
                onClick={() => openUPIApp(app)}
                disabled={paymentLoading}
                className={`flex flex-col items-center p-4 rounded-xl border-2 transition-all ${
                  selectedApp === app.id
                    ? 'border-orange-500 bg-orange-50'
                    : 'border-gray-200 hover:border-orange-300 hover:bg-orange-50'
                } ${paymentLoading && selectedApp !== app.id ? 'opacity-50' : ''}`}
              >
                <span className="text-3xl mb-2">{app.icon}</span>
                <span className="text-xs font-medium text-gray-700 text-center">{app.name}</span>
                {selectedApp === app.id && paymentLoading && (
                  <div className="mt-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-orange-500 border-t-transparent"></div>
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Or pay with card/netbanking */}
          <div className="mt-6 pt-4 border-t">
            <p className="text-center text-xs text-gray-500 mb-3">Or pay with Card / Netbanking</p>
            <button
              onClick={() => { setSelectedApp('checkout'); openRazorpayCheckout(); }}
              disabled={paymentLoading}
              className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition-all disabled:opacity-50"
            >
              More Payment Options
            </button>
          </div>

          <p className="text-center text-xs text-gray-500 mt-4">
            🔒 Secure payment powered by Razorpay
          </p>
        </div>
      </div>
    </div>
  );
}
