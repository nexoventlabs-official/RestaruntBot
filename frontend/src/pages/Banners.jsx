import { useState, useEffect } from 'react';
import { Plus, Trash2, Image, X, GripVertical, Eye, EyeOff, Link } from 'lucide-react';
import api from '../api';

export default function Banners() {
  const [banners, setBanners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ title: '', link: '' });
  const [image, setImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);

  useEffect(() => { loadBanners(); }, []);

  const loadBanners = async () => {
    try {
      const res = await api.get('/banners/admin');
      setBanners(res.data);
    } catch (err) {
      console.error('Error loading banners:', err);
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
    if (!image) return alert('Please select an image');
    
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('title', form.title);
      formData.append('link', form.link);
      formData.append('image', image);
      
      await api.post('/banners', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      setShowModal(false);
      setForm({ title: '', link: '' });
      setImage(null);
      setImagePreview(null);
      loadBanners();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add banner');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this banner?')) return;
    try {
      await api.delete(`/banners/${id}`);
      loadBanners();
    } catch (err) {
      alert('Failed to delete');
    }
  };

  const toggleActive = async (id, currentStatus) => {
    try {
      await api.put(`/banners/${id}`, { isActive: !currentStatus });
      loadBanners();
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
          <h2 className="text-xl font-bold text-dark-900">Hero Banners</h2>
          <p className="text-dark-500 text-sm">{banners.length} banners (auto-rotate every 3 seconds)</p>
        </div>
        <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition">
          <Plus className="w-5 h-5" />
          Add Banner
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {banners.map(banner => (
          <div key={banner._id} className={`bg-white rounded-xl overflow-hidden shadow-sm border ${banner.isActive ? 'border-green-200' : 'border-dark-200 opacity-60'}`}>
            <div className="aspect-[3/1] bg-dark-100 relative">
              <img src={banner.image} alt={banner.title} className="w-full h-full object-cover" />
              <div className="absolute top-2 right-2 flex gap-2">
                <span className={`px-2 py-1 rounded-lg text-xs font-medium ${banner.isActive ? 'bg-green-500 text-white' : 'bg-dark-500 text-white'}`}>
                  {banner.isActive ? 'Active' : 'Hidden'}
                </span>
              </div>
            </div>
            <div className="p-4">
              <h3 className="font-semibold text-dark-900">{banner.title || 'Untitled Banner'}</h3>
              {banner.link && (
                <div className="flex items-center gap-1 text-sm text-dark-400 mt-1">
                  <Link className="w-3 h-3" />
                  <span className="truncate">{banner.link}</span>
                </div>
              )}
              <div className="flex items-center gap-2 mt-3">
                <button onClick={() => toggleActive(banner._id, banner.isActive)} className={`flex-1 py-2 rounded-lg text-sm font-medium transition flex items-center justify-center gap-2 ${banner.isActive ? 'bg-amber-50 text-amber-600 hover:bg-amber-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}>
                  {banner.isActive ? <><EyeOff className="w-4 h-4" /> Hide</> : <><Eye className="w-4 h-4" /> Show</>}
                </button>
                <button onClick={() => handleDelete(banner._id)} className="p-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
        
        {banners.length === 0 && (
          <div className="col-span-full text-center py-12 text-dark-400 bg-white rounded-xl">
            <Image className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No banners added yet</p>
            <p className="text-sm mt-1">Add banners to show in hero section</p>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="p-4 border-b border-dark-100 flex items-center justify-between">
              <h3 className="font-semibold text-lg">Add Banner</h3>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-dark-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">Banner Image *</label>
                <label className="block cursor-pointer">
                  <div className="aspect-[3/1] bg-dark-100 rounded-xl overflow-hidden flex items-center justify-center border-2 border-dashed border-dark-200 hover:border-primary-400 transition">
                    {imagePreview ? (
                      <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-center">
                        <Image className="w-8 h-8 mx-auto text-dark-400 mb-2" />
                        <p className="text-sm text-dark-400">Click to upload (1200x400)</p>
                      </div>
                    )}
                  </div>
                  <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                </label>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-1">Title (optional)</label>
                <input type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="w-full px-4 py-2 border border-dark-200 rounded-xl focus:ring-2 focus:ring-primary-500" placeholder="Banner title" />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-1">Link (optional)</label>
                <input type="text" value={form.link} onChange={e => setForm({ ...form, link: e.target.value })} className="w-full px-4 py-2 border border-dark-200 rounded-xl focus:ring-2 focus:ring-primary-500" placeholder="https://..." />
              </div>
              
              <button type="submit" disabled={submitting || !image} className="w-full py-3 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 transition disabled:opacity-50">
                {submitting ? 'Uploading...' : 'Add Banner'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
