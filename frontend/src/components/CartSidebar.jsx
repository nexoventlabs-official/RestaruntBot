import { X, Minus, Plus, Trash2, Heart, ShoppingCart, MessageCircle } from 'lucide-react';

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
              <MessageCircle className="w-5 h-5" />
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
