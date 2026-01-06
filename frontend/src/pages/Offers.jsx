import { useState, useEffect } from 'react';
import { Plus, Trash2, Tag, X, Eye, EyeOff, Bell, BellOff, Calendar, Percent } from 'lucide-react';
import api from '../api';

export default function Offers() {
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', code: '', discount: '', validTill: '', showOnLoad: true });
  const [image, setImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);

  useEffect(() => { loadOffers(); }, []);

  const loadOffers = async () => {
    try {
      const res = await api.get('/offers/admin');
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
      setImage(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title) return alert('Please enter a title');
    
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('title', form.title);
      formData.append('description', form.description);
      formData.append('code', form.code);
      formData.append('discount', form.discount);
      formData.append('validTill', form.validTill);
      formData.append('showOnLoad', form.showOnLoad);
      if (image) formData.append('image', image);
      
      await api.post('/offers', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      setShowModal(false);
      setForm({ title: '', description: '', code: '', discount: '', validTill: '', showOnLoad: true });
      setImage(null);
      setImagePreview(null);
      loadOffers();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add offer');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this offer?')) return;
    try {
      await api.delete(`/offers/${id}`);
      loadOffers();
    } catch (err) {
      alert('Failed to delete');
    }
  };

  const toggleActive = async (id, currentStatus) => {
    try {
      await api.put(`/offers/${id}`, { isActive: !currentStatus });
      loadOffers();
    } catch (err) {
      alert('Failed to update');
    }
  };

  const togglePopup = async (id, currentStatus) => {
    try {
      await api.put(`/offers/${id}`, { showOnLoad: !currentStatus });
      loadOffers();
    } catch (err) {
      alert('Failed to update');
    }
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-dark-900">Offers & Promotions</h2>
          <p className="text-dark-500 text-sm">{offers.length} offers</p>
        </div>
        <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition">
          <Plus className="w-5 h-5" />
          Add Offer
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {offers.map(offer => (
          <div key={offer._id} className={`bg-white rounded-xl overflow-hidden shadow-sm border ${offer.isActive ? 'border-green-200' : 'border-dark-200 opacity-60'}`}>
            {offer.image && (
              <div className="aspect-[3/2] bg-dark-100">
                <img src={offer.image} alt={offer.title} className="w-full h-full object-cover" />
              </div>
            )}
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-dark-900">{offer.title}</h3>
                <div className="flex gap-1">
                  {offer.showOnLoad && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">Popup</span>}
                  <span className={`px-2 py-0.5 rounded-full text-xs ${offer.isActive ? 'bg-green-100 text-green-700' : 'bg-dark-100 text-dark-500'}`}>
                    {offer.isActive ? 'Active' : 'Hidden'}
                  </span>
                </div>
              </div>
              
              {offer.description && <p className="text-sm text-dark-500 mt-1">{offer.description}</p>}
              
              <div className="flex flex-wrap gap-2 mt-3">
                {offer.code && (
                  <span className="px-2 py-1 bg-amber-50 text-amber-700 text-sm rounded-lg font-mono">{offer.code}</span>
                )}
                {offer.discount && (
                  <span className="px-2 py-1 bg-green-50 text-green-700 text-sm rounded-lg flex items-center gap-1">
                    <Percent className="w-3 h-3" /> {offer.discount}
                  </span>
                )}
              </div>
              
              {offer.validTill && (
                <div className="flex items-center gap-1 text-xs text-dark-400 mt-2">
                  <Calendar className="w-3 h-3" />
                  Valid till {new Date(offer.validTill).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                </div>
              )}
              
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-dark-100">
                <button onClick={() => toggleActive(offer._id, offer.isActive)} className={`flex-1 py-2 rounded-lg text-xs font-medium transition flex items-center justify-center gap-1 ${offer.isActive ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'}`}>
                  {offer.isActive ? <><EyeOff className="w-3 h-3" /> Hide</> : <><Eye className="w-3 h-3" /> Show</>}
                </button>
                <button onClick={() => togglePopup(offer._id, offer.showOnLoad)} className={`flex-1 py-2 rounded-lg text-xs font-medium transition flex items-center justify-center gap-1 ${offer.showOnLoad ? 'bg-blue-50 text-blue-600' : 'bg-dark-50 text-dark-500'}`}>
                  {offer.showOnLoad ? <><BellOff className="w-3 h-3" /> No Popup</> : <><Bell className="w-3 h-3" /> Popup</>}
                </button>
                <button onClick={() => handleDelete(offer._id)} className="p-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
        
        {offers.length === 0 && (
          <div className="col-span-full text-center py-12 text-dark-400 bg-white rounded-xl">
            <Tag className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No offers added yet</p>
            <p className="text-sm mt-1">Add offers to show popup on website</p>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b border-dark-100 flex items-center justify-between sticky top-0 bg-white">
              <h3 className="font-semibold text-lg">Add Offer</h3>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-dark-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">Offer Image (optional)</label>
                <label className="block cursor-pointer">
                  <div className="aspect-[3/2] bg-dark-100 rounded-xl overflow-hidden flex items-center justify-center border-2 border-dashed border-dark-200 hover:border-primary-400 transition">
                    {imagePreview ? (
                      <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-center">
                        <Tag className="w-8 h-8 mx-auto text-dark-400 mb-2" />
                        <p className="text-sm text-dark-400">Click to upload</p>
                      </div>
                    )}
                  </div>
                  <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                </label>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-1">Title *</label>
                <input type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="w-full px-4 py-2 border border-dark-200 rounded-xl focus:ring-2 focus:ring-primary-500" placeholder="e.g. 20% OFF on First Order" required />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-1">Description</label>
                <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full px-4 py-2 border border-dark-200 rounded-xl focus:ring-2 focus:ring-primary-500 resize-none" rows={2} placeholder="Offer details..." />
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-dark-700 mb-1">Coupon Code</label>
                  <input type="text" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} className="w-full px-4 py-2 border border-dark-200 rounded-xl focus:ring-2 focus:ring-primary-500 font-mono" placeholder="FIRST20" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-dark-700 mb-1">Discount</label>
                  <input type="text" value={form.discount} onChange={e => setForm({ ...form, discount: e.target.value })} className="w-full px-4 py-2 border border-dark-200 rounded-xl focus:ring-2 focus:ring-primary-500" placeholder="20% OFF" />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-1">Valid Till</label>
                <input type="date" value={form.validTill} onChange={e => setForm({ ...form, validTill: e.target.value })} className="w-full px-4 py-2 border border-dark-200 rounded-xl focus:ring-2 focus:ring-primary-500" />
              </div>
              
              <label className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl cursor-pointer">
                <input type="checkbox" checked={form.showOnLoad} onChange={e => setForm({ ...form, showOnLoad: e.target.checked })} className="w-5 h-5 rounded border-dark-300 text-primary-600 focus:ring-primary-500" />
                <div>
                  <p className="font-medium text-dark-800">Show as Popup</p>
                  <p className="text-xs text-dark-500">Display this offer when user opens website</p>
                </div>
              </label>
              
              <button type="submit" disabled={submitting} className="w-full py-3 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 transition disabled:opacity-50">
                {submitting ? 'Adding...' : 'Add Offer'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
