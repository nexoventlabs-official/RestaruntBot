import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

function Pay() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('redirecting');
  const [error, setError] = useState(null);

  // Get UPI parameters from URL
  const pa = searchParams.get('pa') || '8106811285@ybl'; // UPI ID
  const pn = searchParams.get('pn') || 'FoodAdmin'; // Payee name
  const am = searchParams.get('am') || '0'; // Amount
  const tn = searchParams.get('tn') || ''; // Transaction note
  const tr = searchParams.get('tr') || ''; // Transaction reference
  const cu = searchParams.get('cu') || 'INR'; // Currency

  // Build UPI intent URL
  const upiUrl = `upi://pay?pa=${encodeURIComponent(pa)}&pn=${encodeURIComponent(pn)}&am=${am}&cu=${cu}&tn=${encodeURIComponent(tn)}&tr=${encodeURIComponent(tr)}`;

  useEffect(() => {
    // Try to redirect to UPI app
    const redirectToUpi = () => {
      try {
        // Create hidden iframe to trigger UPI intent (works better on some devices)
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = upiUrl;
        document.body.appendChild(iframe);

        // Also try direct location change after a small delay
        setTimeout(() => {
          window.location.href = upiUrl;
        }, 100);

        // Set timeout to show manual options if redirect doesn't work
        setTimeout(() => {
          setStatus('manual');
        }, 3000);
      } catch (err) {
        console.error('UPI redirect error:', err);
        setStatus('manual');
      }
    };

    redirectToUpi();
  }, [upiUrl]);

  // Handle manual app selection
  const openApp = (appScheme) => {
    let appUrl = '';
    
    switch (appScheme) {
      case 'phonepe':
        appUrl = `phonepe://pay?pa=${encodeURIComponent(pa)}&pn=${encodeURIComponent(pn)}&am=${am}&cu=${cu}&tn=${encodeURIComponent(tn)}`;
        break;
      case 'gpay':
        appUrl = `tez://upi/pay?pa=${encodeURIComponent(pa)}&pn=${encodeURIComponent(pn)}&am=${am}&cu=${cu}&tn=${encodeURIComponent(tn)}`;
        break;
      case 'paytm':
        appUrl = `paytmmp://pay?pa=${encodeURIComponent(pa)}&pn=${encodeURIComponent(pn)}&am=${am}&cu=${cu}&tn=${encodeURIComponent(tn)}`;
        break;
      default:
        appUrl = upiUrl;
    }
    
    window.location.href = appUrl;
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
            <p className="text-gray-500">Please wait while we redirect you to your UPI app</p>
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
                <span className="text-gray-500">UPI ID</span>
                <span className="font-medium text-gray-800">{pa}</span>
              </div>
              <div className="flex justify-between mb-2">
                <span className="text-gray-500">Amount</span>
                <span className="font-bold text-green-600">₹{am}</span>
              </div>
              {tn && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Note</span>
                  <span className="font-medium text-gray-800">{tn}</span>
                </div>
              )}
            </div>

            {/* App Selection Buttons */}
            <div className="space-y-3">
              <button
                onClick={() => openApp('phonepe')}
                className="w-full flex items-center justify-center gap-3 bg-purple-600 hover:bg-purple-700 text-white font-semibold py-4 px-6 rounded-xl transition-all"
              >
                <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/PhonePe_Logo.png/220px-PhonePe_Logo.png" alt="PhonePe" className="w-6 h-6 object-contain bg-white rounded" />
                Pay with PhonePe
              </button>
              
              <button
                onClick={() => openApp('gpay')}
                className="w-full flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 px-6 rounded-xl transition-all"
              >
                <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/Google_Pay_Logo.svg/220px-Google_Pay_Logo.svg.png" alt="GPay" className="w-6 h-6 object-contain" />
                Pay with Google Pay
              </button>
              
              <button
                onClick={() => openApp('paytm')}
                className="w-full flex items-center justify-center gap-3 bg-sky-500 hover:bg-sky-600 text-white font-semibold py-4 px-6 rounded-xl transition-all"
              >
                <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/Paytm_Logo_%28standalone%29.svg/220px-Paytm_Logo_%28standalone%29.svg.png" alt="Paytm" className="w-6 h-6 object-contain" />
                Pay with Paytm
              </button>
              
              <button
                onClick={() => openApp('upi')}
                className="w-full flex items-center justify-center gap-3 bg-gray-800 hover:bg-gray-900 text-white font-semibold py-4 px-6 rounded-xl transition-all"
              >
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
                Other UPI Apps
              </button>
            </div>

            {/* Manual Payment Info */}
            <div className="mt-6 pt-6 border-t border-gray-200">
              <p className="text-sm text-gray-500 mb-2">Or pay manually using UPI ID:</p>
              <div className="bg-gray-100 rounded-lg p-3 flex items-center justify-between">
                <code className="text-purple-600 font-mono font-bold">{pa}</code>
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
