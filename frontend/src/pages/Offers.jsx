import { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Eye, EyeOff, X, Upload, Tag, Bell, BellOff } from 'lucide-react';
import api from '../api';

export default function Offers() {
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingOffer, setEditingOffer] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    code: '',
    discountType: 'none',
    discountValue: 0,
    minOrderAmount: 0,
    validFrom: '',
    validUntil: '',
    buttonText: 'Order Now',
    buttonLink: '/menu',
    isActive: true,
    showAsPopup: true
  });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');

  useEffect(() => {
    loadOffers();
  }, []);

  const loadOffers = async () => {
    try {
      const res = await api.get('/offers');
      setOffers(res.data);
    } catch (err) {
      console.error('Error loading offers:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  const resetForm = () => {
    setFormData({
      title: '',
      description: '',
      code: '',
      discountType: 'none',
      discountValue: 0,
      minOrderAmount: 0,
      validFrom: '',
      validUntil: '',
      buttonText: 'Order Now',
      buttonLink: '/menu',
      isActive: true,
      showAsPopup: true
    });
    setImageFile(null);
    setImagePreview('');
    setEditingOffer(null);
  };

  const formatDateForInput = (date) => {
    if (!date) return '';
    return new Date(date).toISOString().split('T')[0];
  };

  const openModal = (offer = null) => {
    if (offer) {
      setEditingOffer(offer);
      setFormData({
        title: offer.title,
        description: offer.description || '',
        code: offer.code || '',
        discountType: offer.discountType || 'none',
        discountValue: offer.discountValue || 0,
        minOrderAmount: offer.minOrderAmount || 0,
        validFrom: formatDateForInput(offer.validFrom),
        validUntil: formatDateForInput(offer.validUntil),
        buttonText: offer.buttonText || 'Order Now',
        buttonLink: offer.buttonLink || '/menu',
        isActive: offer.isActive,
        showAsPopup: offer.showAsPopup
      });
      setImagePreview(offer.image);
    } else {
      resetForm();
    }
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    resetForm();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.title) return alert('Title is required');
    if (!imageFile && !editingOffer) return alert('Image is required');

    setSubmitting(true);
    try {
      const data = new FormData();
      Object.keys(formData).forEach(key => {
        if (formData[key] !== '' && formData[key] !== null) {
          data.append(key, formData[key]);
        }
      });
      if (imageFile) data.append('image', imageFile);

      if (editingOffer) {
        await api.put(`/offers/${editingOffer._id}`, data);
      } else {
        await api.post('/offers', data);
      }
      
      loadOffers();
      closeModal();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save offer');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this offer?')) return;
    try {
      await api.delete(`/offers/${id}`);
      loadOffers();
    } catch (err) {
      alert('Failed to delete offer');
    }
  };

  const handleToggle = async (id) => {
    try {
      await api.patch(`/offers/${id}/toggle`);
      loadOffers();
    } catch (err) {
      alert('Failed to toggle status');
    }
  };

  const handleTogglePopup = async (id) => {
    try {
      await api.patch(`/offers/${id}/toggle-popup`);
      loadOffers();
    } catch (err) {
      alert('Failed to toggle popup status');
    }
  };

  const isOfferValid = (offer) => {
    const now = new Date();
    const validFrom = new Date(offer.validFrom);
    const validUntil = offer.validUntil ? new Date(offer.validUntil) : null;
    return validFrom <= now && (!validUntil || validUntil >= now);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark-900">Offers & Promotions</h1>
          <p className="text-dark-500 mt-1">Manage promotional offers and popup deals</p>
        </div>
        <button
          onClick={() => openModal()}
          className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2.5 rounded-xl font-medium hover:bg-primary-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          Add Offer
        </button>
      </div>

      {/* Offers List */}
      {offers.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center">
          <Tag className="w-16 h-16 text-dark-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-dark-900 mb-2">No Offers</h3>
          <p className="text-dark-500 mb-6">Create your first promotional offer</p>
          <button
            onClick={() => openModal()}
            className="inline-flex items-center gap-2 bg-primary-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-primary-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Add Offer
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {offers.map((offer) => {
            const valid = isOfferValid(offer);
            return (
              <div 
                key={offer._id} 
                className={`bg-white rounded-2xl overflow-hidden shadow-sm border ${
                  offer.isActive && valid ? 'border-green-200' : 'border-dark-100 opacity-70'
                }`}
              >
                {/* Image */}
                <div className="h-40 relative">
                  <img 
                    src={offer.image} 
                    alt={offer.title}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                  
                  {/* Badges */}
                  <div className="absolute top-3 left-3 flex gap-2">
                    {offer.discountType !== 'none' && offer.discountValue > 0 && (
                      <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-lg font-bold">
                        {offer.discountType === 'percentage' ? `${offer.discountValue}% OFF` : `₹${offer.discountValue} OFF`}
                      </span>
                    )}
                    {offer.showAsPopup && (
                      <span className="bg-purple-500 text-white text-xs px-2 py-1 rounded-lg font-medium">
                        Popup
                      </span>
                    )}
                  </div>

                  {/* Status */}
                  <div className="absolute top-3 right-3">
                    <span className={`px-2 py-1 rounded-lg text-xs font-medium ${
                      offer.isActive && valid
                        ? 'bg-green-500 text-white' 
                        : 'bg-dark-500 text-white'
                    }`}>
                      {!offer.isActive ? 'Inactive' : !valid ? 'Expired' : 'Active'}
                    </span>
                  </div>

                  {/* Title on image */}
                  <div className="absolute bottom-3 left-3 right-3">
                    <h3 className="font-bold text-white text-lg line-clamp-1">{offer.title}</h3>
                  </div>
                </div>

                {/* Content */}
                <div className="p-4">
                  {offer.description && (
                    <p className="text-dark-500 text-sm line-clamp-2 mb-3">{offer.description}</p>
                  )}

                  {/* Offer Details */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    {offer.code && (
                      <span className="bg-orange-100 text-orange-700 text-xs px-2 py-1 rounded-lg font-mono">
                        Code: {offer.code}
                      </span>
                    )}
                    {offer.minOrderAmount > 0 && (
                      <span className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-lg">
                        Min: ₹{offer.minOrderAmount}
                      </span>
                    )}
                    {offer.validUntil && (
                      <span className="bg-dark-100 text-dark-600 text-xs px-2 py-1 rounded-lg">
                        Until: {new Date(offer.validUntil).toLocaleDateString('en-GB')}
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-3 border-t border-dark-100">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleToggle(offer._id)}
                        className={`p-2 rounded-lg transition-colors ${
                          offer.isActive 
                            ? 'text-green-600 hover:bg-green-50' 
                            : 'text-dark-400 hover:bg-dark-50'
                        }`}
                        title={offer.isActive ? 'Deactivate' : 'Activate'}
                      >
                        {offer.isActive ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                      </button>
                      <button
                        onClick={() => handleTogglePopup(offer._id)}
                        className={`p-2 rounded-lg transition-colors ${
                          offer.showAsPopup 
                            ? 'text-purple-600 hover:bg-purple-50' 
                            : 'text-dark-400 hover:bg-dark-50'
                        }`}
                        title={offer.showAsPopup ? 'Disable Popup' : 'Enable Popup'}
                      >
                        {offer.showAsPopup ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
                      </button>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openModal(offer)}
                        className="p-2 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                        title="Edit"
                      >
                        <Edit2 className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => handleDelete(offer._id)}
                        className="p-2 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-dark-100 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-dark-900">
                {editingOffer ? 'Edit Offer' : 'Add Offer'}
              </h2>
              <button onClick={closeModal} className="p-2 hover:bg-dark-100 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              {/* Image Upload */}
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  Offer Image *
                </label>
                <div className="border-2 border-dashed border-dark-200 rounded-xl p-4 text-center hover:border-primary-400 transition-colors">
                  {imagePreview ? (
                    <div className="relative">
                      <img 
                        src={imagePreview} 
                        alt="Preview" 
                        className="w-full h-40 object-cover rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={() => { setImageFile(null); setImagePreview(''); }}
                        className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <label className="cursor-pointer block py-6">
                      <Upload className="w-10 h-10 text-dark-300 mx-auto mb-2" />
                      <p className="text-dark-500">Click to upload image</p>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageChange}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">Title *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-4 py-3 border border-dark-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder="e.g., 20% Off on First Order"
                  required
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-3 border border-dark-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  rows={2}
                  placeholder="Brief description of the offer"
                />
              </div>

              {/* Discount Settings */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-dark-700 mb-2">Discount Type</label>
                  <select
                    value={formData.discountType}
                    onChange={(e) => setFormData({ ...formData, discountType: e.target.value })}
                    className="w-full px-4 py-3 border border-dark-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="none">No Discount</option>
                    <option value="percentage">Percentage</option>
                    <option value="fixed">Fixed Amount</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-dark-700 mb-2">Discount Value</label>
                  <input
                    type="number"
                    value={formData.discountValue}
                    onChange={(e) => setFormData({ ...formData, discountValue: parseFloat(e.target.value) || 0 })}
                    className="w-full px-4 py-3 border border-dark-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    min="0"
                    disabled={formData.discountType === 'none'}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-dark-700 mb-2">Min Order (₹)</label>
                  <input
                    type="number"
                    value={formData.minOrderAmount}
                    onChange={(e) => setFormData({ ...formData, minOrderAmount: parseFloat(e.target.value) || 0 })}
                    className="w-full px-4 py-3 border border-dark-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    min="0"
                  />
                </div>
              </div>

              {/* Promo Code */}
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">Promo Code (Optional)</label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                  className="w-full px-4 py-3 border border-dark-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 font-mono"
                  placeholder="e.g., WELCOME20"
                />
              </div>

              {/* Validity */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-dark-700 mb-2">Valid From</label>
                  <input
                    type="date"
                    value={formData.validFrom}
                    onChange={(e) => setFormData({ ...formData, validFrom: e.target.value })}
                    className="w-full px-4 py-3 border border-dark-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-dark-700 mb-2">Valid Until</label>
                  <input
                    type="date"
                    value={formData.validUntil}
                    onChange={(e) => setFormData({ ...formData, validUntil: e.target.value })}
                    className="w-full px-4 py-3 border border-dark-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
              </div>

              {/* Button Settings */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-dark-700 mb-2">Button Text</label>
                  <input
                    type="text"
                    value={formData.buttonText}
                    onChange={(e) => setFormData({ ...formData, buttonText: e.target.value })}
                    className="w-full px-4 py-3 border border-dark-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    placeholder="Order Now"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-dark-700 mb-2">Button Link</label>
                  <input
                    type="text"
                    value={formData.buttonLink}
                    onChange={(e) => setFormData({ ...formData, buttonLink: e.target.value })}
                    className="w-full px-4 py-3 border border-dark-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    placeholder="/menu"
                  />
                </div>
              </div>

              {/* Status Toggles */}
              <div className="flex gap-6">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    className="w-5 h-5 rounded border-dark-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-dark-700">Active</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.showAsPopup}
                    onChange={(e) => setFormData({ ...formData, showAsPopup: e.target.checked })}
                    className="w-5 h-5 rounded border-dark-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-dark-700">Show as Popup</span>
                </label>
              </div>

              {/* Submit */}
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-3 border border-dark-200 rounded-xl font-medium text-dark-700 hover:bg-dark-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-3 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : editingOffer ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
