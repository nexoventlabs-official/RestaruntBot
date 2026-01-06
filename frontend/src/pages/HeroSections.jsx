import { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Eye, EyeOff, GripVertical, X, Upload, Image } from 'lucide-react';
import api from '../api';

export default function HeroSections() {
  const [heroes, setHeroes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingHero, setEditingHero] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    subtitle: '',
    description: '',
    buttonText: 'Order Now',
    buttonLink: '/menu',
    order: 0,
    isActive: true
  });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');

  useEffect(() => {
    loadHeroes();
  }, []);

  const loadHeroes = async () => {
    try {
      const res = await api.get('/hero-sections');
      setHeroes(res.data);
    } catch (err) {
      console.error('Error loading hero sections:', err);
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
      subtitle: '',
      description: '',
      buttonText: 'Order Now',
      buttonLink: '/menu',
      order: 0,
      isActive: true
    });
    setImageFile(null);
    setImagePreview('');
    setEditingHero(null);
  };

  const openModal = (hero = null) => {
    if (hero) {
      setEditingHero(hero);
      setFormData({
        title: hero.title,
        subtitle: hero.subtitle || '',
        description: hero.description || '',
        buttonText: hero.buttonText || 'Order Now',
        buttonLink: hero.buttonLink || '/menu',
        order: hero.order || 0,
        isActive: hero.isActive
      });
      setImagePreview(hero.image);
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
    if (!imageFile && !editingHero) return alert('Image is required');

    setSubmitting(true);
    try {
      const data = new FormData();
      Object.keys(formData).forEach(key => data.append(key, formData[key]));
      if (imageFile) data.append('image', imageFile);

      if (editingHero) {
        await api.put(`/hero-sections/${editingHero._id}`, data);
      } else {
        await api.post('/hero-sections', data);
      }
      
      loadHeroes();
      closeModal();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save hero section');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this hero section?')) return;
    try {
      await api.delete(`/hero-sections/${id}`);
      loadHeroes();
    } catch (err) {
      alert('Failed to delete hero section');
    }
  };

  const handleToggle = async (id) => {
    try {
      await api.patch(`/hero-sections/${id}/toggle`);
      loadHeroes();
    } catch (err) {
      alert('Failed to toggle status');
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark-900">Hero Sections</h1>
          <p className="text-dark-500 mt-1">Manage homepage banner slides</p>
        </div>
        <button
          onClick={() => openModal()}
          className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2.5 rounded-xl font-medium hover:bg-primary-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          Add Hero
        </button>
      </div>

      {/* Hero List */}
      {heroes.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center">
          <Image className="w-16 h-16 text-dark-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-dark-900 mb-2">No Hero Sections</h3>
          <p className="text-dark-500 mb-6">Add your first hero section to display on the homepage</p>
          <button
            onClick={() => openModal()}
            className="inline-flex items-center gap-2 bg-primary-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-primary-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Add Hero Section
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {heroes.map((hero, index) => (
            <div 
              key={hero._id} 
              className={`bg-white rounded-2xl overflow-hidden shadow-sm border ${
                hero.isActive ? 'border-green-200' : 'border-dark-100 opacity-60'
              }`}
            >
              <div className="flex flex-col md:flex-row">
                {/* Image */}
                <div className="md:w-64 h-40 md:h-auto relative flex-shrink-0">
                  <img 
                    src={hero.image} 
                    alt={hero.title}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-2 left-2 bg-dark-900/70 text-white text-xs px-2 py-1 rounded-lg">
                    #{index + 1}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 p-4 md:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-dark-900 text-lg">{hero.title}</h3>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          hero.isActive 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-dark-100 text-dark-500'
                        }`}>
                          {hero.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      {hero.subtitle && (
                        <p className="text-primary-600 text-sm font-medium mb-1">{hero.subtitle}</p>
                      )}
                      {hero.description && (
                        <p className="text-dark-500 text-sm line-clamp-2">{hero.description}</p>
                      )}
                      <div className="flex items-center gap-4 mt-3 text-sm text-dark-400">
                        <span>Button: {hero.buttonText}</span>
                        <span>Link: {hero.buttonLink}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggle(hero._id)}
                        className={`p-2 rounded-lg transition-colors ${
                          hero.isActive 
                            ? 'text-green-600 hover:bg-green-50' 
                            : 'text-dark-400 hover:bg-dark-50'
                        }`}
                        title={hero.isActive ? 'Deactivate' : 'Activate'}
                      >
                        {hero.isActive ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                      </button>
                      <button
                        onClick={() => openModal(hero)}
                        className="p-2 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                        title="Edit"
                      >
                        <Edit2 className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => handleDelete(hero._id)}
                        className="p-2 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-dark-100 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-dark-900">
                {editingHero ? 'Edit Hero Section' : 'Add Hero Section'}
              </h2>
              <button onClick={closeModal} className="p-2 hover:bg-dark-100 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              {/* Image Upload */}
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">
                  Banner Image *
                </label>
                <div className="border-2 border-dashed border-dark-200 rounded-xl p-4 text-center hover:border-primary-400 transition-colors">
                  {imagePreview ? (
                    <div className="relative">
                      <img 
                        src={imagePreview} 
                        alt="Preview" 
                        className="w-full h-48 object-cover rounded-lg"
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
                    <label className="cursor-pointer block py-8">
                      <Upload className="w-10 h-10 text-dark-300 mx-auto mb-2" />
                      <p className="text-dark-500">Click to upload image</p>
                      <p className="text-xs text-dark-400 mt-1">Recommended: 1920x1080px</p>
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
                  placeholder="e.g., Delicious Food Delivered Fresh"
                  required
                />
              </div>

              {/* Subtitle */}
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">Subtitle</label>
                <input
                  type="text"
                  value={formData.subtitle}
                  onChange={(e) => setFormData({ ...formData, subtitle: e.target.value })}
                  className="w-full px-4 py-3 border border-dark-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder="e.g., Special Offer"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-3 border border-dark-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  rows={3}
                  placeholder="Brief description for the hero section"
                />
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

              {/* Order & Status */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-dark-700 mb-2">Display Order</label>
                  <input
                    type="number"
                    value={formData.order}
                    onChange={(e) => setFormData({ ...formData, order: parseInt(e.target.value) || 0 })}
                    className="w-full px-4 py-3 border border-dark-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    min="0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-dark-700 mb-2">Status</label>
                  <select
                    value={formData.isActive ? 'active' : 'inactive'}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.value === 'active' })}
                    className="w-full px-4 py-3 border border-dark-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
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
                  {submitting ? 'Saving...' : editingHero ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
