import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Plus, Edit, Trash2, Sparkles, X, Image, FolderPlus, Search, ChevronDown, ChevronUp, Check, Pause, Play, Upload, Ban, CalendarClock, Tag, Package } from 'lucide-react';
import api from '../api';

/* ─── helpers ─── */
const foodDot = (ft) =>
  ft === 'veg' ? 'bg-green-500' : ft === 'egg' ? 'bg-yellow-500' : ft === 'nonveg' || ft === 'non-veg' ? 'bg-red-500' : 'bg-gray-300';

const soldOutRemaining = (cat) => {
  if (!cat?.soldOutSchedule?.enabled || !cat?.soldOutSchedule?.endTime) return null;
  const [h, m] = cat.soldOutSchedule.endTime.split(':').map(Number);
  const end = new Date(); end.setHours(h, m, 0, 0);
  const diff = end - new Date();
  if (diff <= 0) return null;
  const mins = Math.floor(diff / 60000);
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
};

export default function Menu() {
  /* ═══════════ STATE ═══════════ */
  const [items, setItems] = useState([]);
  const [categoryList, setCategoryList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [foodTypeFilter, setFoodTypeFilter] = useState('all');
  const [selectedTitle, setSelectedTitle] = useState('all');
  const [togglingId, setTogglingId] = useState(null);

  // Modals
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);

  // Item form
  const [form, setForm] = useState({ name: '', category: [], variants: [], available: true });
  const [saving, setSaving] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [variantImageFiles, setVariantImageFiles] = useState({});
  const [variantImagePreviews, setVariantImagePreviews] = useState({});
  const [aiLoading, setAiLoading] = useState(false);
  const [aiTagsLoading, setAiTagsLoading] = useState(false);
  const [variantAiLoading, setVariantAiLoading] = useState({});

  // Category form
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '' });
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryImageFile, setCategoryImageFile] = useState(null);
  const [categoryImagePreview, setCategoryImagePreview] = useState('');

  // Sold-out / Schedule modals
  const [soldOutModal, setSoldOutModal] = useState(null); // { type: 'item'|'category', target }
  const [scheduleModal, setScheduleModal] = useState(null);
  const [scheduleSoldOutTime, setScheduleSoldOutTime] = useState('');
  const [bulkPausingCategory, setBulkPausingCategory] = useState(null);

  // Category schedule
  const [categoryScheduleModal, setCategoryScheduleModal] = useState(null);
  const [categorySchedule, setCategorySchedule] = useState({ enabled: false, type: 'daily', startTime: '09:00', endTime: '22:00', days: [] });

  const [deleting, setDeleting] = useState(false);
  const initialLoadDone = useRef(false);
  const lastTapRef = useRef({});

  /* ═══════════ DATA FETCHING ═══════════ */
  const fetchItems = useCallback(async () => {
    try { const r = await api.get('/menu'); setItems(r.data || []); } catch { /* ignore */ }
  }, []);
  const fetchCategories = useCallback(async () => {
    try { const r = await api.get('/categories'); setCategoryList(r.data || []); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    Promise.all([fetchItems(), fetchCategories()]).finally(() => { setLoading(false); initialLoadDone.current = true; });
  }, [fetchItems, fetchCategories]);

  /* ═══════════ MEMOIZED DATA ═══════════ */
  const unavailableCategoryNames = useMemo(() => {
    const s = new Set();
    categoryList.forEach(c => { if (c.isPaused || c.isSoldOut) s.add(c.name); });
    return s;
  }, [categoryList]);

  const scheduledLockedCategoryNames = useMemo(() => {
    const s = new Set();
    categoryList.forEach(c => {
      if (!c.schedule?.enabled) return;
      const now = new Date();
      const day = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][now.getDay()];
      if (c.schedule.type === 'specific_days' && !c.schedule.days?.includes(day)) { s.add(c.name); return; }
      const [sh,sm] = (c.schedule.startTime||'00:00').split(':').map(Number);
      const [eh,em] = (c.schedule.endTime||'23:59').split(':').map(Number);
      const mins = now.getHours()*60+now.getMinutes();
      if (mins < sh*60+sm || mins > eh*60+em) s.add(c.name);
    });
    return s;
  }, [categoryList]);

  const manuallyPausedCategoryNames = useMemo(() => {
    const s = new Set();
    categoryList.forEach(c => { if (c.isPaused || c.isSoldOut) s.add(c.name); });
    return s;
  }, [categoryList]);

  const isItemUnavailable = useCallback((item) => {
    const cats = Array.isArray(item.category) ? item.category : [item.category];
    return cats.every(c => unavailableCategoryNames.has(c) || scheduledLockedCategoryNames.has(c));
  }, [unavailableCategoryNames, scheduledLockedCategoryNames]);

  // Title cards (unique items for product filter)
  const titleCards = useMemo(() => {
    let filtered = items;
    if (selectedCategory !== 'all') filtered = filtered.filter(i => (Array.isArray(i.category) ? i.category : [i.category]).includes(selectedCategory));
    return filtered.map(i => ({ _id: i._id, name: i.name, image: i.image || i.variants?.[0]?.image }));
  }, [items, selectedCategory]);

  const totalVariantCount = useMemo(() => items.reduce((s, i) => s + (i.variants?.length || 1), 0), [items]);

  // Flatten items into variant-level rows (matching mobile's flattenedVariants)
  const flattenedVariants = useMemo(() => {
    let filtered = items;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      filtered = filtered.filter(i => i.name.toLowerCase().includes(q) || i.variants?.some(v => v.label?.toLowerCase().includes(q)));
    }
    if (selectedCategory !== 'all') filtered = filtered.filter(i => (Array.isArray(i.category) ? i.category : [i.category]).includes(selectedCategory));
    if (selectedTitle !== 'all') filtered = filtered.filter(i => i._id === selectedTitle);

    const rows = [];
    filtered.forEach(item => {
      if (!item.variants || item.variants.length === 0) {
        const catUnavail = isItemUnavailable(item);
        if (statusFilter === 'available' && (catUnavail || item.available === false)) return;
        if (statusFilter === 'unavailable' && !catUnavail && item.available !== false) return;
        if (foodTypeFilter !== 'all' && item.foodType !== foodTypeFilter) return;
        rows.push({ ...item, _parentId: item._id, _parentName: item.name, _variantIndex: -1, _isVariant: false });
      } else {
        item.variants.forEach((v, idx) => {
          const catUnavail = isItemUnavailable(item);
          const isOff = catUnavail || v.available === false || item.available === false;
          if (statusFilter === 'available' && isOff) return;
          if (statusFilter === 'unavailable' && !isOff) return;
          const ft = v.foodType || item.foodType;
          if (foodTypeFilter !== 'all' && ft !== foodTypeFilter) return;
          rows.push({
            ...v, _id: `${item._id}_v${idx}`, _parentId: item._id, _parentName: item.name,
            _parentImage: item.image, _parentAvailable: item.available, _parentCategory: item.category,
            _variantIndex: idx, _isVariant: true, _totalVariants: item.variants.length,
            foodType: ft, _catUnavail: catUnavail,
          });
        });
      }
    });
    return rows;
  }, [items, searchTerm, selectedCategory, selectedTitle, statusFilter, foodTypeFilter, isItemUnavailable]);

  // Group by parent item (matching mobile's sectionData)
  const sectionData = useMemo(() => {
    const map = new Map();
    flattenedVariants.forEach(row => {
      if (!map.has(row._parentId)) map.set(row._parentId, { parentId: row._parentId, parentName: row._parentName, parentImage: row._parentImage || row.image, rows: [] });
      map.get(row._parentId).rows.push(row);
    });
    return Array.from(map.values());
  }, [flattenedVariants]);

  const stats = useMemo(() => ({
    totalItems: items.length,
    totalVariants: totalVariantCount,
    uniqueCategories: new Set(items.flatMap(i => Array.isArray(i.category) ? i.category : [i.category])).size,
    availableCount: flattenedVariants.filter(r => !r._catUnavail && r.available !== false && r._parentAvailable !== false).length,
    unavailableCount: flattenedVariants.filter(r => r._catUnavail || r.available === false || r._parentAvailable === false).length,
  }), [items, totalVariantCount, flattenedVariants]);

  /* ═══════════ ITEM / VARIANT HANDLERS ═══════════ */
  const toggleVariant = async (parentId, variantIndex) => {
    const item = items.find(i => i._id === parentId);
    if (!item) return;
    const key = variantIndex >= 0 ? `${parentId}_v${variantIndex}` : parentId;
    setTogglingId(key);
    try {
      if (variantIndex >= 0) {
        await api.patch(`/menu/${parentId}/variant/${variantIndex}/toggle`);
      } else {
        await api.patch(`/menu/${parentId}/toggle-pause`);
      }
      await fetchItems();
    } catch { alert('Failed to toggle'); }
    finally { setTogglingId(null); }
  };

  const markVariantsSoldOut = async (parentId, soldOut) => {
    try {
      await api.patch(`/menu/${parentId}/variants-soldout`, { soldOut });
      await fetchItems();
    } catch { alert('Failed to update'); }
  };

  const handleScheduleSoldOut = async () => {
    if (!scheduleModal || !scheduleSoldOutTime) return;
    try {
      if (scheduleModal.type === 'item') {
        await api.patch(`/menu/${scheduleModal.target._id}/schedule-soldout`, { endTime: scheduleSoldOutTime });
      } else {
        await api.patch(`/categories/${scheduleModal.target._id}/schedule-soldout`, { enabled: true, endTime: scheduleSoldOutTime });
      }
      setScheduleModal(null); setScheduleSoldOutTime('');
      await Promise.all([fetchItems(), fetchCategories()]);
    } catch { alert('Failed to schedule'); }
  };

  const deleteVariant = async (parentId, variantIndex) => {
    setConfirmDialog({
      title: 'Delete Variant?', message: 'This variant will be permanently removed.',
      onConfirm: async () => {
        setDeleting(true);
        try { await api.delete(`/menu/${parentId}/variant/${variantIndex}`); await fetchItems(); }
        catch { alert('Failed to delete variant'); }
        finally { setDeleting(false); setConfirmDialog(null); }
      }
    });
  };

  const deleteItem = (item) => {
    setConfirmDialog({
      title: 'Delete Item?', message: `Delete "${item.name}" and all its variants?`,
      onConfirm: async () => {
        setDeleting(true);
        try { await api.delete(`/menu/${item._id}`); await fetchItems(); }
        catch { alert('Failed to delete item'); }
        finally { setDeleting(false); setConfirmDialog(null); }
      }
    });
  };

  const showSoldOutOptions = (type, target) => {
    setSoldOutModal({ type, target });
  };

  /* ═══════════ CATEGORY HANDLERS ═══════════ */
  const handleBulkPause = async (catName) => {
    const cat = categoryList.find(c => c.name === catName);
    if (!cat) return;
    setBulkPausingCategory(catName);
    try {
      await api.patch('/menu/bulk-pause', { categoryName: catName, isPaused: !cat.isPaused });
      await Promise.all([fetchItems(), fetchCategories()]);
    } catch { alert('Failed to bulk pause'); }
    finally { setBulkPausingCategory(null); }
  };

  const toggleCategorySoldOut = async (cat) => {
    try {
      await api.patch(`/categories/${cat._id}/toggle-soldout`);
      await fetchCategories();
    } catch { alert('Failed to toggle sold-out'); }
  };

  const toggleCategoryPause = async (cat) => {
    try {
      await api.patch(`/categories/${cat._id}/toggle-pause`);
      await fetchCategories();
    } catch { alert('Failed to toggle pause'); }
  };

  const saveCategory = async () => {
    if (!categoryForm.name.trim()) return;
    setSavingCategory(true);
    try {
      const fd = new FormData();
      fd.append('name', categoryForm.name.trim());
      if (categoryForm.description) fd.append('description', categoryForm.description);
      if (categoryImageFile) fd.append('image', categoryImageFile);
      if (editingCategory) { await api.put(`/categories/${editingCategory._id}`, fd, { timeout: 60000 }); }
      else { await api.post('/categories', fd, { timeout: 60000 }); }
      await fetchCategories();
      setShowCategoryModal(false); setEditingCategory(null);
      setCategoryForm({ name: '', description: '' }); setCategoryImageFile(null); setCategoryImagePreview('');
    } catch (err) { alert(err.response?.data?.error || 'Failed to save category'); }
    finally { setSavingCategory(false); }
  };

  const deleteCategory = (cat) => {
    setConfirmDialog({
      title: 'Delete Category?', message: `Delete "${cat.name}"? Items in this category will not be deleted.`,
      onConfirm: async () => {
        try { await api.delete(`/categories/${cat._id}`); await fetchCategories(); }
        catch { alert('Failed to delete category'); }
        finally { setConfirmDialog(null); }
      }
    });
  };

  const openCategoryModal = (cat = null) => {
    if (cat) {
      setEditingCategory(cat);
      setCategoryForm({ name: cat.name, description: cat.description || '' });
      setCategoryImagePreview(cat.image || '');
    } else {
      setEditingCategory(null);
      setCategoryForm({ name: '', description: '' });
      setCategoryImagePreview('');
    }
    setCategoryImageFile(null);
    setShowCategoryModal(true);
  };

  const handleSaveCategorySchedule = async () => {
    if (!categoryScheduleModal) return;
    try {
      await api.patch(`/categories/${categoryScheduleModal._id}/schedule`, categorySchedule);
      await fetchCategories();
      setCategoryScheduleModal(null);
    } catch { alert('Failed to save schedule'); }
  };

  const handleCategoryDoubleTap = (cat) => {
    const now = Date.now();
    const last = lastTapRef.current[cat._id] || 0;
    if (now - last < 400) {
      toggleCategoryPause(cat);
      lastTapRef.current[cat._id] = 0;
    } else {
      setSelectedCategory(selectedCategory === cat.name ? 'all' : cat.name);
      lastTapRef.current[cat._id] = now;
    }
  };

  /* ═══════════ FORM HANDLERS ═══════════ */
  const openModal = (item = null) => {
    if (item) {
      setEditing(item);
      setForm({
        name: item.name || '',
        category: Array.isArray(item.category) ? item.category : [item.category].filter(Boolean),
        variants: (item.variants || []).map((v, i) => ({
          ...v, _uid: `v_${i}_${Date.now()}`, _collapsed: true,
          quantities: v.quantities || [],
        })),
        available: item.available !== false,
      });
      setImagePreview(item.image || '');
      const previews = {};
      (item.variants || []).forEach((v, i) => { if (v.image) previews[`v_${i}_${Date.now()}`] = v.image; });
    } else {
      setEditing(null);
      setForm({ name: '', category: [], variants: [], available: true });
      setImagePreview('');
    }
    setImageFile(null);
    setVariantImageFiles({});
    setVariantImagePreviews({});
    setShowModal(true);
  };

  const addVariant = () => {
    const uid = `v_${form.variants.length}_${Date.now()}`;
    setForm({ ...form, variants: [...form.variants, {
      _uid: uid, _collapsed: false, label: '', description: '', foodType: 'veg',
      tags: '', price: '', available: true, image: null, quantities: [],
    }]});
  };

  const removeVariant = (idx) => {
    setConfirmDialog({
      title: 'Remove Variant?', message: 'This variant will be removed from the form.',
      onConfirm: () => {
        const vs = [...form.variants]; vs.splice(idx, 1);
        setForm({ ...form, variants: vs }); setConfirmDialog(null);
      }
    });
  };

  const toggleVariantCollapse = (idx) => {
    const vs = [...form.variants]; vs[idx] = { ...vs[idx], _collapsed: !vs[idx]._collapsed };
    setForm({ ...form, variants: vs });
  };

  const updateVariant = (idx, field, value) => {
    const vs = [...form.variants]; vs[idx] = { ...vs[idx], [field]: value };
    setForm({ ...form, variants: vs });
  };

  const addQuantityOption = (vi) => {
    const vs = [...form.variants];
    vs[vi] = { ...vs[vi], quantities: [...(vs[vi].quantities || []), { quantity: '', unit: vs[vi].unit || 'piece', price: '' }] };
    setForm({ ...form, variants: vs });
  };

  const removeQuantityOption = (vi, qi) => {
    const vs = [...form.variants]; vs[vi].quantities.splice(qi, 1);
    setForm({ ...form, variants: vs });
  };

  const updateQuantityOption = (vi, qi, field, value) => {
    const vs = [...form.variants]; vs[vi].quantities[qi] = { ...vs[vi].quantities[qi], [field]: value };
    setForm({ ...form, variants: vs });
  };

  const handleVariantImageChange = (idx, e) => {
    const file = e.target.files[0]; if (!file) return;
    const uid = form.variants[idx]._uid;
    setVariantImageFiles(p => ({ ...p, [uid]: file }));
    setVariantImagePreviews(p => ({ ...p, [uid]: URL.createObjectURL(file) }));
  };

  const removeVariantImage = (idx) => {
    const uid = form.variants[idx]._uid;
    const vs = [...form.variants]; vs[idx] = { ...vs[idx], image: null };
    setForm({ ...form, variants: vs });
    setVariantImageFiles(p => { const n = { ...p }; delete n[uid]; return n; });
    setVariantImagePreviews(p => { const n = { ...p }; delete n[uid]; return n; });
  };

  const generateDescription = async (vi = null) => {
    const key = vi !== null ? `desc_${vi}` : 'main';
    setVariantAiLoading(p => ({ ...p, [key]: true }));
    try {
      const name = vi !== null ? form.variants[vi].label : form.name;
      const cat = form.category[0] || '';
      const r = await api.post('/ai/generate-description', { name, category: cat });
      if (vi !== null) { updateVariant(vi, 'description', r.data.description); }
    } catch { alert('AI generation failed'); }
    finally { setVariantAiLoading(p => ({ ...p, [key]: false })); }
  };

  const generateTags = async (vi = null) => {
    const key = vi !== null ? `tags_${vi}` : 'main';
    setVariantAiLoading(p => ({ ...p, [key]: true }));
    try {
      const v = vi !== null ? form.variants[vi] : form;
      const r = await api.post('/ai/generate-tags', { name: v.label || v.name || form.name, category: form.category[0] || '', foodType: v.foodType || 'veg' });
      if (vi !== null) { updateVariant(vi, 'tags', r.data.tags?.join(', ') || ''); }
    } catch { alert('AI generation failed'); }
    finally { setVariantAiLoading(p => ({ ...p, [key]: false })); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return alert('Please enter a name');

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('name', form.name.trim());
      fd.append('category', JSON.stringify(form.category));
      fd.append('available', form.available);

      // Auto-derive from variants
      const v0 = form.variants[0];
      if (v0) {
        fd.append('foodType', v0.foodType || 'veg');
        fd.append('description', v0.description || '');
        fd.append('tags', v0.tags || '');
        const prices = form.variants.flatMap(v => v.quantities?.length > 0 ? v.quantities.map(q => parseFloat(q.price) || 0) : [parseFloat(v.price) || 0]);
        fd.append('price', Math.min(...prices.filter(p => p > 0)) || 0);
      }
      if (imageFile) fd.append('image', imageFile);

      // Variants JSON
      const cleanVariants = form.variants.map(v => {
        const { _uid, _collapsed, ...rest } = v;
        return { ...rest, quantities: (rest.quantities || []).filter(q => q.quantity && q.price) };
      });
      fd.append('variants', JSON.stringify(cleanVariants));

      // Variant images
      const imgIndices = [];
      form.variants.forEach((v, i) => {
        const uid = v._uid;
        if (variantImageFiles[uid]) { fd.append('variantImages', variantImageFiles[uid]); imgIndices.push(i); }
      });
      if (imgIndices.length > 0) fd.append('variantImageIndices', JSON.stringify(imgIndices));

      if (editing) { await api.put(`/menu/${editing._id}`, fd, { timeout: 90000 }); }
      else { await api.post('/menu', fd, { timeout: 90000 }); }

      setShowModal(false); setEditing(null);
      await fetchItems();
    } catch (err) { alert(err.response?.data?.error || 'Failed to save item'); }
    finally { setSaving(false); }
  };

  /* ═══════════ LOADING ═══════════ */
  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  /* ═══════════ RENDER ═══════════ */
  return (
    <div className="space-y-4">
      {/* ── HEADER ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark-900">Menu</h1>
          <p className="text-dark-500 mt-0.5">{stats.totalItems} items &bull; {stats.totalVariants} variants</p>
        </div>
        <button onClick={() => openModal()} className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-colors">
          <Plus className="w-4 h-4" /> Add Item
        </button>
      </div>

      {/* ── SEARCH ── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
        <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search items or variants..."
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-dark-200 rounded-xl text-sm focus:border-primary-500 shadow-sm" />
      </div>

      {/* ── STATS ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total Items', value: stats.totalItems, color: 'text-dark-900' },
          { label: 'Variants', value: stats.totalVariants, color: 'text-blue-600' },
          { label: 'Categories', value: stats.uniqueCategories, color: 'text-purple-600' },
          { label: 'In Stock', value: stats.availableCount, color: 'text-green-600' },
          { label: 'Out', value: stats.unavailableCount, color: 'text-red-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl p-3 shadow-card text-center">
            <p className="text-dark-400 text-xs">{s.label}</p>
            <p className={`text-xl font-bold mt-0.5 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* ── FILTER CHIPS ── */}
      <div className="flex flex-wrap gap-2">
        {['all','available','unavailable'].map(f => (
          <button key={f} onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize ${statusFilter === f ? 'bg-primary-500 text-white' : 'bg-white text-dark-600 border border-dark-200 hover:border-dark-300'}`}>
            {f === 'all' ? 'All' : f === 'available' ? 'In Stock' : 'Out of Stock'}
          </button>
        ))}
        <div className="w-px bg-dark-200 mx-1" />
        {['all','veg','nonveg','egg'].map(f => (
          <button key={f} onClick={() => setFoodTypeFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${foodTypeFilter === f ? 'bg-primary-500 text-white' : 'bg-white text-dark-600 border border-dark-200 hover:border-dark-300'}`}>
            {f === 'all' ? 'All Types' : f === 'veg' ? '🟢 Veg' : f === 'nonveg' ? '🔴 Non-Veg' : '🟡 Egg'}
          </button>
        ))}
      </div>

      {/* ── CATEGORY FILTER (horizontal scroll like mobile) ── */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        <button onClick={() => setSelectedCategory('all')}
          className={`flex-shrink-0 flex flex-col items-center gap-1 px-3 py-2 rounded-xl text-xs font-medium transition-all ${selectedCategory === 'all' ? 'bg-primary-500 text-white' : 'bg-white text-dark-600 border border-dark-200'}`}>
          <Package className="w-5 h-5" /> All
        </button>
        {categoryList.map(cat => {
          const isPaused = cat.isPaused || cat.isSoldOut;
          const rem = soldOutRemaining(cat);
          return (
            <div key={cat._id} className="flex-shrink-0 relative group">
              <button onClick={() => handleCategoryDoubleTap(cat)}
                className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl text-xs font-medium transition-all min-w-[70px] ${
                  selectedCategory === cat.name ? 'bg-primary-500 text-white' :
                  isPaused ? 'bg-red-50 text-red-600 border border-red-200' :
                  'bg-white text-dark-600 border border-dark-200'
                }`}>
                {cat.image ? <img src={cat.image} alt="" className="w-7 h-7 rounded-full object-cover" /> : <FolderPlus className="w-5 h-5" />}
                <span className="truncate max-w-[60px]">{cat.name}</span>
                {isPaused && <span className="text-[9px] text-red-500">Paused</span>}
                {rem && <span className="text-[9px] text-orange-500">{rem}</span>}
              </button>
              {/* Hover quick actions (like mobile long-press) */}
              <div className="absolute -top-1 -right-1 hidden group-hover:flex gap-0.5 z-10">
                <button onClick={(e) => { e.stopPropagation(); showSoldOutOptions('category', cat); }} className="w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center" title="Sold Out">
                  <Ban className="w-3 h-3" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); setCategoryScheduleModal(cat); setCategorySchedule(cat.schedule || { enabled: false, type: 'daily', startTime: '09:00', endTime: '22:00', days: [] }); }}
                  className="w-5 h-5 bg-blue-500 text-white rounded-full flex items-center justify-center" title="Schedule">
                  <CalendarClock className="w-3 h-3" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); openCategoryModal(cat); }} className="w-5 h-5 bg-dark-500 text-white rounded-full flex items-center justify-center" title="Edit">
                  <Edit className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── PRODUCT TITLE FILTER ── */}
      {titleCards.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <button onClick={() => setSelectedTitle('all')}
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${selectedTitle === 'all' ? 'bg-primary-500 text-white' : 'bg-white text-dark-600 border border-dark-200'}`}>
            All Items
          </button>
          {titleCards.map(tc => (
            <button key={tc._id} onClick={() => setSelectedTitle(selectedTitle === tc._id ? 'all' : tc._id)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${selectedTitle === tc._id ? 'bg-primary-500 text-white' : 'bg-white text-dark-600 border border-dark-200'}`}>
              {tc.image && <img src={tc.image} alt="" className="w-5 h-5 rounded object-cover" />}
              <span className="truncate max-w-[80px]">{tc.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── VARIANT LIST (SectionList style like mobile) ── */}
      {sectionData.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center">
          <Image className="w-16 h-16 text-dark-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-dark-900 mb-2">No Items Found</h3>
          <p className="text-dark-500">Try adjusting your filters or add a new item.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sectionData.map(section => (
            <div key={section.parentId} className="bg-white rounded-2xl overflow-hidden shadow-card">
              {/* Section header (parent item) */}
              <div className="flex items-center gap-3 px-4 py-3 bg-dark-50 border-b border-dark-100 group/section">
                <div className="w-10 h-10 rounded-xl bg-dark-100 overflow-hidden flex-shrink-0">
                  {section.parentImage ? <img src={section.parentImage} alt="" className="w-full h-full object-cover" /> :
                    <div className="w-full h-full flex items-center justify-center"><Image className="w-5 h-5 text-dark-300" /></div>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-dark-800 truncate">{section.parentName}</p>
                  <p className="text-[11px] text-dark-400">{section.rows.length} variant{section.rows.length > 1 ? 's' : ''}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openModal(items.find(i => i._id === section.parentId))}
                    className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors" title="Edit Item">
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => deleteItem(items.find(i => i._id === section.parentId))}
                    className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Delete Item">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Variant grid — 4 columns */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
              {section.rows.map((row, ri) => {
                const isOff = row._catUnavail || row.available === false || row._parentAvailable === false;
                const toggleKey = row._isVariant ? `${row._parentId}_v${row._variantIndex}` : row._parentId;
                return (
                  <div key={ri} className={`relative rounded-xl border transition-all ${isOff ? 'border-red-200 bg-red-50/40' : 'border-dark-100 bg-white hover:shadow-md'}`}>
                    {/* Image */}
                    <div className="w-full aspect-square rounded-t-xl bg-dark-100 overflow-hidden relative">
                      {(row.image || row._parentImage) ?
                        <img src={row.image || row._parentImage} alt="" className="w-full h-full object-cover" /> :
                        <div className="w-full h-full flex items-center justify-center"><Image className="w-8 h-8 text-dark-300" /></div>}
                      {row.foodType && row.foodType !== 'none' && (
                        <span className={`absolute top-1.5 left-1.5 w-3 h-3 rounded-full border-2 border-white ${foodDot(row.foodType)}`} />
                      )}

                    </div>

                    {/* Info */}
                    <div className="p-2.5">
                      <p className="font-semibold text-sm text-dark-800 truncate">{row.label || row.name}</p>
                      {row._isVariant && <p className="text-[10px] text-dark-400 truncate">{row._parentName}</p>}
                      {/* Quantities / Price */}
                      {row.quantities && row.quantities.length > 0 ? (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {row.quantities.map((q, qi) => (
                            <span key={qi} className="px-1.5 py-0.5 bg-dark-100 rounded text-[10px] text-dark-600 font-medium">
                              {q.quantity}{q.unit ? ` ${q.unit}` : ''} — ₹{q.price}
                            </span>
                          ))}
                        </div>
                      ) : row.price ? (
                        <p className="text-xs text-dark-500 font-medium mt-1">₹{row.price}</p>
                      ) : null}
                    </div>

                    {/* Delete variant */}
                    {row._isVariant && (
                      <button onClick={() => deleteVariant(row._parentId, row._variantIndex)}
                        className="absolute bottom-2 right-2 p-1 text-dark-300 hover:text-red-500 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══════════ ADD/EDIT ITEM MODAL ═══════════ */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="border-b border-dark-100 px-6 py-4 flex items-center justify-between flex-shrink-0">
              <h2 className="text-xl font-bold text-dark-900">{editing ? 'Edit Item' : 'New Item'}</h2>
              <button onClick={() => { setShowModal(false); setEditing(null); }} className="p-2 hover:bg-dark-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
              {/* Image */}
              <div>
                <label className="block text-sm font-semibold text-dark-700 mb-1">Item Image</label>
                <div className="flex items-center gap-4">
                  <div className="w-24 h-24 rounded-xl bg-dark-100 overflow-hidden flex-shrink-0">
                    {(imagePreview || imageFile) ?
                      <img src={imagePreview} alt="" className="w-full h-full object-cover" /> :
                      <div className="w-full h-full flex items-center justify-center"><Upload className="w-6 h-6 text-dark-300" /></div>}
                  </div>
                  <div className="flex gap-2">
                    <label className="cursor-pointer px-3 py-2 bg-primary-50 text-primary-600 rounded-lg text-sm font-medium hover:bg-primary-100 transition-colors">
                      Upload <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files[0]; if (f) { setImageFile(f); setImagePreview(URL.createObjectURL(f)); }}} className="hidden" />
                    </label>
                    {imagePreview && <button type="button" onClick={() => { setImageFile(null); setImagePreview(''); }} className="px-3 py-2 text-red-500 text-sm">Remove</button>}
                  </div>
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block text-sm font-semibold text-dark-700 mb-1">Title <span className="text-red-500">*</span></label>
                <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required
                  className="w-full px-4 py-3 bg-dark-50 border border-dark-200 rounded-xl focus:border-primary-500 focus:bg-white transition-all" placeholder="Item name" />
              </div>

              {/* Variants */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-dark-700">Variants ({form.variants.length})</label>
                  <button type="button" onClick={addVariant} className="flex items-center gap-1 px-3 py-1.5 bg-primary-50 text-primary-600 rounded-lg text-xs font-medium hover:bg-primary-100">
                    <Plus className="w-3.5 h-3.5" /> Add Variant
                  </button>
                </div>
                <div className="space-y-3">
                  {form.variants.map((v, vi) => (
                    <div key={v._uid} className="border border-dark-200 rounded-xl overflow-hidden">
                      {/* Variant header (collapsible) */}
                      <button type="button" onClick={() => toggleVariantCollapse(vi)}
                        className="w-full flex items-center gap-3 px-4 py-3 bg-dark-50 hover:bg-dark-100 transition-colors text-left">
                        <span className={`w-3 h-3 rounded-full flex-shrink-0 ${foodDot(v.foodType)}`} />
                        <span className="flex-1 font-medium text-sm text-dark-800 truncate">{v.label || `Variant ${vi + 1}`}</span>
                        {v.price && <span className="text-xs text-dark-500">₹{v.price}</span>}
                        {v._collapsed ? <ChevronDown className="w-4 h-4 text-dark-400" /> : <ChevronUp className="w-4 h-4 text-dark-400" />}
                      </button>

                      {/* Variant body */}
                      {!v._collapsed && (
                        <div className="p-4 space-y-4 border-t border-dark-100">
                          {/* Variant image */}
                          <div className="flex items-center gap-3">
                            <div className="w-16 h-16 rounded-lg bg-dark-100 overflow-hidden flex-shrink-0">
                              {(variantImagePreviews[v._uid] || v.image) ?
                                <img src={variantImagePreviews[v._uid] || v.image} alt="" className="w-full h-full object-cover" /> :
                                <div className="w-full h-full flex items-center justify-center"><Upload className="w-4 h-4 text-dark-300" /></div>}
                            </div>
                            <label className="cursor-pointer px-3 py-1.5 bg-dark-100 text-dark-600 rounded-lg text-xs font-medium hover:bg-dark-200">
                              Upload <input type="file" accept="image/*" onChange={(e) => handleVariantImageChange(vi, e)} className="hidden" />
                            </label>
                            {(variantImagePreviews[v._uid] || v.image) &&
                              <button type="button" onClick={() => removeVariantImage(vi)} className="text-xs text-red-500">Remove</button>}
                          </div>

                          {/* Item Name */}
                          <div>
                            <label className="block text-xs font-medium text-dark-500 mb-1">Item Name</label>
                            <input type="text" value={v.label} onChange={e => updateVariant(vi, 'label', e.target.value)}
                              className="w-full px-3 py-2 bg-dark-50 border border-dark-200 rounded-lg text-sm" placeholder="Variant name" />
                          </div>

                          {/* Description + AI */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-xs font-medium text-dark-500">Description</label>
                              <button type="button" onClick={() => generateDescription(vi)} disabled={variantAiLoading[`desc_${vi}`]}
                                className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-primary-600 bg-primary-50 rounded hover:bg-primary-100 disabled:opacity-50">
                                <Sparkles className="w-3 h-3" /> {variantAiLoading[`desc_${vi}`] ? 'Generating...' : 'AI Generate'}
                              </button>
                            </div>
                            <textarea value={v.description || ''} onChange={e => updateVariant(vi, 'description', e.target.value)} rows={2}
                              className="w-full px-3 py-2 bg-dark-50 border border-dark-200 rounded-lg text-sm resize-none" />
                          </div>

                          {/* Food Type */}
                          <div>
                            <label className="block text-xs font-medium text-dark-500 mb-1">Food Type</label>
                            <div className="flex gap-2">
                              {['veg','nonveg','egg'].map(ft => (
                                <button key={ft} type="button" onClick={() => updateVariant(vi, 'foodType', ft)}
                                  className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all ${v.foodType === ft ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-dark-200 text-dark-600'}`}>
                                  {ft === 'veg' ? '🟢 Veg' : ft === 'nonveg' ? '🔴 Non-Veg' : '🟡 Egg'}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Tags + AI */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-xs font-medium text-dark-500">Tags</label>
                              <button type="button" onClick={() => generateTags(vi)} disabled={variantAiLoading[`tags_${vi}`]}
                                className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-primary-600 bg-primary-50 rounded hover:bg-primary-100 disabled:opacity-50">
                                <Sparkles className="w-3 h-3" /> {variantAiLoading[`tags_${vi}`] ? 'Generating...' : 'AI Generate'}
                              </button>
                            </div>
                            <input type="text" value={v.tags || ''} onChange={e => updateVariant(vi, 'tags', e.target.value)}
                              className="w-full px-3 py-2 bg-dark-50 border border-dark-200 rounded-lg text-sm" placeholder="comma separated" />
                          </div>

                          {/* Price / Quantity Options */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-xs font-medium text-dark-500">Pricing</label>
                              <button type="button" onClick={() => addQuantityOption(vi)} className="text-[10px] font-medium text-primary-600 bg-primary-50 px-2 py-0.5 rounded hover:bg-primary-100">
                                + Add Size
                              </button>
                            </div>
                            {(!v.quantities || v.quantities.length === 0) ? (
                              <div className="flex gap-2 items-center">
                                <input type="text" value={v.quantity || ''} onChange={e => updateVariant(vi, 'quantity', e.target.value)}
                                  className="w-20 px-2 py-1.5 bg-dark-50 border border-dark-200 rounded-lg text-xs" placeholder="Qty" />
                                <select value={v.unit || 'piece'} onChange={e => updateVariant(vi, 'unit', e.target.value)}
                                  className="px-2 py-1.5 bg-dark-50 border border-dark-200 rounded-lg text-xs">
                                  {['piece','plate','bowl','glass','bottle','kg','g','ml','l','half','full','small','medium','large','regular'].map(u => <option key={u} value={u}>{u}</option>)}
                                </select>
                                <input type="number" value={v.price || ''} onChange={e => updateVariant(vi, 'price', e.target.value)}
                                  className="flex-1 px-2 py-1.5 bg-dark-50 border border-dark-200 rounded-lg text-xs" placeholder="₹ Price" />
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {v.quantities.map((q, qi) => (
                                  <div key={qi} className="flex gap-2 items-center">
                                    <input type="text" value={q.quantity} onChange={e => updateQuantityOption(vi, qi, 'quantity', e.target.value)}
                                      className="w-20 px-2 py-1.5 bg-dark-50 border border-dark-200 rounded-lg text-xs" placeholder="Qty" />
                                    <select value={q.unit || 'piece'} onChange={e => updateQuantityOption(vi, qi, 'unit', e.target.value)}
                                      className="px-2 py-1.5 bg-dark-50 border border-dark-200 rounded-lg text-xs">
                                      {['piece','plate','bowl','glass','bottle','kg','g','ml','l','half','full','small','medium','large','regular'].map(u => <option key={u} value={u}>{u}</option>)}
                                    </select>
                                    <input type="number" value={q.price} onChange={e => updateQuantityOption(vi, qi, 'price', e.target.value)}
                                      className="w-24 px-2 py-1.5 bg-dark-50 border border-dark-200 rounded-lg text-xs" placeholder="₹ Price" />
                                    <button type="button" onClick={() => removeQuantityOption(vi, qi)} className="text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Available toggle */}
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-dark-500">Available</span>
                            <button type="button" onClick={() => updateVariant(vi, 'available', !v.available)}
                              className={`w-10 h-5 rounded-full transition-colors relative ${v.available ? 'bg-green-500' : 'bg-dark-300'}`}>
                              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${v.available ? 'left-5' : 'left-0.5'}`} />
                            </button>
                          </div>

                          {/* Remove variant */}
                          <button type="button" onClick={() => removeVariant(vi)}
                            className="w-full py-2 text-xs font-medium text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-colors">
                            Remove Variant
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Available */}
              <div className="flex items-center justify-between p-3 bg-dark-50 rounded-xl">
                <span className="text-sm font-medium text-dark-700">Available</span>
                <button type="button" onClick={() => setForm({ ...form, available: !form.available })}
                  className={`w-12 h-6 rounded-full transition-colors relative ${form.available ? 'bg-green-500' : 'bg-dark-300'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.available ? 'left-6' : 'left-0.5'}`} />
                </button>
              </div>

              {/* Submit */}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowModal(false); setEditing(null); }}
                  className="flex-1 px-4 py-3 border border-dark-200 rounded-xl font-medium text-dark-700 hover:bg-dark-50">Cancel</button>
                <button type="submit" disabled={saving}
                  className="flex-1 px-4 py-3 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center gap-2">
                  {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving...</> : editing ? 'Update Item' : 'Add Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════ CATEGORY MODAL ═══════════ */}
      {showCategoryModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
            <div className="border-b border-dark-100 px-6 py-4 flex items-center justify-between flex-shrink-0">
              <h2 className="text-lg font-bold text-dark-900">{editingCategory ? 'Edit Category' : 'New Category'}</h2>
              <button onClick={() => { setShowCategoryModal(false); setEditingCategory(null); }} className="p-2 hover:bg-dark-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {/* Image */}
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl bg-dark-100 overflow-hidden flex-shrink-0">
                  {(categoryImagePreview || categoryImageFile) ?
                    <img src={categoryImagePreview} alt="" className="w-full h-full object-cover" /> :
                    <div className="w-full h-full flex items-center justify-center"><FolderPlus className="w-5 h-5 text-dark-300" /></div>}
                </div>
                <label className="cursor-pointer px-3 py-2 bg-primary-50 text-primary-600 rounded-lg text-sm font-medium">
                  Upload <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files[0]; if (f) { setCategoryImageFile(f); setCategoryImagePreview(URL.createObjectURL(f)); }}} className="hidden" />
                </label>
                {categoryImagePreview && <button type="button" onClick={() => { setCategoryImageFile(null); setCategoryImagePreview(''); }} className="text-xs text-red-500">Remove</button>}
              </div>
              <div>
                <label className="block text-sm font-semibold text-dark-700 mb-1">Name <span className="text-red-500">*</span></label>
                <input type="text" value={categoryForm.name} onChange={e => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  className="w-full px-4 py-3 bg-dark-50 border border-dark-200 rounded-xl text-sm" placeholder="Category name" />
              </div>
              <button onClick={saveCategory} disabled={savingCategory || !categoryForm.name.trim()}
                className="w-full py-3 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 disabled:opacity-50">
                {savingCategory ? 'Saving...' : editingCategory ? 'Update' : 'Create'}
              </button>

              {/* Category list */}
              <div className="border-t border-dark-100 pt-4 mt-4">
                <p className="text-sm font-semibold text-dark-700 mb-3">All Categories ({categoryList.length})</p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {categoryList.map(cat => (
                    <div key={cat._id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-dark-50 group">
                      <div className="w-8 h-8 rounded-lg bg-dark-100 overflow-hidden flex-shrink-0">
                        {cat.image ? <img src={cat.image} alt="" className="w-full h-full object-cover" /> : <FolderPlus className="w-4 h-4 text-dark-300 m-2" />}
                      </div>
                      <span className="flex-1 text-sm text-dark-700 truncate">{cat.name}</span>
                      {cat.isPaused && <span className="px-1.5 py-0.5 text-[9px] bg-red-100 text-red-600 rounded">Paused</span>}
                      <div className="hidden group-hover:flex gap-1">
                        <button onClick={() => handleBulkPause(cat.name)} disabled={bulkPausingCategory === cat.name}
                          className="p-1 text-blue-500 hover:bg-blue-50 rounded" title={cat.isPaused ? 'Resume' : 'Pause'}>
                          {cat.isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => openCategoryModal(cat)} className="p-1 text-dark-500 hover:bg-dark-100 rounded"><Edit className="w-3.5 h-3.5" /></button>
                        <button onClick={() => deleteCategory(cat)} className="p-1 text-red-500 hover:bg-red-50 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ SOLD OUT OPTIONS MODAL (matching mobile's Alert) ═══════════ */}
      {soldOutModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-3">
            <h3 className="text-lg font-bold text-dark-900">
              {soldOutModal.type === 'item' ? soldOutModal.target?.name : soldOutModal.target?.name}
            </h3>
            <p className="text-sm text-dark-500">Choose an action:</p>
            <button onClick={() => {
              if (soldOutModal.type === 'item') markVariantsSoldOut(soldOutModal.target._id, false);
              else toggleCategorySoldOut(soldOutModal.target);
              setSoldOutModal(null);
            }} className="w-full py-2.5 bg-green-50 text-green-700 rounded-xl font-medium hover:bg-green-100 transition-colors">
              ✅ Mark Available
            </button>
            <button onClick={() => {
              if (soldOutModal.type === 'item') markVariantsSoldOut(soldOutModal.target._id, true);
              else toggleCategorySoldOut(soldOutModal.target);
              setSoldOutModal(null);
            }} className="w-full py-2.5 bg-red-50 text-red-700 rounded-xl font-medium hover:bg-red-100 transition-colors">
              🚫 Sold Out Now
            </button>
            <button onClick={() => {
              setScheduleModal(soldOutModal);
              setScheduleSoldOutTime('');
              setSoldOutModal(null);
            }} className="w-full py-2.5 bg-orange-50 text-orange-700 rounded-xl font-medium hover:bg-orange-100 transition-colors">
              ⏰ Schedule Sold Out
            </button>
            <button onClick={() => setSoldOutModal(null)} className="w-full py-2 text-dark-500 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* ═══════════ SCHEDULE SOLD OUT MODAL ═══════════ */}
      {scheduleModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-lg font-bold text-dark-900">Schedule Sold Out</h3>
            <p className="text-sm text-dark-500">Mark as sold out until:</p>
            <input type="time" value={scheduleSoldOutTime} onChange={e => setScheduleSoldOutTime(e.target.value)}
              className="w-full px-4 py-3 bg-dark-50 border border-dark-200 rounded-xl text-sm" />
            <div className="flex gap-3">
              <button onClick={() => setScheduleModal(null)} className="flex-1 py-2.5 border border-dark-200 rounded-xl font-medium text-dark-700">Cancel</button>
              <button onClick={handleScheduleSoldOut} disabled={!scheduleSoldOutTime}
                className="flex-1 py-2.5 bg-primary-600 text-white rounded-xl font-medium disabled:opacity-50">Schedule</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ CATEGORY SCHEDULE MODAL ═══════════ */}
      {categoryScheduleModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-dark-900">Schedule: {categoryScheduleModal.name}</h3>
            <div className="flex items-center justify-between">
              <span className="text-sm text-dark-700">Enabled</span>
              <button type="button" onClick={() => setCategorySchedule(p => ({ ...p, enabled: !p.enabled }))}
                className={`w-10 h-5 rounded-full transition-colors relative ${categorySchedule.enabled ? 'bg-green-500' : 'bg-dark-300'}`}>
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${categorySchedule.enabled ? 'left-5' : 'left-0.5'}`} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-dark-500 mb-1">Start Time</label>
                <input type="time" value={categorySchedule.startTime} onChange={e => setCategorySchedule(p => ({ ...p, startTime: e.target.value }))}
                  className="w-full px-3 py-2 bg-dark-50 border border-dark-200 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-dark-500 mb-1">End Time</label>
                <input type="time" value={categorySchedule.endTime} onChange={e => setCategorySchedule(p => ({ ...p, endTime: e.target.value }))}
                  className="w-full px-3 py-2 bg-dark-50 border border-dark-200 rounded-lg text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-dark-500 mb-1">Type</label>
              <div className="flex gap-2">
                {['daily','specific_days'].map(t => (
                  <button key={t} type="button" onClick={() => setCategorySchedule(p => ({ ...p, type: t }))}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium border ${categorySchedule.type === t ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-dark-200 text-dark-600'}`}>
                    {t === 'daily' ? 'Daily' : 'Specific Days'}
                  </button>
                ))}
              </div>
            </div>
            {categorySchedule.type === 'specific_days' && (
              <div className="flex flex-wrap gap-1.5">
                {['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].map(d => (
                  <button key={d} type="button" onClick={() => {
                    const days = categorySchedule.days?.includes(d) ? categorySchedule.days.filter(x => x !== d) : [...(categorySchedule.days || []), d];
                    setCategorySchedule(p => ({ ...p, days }));
                  }} className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize ${categorySchedule.days?.includes(d) ? 'bg-primary-500 text-white' : 'bg-dark-100 text-dark-600'}`}>
                    {d.slice(0, 3)}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => setCategoryScheduleModal(null)} className="flex-1 py-2.5 border border-dark-200 rounded-xl font-medium text-dark-700">Cancel</button>
              <button onClick={handleSaveCategorySchedule} className="flex-1 py-2.5 bg-primary-600 text-white rounded-xl font-medium">Save Schedule</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ CONFIRM DIALOG ═══════════ */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-lg font-bold text-dark-900">{confirmDialog.title}</h3>
            <p className="text-sm text-dark-500">{confirmDialog.message}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDialog(null)} className="flex-1 py-2.5 border border-dark-200 rounded-xl font-medium text-dark-700">Cancel</button>
              <button onClick={confirmDialog.onConfirm} disabled={deleting}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 disabled:opacity-50">
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
