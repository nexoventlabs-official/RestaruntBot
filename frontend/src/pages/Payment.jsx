import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';

// UPI App icons
const UPI_APPS = [
  { id: 'gpay', name: 'Google Pay', icon: '💳', package: 'com.google.android.apps.nbu.paisa.user', scheme: 'gpay://' },
  { id: 'phonepe', name: 'PhonePe', icon: '💜', package: 'com.phonepe.app', scheme: 'phonepe://' },
  { id: 'paytm', name: 'Paytm', icon: '🔵', package: 'net.one97.paytm', scheme: 'paytm://' },
  { id: 'bhim', name: 'BHIM', icon: '🇮🇳', package: 'in.org.npci.upiapp', scheme: 'bhim://' },
  { id: 'amazonpay', name: 'Amazon Pay', icon: '🛒', package: 'in.amazon.mShop.android.shopping', scheme: 'amazonpay://' },
  { id: 'whatsapp', name: 'WhatsApp Pay', icon: '💬', package: 'com.whatsapp', scheme: 'whatsapp://' }
];

export default function Payment() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [selectedApp, setSelectedApp] = useState(null);
  const [razorpayOrder, setRazorpayOrder] = useState(null);

  useEffect(() => {
    fetchOrder();
  }, [orderId]);

  const fetchOrder = async () => {
    try {
      const res = await api.get(`/api/public/order/${orderId}`);
      if (res.data) {
        setOrder(res.data);
        if (res.data.paymentStatus === 'paid') {
          setError('This order has already been paid.');
        } else if (res.data.status === 'cancelled') {
          setError('This order has been cancelled.');
        } else {
          // Create Razorpay order for UPI intent
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
      const res = await api.post('/api/payment/create-upi-order', {
        orderId: orderData.orderId,
        amount: orderData.totalAmount
      });
      setRazorpayOrder(res.data);
    } catch (err) {
      console.error('Failed to create Razorpay order:', err);
    }
  };

  const handleUPIPayment = async (app) => {
    if (!razorpayOrder || !order) return;
    
    setSelectedApp(app.id);
    setPaymentLoading(true);

    try {
      // Load Razorpay script if not loaded
      if (!window.Razorpay) {
        await loadRazorpayScript();
      }

      const options = {
        key: razorpayOrder.keyId,
        amount: razorpayOrder.amount,
        currency: 'INR',
        name: 'Restaurant Order',
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
        // UPI Intent configuration
        config: {
          display: {
            blocks: {
              utib: {
                name: 'Pay using UPI',
                instruments: [
                  {
                    method: 'upi',
                    flows: ['intent', 'collect'],
                    apps: [app.id]
                  }
                ]
              }
            },
            sequence: ['block.utib'],
            preferences: {
              show_default_blocks: false
            }
          }
        },
        handler: function(response) {
          // Payment successful
          handlePaymentSuccess(response);
        },
        modal: {
          ondismiss: function() {
            setPaymentLoading(false);
            setSelectedApp(null);
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
      // Verify payment on backend
      await api.post('/api/payment/verify-upi', {
        orderId: order.orderId,
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_order_id: response.razorpay_order_id,
        razorpay_signature: response.razorpay_signature
      });
      
      // Redirect to success page
      navigate(`/payment-success/${order.orderId}`);
    } catch (err) {
      console.error('Verification error:', err);
      setError('Payment verification failed. Please contact support.');
    } finally {
      setPaymentLoading(false);
      setSelectedApp(null);
    }
  };

  const handlePaymentFailure = (error) => {
    console.error('Payment failed:', error);
    setError(`Payment failed: ${error.description || 'Please try again'}`);
    setPaymentLoading(false);
    setSelectedApp(null);
  };

  const loadRazorpayScript = () => {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
  };

  // Generate UPI deep link for direct app opening
  const generateUPILink = (app) => {
    if (!order || !razorpayOrder) return null;
    
    const upiParams = new URLSearchParams({
      pa: razorpayOrder.vpa || process.env.REACT_APP_UPI_VPA || 'merchant@upi',
      pn: 'Restaurant',
      am: order.totalAmount.toString(),
      cu: 'INR',
      tn: `Order ${order.orderId}`,
      tr: razorpayOrder.razorpayOrderId || order.orderId
    });

    return `upi://pay?${upiParams.toString()}`;
  };

  const openUPIApp = (app) => {
    const upiLink = generateUPILink(app);
    if (upiLink) {
      // Try to open the UPI app directly
      window.location.href = upiLink;
      
      // Fallback to Razorpay checkout after a delay
      setTimeout(() => {
        handleUPIPayment(app);
      }, 2000);
    } else {
      handleUPIPayment(app);
    }
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
            onClick={() => window.close()}
            className="px-6 py-3 bg-orange-500 text-white rounded-xl font-semibold hover:bg-orange-600 transition-colors"
          >
            Close
          </button>
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

          {/* Order Items */}
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

          {/* Total */}
          <div className="flex justify-between items-center text-xl font-bold">
            <span>Total Amount</span>
            <span className="text-orange-600">₹{order?.totalAmount}</span>
          </div>
        </div>

        {/* UPI Apps Selection */}
        <div className="bg-white rounded-2xl shadow-xl p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4 text-center">
            Select UPI App to Pay
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

          {/* Pay Any UPI Button */}
          <button
            onClick={() => handleUPIPayment({ id: 'upi' })}
            disabled={paymentLoading}
            className="w-full mt-6 py-4 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-xl font-semibold hover:from-orange-600 hover:to-orange-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {paymentLoading && selectedApp === 'upi' ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                Processing...
              </>
            ) : (
              <>
                <span>💳</span>
                Pay ₹{order?.totalAmount} with Any UPI
              </>
            )}
          </button>

          <p className="text-center text-xs text-gray-500 mt-4">
            🔒 Secure payment powered by Razorpay
          </p>
        </div>
      </div>
    </div>
  );
}
