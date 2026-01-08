import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

function Pay() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('redirecting');

  // Get UPI parameters from URL
  const pa = searchParams.get('pa') || 'gokrishna98@okaxis'; // UPI ID
  const pn = searchParams.get('pn') || 'FoodAdmin'; // Payee name
  const am = searchParams.get('am') || '0'; // Amount
  const tn = searchParams.get('tn') || ''; // Transaction note
  const tr = searchParams.get('tr') || ''; // Transaction reference
  const cu = searchParams.get('cu') || 'INR'; // Currency

  // Build standard UPI intent URL (works with all UPI apps)
  const buildUpiUrl = () => {
    const params = new URLSearchParams();
    params.set('pa', pa);
    params.set('pn', pn);
    params.set('am', am);
    params.set('cu', cu);
    if (tn) params.set('tn', tn);
    if (tr) params.set('tr', tr);
    return `upi://pay?${params.toString()}`;
  };

  const upiUrl = buildUpiUrl();

  useEffect(() => {
    // Detect if on mobile
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (isMobile) {
      // On mobile, try to open UPI app directly
      // Use a small delay to ensure page is loaded
      const timer = setTimeout(() => {
        window.location.href = upiUrl;
      }, 500);

      // Show manual options after 2.5 seconds if app doesn't open
      const fallbackTimer = setTimeout(() => {
        setStatus('manual');
      }, 2500);

      return () => {
        clearTimeout(timer);
        clearTimeout(fallbackTimer);
      };
    } else {
      // On desktop, show manual options immediately
      setStatus('manual');
    }
  }, [upiUrl]);

  // Handle app selection - use intent:// scheme for Android
  const openApp = (appPackage) => {
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    
    if (isAndroid) {
      // Android: Use intent:// scheme which is more reliable
      let intentUrl = '';
      
      switch (appPackage) {
        case 'phonepe':
          // PhonePe Android intent
          intentUrl = `intent://pay?pa=${encodeURIComponent(pa)}&pn=${encodeURIComponent(pn)}&am=${am}&cu=${cu}&tn=${encodeURIComponent(tn)}&tr=${encodeURIComponent(tr)}#Intent;scheme=upi;package=com.phonepe.app;end`;
          break;
        case 'gpay':
          // Google Pay Android intent
          intentUrl = `intent://pay?pa=${encodeURIComponent(pa)}&pn=${encodeURIComponent(pn)}&am=${am}&cu=${cu}&tn=${encodeURIComponent(tn)}&tr=${encodeURIComponent(tr)}#Intent;scheme=upi;package=com.google.android.apps.nbu.paisa.user;end`;
          break;
        case 'paytm':
          // Paytm Android intent
          intentUrl = `intent://pay?pa=${encodeURIComponent(pa)}&pn=${encodeURIComponent(pn)}&am=${am}&cu=${cu}&tn=${encodeURIComponent(tn)}&tr=${encodeURIComponent(tr)}#Intent;scheme=upi;package=net.one97.paytm;end`;
          break;
        default:
          // Generic UPI intent - lets Android choose the app
          intentUrl = upiUrl;
      }
      
      window.location.href = intentUrl;
    } else if (isIOS) {
      // iOS: Use app-specific URL schemes
      let appUrl = '';
      
      switch (appPackage) {
        case 'phonepe':
          appUrl = `phonepe://pay?pa=${encodeURIComponent(pa)}&pn=${encodeURIComponent(pn)}&am=${am}&cu=${cu}&tn=${encodeURIComponent(tn)}&tr=${encodeURIComponent(tr)}`;
          break;
        case 'gpay':
          appUrl = `gpay://upi/pay?pa=${encodeURIComponent(pa)}&pn=${encodeURIComponent(pn)}&am=${am}&cu=${cu}&tn=${encodeURIComponent(tn)}&tr=${encodeURIComponent(tr)}`;
          break;
        case 'paytm':
          appUrl = `paytm://pay?pa=${encodeURIComponent(pa)}&pn=${encodeURIComponent(pn)}&am=${am}&cu=${cu}&tn=${encodeURIComponent(tn)}&tr=${encodeURIComponent(tr)}`;
          break;
        default:
          appUrl = upiUrl;
      }
      
      window.location.href = appUrl;
      
      // Fallback to generic UPI after delay
      setTimeout(() => {
        window.location.href = upiUrl;
      }, 1000);
    } else {
      // Desktop or unknown - use generic UPI URL
      window.location.href = upiUrl;
    }
  };

  // Try generic UPI (opens app chooser on Android)
  const openGenericUpi = () => {
    window.location.href = upiUrl;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8">
        {status === 'redirecting' && (
          <div className="text-center">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-purple-100 flex items-center justify-center">
              <svg className="w-10 h-10 text-purple-600 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">Opening UPI App...</h1>
            <p className="text-gray-500 mb-4">Please wait while we redirect you</p>
            <p className="text-sm text-gray-400">Amount: ₹{am}</p>
          </div>
        )}

        {status === 'manual' && (
          <div className="text-center">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            
            <h1 className="text-2xl font-bold text-gray-800 mb-2">Pay ₹{am}</h1>
            <p className="text-gray-500 mb-6">Select your UPI app to complete payment</p>

            {/* Payment Details */}
            <div className="bg-gray-50 rounded-xl p-4 mb-6 text-left">
              <div className="flex justify-between mb-2">
                <span className="text-gray-500">Pay to</span>
                <span className="font-medium text-gray-800">{pn}</span>
              </div>
              <div className="flex justify-between mb-2">
                <span className="text-gray-500">UPI ID</span>
                <span className="font-medium text-gray-800 text-sm">{pa}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Amount</span>
                <span className="font-bold text-green-600 text-lg">₹{am}</span>
              </div>
            </div>

            {/* Primary CTA - Open any UPI app */}
            <button
              onClick={openGenericUpi}
              className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-bold py-4 px-6 rounded-xl transition-all mb-4 shadow-lg"
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
              Pay ₹{am} with UPI
            </button>

            {/* App Selection Buttons */}
            <p className="text-sm text-gray-500 mb-3">Or choose a specific app:</p>
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => openApp('phonepe')}
                className="flex flex-col items-center justify-center gap-2 bg-purple-50 hover:bg-purple-100 p-4 rounded-xl transition-all border border-purple-200"
              >
                <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/PhonePe_Logo.png/220px-PhonePe_Logo.png" alt="PhonePe" className="w-10 h-10 object-contain" />
                <span className="text-xs font-medium text-purple-700">PhonePe</span>
              </button>
              
              <button
                onClick={() => openApp('gpay')}
                className="flex flex-col items-center justify-center gap-2 bg-blue-50 hover:bg-blue-100 p-4 rounded-xl transition-all border border-blue-200"
              >
                <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/Google_Pay_Logo.svg/220px-Google_Pay_Logo.svg.png" alt="GPay" className="w-10 h-10 object-contain" />
                <span className="text-xs font-medium text-blue-700">Google Pay</span>
              </button>
              
              <button
                onClick={() => openApp('paytm')}
                className="flex flex-col items-center justify-center gap-2 bg-sky-50 hover:bg-sky-100 p-4 rounded-xl transition-all border border-sky-200"
              >
                <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/Paytm_Logo_%28standalone%29.svg/220px-Paytm_Logo_%28standalone%29.svg.png" alt="Paytm" className="w-10 h-10 object-contain" />
                <span className="text-xs font-medium text-sky-700">Paytm</span>
              </button>
            </div>

            {/* Manual Payment Info */}
            <div className="mt-6 pt-6 border-t border-gray-200">
              <p className="text-sm text-gray-500 mb-2">Or pay manually using UPI ID:</p>
              <div className="bg-gray-100 rounded-lg p-3 flex items-center justify-between">
                <code className="text-purple-600 font-mono font-bold text-sm">{pa}</code>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(pa);
                    alert('UPI ID copied!');
                  }}
                  className="text-purple-600 hover:text-purple-800 font-medium text-sm"
                >
                  Copy
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">Open any UPI app → Send Money → Enter UPI ID → Pay ₹{am}</p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-gray-400">
            Secure payment powered by UPI
          </p>
        </div>
      </div>
    </div>
  );
}

export default Pay;
