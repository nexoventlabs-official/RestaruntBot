import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Eye, EyeOff, X, Upload, Tag, Send, RotateCw, Search, Edit, Check, Clock, Users, Percent, ShoppingBag, Image, AlertCircle, CheckCircle } from 'lucide-react';
import api from '../api';

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'https://restaruntbot.onrender.com/api').replace('/api', '');

export default function Offers() {
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [sendingOffer, setSendingOffer] = useState(null);
  const [togglingOffer, setTogglingOffer] = useState(null);
  const [retryingTemplate, setRetryingTemplate] = useState(null);
  const pollingRef = useRef(null);

  // Form state matching mobile app's OfferFormScreen
  const [categories, setCategories] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [form, setForm] = useState({
    offerType: 'percentage',
    percentage: '',
    selectedCategories: [],
    selectedItems: [],
    selectedVariants: [],
    validFrom: '',
    validUntil: '',
    targetType: 'all',
    targetPercentage: '10',
    targetMinSpent: '500',
    targetMinOrders: '3',
    isActive: true,
  });
  const [customerStats, setCustomerStats] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadOffers();
  }, []);

  // Poll pending template statuses
  useEffect(() => {
    const pendingOffers = offers.filter(o => o.templateStatus === 'PENDING');
    if (pendingOffers.length > 0) {
      pollingRef.current = setInterval(async () => {
        for (const offer of pendingOffers) {
          try {
            const res = await api.get(`/offers/${offer._id}/template-status`);
            if (res.data.status !== 'PENDING') {
              loadOffers();
            }
          } catch (e) { /* ignore */ }
        }
      }, 30000);
    }
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [offers]);

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

  const loadFormData = async () => {
    try {
      const [catRes, menuRes] = await Promise.all([
        api.get('/categories'),
        api.get('/menu'),
      ]);
      setCategories(catRes.data || []);
      setMenuItems(menuRes.data || []);
    } catch (err) {
      console.error('Failed to load form data:', err);
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
    setImageFile(null);
    setImagePreview('');
    setEditing(null);
    setForm({
      offerType: 'percentage',
      percentage: '',
      selectedCategories: [],
      selectedItems: [],
      selectedVariants: [],
      validFrom: '',
      validUntil: '',
      targetType: 'all',
      targetPercentage: '10',
      targetMinSpent: '500',
      targetMinOrders: '3',
      isActive: true,
    });
    setCustomerStats(null);
    setSearchQuery('');
  };

  const openModal = (offer = null) => {
    loadFormData();
    if (offer) {
      setEditing(offer);
      setForm({
        offerType: offer.offerType || 'percentage',
        percentage: offer.percentage || '',
        selectedCategories: offer.selectedCategories || [],
        selectedItems: offer.selectedItems || [],
        selectedVariants: offer.selectedVariants || [],
        validFrom: offer.validFrom ? new Date(offer.validFrom).toISOString().slice(0, 16) : '',
        validUntil: offer.validUntil ? new Date(offer.validUntil).toISOString().slice(0, 16) : '',
        targetType: offer.targetType || 'all',
        targetPercentage: offer.targetPercentage || '10',
        targetMinSpent: offer.targetMinSpent || '500',
        targetMinOrders: offer.targetMinOrders || '3',
        isActive: offer.isActive !== false,
      });
      setImagePreview(offer.image || '');
    } else {
      resetForm();
    }
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    resetForm();
  };

  // Preview customer targeting
  const previewCustomers = async () => {
    try {
      let res;
      if (form.targetType === 'top_percentage') {
        res = await api.get(`/offers/customers/top/${form.targetPercentage}`);
      } else if (form.targetType === 'min_spent') {
        res = await api.get(`/offers/customers/min-spent/${form.targetMinSpent}`);
      } else if (form.targetType === 'min_orders') {
        res = await api.get(`/offers/customers/min-orders/${form.targetMinOrders}`);
      }
      if (res) setCustomerStats(res.data);
    } catch (err) {
      console.error('Failed to preview customers:', err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!imageFile && !editing) return alert('Please select an image');

    setSubmitting(true);
    try {
      const data = new FormData();

      if (imageFile) {
        data.append('imageMobile', imageFile);
        data.append('imageTablet', imageFile);
        data.append('imageDesktop', imageFile);
        data.append('image', imageFile);
      }

      data.append('offerType', form.offerType);
      data.append('percentage', form.percentage);
      data.append('isActive', form.isActive);

      if (form.selectedCategories.length > 0) data.append('selectedCategories', JSON.stringify(form.selectedCategories));
      if (form.selectedItems.length > 0) data.append('selectedItems', JSON.stringify(form.selectedItems));
      if (form.selectedVariants.length > 0) data.append('selectedVariants', JSON.stringify(form.selectedVariants));

      if (form.validFrom) data.append('validFrom', new Date(form.validFrom).toISOString());
      if (form.validUntil) data.append('validUntil', new Date(form.validUntil).toISOString());

      data.append('targetType', form.targetType);
      if (form.targetType === 'top_percentage') data.append('targetPercentage', form.targetPercentage);
      if (form.targetType === 'min_spent') data.append('targetMinSpent', form.targetMinSpent);
      if (form.targetType === 'min_orders') data.append('targetMinOrders', form.targetMinOrders);

      if (editing) {
        await api.put(`/offers/${editing._id}`, data, { timeout: 90000 });
      } else {
        await api.post('/offers', data, { timeout: 90000 });
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
    if (!confirm('Delete this offer? This will also remove the Meta template and catalog prices.')) return;
    try {
      await api.delete(`/offers/${id}`);
      loadOffers();
    } catch (err) {
      alert('Failed to delete offer');
    }
  };

  const handleToggle = async (id) => {
    setTogglingOffer(id);
    try {
      await api.patch(`/offers/${id}/toggle`);
      loadOffers();
    } catch (err) {
      alert('Failed to toggle status');
    } finally {
      setTogglingOffer(null);
    }
  };

  const handleSend = async (id) => {
    if (!confirm('Send this offer to customers via WhatsApp?')) return;
    setSendingOffer(id);
    try {
      const res = await api.post(`/offers/${id}/send`);
      alert(res.data?.message || 'Offer sent successfully!');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to send offer');
    } finally {
      setSendingOffer(null);
    }
  };

  const handleRetryTemplate = async (id) => {
    setRetryingTemplate(id);
    try {
      await api.post(`/offers/${id}/retry-template`);
      alert('Template resubmitted to Meta for approval');
      loadOffers();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to retry template');
    } finally {
      setRetryingTemplate(null);
    }
  };

  const getTemplateStatusBadge = (offer) => {
    if (!offer.templateStatus) return null;
    const config = {
      APPROVED: { bg: 'bg-green-100', text: 'text-green-700', label: 'Template Approved' },
      PENDING: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Template Pending' },
      REJECTED: { bg: 'bg-red-100', text: 'text-red-700', label: 'Template Rejected' },
    };
    const c = config[offer.templateStatus] || config.PENDING;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
        {offer.templateStatus === 'PENDING' && <Clock className="w-3 h-3 animate-pulse" />}
        {offer.templateStatus === 'APPROVED' && <CheckCircle className="w-3 h-3" />}
        {offer.templateStatus === 'REJECTED' && <AlertCircle className="w-3 h-3" />}
        {c.label}
      </span>
    );
  };

  const filteredMenuItems = searchQuery
    ? menuItems.filter(i => i.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : menuItems;

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
          <p className="text-dark-500 mt-1">{offers.length} offers &bull; Manage promotional deals</p>
        </div>
        <button
          onClick={() => openModal()}
          className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2.5 rounded-xl font-medium hover:bg-primary-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          Create Offer
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 shadow-card">
          <p className="text-dark-400 text-sm">Total Offers</p>
          <p className="text-2xl font-bold text-dark-900 mt-1">{offers.length}</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-card">
          <p className="text-dark-400 text-sm">Active</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{offers.filter(o => o.isActive).length}</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-card">
          <p className="text-dark-400 text-sm">Pending Approval</p>
          <p className="text-2xl font-bold text-yellow-600 mt-1">{offers.filter(o => o.templateStatus === 'PENDING').length}</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-card">
          <p className="text-dark-400 text-sm">Rejected</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{offers.filter(o => o.templateStatus === 'REJECTED').length}</p>
        </div>
      </div>

      {/* Offers Grid */}
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
            Create Offer
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {offers.map((offer) => (
            <div
              key={offer._id}
              className={`bg-white rounded-2xl overflow-hidden shadow-card hover:shadow-card-hover transition-all ${
                offer.isActive ? 'border border-green-200' : 'border border-dark-100 opacity-70'
              }`}
            >
              {/* Image */}
              <div className="relative aspect-[19/6] bg-dark-100 overflow-hidden">
                {offer.image ? (
                  <img src={offer.image.startsWith('http') ? offer.image : `${API_BASE_URL}${offer.image}`} alt="Offer" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Image className="w-12 h-12 text-dark-300" />
                  </div>
                )}
                <div className="absolute top-2 left-2 flex gap-1.5">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${offer.isActive ? 'bg-green-500 text-white' : 'bg-dark-500 text-white'}`}>
                    {offer.isActive ? 'Active' : 'Inactive'}
                  </span>
                  {offer.offerType && (
                    <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-primary-500 text-white capitalize">
                      {offer.offerType === 'percentage' ? `${offer.percentage}% off` : offer.offerType}
                    </span>
                  )}
                </div>
              </div>

              {/* Info */}
              <div className="p-4 space-y-3">
                {getTemplateStatusBadge(offer)}

                {offer.targetType && offer.targetType !== 'all' && (
                  <div className="flex items-center gap-1.5 text-xs text-dark-500">
                    <Users className="w-3.5 h-3.5" />
                    <span>Targeted: {offer.targetType === 'top_percentage' ? `Top ${offer.targetPercentage}%` : offer.targetType === 'min_spent' ? `Min ₹${offer.targetMinSpent}` : `Min ${offer.targetMinOrders} orders`}</span>
                  </div>
                )}

                {offer.selectedCategories?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {offer.selectedCategories.map((cat, i) => (
                      <span key={i} className="px-2 py-0.5 bg-dark-50 rounded text-xs text-dark-600">{cat}</span>
                    ))}
                  </div>
                )}

                {(offer.validFrom || offer.validUntil) && (
                  <div className="flex items-center gap-1.5 text-xs text-dark-400">
                    <Clock className="w-3.5 h-3.5" />
                    <span>
                      {offer.validFrom ? new Date(offer.validFrom).toLocaleDateString() : 'Now'} — {offer.validUntil ? new Date(offer.validUntil).toLocaleDateString() : 'No end'}
                    </span>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 pt-2 border-t border-dark-100">
                  <button onClick={() => handleToggle(offer._id)} disabled={togglingOffer === offer._id}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium transition-colors ${
                      offer.isActive ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-dark-50 text-dark-600 hover:bg-dark-100'
                    } ${togglingOffer === offer._id ? 'opacity-50' : ''}`}>
                    {offer.isActive ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    {togglingOffer === offer._id ? '...' : offer.isActive ? 'Active' : 'Inactive'}
                  </button>

                  <button onClick={() => openModal(offer)}
                    className="p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors" title="Edit">
                    <Edit className="w-4 h-4" />
                  </button>

                  <button onClick={() => handleSend(offer._id)} disabled={sendingOffer === offer._id}
                    className={`p-2 bg-green-50 text-green-600 rounded-xl hover:bg-green-100 transition-colors ${sendingOffer === offer._id ? 'opacity-50' : ''}`} title="Send via WhatsApp">
                    {sendingOffer === offer._id ? <RotateCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>

                  {offer.templateStatus === 'REJECTED' && (
                    <button onClick={() => handleRetryTemplate(offer._id)} disabled={retryingTemplate === offer._id}
                      className={`p-2 bg-yellow-50 text-yellow-600 rounded-xl hover:bg-yellow-100 transition-colors ${retryingTemplate === offer._id ? 'opacity-50' : ''}`} title="Retry Template">
                      {retryingTemplate === offer._id ? <RotateCw className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
                    </button>
                  )}

                  <button onClick={() => handleDelete(offer._id)}
                    className="p-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-colors" title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Offer Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="border-b border-dark-100 px-6 py-4 flex items-center justify-between flex-shrink-0">
              <h2 className="text-xl font-bold text-dark-900">{editing ? 'Edit Offer' : 'Create New Offer'}</h2>
              <button onClick={closeModal} className="p-2 hover:bg-dark-100 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
              {/* Image Upload */}
              <div>
                <label className="block text-sm font-semibold text-dark-700 mb-2">Offer Banner Image</label>
                <div className="border-2 border-dashed border-dark-200 rounded-xl overflow-hidden hover:border-primary-400 transition-colors">
                  {imagePreview ? (
                    <div className="relative">
                      <img src={imagePreview} alt="Preview" className="w-full h-auto max-h-[200px] object-contain bg-dark-50" />
                      <button type="button" onClick={() => { setImageFile(null); setImagePreview(''); }}
                        className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full hover:bg-red-600 shadow-lg">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <label className="cursor-pointer block py-10 text-center">
                      <Upload className="w-10 h-10 text-dark-300 mx-auto mb-2" />
                      <p className="text-dark-600 font-medium">Click to upload banner</p>
                      <p className="text-dark-400 text-sm mt-1">Recommended: 19:6 aspect ratio</p>
                      <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                    </label>
                  )}
                </div>
              </div>

              {/* Offer Type & Discount */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-dark-700 mb-2">Offer Type</label>
                  <div className="flex gap-2">
                    {['percentage', 'flat', 'bogo'].map(type => (
                      <button key={type} type="button" onClick={() => setForm({ ...form, offerType: type })}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all border-2 capitalize ${
                          form.offerType === type ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-dark-200 text-dark-600 hover:border-dark-300'
                        }`}>
                        {type === 'bogo' ? 'BOGO' : type}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-dark-700 mb-2">
                    {form.offerType === 'percentage' ? 'Discount %' : form.offerType === 'flat' ? 'Flat Off (₹)' : 'Buy X Get Y'}
                  </label>
                  <input type="number" value={form.percentage} onChange={(e) => setForm({ ...form, percentage: e.target.value })}
                    className="w-full px-4 py-3 bg-dark-50 border border-dark-200 rounded-xl focus:border-primary-500 focus:bg-white transition-all"
                    placeholder={form.offerType === 'percentage' ? 'e.g., 20' : form.offerType === 'flat' ? 'e.g., 50' : 'e.g., 1'}
                  />
                </div>
              </div>

              {/* Category Selection */}
              <div>
                <label className="block text-sm font-semibold text-dark-700 mb-2">Apply to Categories (optional)</label>
                <div className="flex flex-wrap gap-2">
                  {categories.map(cat => (
                    <button key={cat._id} type="button"
                      onClick={() => {
                        const selected = form.selectedCategories.includes(cat.name)
                          ? form.selectedCategories.filter(c => c !== cat.name)
                          : [...form.selectedCategories, cat.name];
                        setForm({ ...form, selectedCategories: selected });
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                        form.selectedCategories.includes(cat.name)
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-dark-200 text-dark-600 hover:border-dark-300'
                      }`}>
                      {cat.image && <img src={cat.image} alt="" className="w-5 h-5 rounded-full object-cover" />}
                      {cat.name}
                      {form.selectedCategories.includes(cat.name) && <Check className="w-3.5 h-3.5" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Item Selection */}
              <div>
                <label className="block text-sm font-semibold text-dark-700 mb-2">Apply to Specific Items (optional)</label>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
                  <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search menu items..." className="w-full pl-10 pr-4 py-2 bg-dark-50 border border-dark-200 rounded-xl text-sm focus:border-primary-500" />
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1 border border-dark-200 rounded-xl p-2">
                  {filteredMenuItems.map(item => (
                    <button key={item._id} type="button"
                      onClick={() => {
                        const selected = form.selectedItems.includes(item._id)
                          ? form.selectedItems.filter(id => id !== item._id)
                          : [...form.selectedItems, item._id];
                        setForm({ ...form, selectedItems: selected });
                      }}
                      className={`w-full flex items-center gap-2 p-2 rounded-lg text-left text-sm transition-all ${
                        form.selectedItems.includes(item._id) ? 'bg-primary-50 border border-primary-200' : 'hover:bg-dark-50'
                      }`}>
                      <div className="w-8 h-8 rounded-lg bg-dark-100 overflow-hidden flex-shrink-0">
                        {item.image ? <img src={item.image} alt="" className="w-full h-full object-cover" /> :
                          <div className="w-full h-full flex items-center justify-center"><ShoppingBag className="w-4 h-4 text-dark-300" /></div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-dark-800 truncate">{item.name}</p>
                        <p className="text-xs text-dark-400">₹{item.price}{item.variants?.length > 0 ? ` • ${item.variants.length} variants` : ''}</p>
                      </div>
                      {form.selectedItems.includes(item._id) && <Check className="w-4 h-4 text-primary-500 flex-shrink-0" />}
                    </button>
                  ))}
                </div>
                {form.selectedItems.length > 0 && (
                  <p className="text-xs text-primary-600 mt-1">{form.selectedItems.length} items selected</p>
                )}
              </div>

              {/* Schedule */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-dark-700 mb-2">Valid From (optional)</label>
                  <input type="datetime-local" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
                    className="w-full px-4 py-3 bg-dark-50 border border-dark-200 rounded-xl focus:border-primary-500 focus:bg-white transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-dark-700 mb-2">Valid Until (optional)</label>
                  <input type="datetime-local" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
                    className="w-full px-4 py-3 bg-dark-50 border border-dark-200 rounded-xl focus:border-primary-500 focus:bg-white transition-all" />
                </div>
              </div>

              {/* Customer Targeting */}
              <div>
                <label className="block text-sm font-semibold text-dark-700 mb-2">Customer Targeting</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'all', label: 'All Customers', icon: Users },
                    { value: 'top_percentage', label: 'Top Spenders %', icon: Percent },
                    { value: 'min_spent', label: 'Min Amount Spent', icon: ShoppingBag },
                    { value: 'min_orders', label: 'Min Orders Count', icon: Tag },
                  ].map(opt => (
                    <button key={opt.value} type="button" onClick={() => setForm({ ...form, targetType: opt.value })}
                      className={`flex items-center gap-2 p-3 rounded-xl text-sm font-medium border-2 transition-all ${
                        form.targetType === opt.value ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-dark-200 text-dark-600 hover:border-dark-300'
                      }`}>
                      <opt.icon className="w-4 h-4" />
                      {opt.label}
                    </button>
                  ))}
                </div>

                {form.targetType === 'top_percentage' && (
                  <div className="mt-3 flex items-center gap-3">
                    <input type="number" value={form.targetPercentage} onChange={(e) => setForm({ ...form, targetPercentage: e.target.value })}
                      className="w-24 px-3 py-2 border border-dark-200 rounded-lg text-sm" min="1" max="100" />
                    <span className="text-sm text-dark-500">% of top spenders</span>
                    <button type="button" onClick={previewCustomers} className="px-3 py-2 bg-dark-100 text-dark-700 rounded-lg text-xs font-medium hover:bg-dark-200">Preview</button>
                  </div>
                )}
                {form.targetType === 'min_spent' && (
                  <div className="mt-3 flex items-center gap-3">
                    <span className="text-sm text-dark-500">₹</span>
                    <input type="number" value={form.targetMinSpent} onChange={(e) => setForm({ ...form, targetMinSpent: e.target.value })}
                      className="w-32 px-3 py-2 border border-dark-200 rounded-lg text-sm" />
                    <span className="text-sm text-dark-500">minimum spent</span>
                    <button type="button" onClick={previewCustomers} className="px-3 py-2 bg-dark-100 text-dark-700 rounded-lg text-xs font-medium hover:bg-dark-200">Preview</button>
                  </div>
                )}
                {form.targetType === 'min_orders' && (
                  <div className="mt-3 flex items-center gap-3">
                    <input type="number" value={form.targetMinOrders} onChange={(e) => setForm({ ...form, targetMinOrders: e.target.value })}
                      className="w-24 px-3 py-2 border border-dark-200 rounded-lg text-sm" min="1" />
                    <span className="text-sm text-dark-500">minimum orders</span>
                    <button type="button" onClick={previewCustomers} className="px-3 py-2 bg-dark-100 text-dark-700 rounded-lg text-xs font-medium hover:bg-dark-200">Preview</button>
                  </div>
                )}

                {customerStats && (
                  <div className="mt-3 p-3 bg-blue-50 rounded-xl text-sm text-blue-700">
                    <p className="font-medium">{customerStats.count || customerStats.customers?.length || 0} customers will receive this offer</p>
                  </div>
                )}
              </div>

              {/* Submit */}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal}
                  className="flex-1 px-4 py-3 border border-dark-200 rounded-xl font-medium text-dark-700 hover:bg-dark-50 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={submitting || (!imageFile && !editing)}
                  className="flex-1 px-4 py-3 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                  {submitting ? (
                    <><RotateCw className="w-4 h-4 animate-spin" />{editing ? 'Updating...' : 'Creating...'}</>
                  ) : (
                    editing ? 'Update Offer' : 'Create Offer'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
