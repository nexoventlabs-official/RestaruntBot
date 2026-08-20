import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, Edit, Trash2, Sparkles, X, Image, FolderPlus, Search, Check, Pause, Play, Upload, Ban, CalendarClock, Package, Film } from 'lucide-react';
import api from '../api';

/* ─── helpers ─── */
const foodDot = (ft) =>
  ft === 'veg' ? 'bg-green-500' : ft === 'egg' ? 'bg-yellow-500' : ft === 'nonveg' || ft === 'non-veg' ? 'bg-red-500' : 'bg-gray-300';

// Units allowed by the MenuItem schema (variant + quantity enums).
const UNITS = ['piece', 'plate', 'bowl', 'cup', 'kg', 'gram', 'liter', 'ml', 'slice', 'inch', 'full', 'half', 'small'];

const soldOutRemaining = (cat) => {
  if (!cat?.soldOutSchedule?.enabled || !cat?.soldOutSchedule?.endTime) return null;
  const [h, m] = cat.soldOutSchedule.endTime.split(':').map(Number);
  const end = new Date(); end.setHours(h, m, 0, 0);
  const diff = end - new Date();
  if (diff <= 0) return null;
  const mins = Math.floor(diff / 60000);
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
};

/* ─── FMCG-style image category picker (multi-select) ─── */
function CategoryPicker({ categories, selected, onToggle }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
      {categories.length === 0 && (
        <p className="col-span-full text-xs text-dark-400">No categories yet. Create one from “Manage Categories”.</p>
      )}
      {categories.map((c) => {
        const active = selected.includes(c.name);
        return (
          <button
            key={c._id}
            type="button"
            onClick={() => onToggle(c.name)}
            className={`relative flex flex-col items-center gap-1 p-2 rounded-xl border transition-all ${
              active ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-300' : 'border-dark-200 bg-white hover:border-dark-300'
            }`}
          >
            <div className="w-12 h-12 rounded-lg bg-dark-100 overflow-hidden flex-shrink-0">
              {c.image
                ? <img src={c.image} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center"><FolderPlus className="w-5 h-5 text-dark-300" /></div>}
            </div>
            <span className="text-[11px] font-medium text-dark-700 truncate max-w-[70px]">{c.name}</span>
            {active && (
              <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary-500 text-white flex items-center justify-center">
                <Check className="w-2.5 h-2.5" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default function Menu() {
  const navigate = useNavigate();
  const location = useLocation();
  const basePath = location.pathname.startsWith('/super-admin') ? '/super-admin' : '/admin';

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

  // Item form — FMCG style: product-level fields + size-variant rows
  const [form, setForm] = useState({ name: '', category: [], foodType: 'veg', description: '', tags: '', available: true, variants: [] });
  const [saving, setSaving] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState('');
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreview, setVideoPreview] = useState('');
  const [variantImageFiles, setVariantImageFiles] = useState({});
  const [variantImagePreviews, setVariantImagePreviews] = useState({});
  const [variantGalleryFiles, setVariantGalleryFiles] = useState({});   // uid -> File[]
  const [variantGalleryPreviews, setVariantGalleryPreviews] = useState({}); // uid -> blobUrl[]
  const [aiLoading, setAiLoading] = useState(false);

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
  const [toast, setToast] = useState(null); // { message, type: 'info'|'success'|'error' }
  const toastTimer = useRef(null);
  const initialLoadDone = useRef(false);
  const lastTapRef = useRef({});

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), type === 'error' ? 5000 : 3000);
  }, []);

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

  // Flatten items into variant-level rows
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

  // Group by parent item
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
        setItems(prev => prev.map(i => i._id === parentId ? { ...i, variants: i.variants.filter((_, idx) => idx !== variantIndex) } : i));
        setConfirmDialog(null);
        showToast('⏳ Deleting variant...', 'info');
        try {
          await api.delete(`/menu/${parentId}/variant/${variantIndex}`);
          showToast('✅ Variant deleted', 'success');
          await fetchItems();
        } catch {
          showToast('❌ Failed to delete variant', 'error');
          await fetchItems();
        }
      }
    });
  };

  const deleteItem = (item) => {
    setConfirmDialog({
      title: 'Delete Item?', message: `Delete "${item.name}" and all its variants?`,
      onConfirm: async () => {
        setItems(prev => prev.filter(i => i._id !== item._id));
        setConfirmDialog(null);
        showToast('⏳ Deleting item...', 'info');
        try {
          await api.delete(`/menu/${item._id}`);
          showToast('✅ Item deleted', 'success');
          await fetchItems();
        } catch {
          showToast('❌ Failed to delete item', 'error');
          await fetchItems();
        }
      }
    });
  };

  const showSoldOutOptions = (type, target) => setSoldOutModal({ type, target });

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
    try { await api.patch(`/categories/${cat._id}/toggle-soldout`); await fetchCategories(); }
    catch { alert('Failed to toggle sold-out'); }
  };

  const toggleCategoryPause = async (cat) => {
    try { await api.patch(`/categories/${cat._id}/toggle-pause`); await fetchCategories(); }
    catch { alert('Failed to toggle pause'); }
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
      setEditingCategory(null);
      setCategoryForm({ name: '', description: '' }); setCategoryImageFile(null); setCategoryImagePreview('');
    } catch (err) { alert(err.response?.data?.error || 'Failed to save category'); }
    finally { setSavingCategory(false); }
  };

  const deleteCategory = (cat) => {
    setConfirmDialog({
      title: 'Delete Category?', message: `Delete "${cat.name}"? Items only in this category will also be removed.`,
      onConfirm: async () => {
        try { await api.delete(`/categories/${cat._id}`); await Promise.all([fetchCategories(), fetchItems()]); }
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

  /* ═══════════ PRODUCT FORM HANDLERS (FMCG style) ═══════════ */
  const openModal = (item = null) => {
    if (item) {
      setEditing(item);
      setForm({
        name: item.name || '',
        category: Array.isArray(item.category) ? item.category : [item.category].filter(Boolean),
        foodType: item.foodType && item.foodType !== 'none' ? item.foodType : 'veg',
        description: item.description || '',
        tags: (item.tags || []).join(', '),
        available: item.available !== false,
        variants: (item.variants || []).map((v, i) => ({
          _uid: `v_${i}_${Date.now()}`,
          label: v.label || '',
          quantity: v.quantity ?? '',
          unit: v.unit || 'piece',
          price: v.price ?? '',
          offerPrice: v.offerPrice ?? '',
          available: v.available !== false,
          image: v.image || null,
          images: Array.isArray(v.images) ? [...v.images] : [], // kept additional images
        })),
      });
      setImagePreview(item.image || '');
      setCoverPreview(item.coverImage || '');
      setVideoPreview(item.video || '');
    } else {
      setEditing(null);
      setForm({ name: '', category: [], foodType: 'veg', description: '', tags: '', available: true, variants: [] });
      setImagePreview('');
      setCoverPreview('');
      setVideoPreview('');
    }
    setImageFile(null);
    setCoverFile(null);
    setVideoFile(null);
    setVariantImageFiles({});
    setVariantImagePreviews({});
    setVariantGalleryFiles({});
    setVariantGalleryPreviews({});
    setShowModal(true);
  };

  const toggleCategoryInForm = (name) => {
    setForm(f => ({
      ...f,
      category: f.category.includes(name) ? f.category.filter(c => c !== name) : [...f.category, name],
    }));
  };

  const addVariant = () => {
    const uid = `v_${form.variants.length}_${Date.now()}`;
    setForm(f => ({
      ...f,
      variants: [...f.variants, { _uid: uid, label: '', quantity: '', unit: 'piece', price: '', offerPrice: '', available: true, image: null }],
    }));
  };

  const removeVariant = (idx) => {
    setForm(f => ({ ...f, variants: f.variants.filter((_, i) => i !== idx) }));
  };

  const updateVariant = (idx, field, value) => {
    setForm(f => {
      const vs = [...f.variants];
      vs[idx] = { ...vs[idx], [field]: value };
      return { ...f, variants: vs };
    });
  };

  const handleVariantImageChange = (idx, e) => {
    const file = e.target.files[0]; if (!file) return;
    const uid = form.variants[idx]._uid;
    setVariantImageFiles(p => ({ ...p, [uid]: file }));
    setVariantImagePreviews(p => ({ ...p, [uid]: URL.createObjectURL(file) }));
  };

  const removeVariantImage = (idx) => {
    const uid = form.variants[idx]._uid;
    updateVariant(idx, 'image', null);
    setVariantImageFiles(p => { const n = { ...p }; delete n[uid]; return n; });
    setVariantImagePreviews(p => { const n = { ...p }; delete n[uid]; return n; });
  };

  // Additional (gallery) images per variant
  const addGalleryImages = (idx, files) => {
    const uid = form.variants[idx]._uid;
    const arr = Array.from(files);
    setVariantGalleryFiles(p => ({ ...p, [uid]: [...(p[uid] || []), ...arr] }));
    setVariantGalleryPreviews(p => ({ ...p, [uid]: [...(p[uid] || []), ...arr.map(f => URL.createObjectURL(f))] }));
  };
  const removeExistingGalleryImage = (idx, url) => {
    setForm(f => {
      const vs = [...f.variants];
      vs[idx] = { ...vs[idx], images: (vs[idx].images || []).filter(u => u !== url) };
      return { ...f, variants: vs };
    });
  };
  const removeNewGalleryImage = (idx, gi) => {
    const uid = form.variants[idx]._uid;
    setVariantGalleryFiles(p => ({ ...p, [uid]: (p[uid] || []).filter((_, i) => i !== gi) }));
    setVariantGalleryPreviews(p => ({ ...p, [uid]: (p[uid] || []).filter((_, i) => i !== gi) }));
  };

  const generateDescription = async () => {
    setAiLoading(true);
    try {
      const r = await api.post('/ai/generate-description', { name: form.name, category: form.category[0] || '' });
      setForm(f => ({ ...f, description: r.data.description || f.description }));
    } catch { alert('AI generation failed'); }
    finally { setAiLoading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return alert('Please enter a product name');
    if (form.category.length === 0) return alert('Please select at least one category');
    if (form.variants.length === 0) return alert('Add at least one size / variant');
    if (!form.variants.some(v => Number(v.price) > 0)) return alert('Every product needs at least one variant with a price');

    const fd = new FormData();
    fd.append('name', form.name.trim());
    fd.append('category', JSON.stringify(form.category));
    fd.append('foodType', form.foodType || 'veg');
    fd.append('description', form.description || '');
    fd.append('tags', form.tags || '');
    fd.append('available', form.available);

    const prices = form.variants.map(v => parseFloat(v.price) || 0).filter(p => p > 0);
    fd.append('price', prices.length ? Math.min(...prices) : 0);
    // Product thumbnail is derived server-side from the first variant image.

    // Product video
    if (videoFile) fd.append('video', videoFile);
    else if (editing && !videoPreview) fd.append('removeVideo', 'true');

    // Variants — FMCG size rows mapped to the MenuItem variant schema.
    // label is required by the model, so auto-derive from qty+unit when blank.
    const cleanVariants = form.variants.map(v => {
      const derivedLabel = (v.label && v.label.trim())
        || `${v.quantity || ''} ${v.unit || ''}`.trim()
        || form.name.trim();
      return {
        label: derivedLabel,
        quantity: v.quantity ? parseFloat(v.quantity) : 1,
        unit: v.unit || 'piece',
        price: parseFloat(v.price) || 0,
        offerPrice: v.offerPrice ? parseFloat(v.offerPrice) : undefined,
        available: v.available !== false,
        foodType: form.foodType || 'veg',
        image: v.image || null,
        images: Array.isArray(v.images) ? v.images : [], // kept additional images
      };
    });
    fd.append('variants', JSON.stringify(cleanVariants));

    // Variant main images (new uploads) + their indices
    const imgIndices = [];
    form.variants.forEach((v, i) => {
      if (variantImageFiles[v._uid]) { fd.append('variantImages', variantImageFiles[v._uid]); imgIndices.push(i); }
    });
    if (imgIndices.length > 0) fd.append('variantImageIndices', JSON.stringify(imgIndices));

    // Variant additional (gallery) images — each file tagged with its variant index
    const galleryIndices = [];
    form.variants.forEach((v, i) => {
      (variantGalleryFiles[v._uid] || []).forEach(file => {
        fd.append('variantGallery', file);
        galleryIndices.push(i);
      });
    });
    if (galleryIndices.length > 0) fd.append('variantGalleryIndices', JSON.stringify(galleryIndices));

    const isEdit = !!editing;
    const editId = editing?._id;
    setShowModal(false); setEditing(null); setSaving(false);
    showToast(isEdit ? '⏳ Updating product...' : '⏳ Creating product...', 'info');

    try {
      if (isEdit) { await api.put(`/menu/${editId}`, fd, { timeout: 90000 }); }
      else { await api.post('/menu', fd, { timeout: 90000 }); }
      showToast('✅ Product saved successfully', 'success');
      await fetchItems();
    } catch (err) {
      showToast('❌ ' + (err.response?.data?.error || 'Failed to save product'), 'error');
    }
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
          <h1 className="text-2xl font-bold text-dark-900">Products</h1>
          <p className="text-dark-500 mt-0.5">{stats.totalItems} products &bull; {stats.totalVariants} variants</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate(`${basePath}/categories`)} className="flex items-center gap-1.5 px-4 py-2 bg-white border border-dark-200 text-dark-700 rounded-xl text-sm font-medium hover:bg-dark-50 transition-colors">
            <FolderPlus className="w-4 h-4" /> Manage Categories
          </button>
          <button onClick={() => openModal()} className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-colors">
            <Plus className="w-4 h-4" /> Add Product
          </button>
        </div>
      </div>

      {/* ── SEARCH ── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
        <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search products or variants..."
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-dark-200 rounded-xl text-sm focus:border-primary-500 shadow-sm" />
      </div>

      {/* ── STATS ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Products', value: stats.totalItems, color: 'text-dark-900' },
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

      {/* ── CATEGORY FILTER ── */}
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
            All Products
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

      {/* ── PRODUCT LIST ── */}
      {sectionData.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center">
          <Image className="w-16 h-16 text-dark-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-dark-900 mb-2">No Products Found</h3>
          <p className="text-dark-500">Try adjusting your filters or add a new product.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sectionData.map(section => (
            <div key={section.parentId} className="bg-white rounded-2xl overflow-hidden shadow-card">
              {/* Section header (product) */}
              <div className="flex items-center gap-3 px-4 py-3 bg-dark-50 border-b border-dark-100">
                <div className="w-10 h-10 rounded-xl bg-dark-100 overflow-hidden flex-shrink-0">
                  {section.parentImage ? <img src={section.parentImage} alt="" className="w-full h-full object-cover" /> :
                    <div className="w-full h-full flex items-center justify-center"><Image className="w-5 h-5 text-dark-300" /></div>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-dark-800 truncate">{section.parentName}</p>
                  <p className="text-[11px] text-dark-400">{section.rows.length} variant{section.rows.length > 1 ? 's' : ''}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => showSoldOutOptions('item', items.find(i => i._id === section.parentId))}
                    className="p-1.5 text-orange-500 hover:bg-orange-50 rounded-lg transition-colors" title="Availability / Schedule">
                    <CalendarClock className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => openModal(items.find(i => i._id === section.parentId))}
                    className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors" title="Edit Product">
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => deleteItem(items.find(i => i._id === section.parentId))}
                    className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Delete Product">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Variant grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
              {section.rows.map((row, ri) => {
                const isOff = row._catUnavail || row.available === false || row._parentAvailable === false;
                return (
                  <div key={ri} className={`relative rounded-xl border transition-all ${isOff ? 'border-red-200 bg-red-50/40' : 'border-dark-100 bg-white hover:shadow-md'}`}>
                    <div className="w-full aspect-square rounded-t-xl bg-dark-100 overflow-hidden relative">
                      {(row.image || row._parentImage) ?
                        <img src={row.image || row._parentImage} alt="" className="w-full h-full object-cover" /> :
                        <div className="w-full h-full flex items-center justify-center"><Image className="w-8 h-8 text-dark-300" /></div>}
                      {row.foodType && row.foodType !== 'none' && (
                        <span className={`absolute top-1.5 left-1.5 w-3 h-3 rounded-full border-2 border-white ${foodDot(row.foodType)}`} />
                      )}
                      <span className={`absolute top-1.5 right-1.5 text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase ${isOff ? 'bg-red-500 text-white' : 'bg-green-500 text-white'}`}>
                        {isOff ? 'Out' : 'In'}
                      </span>
                    </div>
                    <div className="p-2.5">
                      <p className="font-semibold text-sm text-dark-800 truncate">{row.label || row.name}</p>
                      {row._isVariant && <p className="text-[10px] text-dark-400 truncate">{row._parentName}</p>}
                      {row.quantities && row.quantities.length > 0 ? (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {row.quantities.map((q, qi) => (
                            <span key={qi} className="px-1.5 py-0.5 bg-dark-100 rounded text-[10px] text-dark-600 font-medium">
                              {q.quantity}{q.unit ? ` ${q.unit}` : ''} — ₹{q.price}
                            </span>
                          ))}
                        </div>
                      ) : row.price ? (
                        <p className="text-xs font-medium mt-1">
                          {row.offerPrice ? (
                            <><span className="text-dark-400 line-through mr-1">₹{row.price}</span><span className="text-green-600 font-bold">₹{row.offerPrice}</span></>
                          ) : (<span className="text-dark-500">₹{row.price}</span>)}
                        </p>
                      ) : null}
                    </div>
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

      {/* ═══════════ ADD/EDIT PRODUCT MODAL (FMCG style) ═══════════ */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="border-b border-dark-100 px-6 py-4 flex items-center justify-between flex-shrink-0">
              <h2 className="text-xl font-bold text-dark-900">{editing ? `Edit Product — ${editing.name}` : 'Add Product'}</h2>
              <button onClick={() => { setShowModal(false); setEditing(null); }} className="p-2 hover:bg-dark-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
              <p className="text-xs text-dark-400 bg-dark-50 rounded-lg px-3 py-2">
                The product thumbnail is taken automatically from the first variant's image below. Add a size variant with an image to set it.
              </p>

              {/* Product Video */}
              <div className="border border-dark-200 rounded-xl p-3">
                <label className="block text-xs font-semibold text-dark-700 mb-2">Product Video <span className="text-dark-400 font-normal">(mp4 — plays on hover on the website)</span></label>
                <div className="flex items-center gap-3">
                  <div className="w-16 h-12 rounded-lg bg-dark-100 overflow-hidden flex-shrink-0 flex items-center justify-center">
                    {videoPreview ?
                      <video src={videoPreview} className="w-full h-full object-cover" muted /> :
                      <Film className="w-5 h-5 text-dark-300" />}
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="cursor-pointer px-2.5 py-1.5 bg-primary-50 text-primary-600 rounded-lg text-xs font-medium hover:bg-primary-100 w-fit">
                      {videoPreview ? 'Change' : 'Upload'}
                      <input type="file" accept="video/*" onChange={(e) => { const f = e.target.files[0]; if (f) { setVideoFile(f); setVideoPreview(URL.createObjectURL(f)); }}} className="hidden" />
                    </label>
                    {videoPreview && <button type="button" onClick={() => { setVideoFile(null); setVideoPreview(''); }} className="text-[11px] text-red-500 text-left">Remove</button>}
                  </div>
                </div>
              </div>

              {/* Name */}
              <div>
                <label className="block text-sm font-semibold text-dark-700 mb-1">Product Name <span className="text-red-500">*</span></label>
                <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required
                  className="w-full px-4 py-3 bg-dark-50 border border-dark-200 rounded-xl focus:border-primary-500 focus:bg-white transition-all" placeholder="e.g. Chicken Biryani" />
              </div>

              {/* Category picker (image tiles, multi-select) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-semibold text-dark-700">Category <span className="text-red-500">*</span></label>
                  <button type="button" onClick={() => openCategoryModal()} className="text-xs font-medium text-primary-600 hover:underline">+ New category</button>
                </div>
                <CategoryPicker categories={categoryList} selected={form.category} onToggle={toggleCategoryInForm} />
              </div>

              {/* Food type */}
              <div>
                <label className="block text-sm font-semibold text-dark-700 mb-1">Food Type</label>
                <div className="flex gap-2">
                  {['veg','nonveg','egg'].map(ft => (
                    <button key={ft} type="button" onClick={() => setForm({ ...form, foodType: ft })}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all ${form.foodType === ft ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-dark-200 text-dark-600'}`}>
                      {ft === 'veg' ? '🟢 Veg' : ft === 'nonveg' ? '🔴 Non-Veg' : '🟡 Egg'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description + AI */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-semibold text-dark-700">Description</label>
                  <button type="button" onClick={generateDescription} disabled={aiLoading}
                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-primary-600 bg-primary-50 rounded hover:bg-primary-100 disabled:opacity-50">
                    <Sparkles className="w-3 h-3" /> {aiLoading ? 'Generating...' : 'AI Generate'}
                  </button>
                </div>
                <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2}
                  className="w-full px-3 py-2 bg-dark-50 border border-dark-200 rounded-xl text-sm resize-none" placeholder="Short description" />
              </div>

              {/* Tags */}
              <div>
                <label className="block text-sm font-semibold text-dark-700 mb-1">Tags</label>
                <input type="text" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })}
                  className="w-full px-3 py-2 bg-dark-50 border border-dark-200 rounded-xl text-sm" placeholder="comma separated (e.g. spicy, popular)" />
              </div>

              {/* Size / Quantity variants (FMCG style rows) */}
              <div className="border border-dark-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <label className="text-sm font-semibold text-dark-700">Size / Quantity variants</label>
                    <p className="text-[11px] text-dark-400">Each size has its own price &amp; image (e.g. Half ₹120, Full ₹220).</p>
                  </div>
                  <button type="button" onClick={addVariant} className="flex items-center gap-1 px-3 py-1.5 bg-primary-50 text-primary-600 rounded-lg text-xs font-medium hover:bg-primary-100">
                    <Plus className="w-3.5 h-3.5" /> Add size
                  </button>
                </div>

                {form.variants.length === 0 && (
                  <p className="text-xs text-dark-400">No variants yet. Click “Add size” to create the first one.</p>
                )}

                <div className="space-y-2.5">
                  {form.variants.map((v, vi) => (
                    <div key={v._uid} className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg border border-dark-100 bg-dark-50/50">
                      {/* Variant image */}
                      <div className="w-12 h-12 rounded-lg bg-dark-100 overflow-hidden flex-shrink-0 relative">
                        {(variantImagePreviews[v._uid] || v.image) ?
                          <img src={variantImagePreviews[v._uid] || v.image} alt="" className="w-full h-full object-cover" /> :
                          <div className="w-full h-full flex items-center justify-center"><Upload className="w-4 h-4 text-dark-300" /></div>}
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="cursor-pointer px-2 py-1 bg-dark-100 text-dark-600 rounded text-[10px] font-medium hover:bg-dark-200 text-center">
                          {(variantImagePreviews[v._uid] || v.image) ? 'Change' : 'Image'}
                          <input type="file" accept="image/*" onChange={(e) => handleVariantImageChange(vi, e)} className="hidden" />
                        </label>
                        {(variantImagePreviews[v._uid] || v.image) &&
                          <button type="button" onClick={() => removeVariantImage(vi)} className="text-[10px] text-red-500">Remove</button>}
                      </div>

                      {/* Fields — size label is auto-derived from qty + unit */}
                      <input type="number" value={v.quantity} onChange={e => updateVariant(vi, 'quantity', e.target.value)}
                        className="w-16 px-2 py-1.5 bg-white border border-dark-200 rounded-lg text-xs" placeholder="Qty" />
                      <select value={v.unit} onChange={e => updateVariant(vi, 'unit', e.target.value)}
                        className="px-2 py-1.5 bg-white border border-dark-200 rounded-lg text-xs">
                        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                      <input type="number" value={v.price} onChange={e => updateVariant(vi, 'price', e.target.value)}
                        className="w-20 px-2 py-1.5 bg-white border border-dark-200 rounded-lg text-xs" placeholder="₹ Price" />
                      <input type="number" value={v.offerPrice} onChange={e => updateVariant(vi, 'offerPrice', e.target.value)}
                        className="w-24 px-2 py-1.5 bg-white border border-dark-200 rounded-lg text-xs" placeholder="₹ Offer" />

                      {/* Available toggle */}
                      <button type="button" onClick={() => updateVariant(vi, 'available', !v.available)}
                        className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${v.available ? 'bg-green-500' : 'bg-dark-300'}`} title="Available">
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${v.available ? 'left-4' : 'left-0.5'}`} />
                      </button>

                      <button type="button" onClick={() => removeVariant(vi)} className="ml-auto p-1 text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>

                      {/* Additional images (gallery) */}
                      <div className="basis-full w-full flex items-center gap-2 flex-wrap pt-1">
                        <span className="text-[10px] text-dark-400 uppercase tracking-wide">Extra images</span>
                        {(v.images || []).map(url => (
                          <div key={url} className="relative w-10 h-10">
                            <img src={url} alt="" className="w-10 h-10 rounded object-cover border border-dark-200" />
                            <button type="button" onClick={() => removeExistingGalleryImage(vi, url)} className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] leading-none flex items-center justify-center">×</button>
                          </div>
                        ))}
                        {(variantGalleryPreviews[v._uid] || []).map((url, gi) => (
                          <div key={gi} className="relative w-10 h-10">
                            <img src={url} alt="" className="w-10 h-10 rounded object-cover border border-dark-200" />
                            <button type="button" onClick={() => removeNewGalleryImage(vi, gi)} className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] leading-none flex items-center justify-center">×</button>
                          </div>
                        ))}
                        <label className="cursor-pointer w-10 h-10 rounded border border-dashed border-dark-300 flex items-center justify-center text-dark-400 hover:bg-dark-100" title="Add images">
                          <Plus className="w-4 h-4" />
                          <input type="file" accept="image/*" multiple onChange={(e) => addGalleryImages(vi, e.target.files)} className="hidden" />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Product available */}
              <div className="flex items-center justify-between p-3 bg-dark-50 rounded-xl">
                <span className="text-sm font-medium text-dark-700">Product Available</span>
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
                  {editing ? 'Save Changes' : 'Add Product'}
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
                  {categoryImagePreview ?
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
                {savingCategory ? 'Saving...' : editingCategory ? 'Update Category' : 'Create Category'}
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

      {/* ═══════════ SOLD OUT OPTIONS MODAL ═══════════ */}
      {soldOutModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-3">
            <h3 className="text-lg font-bold text-dark-900">{soldOutModal.target?.name}</h3>
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
              className="w-full px-4 py-3.5 bg-white border-2 border-dark-200 rounded-xl text-base font-semibold text-dark-800 focus:border-primary-500 transition-all" />
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
                <label className="block text-xs font-semibold text-dark-500 mb-1.5 uppercase tracking-wide">Start Time</label>
                <input type="time" value={categorySchedule.startTime} onChange={e => setCategorySchedule(p => ({ ...p, startTime: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-white border-2 border-dark-200 rounded-xl text-sm font-semibold text-dark-800 focus:border-primary-500 transition-all" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-dark-500 mb-1.5 uppercase tracking-wide">End Time</label>
                <input type="time" value={categorySchedule.endTime} onChange={e => setCategorySchedule(p => ({ ...p, endTime: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-white border-2 border-dark-200 rounded-xl text-sm font-semibold text-dark-800 focus:border-primary-500 transition-all" />
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

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 rounded-xl shadow-lg text-sm font-medium ${
          toast.type === 'error' ? 'bg-red-600 text-white' : toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-dark-800 text-white'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
