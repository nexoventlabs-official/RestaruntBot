import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Sparkles, X, Image, FolderPlus } from 'lucide-react';
import api from '../api';

export default function Menu() {
  const [items, setItems] = useState([]);
  const [categoryList, setCategoryList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', price: '', category: '', unit: 'piece', quantity: 1, foodType: 'none', available: true, preparationTime: 15, tags: '', image: '' });
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '' });
  const units = ['piece', 'kg', 'gram', 'liter', 'ml', 'plate', 'bowl', 'cup', 'slice'];
  const [aiLoading, setAiLoading] = useState(false);

  const fetchItems = async () => {
    try {
      const res = await api.get('/menu');
      setItems(res.data || []);
    } catch (err) {
      console.error('Failed to fetch menu:', err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await api.get('/categories');
      setCategoryList(res.data || []);
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    }
  };

  useEffect(() => { 
    fetchItems(); 
    fetchCategories(); 
  }, []);

  const openModal = (item = null) => {
    if (item) {
      setEditing(item);
      setForm({ name: item.name, description: item.description || '', price: item.price, category: item.category, unit: item.unit || 'piece', quantity: item.quantity || 1, foodType: item.foodType || 'none', available: item.available, preparationTime: item.preparationTime || 15, tags: item.tags?.join(', ') || '', image: item.image || '' });
    } else {
      setEditing(null);
      setForm({ name: '', description: '', price: '', category: '', unit: 'piece', quantity: 1, foodType: 'none', available: true, preparationTime: 15, tags: '', image: '' });
    }
    setShowModal(true);
  };

  const generateDescription = async () => {
    if (!form.name || !form.category) return alert('Enter name and category first');
    setAiLoading(true);
    try {
      const res = await api.post('/ai/generate-description', { name: form.name, category: form.category });
      setForm({ ...form, description: res.data.description });
    } catch (err) {
      alert('Failed to generate description');
    } finally {
      setAiLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await api.put(`/menu/${editing._id}`, form);
      } else {
        await api.post('/menu', form);
      }
      setShowModal(false);
      fetchItems();
    } catch (err) {
      alert('Failed to save item');
    }
  };

  const deleteItem = async (id) => {
    if (!confirm('Delete this item?')) return;
    try {
      await api.delete(`/menu/${id}`);
      fetchItems();
    } catch (err) {
      alert('Failed to delete');
    }
  };

  const toggleAvailability = async (item) => {
    try {
      await api.put(`/menu/${item._id}`, { ...item, available: !item.available, tags: item.tags?.join(', ') || '' });
      setItems(prev => prev.map(i => i._id === item._id ? { ...i, available: !i.available } : i));
    } catch (err) {
      alert('Failed to update availability');
    }
  };

  const categories = [...new Set(items.map(i => i.category))];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Menu Items</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowCategoryModal(true)} className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700">
            <FolderPlus className="w-5 h-5" /> Categories
          </button>
          <button onClick={() => openModal()} className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">
            <Plus className="w-5 h-5" /> Add Item
          </button>
        </div>
      </div>

      {loading ? <div className="text-center py-8">Loading...</div> : (
        <div>
          {categories.map(cat => (
            <div key={cat} className="mb-8">
              <h2 className="text-lg font-semibold mb-4 text-gray-700">{cat}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {items.filter(i => i.category === cat).map(item => (
                  <div key={item._id} className="bg-white rounded-xl shadow-sm overflow-hidden">
                    <div className="h-40 bg-gray-100 flex items-center justify-center">
                      {item.image ? (
                        <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                      ) : (
                        <Image className="w-12 h-12 text-gray-300" />
                      )}
                    </div>
                    <div className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold">{item.name}</h3>
                          <p className="text-green-600 font-bold">₹{item.price} / {item.quantity || 1} {item.unit || 'piece'}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {item.foodType && item.foodType !== 'none' && (
                            <span className={`w-4 h-4 rounded border-2 ${item.foodType === 'veg' ? 'border-green-600' : 'border-red-600'}`}>
                              <span className={`block w-2 h-2 m-0.5 rounded-full ${item.foodType === 'veg' ? 'bg-green-600' : 'bg-red-600'}`}></span>
                            </span>
                          )}
                          <button 
                            onClick={() => toggleAvailability(item)} 
                            className={`px-2 py-1 rounded text-xs cursor-pointer hover:opacity-80 transition-opacity ${item.available ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                          >
                            {item.available ? 'Available' : 'Unavailable'}
                          </button>
                        </div>
                      </div>
                      {item.description && <p className="text-sm text-gray-500 mt-2 line-clamp-2">{item.description}</p>}
                      <div className="flex gap-2 mt-4">
                        <button onClick={() => openModal(item)} className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm hover:bg-blue-100">
                          <Edit className="w-4 h-4" /> Edit
                        </button>
                        <button onClick={() => deleteItem(item._id)} className="flex items-center justify-center px-3 py-2 bg-red-50 text-red-600 rounded-lg text-sm hover:bg-red-100">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">{editing ? 'Edit Item' : 'Add Item'}</h2>
              <button onClick={() => setShowModal(false)}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Category</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 border rounded-lg" required>
                  <option value="">Select Category</option>
                  {categoryList.map(cat => <option key={cat._id} value={cat.name}>{cat.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <div className="relative">
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 border rounded-lg pr-10" rows={3} />
                  <button type="button" onClick={generateDescription} disabled={aiLoading} className="absolute right-2 top-2 p-1 text-purple-600 hover:bg-purple-50 rounded" title="Generate with AI">
                    <Sparkles className={`w-5 h-5 ${aiLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Price (₹)</label>
                  <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-full px-3 py-2 border rounded-lg" required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Prep Time (min)</label>
                  <input type="number" value={form.preparationTime} onChange={(e) => setForm({ ...form, preparationTime: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Quantity</label>
                  <input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="w-full px-3 py-2 border rounded-lg" min="1" step="0.5" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Unit</label>
                  <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="w-full px-3 py-2 border rounded-lg">
                    {units.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Image URL</label>
                <input type="url" value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="https://example.com/image.jpg" />
                {form.image && (
                  <div className="mt-2 rounded-lg overflow-hidden border h-40 bg-gray-100">
                    <img src={form.image} alt="Preview" className="w-full h-full object-cover" onError={(e) => e.target.style.display = 'none'} />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Tags (comma separated)</label>
                <input type="text" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="spicy, vegetarian" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Food Type</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="foodType" value="veg" checked={form.foodType === 'veg'} onChange={(e) => setForm({ ...form, foodType: e.target.value })} className="text-green-600" />
                    <span className="w-4 h-4 rounded border-2 border-green-600 flex items-center justify-center"><span className="w-2 h-2 rounded-full bg-green-600"></span></span>
                    <span>Veg</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="foodType" value="nonveg" checked={form.foodType === 'nonveg'} onChange={(e) => setForm({ ...form, foodType: e.target.value })} className="text-red-600" />
                    <span className="w-4 h-4 rounded border-2 border-red-600 flex items-center justify-center"><span className="w-2 h-2 rounded-full bg-red-600"></span></span>
                    <span>Non-Veg</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="foodType" value="none" checked={form.foodType === 'none'} onChange={(e) => setForm({ ...form, foodType: e.target.value })} className="text-gray-600" />
                    <span className="w-4 h-4 rounded border-2 border-gray-400"></span>
                    <span>None</span>
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Availability</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="availability" checked={form.available === true} onChange={() => setForm({ ...form, available: true })} className="text-green-600" />
                    <span className="px-2 py-1 rounded text-xs bg-green-100 text-green-700">Available</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="availability" checked={form.available === false} onChange={() => setForm({ ...form, available: false })} className="text-red-600" />
                    <span className="px-2 py-1 rounded text-xs bg-red-100 text-red-700">Unavailable</span>
                  </label>
                </div>
              </div>
              <button type="submit" className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700">
                {editing ? 'Update Item' : 'Add Item'}
              </button>
            </form>
          </div>
        </div>
      )}

      {showCategoryModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCategoryModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">Manage Categories</h2>
              <button onClick={() => setShowCategoryModal(false)}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4">
              <form onSubmit={async (e) => {
                e.preventDefault();
                if (!categoryForm.name.trim()) return;
                try {
                  await api.post('/categories', categoryForm);
                  setCategoryForm({ name: '', description: '' });
                  fetchCategories();
                } catch (err) {
                  alert(err.response?.data?.error || 'Failed to add category');
                }
              }} className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  placeholder="New category name"
                  className="flex-1 px-3 py-2 border rounded-lg"
                />
                <button type="submit" className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700">
                  Add
                </button>
              </form>
              <div className="space-y-2">
                {categoryList.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No categories yet. Add one above!</p>
                ) : (
                  categoryList.map(cat => (
                    <div key={cat._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <span className="font-medium">{cat.name}</span>
                      <button
                        onClick={async () => {
                          if (!confirm(`Delete "${cat.name}" category?`)) return;
                          try {
                            await api.delete(`/categories/${cat._id}`);
                            fetchCategories();
                          } catch (err) {
                            alert('Failed to delete category');
                          }
                        }}
                        className="text-red-500 hover:bg-red-50 p-1 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
