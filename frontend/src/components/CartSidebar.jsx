import { X, Minus, Plus, Trash2, Heart, ShoppingCart } from 'lucide-react';

// WhatsApp Icon Component
const WhatsAppIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

export default function CartSidebar({ 
  isOpen, onClose, activeTab, setActiveTab,
  cart, wishlist, cartTotal, cartCount,
  updateQuantity, removeFromCart, clearCart,
  addToCart, removeFromWishlist, whatsappNumber
}) {
  // Generate WhatsApp message for cart items
  const generateWhatsAppMessage = () => {
    if (cart.length === 0) return '';
    let msg = '🛒 *Order from Website*\n\n';
    cart.forEach((item, i) => {
      msg += `${i + 1}. ${item.name} x${item.quantity} - ₹${item.price * item.quantity}\n`;
    });
    msg += `\n💰 *Total: ₹${cartTotal}*\n\nPlease confirm my order!`;
    return encodeURIComponent(msg);
  };

  const handleOrderAll = () => {
    if (cart.length === 0) return;
    const msg = generateWhatsAppMessage();
    window.open(`https://wa.me/${whatsappNumber}?text=${msg}`, '_blank');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose}></div>
      <div className="relative w-full max-w-md bg-white h-full shadow-xl flex flex-col animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('cart')}
              className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 ${activeTab === 'cart' ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              <ShoppingCart className="w-4 h-4" />
              Cart {cartCount > 0 && `(${cartCount})`}
            </button>
            <button
              onClick={() => setActiveTab('wishlist')}
              className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 ${activeTab === 'wishlist' ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              <Heart className="w-4 h-4" />
              Wishlist {wishlist.length > 0 && `(${wishlist.length})`}
            </button>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'cart' ? (
            cart.length === 0 ? (
              <div className="text-center py-12">
                <ShoppingCart className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500">Your cart is empty</p>
                <p className="text-sm text-gray-400 mt-1">Add items to get started!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {cart.map(item => (
                  <div key={item._id} className="flex gap-3 bg-gray-50 rounded-xl p-3">
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="w-20 h-20 rounded-lg object-cover" />
                    ) : (
                      <div className="w-20 h-20 rounded-lg bg-gray-200 flex items-center justify-center">
                        <span className="text-2xl">🍽️</span>
                      </div>
                    )}
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-900">{item.name}</h4>
                      <p className="text-sm text-gray-500">{item.unitQty} {item.unit}</p>
                      <p className="text-orange-600 font-semibold">₹{item.price * item.quantity}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <button onClick={() => updateQuantity(item._id, item.quantity - 1)} className="p-1 bg-white rounded-full shadow hover:bg-gray-50">
                          <Minus className="w-4 h-4" />
                        </button>
                        <span className="w-8 text-center font-medium">{item.quantity}</span>
                        <button onClick={() => updateQuantity(item._id, item.quantity + 1)} className="p-1 bg-white rounded-full shadow hover:bg-gray-50">
                          <Plus className="w-4 h-4" />
                        </button>
                        <button onClick={() => removeFromCart(item._id)} className="ml-auto p-1 text-red-500 hover:bg-red-50 rounded-full">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            wishlist.length === 0 ? (
              <div className="text-center py-12">
                <Heart className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500">Your wishlist is empty</p>
                <p className="text-sm text-gray-400 mt-1">Save items you love!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {wishlist.map(item => (
                  <div key={item._id} className="flex gap-3 bg-gray-50 rounded-xl p-3">
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="w-20 h-20 rounded-lg object-cover" />
                    ) : (
                      <div className="w-20 h-20 rounded-lg bg-gray-200 flex items-center justify-center">
                        <span className="text-2xl">🍽️</span>
                      </div>
                    )}
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-900">{item.name}</h4>
                      <p className="text-sm text-gray-500">{item.unitQty} {item.unit}</p>
                      <p className="text-orange-600 font-semibold">₹{item.price}</p>
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => { addToCart(item); removeFromWishlist(item._id); }} className="px-3 py-1 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600">
                          Add to Cart
                        </button>
                        <button onClick={() => removeFromWishlist(item._id)} className="p-1 text-red-500 hover:bg-red-50 rounded-full">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        {/* Footer - Cart Only */}
        {activeTab === 'cart' && cart.length > 0 && (
          <div className="border-t p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Total</span>
              <span className="text-xl font-bold text-gray-900">₹{cartTotal}</span>
            </div>
            <button onClick={handleOrderAll} className="w-full py-3 bg-green-500 text-white rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-green-600 transition-colors">
              <WhatsAppIcon className="w-5 h-5" />
              Order via WhatsApp
            </button>
            <button onClick={clearCart} className="w-full py-2 text-red-500 text-sm hover:bg-red-50 rounded-lg">
              Clear Cart
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
