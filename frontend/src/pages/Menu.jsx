import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Plus, Edit, Trash2, Sparkles, X, Search, ChevronDown, ChevronUp, Check, Upload, Ban, CalendarClock, Clock, Calendar, ArrowLeft, Image as ImageIcon, Package } from 'lucide-react';
import api from '../api';

/* ─── HELPERS ─── */
const foodDot = (ft) =>
  ft === 'veg' ? 'bg-green-500' : ft === 'egg' ? 'bg-yellow-500' : ft === 'nonveg' || ft === 'non-veg' ? 'bg-red-500' : 'bg-gray-300';

const foodColor = (ft) =>
  ft === 'veg' ? '#22c55e' : ft === 'egg' ? '#f59e0b' : '#ef4444';

const formatTime12 = (time) => {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${period}`;
};



const soldOutRemaining = (cat) => {
  if (!cat?.soldOutSchedule?.enabled || !cat?.soldOutSchedule?.endTime) return null;
  const [h, m] = cat.soldOutSchedule.endTime.split(':').map(Number);
  const end = new Date(); end.setHours(h, m, 0, 0);
  const diff = end - new Date();
  if (diff <= 0) return null;
  const mins = Math.floor(diff / 60000);
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
};

const formatScheduleDisplay = (schedule) => {
  if (!schedule?.enabled) return '';
  if (schedule.type === 'daily' || !schedule.type) {
    return `${formatTime12(schedule.startTime)} - ${formatTime12(schedule.endTime)}`;
  }
  if (schedule.type === 'specific_days' && schedule.days?.length > 0) {
    return schedule.days.map(d => d.slice(0, 3)).join(', ');
  }
  return '';
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_FULL = { Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
const UNITS = ['piece','plate','bowl','glass','bottle','kg','g','ml','l','half','full','small','medium','large','regular'];


const ZOMATO_RED = '#E23744';

export default function Menu() {
  /* ═══════════ VIEW STATE ═══════════ */
  const [view, setView] = useState('list'); // 'list' | 'form'

  /* ═══════════ DATA STATE ═══════════ */
  const [items, setItems] = useState([]);
  const [categoryList, setCategoryList] = useState([]);
  const [loading, setLoading] = useState(true);

  /* ═══════════ FILTER STATE ═══════════ */
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [foodTypeFilter, setFoodTypeFilter] = useState('all');
  const [selectedTitle, setSelectedTitle] = useState('all');
  const [togglingId, setTogglingId] = useState(null);

  /* ═══════════ FORM STATE ═══════════ */
  const [editing, setEditing] = useState(null);
  const [focusVariantIdx, setFocusVariantIdx] = useState(null);
  const [form, setForm] = useState({ name: '', category: [], variants: [], available: true });
  const [saving] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [variantImageFiles, setVariantImageFiles] = useState({});
  const [variantImagePreviews, setVariantImagePreviews] = useState({});
  const [variantAiLoading, setVariantAiLoading] = useState({});

  /* ═══════════ CATEGORY MODAL STATE ═══════════ */
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '' });
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryImageFile, setCategoryImageFile] = useState(null);
  const [categoryImagePreview, setCategoryImagePreview] = useState('');

  /* ═══════════ CATEGORY ACTION MODAL (right-click) ═══════════ */
  const [categoryActionModal, setCategoryActionModal] = useState(null);

  /* ═══════════ SOLD OUT MODAL ═══════════ */
  const [soldOutModal, setSoldOutModal] = useState(null);

  /* ═══════════ SCHEDULE SOLD OUT (category - simple time) ═══════════ */
  const [scheduleModal, setScheduleModal] = useState(null);
  const [scheduleSoldOutTime, setScheduleSoldOutTime] = useState('');

  /* ═══════════ ITEM SCHEDULE (daily/custom - matching app) ═══════════ */
  const [showItemScheduleModal, setShowItemScheduleModal] = useState(false);
  const [soldOutItem, setSoldOutItem] = useState(null);
  const [scheduleType, setScheduleType] = useState(null); // null | 'daily' | 'custom'
  const [dailyStartTime, setDailyStartTime] = useState('09:00');
  const [dailyEndTime, setDailyEndTime] = useState('17:00');
  const [customDays, setCustomDays] = useState(DAYS.map(d => ({ day: d, enabled: false, startTime: '09:00', endTime: '17:00' })));


  /* ═══════════ CATEGORY SCHEDULE ═══════════ */
  const [categoryScheduleModal, setCategoryScheduleModal] = useState(null);
  const [categorySchedule, setCategorySchedule] = useState({ enabled: false, type: 'daily', startTime: '09:00', endTime: '22:00', days: [] });

  /* ═══════════ QUANTITY TOGGLE MODAL ═══════════ */
  const [showQtyModal, setShowQtyModal] = useState(false);
  const [qtyModalItem, setQtyModalItem] = useState(null);

  /* ═══════════ MISC ═══════════ */
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [deleting] = useState(false);
  const [toast, setToast] = useState(null);
  const [, setBulkPausingCategory] = useState(null);
  const toastTimer = useRef(null);
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
    Promise.all([fetchItems(), fetchCategories()]).finally(() => setLoading(false));
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

  const titleCards = useMemo(() => {
    let filtered = items;
    if (selectedCategory !== 'all') filtered = filtered.filter(i => (Array.isArray(i.category) ? i.category : [i.category]).includes(selectedCategory));
    const emojiRegex = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;
    const cards = filtered.map(i => {
      const allOff = i.variants?.length > 0 ? i.variants.every(v => v.available === false) : !i.available;
      return { _id: i._id, name: i.name, image: i.image || i.variants?.[0]?.image, variantCount: i.variants?.length || 0, isSoldOut: allOff };
    });
    cards.sort((a, b) => {
      const ae = emojiRegex.test(a.name), be = emojiRegex.test(b.name);
      if (ae && !be) return -1;
      if (!ae && be) return 1;
      return a.name.localeCompare(b.name);
    });
    return cards;
  }, [items, selectedCategory]);

  const totalVariantCount = useMemo(() => items.reduce((s, i) => s + (i.variants?.length || 1), 0), [items]);

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
      const catUnavail = isItemUnavailable(item);
      if (!item.variants || item.variants.length === 0) {
        if (statusFilter === 'available' && (catUnavail || item.available === false)) return;
        if (statusFilter === 'unavailable' && !catUnavail && item.available !== false) return;
        if (foodTypeFilter !== 'all' && item.foodType !== foodTypeFilter) return;
        rows.push({
          ...item, _id: item._id, _parentId: item._id, _parentName: item.name,
          _parentImage: item.image, _parentAvailable: item.available, _parentCategory: item.category,
          _variantIndex: -1, _isVariant: false, _catUnavail: catUnavail,
          parentItem: item,
        });
      } else {
        item.variants.forEach((v, idx) => {
          const isOff = catUnavail || v.available === false || item.available === false;
          if (statusFilter === 'available' && isOff) return;
          if (statusFilter === 'unavailable' && !isOff) return;
          const ft = v.foodType || item.foodType;
          if (foodTypeFilter !== 'all' && ft !== foodTypeFilter) return;
          rows.push({
            ...v, _id: `${item._id}_v${idx}`, _parentId: item._id, _parentName: item.name,
            _parentImage: item.image, _parentAvailable: item.available, _parentCategory: item.category,
            _variantIndex: idx, _isVariant: true, _totalVariants: item.variants.length,
            foodType: ft, _catUnavail: catUnavail, parentItem: item,
            name: v.label || v.name,
          });
        });
      }
    });
    return rows;
  }, [items, searchTerm, selectedCategory, selectedTitle, statusFilter, foodTypeFilter, isItemUnavailable]);

  const sectionData = useMemo(() => {
    const map = new Map();
    flattenedVariants.forEach(row => {
      if (!map.has(row._parentId)) map.set(row._parentId, { parentId: row._parentId, parentName: row._parentName, parentImage: row._parentImage || row.image, parentItem: row.parentItem, rows: [] });
      map.get(row._parentId).rows.push(row);
    });
    const sections = Array.from(map.values());
    const emojiRegex = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;
    sections.sort((a, b) => {
      const ae = emojiRegex.test(a.parentName), be = emojiRegex.test(b.parentName);
      if (ae && !be) return -1;
      if (!ae && be) return 1;
      return a.parentName.localeCompare(b.parentName);
    });
    return sections;
  }, [flattenedVariants]);

  const stats = useMemo(() => ({
    totalItems: items.length,
    totalVariants: totalVariantCount,
    uniqueCategories: new Set(items.flatMap(i => Array.isArray(i.category) ? i.category : [i.category])).size,
    availableCount: flattenedVariants.filter(r => !r._catUnavail && r.available !== false && r._parentAvailable !== false).length,
    unavailableCount: flattenedVariants.filter(r => r._catUnavail || r.available === false || r._parentAvailable === false).length,
  }), [items, totalVariantCount, flattenedVariants]);

  /* ═══════════ VARIANT TOGGLE HANDLERS ═══════════ */
  const toggleVariantAvailability = async (vItem) => {
    // If variant has quantity options, show qty modal instead
    if (vItem.quantities && vItem.quantities.length > 0 && vItem._variantIndex >= 0) {
      setQtyModalItem(vItem);
      setShowQtyModal(true);
      return;
    }
    const parentId = vItem._parentId;
    const vIdx = vItem._variantIndex;
    const key = vIdx >= 0 ? `${parentId}_v${vIdx}` : parentId;
    setTogglingId(key);
    // Optimistic update
    setItems(prev => prev.map(i => {
      if (i._id !== parentId) return i;
      if (vIdx === -1) return { ...i, available: !i.available };
      const updatedV = i.variants.map((v, idx) => idx === vIdx ? { ...v, available: !v.available } : v);
      return { ...i, variants: updatedV };
    }));
    try {
      if (vIdx === -1) await api.patch(`/menu/${parentId}/toggle-pause`);
      else await api.patch(`/menu/${parentId}/variant/${vIdx}/toggle`);
    } catch {
      await fetchItems(); // revert
      showToast('❌ Failed to toggle', 'error');
    } finally { setTogglingId(null); }
  };

  const toggleQuantityAvailability = async (vItem, qIdx) => {
    const parentId = vItem._parentId;
    const vIdx = vItem._variantIndex;
    // Optimistic UI
    setItems(prev => prev.map(i => {
      if (i._id !== parentId) return i;
      const updV = i.variants.map((v, idx) => {
        if (idx !== vIdx) return v;
        const updQ = v.quantities.map((q, qi) => qi === qIdx ? { ...q, available: q.available === false ? true : false } : q);
        return { ...v, quantities: updQ };
      });
      return { ...i, variants: updV };
    }));
    setQtyModalItem(prev => {
      if (!prev) return prev;
      const updQ = prev.quantities.map((q, qi) => qi === qIdx ? { ...q, available: q.available === false ? true : false } : q);
      return { ...prev, quantities: updQ };
    });
    try {
      await api.patch(`/menu/${parentId}/variant/${vIdx}/quantity/${qIdx}/toggle`);
    } catch {
      await fetchItems();
      showToast('❌ Failed to toggle quantity', 'error');
    }
  };

  const markVariantsSoldOut = async (parentId, soldOut) => {
    setItems(prev => prev.map(i => {
      if (i._id !== parentId) return i;
      const updV = (i.variants || []).map(v => ({ ...v, available: !soldOut }));
      return { ...i, available: !soldOut, variants: updV };
    }));
    try {
      await api.patch(`/menu/${parentId}/variants-soldout`, { soldOut });
      showToast(soldOut ? '🚫 Item marked sold out' : '✅ Item marked available', 'success');
    } catch {
      await fetchItems();
      showToast('❌ Failed to update', 'error');
    }
  };

  /* ═══════════ ITEM SOLD OUT / SCHEDULE ═══════════ */
  const showItemSoldOutOptions = (parentItem) => {
    const allOff = parentItem.variants?.length > 0 ? parentItem.variants.every(v => v.available === false) : !parentItem.available;
    setSoldOutModal({ type: 'item', target: parentItem, allOff });
  };

  const openItemScheduleModal = (parentItem) => {
    setSoldOutItem(parentItem);
    const existing = parentItem.soldOutSchedule;
    if (existing?.enabled) {
      setScheduleType(existing.type || 'daily');
      if (existing.type === 'daily') {
        setDailyStartTime(existing.dailyStartTime || '09:00');
        setDailyEndTime(existing.dailyEndTime || '17:00');
      } else if (existing.type === 'custom' && existing.days) {
        setCustomDays(DAYS.map(d => {
          const found = existing.days.find(ed => ed.day === d);
          return found ? { ...found } : { day: d, enabled: false, startTime: '09:00', endTime: '17:00' };
        }));
      }
    } else {
      setScheduleType(null);
      setDailyStartTime('09:00');
      setDailyEndTime('17:00');
      setCustomDays(DAYS.map(d => ({ day: d, enabled: false, startTime: '09:00', endTime: '17:00' })));
    }
    setShowItemScheduleModal(true);
  };

  const saveItemSoldOutSchedule = async () => {
    if (!soldOutItem || !scheduleType) return;
    try {
      setSavingCategory(true);
      const schedule = {
        type: scheduleType,
        dailyStartTime: scheduleType === 'daily' ? dailyStartTime : null,
        dailyEndTime: scheduleType === 'daily' ? dailyEndTime : null,
        days: scheduleType === 'custom' ? customDays : [],
      };
      await api.patch(`/menu/${soldOutItem._id}/schedule-soldout`, { schedule });
      setShowItemScheduleModal(false);
      showToast('✅ Schedule saved', 'success');
      await fetchItems();
    } catch {
      showToast('❌ Failed to save schedule', 'error');
    } finally { setSavingCategory(false); }
  };

  const removeItemSchedule = async () => {
    if (!soldOutItem) return;
    try {
      setSavingCategory(true);
      await api.patch(`/menu/${soldOutItem._id}/schedule-soldout`, {
        schedule: { type: 'daily', dailyStartTime: null, dailyEndTime: null, days: [] }
      });
      await api.put(`/menu/${soldOutItem._id}`, { ...soldOutItem, soldOutSchedule: { enabled: false } });
      setShowItemScheduleModal(false);
      showToast('✅ Schedule removed', 'success');
      await fetchItems();
    } catch { showToast('❌ Failed to remove schedule', 'error'); }
    finally { setSavingCategory(false); }
  };

  const updateCustomDay = (dIdx, field, value) => {
    setCustomDays(prev => prev.map((d, i) => i === dIdx ? { ...d, [field]: value } : d));
  };



  /* ═══════════ DELETE HANDLERS ═══════════ */
  const deleteVariant = (parentId, variantIndex) => {
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

  /* ═══════════ CATEGORY HANDLERS ═══════════ */
  const toggleCategorySoldOut = async (cat) => {
    try { await api.patch(`/categories/${cat._id}/toggle-soldout`); await fetchCategories(); }
    catch { showToast('❌ Failed to toggle sold-out', 'error'); }
  };

  const toggleCategoryPause = async (cat) => {
    try { await api.patch(`/categories/${cat._id}/toggle-pause`); await fetchCategories(); }
    catch { showToast('❌ Failed to toggle pause', 'error'); }
  };

  const handleBulkPause = async (catName) => {
    const cat = categoryList.find(c => c.name === catName);
    if (!cat) return;
    setBulkPausingCategory(catName);
    try {
      await api.patch('/menu/bulk-pause', { categoryName: catName, isPaused: !cat.isPaused });
      await Promise.all([fetchItems(), fetchCategories()]);
    } catch { showToast('❌ Failed to bulk pause', 'error'); }
    finally { setBulkPausingCategory(null); }
  };

  const showCategorySoldOutOptions = (cat) => {
    setSoldOutModal({ type: 'category', target: cat, allOff: cat.isSoldOut });
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
      showToast('✅ Scheduled', 'success');
    } catch { showToast('❌ Failed to schedule', 'error'); }
  };

  const saveCategory = async () => {
    if (!categoryForm.name.trim()) return;
    setSavingCategory(true);
    try {
      const fd = new FormData();
      fd.append('name', categoryForm.name.trim());
      if (categoryForm.description) fd.append('description', categoryForm.description);
      if (categoryImageFile) fd.append('image', categoryImageFile);
      if (editingCategory) await api.put(`/categories/${editingCategory._id}`, fd, { timeout: 60000 });
      else await api.post('/categories', fd, { timeout: 60000 });
      await fetchCategories();
      setShowCategoryModal(false); setEditingCategory(null);
      setCategoryForm({ name: '', description: '' }); setCategoryImageFile(null); setCategoryImagePreview('');
      showToast('✅ Category saved', 'success');
    } catch (err) { showToast('❌ ' + (err.response?.data?.error || 'Failed to save'), 'error'); }
    finally { setSavingCategory(false); }
  };

  const deleteCategory = (cat) => {
    setConfirmDialog({
      title: 'Delete Category?', message: `Delete "${cat.name}"? Items in this category will not be deleted.`,
      onConfirm: async () => {
        try { await api.delete(`/categories/${cat._id}`); await fetchCategories(); showToast('✅ Category deleted', 'success'); }
        catch { showToast('❌ Failed to delete', 'error'); }
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
      showToast('✅ Schedule saved', 'success');
    } catch { showToast('❌ Failed to save schedule', 'error'); }
  };

  const handleCategoryClick = (cat) => {
    setSelectedCategory(selectedCategory === cat.name ? 'all' : cat.name);
  };

  const handleCategoryContextMenu = (e, cat) => {
    e.preventDefault();
    setCategoryActionModal(cat);
  };

  /* ═══════════ FORM HELPERS ═══════════ */
  const openForm = (item = null, variantIndex = null) => {
    if (item) {
      setEditing(item);
      setFocusVariantIdx(variantIndex);
      setForm({
        name: item.name || '',
        category: Array.isArray(item.category) ? item.category : [item.category].filter(Boolean),
        variants: (item.variants || []).map((v, i) => ({
          ...v, _uid: `v_${i}_${Date.now()}`, _collapsed: variantIndex !== null ? i !== variantIndex : true,
          quantities: v.quantities || [],
        })),
        available: item.available !== false,
      });
      setImagePreview(item.image || '');
      const previews = {};
      (item.variants || []).forEach((v, i) => { if (v.image) previews[`v_${i}_${Date.now()}`] = v.image; });
      setVariantImagePreviews(previews);
    } else {
      setEditing(null);
      setFocusVariantIdx(null);
      setForm({ name: '', category: [], variants: [], available: true });
      setImagePreview('');
      setVariantImagePreviews({});
    }
    setImageFile(null);
    setVariantImageFiles({});
    setView('form');
  };

  const addVariant = () => {
    const uid = `v_${form.variants.length}_${Date.now()}`;
    setForm({ ...form, variants: [...form.variants, {
      _uid: uid, _collapsed: false, label: '', description: '', foodType: 'veg',
      tags: '', price: '', available: true, image: null, quantities: [],
      quantity: '1', unit: 'piece',
    }]});
  };

  const removeVariant = (idx) => {
    if (form.variants.length <= 1 && !editing) {
      showToast('Need at least one variant', 'error');
      return;
    }
    const vs = [...form.variants]; vs.splice(idx, 1);
    setForm({ ...form, variants: vs });
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
    vs[vi] = { ...vs[vi], quantities: [...(vs[vi].quantities || []), { quantity: '', unit: vs[vi].unit || 'piece', price: '', offerPrice: '' }] };
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

  const toggleCategory = (catName) => {
    setForm(prev => ({
      ...prev,
      category: prev.category.includes(catName) ? prev.category.filter(c => c !== catName) : [...prev.category, catName]
    }));
  };

  const generateDescription = async (vi) => {
    const key = `desc_${vi}`;
    setVariantAiLoading(p => ({ ...p, [key]: true }));
    try {
      const name = form.variants[vi].label || form.name;
      const cat = form.category[0] || '';
      const r = await api.post('/ai/generate-description', { name, category: cat });
      updateVariant(vi, 'description', r.data.description);
    } catch { showToast('AI generation failed', 'error'); }
    finally { setVariantAiLoading(p => ({ ...p, [key]: false })); }
  };

  const generateTags = async (vi) => {
    const key = `tags_${vi}`;
    setVariantAiLoading(p => ({ ...p, [key]: true }));
    try {
      const v = form.variants[vi];
      const r = await api.post('/ai/generate-tags', { name: v.label || form.name, category: form.category[0] || '', foodType: v.foodType || 'veg' });
      updateVariant(vi, 'tags', r.data.tags?.join(', ') || '');
    } catch { showToast('AI generation failed', 'error'); }
    finally { setVariantAiLoading(p => ({ ...p, [key]: false })); }
  };

  /* ═══════════ SUBMIT HANDLER ═══════════ */
  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!form.name.trim()) return showToast('Please enter a name', 'error');
    if (form.variants.length === 0) return showToast('Add at least one variant', 'error');
    for (let i = 0; i < form.variants.length; i++) {
      const v = form.variants[i];
      if (!v.label?.trim()) return showToast(`Variant ${i+1}: Name is required`, 'error');
      if (v.quantities?.length > 0) {
        if (v.quantities.some(q => !q.price || parseFloat(q.price) <= 0)) return showToast(`Variant ${i+1}: All sizes need prices`, 'error');
      } else if (!v.price || parseFloat(v.price) <= 0) return showToast(`Variant ${i+1}: Price is required`, 'error');
    }

    const fd = new FormData();
    fd.append('name', form.name.trim());
    fd.append('category', JSON.stringify(form.category));
    fd.append('available', form.available);
    const v0 = form.variants[0];
    if (v0) {
      fd.append('foodType', v0.foodType || 'veg');
      fd.append('description', v0.description || '');
      fd.append('tags', v0.tags || '');
      const prices = form.variants.flatMap(v => v.quantities?.length > 0 ? v.quantities.map(q => parseFloat(q.price) || 0) : [parseFloat(v.price) || 0]);
      fd.append('price', Math.min(...prices.filter(p => p > 0)) || 0);
    }
    if (imageFile) fd.append('image', imageFile);

    const cleanVariants = form.variants.map(v => {
      const { _uid, _collapsed, ...rest } = v;
      return { ...rest, quantities: (rest.quantities || []).filter(q => q.quantity && q.price) };
    });
    fd.append('variants', JSON.stringify(cleanVariants));

    const imgIndices = [];
    form.variants.forEach((v, i) => {
      const uid = v._uid;
      if (variantImageFiles[uid]) { fd.append('variantImages', variantImageFiles[uid]); imgIndices.push(i); }
    });
    if (imgIndices.length > 0) fd.append('variantImageIndices', JSON.stringify(imgIndices));

    const isEdit = !!editing;
    const editId = editing?._id;
    setView('list');
    showToast(isEdit ? '⏳ Updating item...' : '⏳ Creating item...', 'info');

    try {
      if (isEdit) await api.put(`/menu/${editId}`, fd, { timeout: 90000 });
      else await api.post('/menu', fd, { timeout: 90000 });
      showToast('✅ Item saved successfully', 'success');
      await fetchItems();
    } catch (err) {
      showToast('❌ ' + (err.response?.data?.error || 'Failed to save item'), 'error');
    }
  };

  /* ═══════════ PRODUCT TITLE DOUBLE-CLICK ═══════════ */
  const handleTitleClick = (tc) => {
    const now = Date.now();
    const last = lastTapRef.current[tc._id] || 0;
    if (now - last < 400) {
      const item = items.find(i => i._id === tc._id);
      if (item) openForm(item);
      lastTapRef.current[tc._id] = 0;
    } else {
      lastTapRef.current[tc._id] = now;
      setTimeout(() => {
        if (lastTapRef.current[tc._id] === now) setSelectedTitle(tc._id === selectedTitle ? 'all' : tc._id);
      }, 400);
    }
  };

  /* ═══════════ LOADING ═══════════ */
  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: `${ZOMATO_RED} transparent transparent transparent` }} />
    </div>
  );

  /* ═══════════════════════════════════════════════════════════
     FORM VIEW (MenuItemFormScreen equivalent)
     ═══════════════════════════════════════════════════════════ */
  if (view === 'form') {
    const isEditing = !!editing;
    const isSingleVariantEdit = focusVariantIdx !== null;
    return (
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setView('list')} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-700" />
          </button>
          <h1 className="text-xl font-bold text-gray-900">
            {isSingleVariantEdit ? `Edit Variant` : isEditing ? 'Edit Item' : 'New Item'}
          </h1>
        </div>

        <div className="space-y-5">
          {/* Item Image (hidden in single-variant edit) */}
          {!isSingleVariantEdit && (
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <label className="block text-sm font-semibold text-gray-700 mb-3">Item Image</label>
              <div className="flex items-center gap-4">
                <div className="w-24 h-24 rounded-xl bg-gray-100 overflow-hidden flex-shrink-0 border-2 border-dashed border-gray-200">
                  {imagePreview ? <img src={imagePreview} alt="" className="w-full h-full object-cover" /> :
                    <div className="w-full h-full flex items-center justify-center"><Upload className="w-6 h-6 text-gray-300" /></div>}
                </div>
                <div className="flex flex-col gap-2">
                  <label className="cursor-pointer px-4 py-2 rounded-xl text-sm font-medium transition-colors text-white" style={{ backgroundColor: ZOMATO_RED }}>
                    {imagePreview ? 'Change' : 'Upload'}
                    <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files[0]; if (f) { setImageFile(f); setImagePreview(URL.createObjectURL(f)); }}} className="hidden" />
                  </label>
                  {imagePreview && <button type="button" onClick={() => { setImageFile(null); setImagePreview(''); }} className="px-4 py-2 text-red-500 text-sm font-medium hover:bg-red-50 rounded-xl transition-colors">Remove</button>}
                </div>
              </div>
            </div>
          )}

          {/* Title (hidden in single-variant edit) */}
          {!isSingleVariantEdit && (
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <label className="block text-sm font-semibold text-gray-700 mb-2">Title <span className="text-red-500">*</span></label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-red-400 focus:bg-white transition-all text-sm" placeholder="Item name (e.g., Paneer Tikka)" />
            </div>
          )}

          {/* Category Picker (hidden in single-variant edit) */}
          {!isSingleVariantEdit && (
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <label className="block text-sm font-semibold text-gray-700 mb-3">Categories</label>
              <div className="flex flex-wrap gap-2">
                {categoryList.map(cat => (
                  <button key={cat._id} type="button" onClick={() => toggleCategory(cat.name)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
                      form.category.includes(cat.name) ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}>
                    {cat.image && <img src={cat.image} alt="" className="w-4 h-4 rounded-full object-cover" />}
                    {cat.name}
                    {form.category.includes(cat.name) && <Check className="w-3 h-3" />}
                  </button>
                ))}
                <button type="button" onClick={() => openCategoryModal()} className="px-3 py-2 rounded-xl text-xs font-medium border border-dashed border-gray-300 text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-colors">
                  + New
                </button>
              </div>
            </div>
          )}

          {/* Variants Section */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <label className="text-sm font-semibold text-gray-700">Variants</label>
                <span className="px-2 py-0.5 bg-gray-100 rounded-full text-xs font-bold text-gray-600">{form.variants.length}</span>
              </div>
              {!isSingleVariantEdit && (
                <button type="button" onClick={addVariant} className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium text-white transition-colors" style={{ backgroundColor: ZOMATO_RED }}>
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              )}
            </div>

            {form.variants.length === 0 ? (
              <button type="button" onClick={addVariant} className="w-full py-8 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 hover:text-gray-600 hover:border-gray-300 transition-colors text-sm">
                + Add your first variant
              </button>
            ) : (
              <div className="space-y-3">
                {form.variants.map((v, vi) => (
                  <div key={v._uid} className="border border-gray-200 rounded-xl overflow-hidden">
                    {/* Variant Header */}
                    <button type="button" onClick={() => toggleVariantCollapse(vi)}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left">
                      <span className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: ZOMATO_RED }}>{vi + 1}</span>
                      <span className={`w-3 h-3 rounded-full flex-shrink-0 border-2 border-white shadow-sm ${foodDot(v.foodType)}`} />
                      <span className="flex-1 font-medium text-sm text-gray-800 truncate">{v.label || `Variant ${vi + 1}`}</span>
                      {v.quantities?.length > 0 ? (
                        <span className="text-xs text-gray-400">{v.quantities.length} size{v.quantities.length > 1 ? 's' : ''}</span>
                      ) : v.price ? (
                        <span className="text-xs text-gray-500 font-medium">₹{v.price}</span>
                      ) : null}
                      {!v.available && <span className="px-1.5 py-0.5 bg-red-100 text-red-600 rounded text-[9px] font-bold">OFF</span>}
                      {v._collapsed ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronUp className="w-4 h-4 text-gray-400" />}
                    </button>

                    {/* Variant Body */}
                    {!v._collapsed && (
                      <div className="p-4 space-y-4 border-t border-gray-100">
                        {/* Variant Image */}
                        <div className="flex items-center gap-3">
                          <div className="w-16 h-16 rounded-xl bg-gray-100 overflow-hidden flex-shrink-0 border border-gray-200">
                            {(variantImagePreviews[v._uid] || v.image) ?
                              <img src={variantImagePreviews[v._uid] || v.image} alt="" className="w-full h-full object-cover" /> :
                              <div className="w-full h-full flex items-center justify-center"><Upload className="w-4 h-4 text-gray-300" /></div>}
                          </div>
                          <label className="cursor-pointer px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-200 transition-colors">
                            Upload <input type="file" accept="image/*" onChange={(e) => handleVariantImageChange(vi, e)} className="hidden" />
                          </label>
                          {(variantImagePreviews[v._uid] || v.image) &&
                            <button type="button" onClick={() => removeVariantImage(vi)} className="text-xs text-red-500 font-medium">Remove</button>}
                        </div>

                        {/* Item Name */}
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Item Name <span className="text-red-500">*</span></label>
                          <input type="text" value={v.label} onChange={e => updateVariant(vi, 'label', e.target.value)}
                            className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:border-red-400 transition-colors" placeholder="Variant name" />
                        </div>

                        {/* Description + AI */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs font-medium text-gray-500">Description</label>
                            <button type="button" onClick={() => generateDescription(vi)} disabled={variantAiLoading[`desc_${vi}`]}
                              className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-white rounded-md disabled:opacity-50 transition-colors" style={{ backgroundColor: ZOMATO_RED }}>
                              <Sparkles className="w-3 h-3" /> {variantAiLoading[`desc_${vi}`] ? '...' : 'AI'}
                            </button>
                          </div>
                          <textarea value={v.description || ''} onChange={e => updateVariant(vi, 'description', e.target.value)} rows={2}
                            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm resize-none focus:border-red-400" />
                        </div>

                        {/* Food Type */}
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1.5">Food Type</label>
                          <div className="flex gap-2">
                            {[{v:'veg',l:'🟢 Veg'},{v:'nonveg',l:'🔴 Non-Veg'},{v:'egg',l:'🟡 Egg'}].map(ft => (
                              <button key={ft.v} type="button" onClick={() => updateVariant(vi, 'foodType', ft.v)}
                                className={`flex-1 py-2.5 rounded-xl text-xs font-medium border-2 transition-all ${v.foodType === ft.v ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                                {ft.l}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Tags + AI */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs font-medium text-gray-500">Tags</label>
                            <button type="button" onClick={() => generateTags(vi)} disabled={variantAiLoading[`tags_${vi}`]}
                              className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-white rounded-md disabled:opacity-50 transition-colors" style={{ backgroundColor: ZOMATO_RED }}>
                              <Sparkles className="w-3 h-3" /> {variantAiLoading[`tags_${vi}`] ? '...' : 'AI'}
                            </button>
                          </div>
                          <input type="text" value={v.tags || ''} onChange={e => updateVariant(vi, 'tags', e.target.value)}
                            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:border-red-400" placeholder="comma separated" />
                        </div>

                        {/* Pricing */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-medium text-gray-500">Pricing</label>
                            <button type="button" onClick={() => addQuantityOption(vi)} className="text-[10px] font-medium text-white px-2 py-0.5 rounded-md transition-colors" style={{ backgroundColor: ZOMATO_RED }}>
                              + Size
                            </button>
                          </div>
                          {(!v.quantities || v.quantities.length === 0) ? (
                            <div className="flex gap-2 items-center">
                              <input type="text" value={v.quantity || ''} onChange={e => updateVariant(vi, 'quantity', e.target.value)}
                                className="w-16 px-2 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs" placeholder="Qty" />
                              <select value={v.unit || 'piece'} onChange={e => updateVariant(vi, 'unit', e.target.value)}
                                className="px-2 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs">
                                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                              </select>
                              <div className="flex-1 relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">₹</span>
                                <input type="number" value={v.price || ''} onChange={e => updateVariant(vi, 'price', e.target.value)}
                                  className="w-full pl-6 pr-2 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs" placeholder="Price" />
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {v.quantities.map((q, qi) => (
                                <div key={qi} className="flex gap-2 items-center bg-gray-50 p-2 rounded-lg">
                                  <input type="text" value={q.quantity} onChange={e => updateQuantityOption(vi, qi, 'quantity', e.target.value)}
                                    className="w-16 px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-xs" placeholder="Qty" />
                                  <select value={q.unit || 'piece'} onChange={e => updateQuantityOption(vi, qi, 'unit', e.target.value)}
                                    className="px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-xs">
                                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                                  </select>
                                  <div className="flex-1 relative">
                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">₹</span>
                                    <input type="number" value={q.price} onChange={e => updateQuantityOption(vi, qi, 'price', e.target.value)}
                                      className="w-full pl-6 pr-2 py-1.5 bg-white border border-gray-200 rounded-lg text-xs" placeholder="Price" />
                                  </div>
                                  <button type="button" onClick={() => removeQuantityOption(vi, qi)} className="text-red-400 hover:text-red-600 p-1"><X className="w-3.5 h-3.5" /></button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Available Toggle */}
                        <div className="flex items-center justify-between py-2">
                          <span className="text-xs font-medium text-gray-500">Available</span>
                          <button type="button" onClick={() => updateVariant(vi, 'available', !v.available)}
                            className={`w-11 h-6 rounded-full transition-colors relative ${v.available ? 'bg-green-500' : 'bg-gray-300'}`}>
                            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${v.available ? 'left-5' : 'left-0.5'}`} />
                          </button>
                        </div>

                        {/* Remove */}
                        <button type="button" onClick={() => removeVariant(vi)}
                          className="w-full py-2.5 text-xs font-medium text-red-500 border border-red-200 rounded-xl hover:bg-red-50 transition-colors">
                          Remove Variant
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                {/* Add Another */}
                {!isSingleVariantEdit && form.variants.length > 0 && (
                  <button type="button" onClick={addVariant} className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 hover:text-gray-600 hover:border-gray-300 transition-colors text-xs font-medium">
                    + Add Another Variant
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Available Switch (hidden in single-variant edit) */}
          {!isSingleVariantEdit && (
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">Item Available</span>
              <button type="button" onClick={() => setForm({ ...form, available: !form.available })}
                className={`w-12 h-7 rounded-full transition-colors relative ${form.available ? 'bg-green-500' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${form.available ? 'left-5' : 'left-0.5'}`} />
              </button>
            </div>
          )}

          {/* Submit */}
          <div className="flex gap-3 pb-6">
            <button type="button" onClick={() => setView('list')} className="flex-1 px-4 py-3.5 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={saving}
              className="flex-1 px-4 py-3.5 text-white rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 transition-colors" style={{ backgroundColor: ZOMATO_RED }}>
              {saving ? 'Saving...' : isEditing ? 'Update Item' : 'Add Item'}
            </button>
          </div>
        </div>

        {/* Category Modal in form view */}
        {showCategoryModal && renderCategoryModal()}
        {confirmDialog && renderConfirmDialog()}
        {renderToast()}
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════
     LIST VIEW (AdminMenuScreen equivalent)
     ═══════════════════════════════════════════════════════════ */

  /* ── Helper render functions ── */
  function renderCategoryModal() {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden">
          <div className="border-b border-gray-100 px-6 py-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">{editingCategory ? 'Edit Category' : 'New Category'}</h2>
            <button onClick={() => { setShowCategoryModal(false); setEditingCategory(null); }} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-6 space-y-4">
            {/* Image */}
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-xl bg-gray-100 overflow-hidden flex-shrink-0 border border-gray-200">
                {categoryImagePreview ? <img src={categoryImagePreview} alt="" className="w-full h-full object-cover" /> :
                  <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-5 h-5 text-gray-300" /></div>}
              </div>
              <label className="cursor-pointer px-4 py-2 text-white rounded-xl text-sm font-medium" style={{ backgroundColor: ZOMATO_RED }}>
                Upload <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files[0]; if (f) { setCategoryImageFile(f); setCategoryImagePreview(URL.createObjectURL(f)); }}} className="hidden" />
              </label>
              {categoryImagePreview && <button type="button" onClick={() => { setCategoryImageFile(null); setCategoryImagePreview(''); }} className="text-xs text-red-500 font-medium">Remove</button>}
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
              <input type="text" value={categoryForm.name} onChange={e => setCategoryForm({ ...categoryForm, name: e.target.value })}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm" placeholder="Category name" />
            </div>
            <button onClick={saveCategory} disabled={savingCategory || !categoryForm.name.trim()}
              className="w-full py-3 text-white rounded-xl font-medium disabled:opacity-50 transition-colors" style={{ backgroundColor: ZOMATO_RED }}>
              {savingCategory ? 'Saving...' : editingCategory ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderConfirmDialog() {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4">
          <h3 className="text-lg font-bold text-gray-900">{confirmDialog.title}</h3>
          <p className="text-sm text-gray-500">{confirmDialog.message}</p>
          <div className="flex gap-3">
            <button onClick={() => setConfirmDialog(null)} className="flex-1 py-2.5 border border-gray-200 rounded-xl font-medium text-gray-700">Cancel</button>
            <button onClick={confirmDialog.onConfirm} disabled={deleting}
              className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 disabled:opacity-50">
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderToast() {
    if (!toast) return null;
    return (
      <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 rounded-xl shadow-lg text-sm font-medium ${
        toast.type === 'error' ? 'bg-red-600 text-white' : toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-gray-800 text-white'
      }`}>{toast.message}</div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── HEADER ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Menu</h1>
          <p className="text-gray-500 mt-0.5 text-sm">{stats.totalItems} items • {stats.totalVariants} variants • {stats.uniqueCategories} categories</p>
        </div>
        <button onClick={() => openForm()} className="flex items-center gap-1.5 px-4 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-colors" style={{ backgroundColor: ZOMATO_RED }}>
          <Plus className="w-4 h-4" /> Add Item
        </button>
      </div>

      {/* ── SEARCH ── */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search items or variants..."
          className="w-full pl-10 pr-10 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:border-red-400 shadow-sm" />
        {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-4 h-4 text-gray-400" /></button>}
      </div>

      {/* ── STATS ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total Items', value: stats.totalItems, color: 'text-gray-900' },
          { label: 'Variants', value: stats.totalVariants, color: 'text-blue-600' },
          { label: 'Categories', value: stats.uniqueCategories, color: 'text-purple-600' },
          { label: 'In Stock', value: stats.availableCount, color: 'text-green-600' },
          { label: 'Out', value: stats.unavailableCount, color: 'text-red-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 text-center">
            <p className="text-gray-400 text-xs">{s.label}</p>
            <p className={`text-xl font-bold mt-0.5 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* ── FILTER CHIPS ── */}
      <div className="flex flex-wrap gap-2">
        {['all','available','unavailable'].map(f => (
          <button key={f} onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              statusFilter === f ? 'text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
            }`} style={statusFilter === f ? { backgroundColor: ZOMATO_RED } : {}}>
            {f === 'all' ? 'All' : f === 'available' ? 'In Stock' : 'Out of Stock'}
          </button>
        ))}
        <div className="w-px bg-gray-200 mx-1" />
        {[
          { v: 'veg', l: '🟢 Veg', c: '#22c55e' },
          { v: 'nonveg', l: '🔴 Non-Veg', c: '#ef4444' },
          { v: 'egg', l: '🟡 Egg', c: '#f59e0b' },
        ].map(f => (
          <button key={f.v} onClick={() => setFoodTypeFilter(foodTypeFilter === f.v ? 'all' : f.v)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              foodTypeFilter === f.v ? 'text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
            }`} style={foodTypeFilter === f.v ? { backgroundColor: f.c } : {}}>
            {f.l}
          </button>
        ))}
      </div>

      {/* ── CATEGORY FILTER (circles like mobile app) ── */}
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {/* All */}
        <button onClick={() => setSelectedCategory('all')} className="flex-shrink-0 flex flex-col items-center gap-1.5 min-w-[60px]">
          <div className={`w-14 h-14 rounded-full flex items-center justify-center border-2 transition-all ${
            selectedCategory === 'all' ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50'
          }`}>
            <Package className={`w-6 h-6 ${selectedCategory === 'all' ? 'text-red-500' : 'text-gray-400'}`} />
          </div>
          <span className={`text-[10px] font-medium ${selectedCategory === 'all' ? 'text-red-600' : 'text-gray-500'}`}>All</span>
          {selectedCategory === 'all' && <div className="w-5 h-0.5 rounded-full" style={{ backgroundColor: ZOMATO_RED }} />}
        </button>
        {categoryList.map(cat => {
          const isActive = selectedCategory === cat.name;
          const isSoldOut = cat.isSoldOut;
          const isScheduledLocked = cat.schedule?.enabled && cat.isPaused && !cat.isSoldOut;
          const rem = soldOutRemaining(cat);
          return (
            <div key={cat._id} className="flex-shrink-0 flex flex-col items-center gap-1.5 min-w-[60px] relative group"
              onContextMenu={(e) => handleCategoryContextMenu(e, cat)}>
              <button onClick={() => handleCategoryClick(cat)} className="flex flex-col items-center">
                <div className={`w-14 h-14 rounded-full overflow-hidden border-2 transition-all relative ${
                  isActive ? 'border-red-500' : isSoldOut ? 'border-red-300' : isScheduledLocked ? 'border-indigo-300' : 'border-gray-200'
                }`}>
                  {cat.image ? (
                    <img src={cat.image} alt="" className={`w-full h-full object-cover ${(isSoldOut || isScheduledLocked) ? 'opacity-50' : ''}`} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gray-50">
                      <ImageIcon className={`w-5 h-5 ${isSoldOut ? 'text-red-400' : isScheduledLocked ? 'text-indigo-400' : 'text-gray-400'}`} />
                    </div>
                  )}
                  {isSoldOut && (
                    <div className="absolute inset-0 bg-red-500/30 flex items-center justify-center">
                      <span className="bg-red-600 text-white text-[7px] font-bold px-1.5 py-0.5 rounded">SOLD OUT</span>
                    </div>
                  )}
                  {isScheduledLocked && !isSoldOut && (
                    <div className="absolute inset-0 bg-indigo-500/20 flex items-center justify-center">
                      <Clock className="w-4 h-4 text-indigo-600" />
                    </div>
                  )}
                </div>
                <span className={`text-[10px] font-medium truncate max-w-[60px] ${
                  isActive ? 'text-red-600' : isSoldOut ? 'text-red-400' : isScheduledLocked ? 'text-indigo-500' : 'text-gray-500'
                }`}>{cat.name}</span>
                {rem && <span className="text-[8px] text-orange-500 font-medium">Until {rem}</span>}
                {cat.schedule?.enabled && !isSoldOut && (
                  <span className={`text-[8px] font-medium ${cat.isPaused ? 'text-indigo-400' : 'text-green-500'}`}>
                    {cat.isPaused ? '⏰' : '✅'} {formatScheduleDisplay(cat.schedule).substring(0, 15)}
                  </span>
                )}
                {isActive && <div className="w-5 h-0.5 rounded-full" style={{ backgroundColor: ZOMATO_RED }} />}
              </button>
              {/* Hover quick actions */}
              <div className="absolute -top-1 -right-1 hidden group-hover:flex gap-0.5 z-10">
                <button onClick={(e) => { e.stopPropagation(); setCategoryActionModal(cat); }} className="w-5 h-5 bg-gray-700 text-white rounded-full flex items-center justify-center text-[10px]" title="Actions">⋯</button>
              </div>
            </div>
          );
        })}
        {/* Add category button */}
        <button onClick={() => openCategoryModal()} className="flex-shrink-0 flex flex-col items-center gap-1.5 min-w-[60px]">
          <div className="w-14 h-14 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center hover:border-gray-400 transition-colors">
            <Plus className="w-5 h-5 text-gray-400" />
          </div>
          <span className="text-[10px] text-gray-400 font-medium">Add</span>
        </button>
      </div>

      {/* ── PRODUCT TITLE CARDS ── */}
      {titleCards.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Products</p>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
            {/* All Items */}
            <button onClick={() => setSelectedTitle('all')} className="flex-shrink-0 flex flex-col items-center gap-1.5 min-w-[70px]">
              <div className={`w-16 h-16 rounded-xl overflow-hidden flex items-center justify-center border-2 transition-all ${
                selectedTitle === 'all' ? 'border-red-500' : 'border-gray-200'
              }`} style={selectedTitle === 'all' ? { backgroundColor: ZOMATO_RED } : { backgroundColor: '#f9fafb' }}>
                <div className="text-center">
                  <Package className={`w-5 h-5 mx-auto ${selectedTitle === 'all' ? 'text-white' : 'text-gray-400'}`} />
                  <span className={`text-[9px] font-bold ${selectedTitle === 'all' ? 'text-white' : 'text-gray-400'}`}>All</span>
                </div>
              </div>
              <span className={`text-[10px] font-medium ${selectedTitle === 'all' ? 'text-red-600' : 'text-gray-500'}`}>All Items</span>
              <span className="text-[9px] text-gray-400">{totalVariantCount} items</span>
              {selectedTitle === 'all' && <div className="w-5 h-0.5 rounded-full" style={{ backgroundColor: ZOMATO_RED }} />}
            </button>
            {titleCards.map(tc => (
              <div key={tc._id} className="flex-shrink-0 flex flex-col items-center gap-1.5 min-w-[70px] cursor-pointer"
                onClick={() => handleTitleClick(tc)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const item = items.find(i => i._id === tc._id);
                  if (item) showItemSoldOutOptions(item);
                }}>
                <div className={`w-16 h-16 rounded-xl overflow-hidden border-2 transition-all relative ${
                  selectedTitle === tc._id ? 'border-red-500' : 'border-gray-200'
                }`}>
                  {tc.image ? (
                    <img src={tc.image} alt="" className={`w-full h-full object-cover ${tc.isSoldOut ? 'opacity-40' : ''}`} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gray-50">
                      <ImageIcon className="w-5 h-5 text-gray-300" />
                    </div>
                  )}
                  {tc.isSoldOut && (
                    <div className="absolute bottom-0 inset-x-0 bg-red-500/90 py-0.5 text-center">
                      <span className="text-[7px] font-bold text-white tracking-wider">SOLD OUT</span>
                    </div>
                  )}
                </div>
                <span className={`text-[10px] font-medium truncate max-w-[70px] ${
                  selectedTitle === tc._id ? 'text-red-600' : tc.isSoldOut ? 'text-gray-300' : 'text-gray-600'
                }`}>{tc.name}</span>
                {tc.variantCount > 0 && <span className="text-[9px] text-gray-400">{tc.variantCount} variant{tc.variantCount > 1 ? 's' : ''}</span>}
                {selectedTitle === tc._id && <div className="w-5 h-0.5 rounded-full" style={{ backgroundColor: ZOMATO_RED }} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── VARIANT LIST (matching mobile's flat variant cards) ── */}
      {sectionData.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#FEF2F2' }}>
            <ImageIcon className="w-8 h-8" style={{ color: ZOMATO_RED }} />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {searchTerm || selectedCategory !== 'all' || statusFilter !== 'all' || foodTypeFilter !== 'all' ? 'No items found' : 'No menu items yet'}
          </h3>
          <p className="text-gray-500 text-sm mb-4">
            {searchTerm || selectedCategory !== 'all' || statusFilter !== 'all' || foodTypeFilter !== 'all' ? 'Try adjusting your filters' : 'Add your first menu item to get started'}
          </p>
          {!searchTerm && selectedCategory === 'all' && statusFilter === 'all' && foodTypeFilter === 'all' && (
            <button onClick={() => openForm()} className="inline-flex items-center gap-1.5 px-5 py-2.5 text-white rounded-xl text-sm font-medium" style={{ backgroundColor: ZOMATO_RED }}>
              <Plus className="w-4 h-4" /> Add First Item
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {sectionData.map(section => (
            <div key={section.parentId}>
              {/* Variant cards — horizontal row layout matching app */}
              {section.rows.map((row, ri) => {
                const isOff = row._catUnavail || row.available === false || row._parentAvailable === false;
                const toggleKey = row._isVariant ? `${row._parentId}_v${row._variantIndex}` : row._parentId;
                const isToggling = togglingId === toggleKey;
                return (
                  <div key={ri}
                    className={`flex items-center gap-3 bg-white rounded-xl p-2.5 mb-2 border transition-all cursor-pointer hover:shadow-md ${isOff ? 'border-red-100 bg-red-50/30' : 'border-gray-100'}`}
                    onClick={() => openForm(row.parentItem, row._isVariant ? row._variantIndex : null)}>
                    {/* Image */}
                    <div className="w-16 h-16 rounded-xl bg-gray-100 overflow-hidden flex-shrink-0 relative">
                      {(row.image || row._parentImage) ? (
                        <img src={row.image || row._parentImage} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-6 h-6 text-gray-300" /></div>
                      )}
                      {row.foodType && row.foodType !== 'none' && (
                        <span className="absolute top-1 left-1 w-3 h-3 rounded-sm border-2 border-white" style={{ backgroundColor: foodColor(row.foodType) }} />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-gray-800 truncate">{row.label || row.name}</p>
                      {row._isVariant && <p className="text-[11px] text-gray-400 truncate">{row._parentName}</p>}
                      {row.quantities && row.quantities.length > 0 ? (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {row.quantities.map((q, qi) => (
                            <span key={qi} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              q.available === false ? 'bg-red-100 text-red-600 line-through' : 'bg-gray-100 text-gray-600'
                            }`}>{q.quantity} {q.unit} — ₹{q.price}</span>
                          ))}
                        </div>
                      ) : row.price ? (
                        <p className="text-xs text-gray-500 font-medium mt-0.5">₹{row.price}{row.quantity && row.unit ? ` / ${row.quantity} ${row.unit}` : ''}</p>
                      ) : null}
                    </div>

                    {/* Active/Off Toggle + Delete */}
                    <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                      <button onClick={() => toggleVariantAvailability(row)} disabled={isToggling}
                        className={`px-3.5 py-1.5 rounded-full text-[11px] font-bold text-white transition-all disabled:opacity-50 shadow-sm ${
                          isOff ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
                        }`}>
                        {isToggling ? '...' : isOff ? 'Off' : 'Active'}
                      </button>
                      {row._isVariant ? (
                        <button onClick={() => deleteVariant(row._parentId, row._variantIndex)}
                          className="p-1.5 text-gray-300 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button onClick={() => deleteItem(row.parentItem)}
                          className="p-1.5 text-gray-300 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* ═══════════ MODALS ═══════════ */}

      {/* Category Modal */}
      {showCategoryModal && renderCategoryModal()}

      {/* Category Action Modal (right-click) */}
      {categoryActionModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4" onClick={() => setCategoryActionModal(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center gap-3 p-5 border-b border-gray-100">
              <div className="w-12 h-12 rounded-xl bg-gray-100 overflow-hidden flex-shrink-0">
                {categoryActionModal.image ? <img src={categoryActionModal.image} alt="" className="w-full h-full object-cover" /> :
                  <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-5 h-5 text-gray-400" /></div>}
              </div>
              <div className="flex-1">
                <p className="font-bold text-gray-900">{categoryActionModal.name}</p>
                {categoryActionModal.isSoldOut && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-600 text-[10px] font-bold rounded-full">SOLD OUT
                    {categoryActionModal.soldOutSchedule?.enabled && categoryActionModal.soldOutSchedule?.endTime && (
                      <span className="font-medium"> until {formatTime12(categoryActionModal.soldOutSchedule.endTime)}</span>
                    )}
                  </span>
                )}
                {categoryActionModal.schedule?.enabled && categoryActionModal.isPaused && !categoryActionModal.isSoldOut && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-100 text-indigo-600 text-[10px] font-bold rounded-full">
                    <Clock className="w-3 h-3" /> Scheduled
                  </span>
                )}
              </div>
              <button onClick={() => setCategoryActionModal(null)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {/* Actions */}
            <div className="p-2">
              {/* Sold Out / Available */}
              <button onClick={() => { setCategoryActionModal(null); showCategorySoldOutOptions(categoryActionModal); }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-gray-50 transition-colors text-left">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${categoryActionModal.isSoldOut ? 'bg-green-50' : 'bg-red-50'}`}>
                  {categoryActionModal.isSoldOut ? <Check className="w-5 h-5 text-green-600" /> : <Ban className="w-5 h-5 text-red-500" />}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-800">{categoryActionModal.isSoldOut ? 'Mark Available' : 'Mark Sold Out'}</p>
                  <p className="text-xs text-gray-400">{categoryActionModal.isSoldOut ? 'Make available for orders' : 'Temporarily mark as sold out'}</p>
                </div>
                <ChevronDown className="w-4 h-4 text-gray-300 -rotate-90" />
              </button>
              {/* Schedule */}
              <button onClick={() => {
                setCategoryActionModal(null);
                setCategoryScheduleModal(categoryActionModal);
                setCategorySchedule(categoryActionModal.schedule || { enabled: false, type: 'daily', startTime: '09:00', endTime: '22:00', days: [] });
              }} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-gray-50 transition-colors text-left">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-blue-50">
                  <CalendarClock className="w-5 h-5 text-blue-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-800">Schedule</p>
                  <p className="text-xs text-gray-400">Set availability time slots</p>
                </div>
                <ChevronDown className="w-4 h-4 text-gray-300 -rotate-90" />
              </button>
              {/* Edit */}
              <button onClick={() => { setCategoryActionModal(null); openCategoryModal(categoryActionModal); }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-gray-50 transition-colors text-left">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-amber-50">
                  <Edit className="w-5 h-5 text-amber-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-800">Edit Category</p>
                  <p className="text-xs text-gray-400">Change name or image</p>
                </div>
                <ChevronDown className="w-4 h-4 text-gray-300 -rotate-90" />
              </button>
              {/* Delete */}
              <button onClick={() => { setCategoryActionModal(null); deleteCategory(categoryActionModal); }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-red-50 transition-colors text-left">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-red-50">
                  <Trash2 className="w-5 h-5 text-red-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-red-600">Delete Category</p>
                  <p className="text-xs text-gray-400">Remove permanently</p>
                </div>
                <ChevronDown className="w-4 h-4 text-red-300 -rotate-90" />
              </button>
              {/* Pause */}
              <button onClick={() => { setCategoryActionModal(null); toggleCategoryPause(categoryActionModal); }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-gray-50 transition-colors text-left">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gray-100">
                  {categoryActionModal.isPaused ? <Check className="w-5 h-5 text-green-600" /> : <Ban className="w-5 h-5 text-gray-500" />}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-800">{categoryActionModal.isPaused ? 'Resume Category' : 'Pause Category'}</p>
                  <p className="text-xs text-gray-400">{categoryActionModal.isPaused ? 'Resume all items' : 'Pause all items in category'}</p>
                </div>
                <ChevronDown className="w-4 h-4 text-gray-300 -rotate-90" />
              </button>
              {/* Bulk Pause */}
              <button onClick={() => { setCategoryActionModal(null); handleBulkPause(categoryActionModal.name); }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-gray-50 transition-colors text-left">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-purple-50">
                  <Package className="w-5 h-5 text-purple-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-800">Bulk {categoryActionModal.isPaused ? 'Resume' : 'Pause'} Items</p>
                  <p className="text-xs text-gray-400">Toggle all items in this category</p>
                </div>
                <ChevronDown className="w-4 h-4 text-gray-300 -rotate-90" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sold Out Options Modal */}
      {soldOutModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-3">
            <h3 className="text-lg font-bold text-gray-900">{soldOutModal.target?.name}</h3>
            <p className="text-sm text-gray-500">{soldOutModal.allOff ? 'This item is currently sold out.' : 'Choose an action:'}</p>
            <button onClick={() => {
              if (soldOutModal.type === 'item') markVariantsSoldOut(soldOutModal.target._id, false);
              else toggleCategorySoldOut(soldOutModal.target);
              setSoldOutModal(null);
            }} className="w-full py-2.5 bg-green-50 text-green-700 rounded-xl font-medium hover:bg-green-100 transition-colors">
              ✅ Mark Available
            </button>
            {!soldOutModal.allOff && (
              <button onClick={() => {
                if (soldOutModal.type === 'item') markVariantsSoldOut(soldOutModal.target._id, true);
                else toggleCategorySoldOut(soldOutModal.target);
                setSoldOutModal(null);
              }} className="w-full py-2.5 bg-red-50 text-red-700 rounded-xl font-medium hover:bg-red-100 transition-colors">
                🚫 Sold Out Now
              </button>
            )}
            {!soldOutModal.allOff && soldOutModal.type === 'item' && (
              <button onClick={() => {
                const item = soldOutModal.target;
                setSoldOutModal(null);
                openItemScheduleModal(item);
              }} className="w-full py-2.5 bg-orange-50 text-orange-700 rounded-xl font-medium hover:bg-orange-100 transition-colors">
                ⏰ Schedule
              </button>
            )}
            {!soldOutModal.allOff && soldOutModal.type === 'category' && (
              <button onClick={() => {
                setScheduleModal(soldOutModal);
                setScheduleSoldOutTime('');
                setSoldOutModal(null);
              }} className="w-full py-2.5 bg-orange-50 text-orange-700 rounded-xl font-medium hover:bg-orange-100 transition-colors">
                ⏰ Schedule Sold Out
              </button>
            )}
            <button onClick={() => setSoldOutModal(null)} className="w-full py-2 text-gray-500 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Schedule Sold Out Modal (simple time picker for categories) */}
      {scheduleModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Schedule Sold Out</h3>
            <p className="text-sm text-gray-500">Mark as sold out until:</p>
            <input type="time" value={scheduleSoldOutTime} onChange={e => setScheduleSoldOutTime(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm" />
            <div className="flex gap-3">
              <button onClick={() => setScheduleModal(null)} className="flex-1 py-2.5 border border-gray-200 rounded-xl font-medium text-gray-700">Cancel</button>
              <button onClick={handleScheduleSoldOut} disabled={!scheduleSoldOutTime}
                className="flex-1 py-2.5 text-white rounded-xl font-medium disabled:opacity-50" style={{ backgroundColor: ZOMATO_RED }}>Schedule</button>
            </div>
          </div>
        </div>
      )}

      {/* Item Schedule Modal (Daily / Custom — matching mobile app) */}
      {showItemScheduleModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-2">
                {scheduleType && (
                  <button onClick={() => setScheduleType(null)} className="p-1 hover:bg-gray-100 rounded-lg">
                    <ArrowLeft className="w-4 h-4 text-gray-600" />
                  </button>
                )}
                <h3 className="text-lg font-bold text-gray-900">
                  {!scheduleType ? 'Schedule Type' : scheduleType === 'daily' ? 'Daily Schedule' : 'Custom Schedule'}
                </h3>
              </div>
              <button onClick={() => setShowItemScheduleModal(false)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              <p className="font-semibold text-gray-800">{soldOutItem?.name}</p>

              {/* Step 1: Choose type */}
              {!scheduleType && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-500">Choose how to schedule sold-out times.</p>
                  <button onClick={() => setScheduleType('daily')}
                    className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors text-left">
                    <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <Clock className="w-6 h-6 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-gray-800">Daily Schedule</p>
                      <p className="text-xs text-gray-500 mt-0.5">Set one time — applies to all days</p>
                    </div>
                    <ChevronDown className="w-4 h-4 text-gray-400 -rotate-90" />
                  </button>
                  <button onClick={() => setScheduleType('custom')}
                    className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-orange-200 bg-orange-50 hover:bg-orange-100 transition-colors text-left">
                    <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
                      <Calendar className="w-6 h-6 text-orange-600" />
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-gray-800">Custom Schedule</p>
                      <p className="text-xs text-gray-500 mt-0.5">Set different times for each day</p>
                    </div>
                    <ChevronDown className="w-4 h-4 text-gray-400 -rotate-90" />
                  </button>
                  {soldOutItem?.soldOutSchedule?.enabled && (
                    <button onClick={removeItemSchedule} disabled={savingCategory}
                      className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-red-200 bg-red-50 text-red-600 font-medium text-sm hover:bg-red-100 disabled:opacity-50">
                      <Trash2 className="w-4 h-4" /> Remove Schedule
                    </button>
                  )}
                </div>
              )}

              {/* Step 2a: Daily */}
              {scheduleType === 'daily' && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-500">Item will be available only during this time window. Outside this time, it will be sold out.</p>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Available from:</label>
                    <input type="time" value={dailyStartTime} onChange={e => setDailyStartTime(e.target.value)}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Available until:</label>
                    <input type="time" value={dailyEndTime} onChange={e => setDailyEndTime(e.target.value)}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl" />
                  </div>
                  <div className="p-3 bg-orange-50 border border-orange-200 rounded-xl text-sm text-orange-800">
                    ✅ Available daily: {formatTime12(dailyStartTime)} – {formatTime12(dailyEndTime)}<br />
                    🚫 Sold out outside this window
                  </div>
                </div>
              )}

              {/* Step 2b: Custom */}
              {scheduleType === 'custom' && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-500">Enable specific days and set available times for each.</p>
                  {customDays.map((dayItem, dIdx) => (
                    <div key={dayItem.day} className={`rounded-xl border-2 overflow-hidden ${dayItem.enabled ? 'border-green-200 bg-green-50/50' : 'border-gray-200 bg-gray-50'}`}>
                      <button onClick={() => updateCustomDay(dIdx, 'enabled', !dayItem.enabled)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${dayItem.enabled ? 'bg-green-100' : 'bg-gray-100'}`}>
                            <span className={`text-xs font-bold ${dayItem.enabled ? 'text-green-600' : 'text-gray-400'}`}>{dayItem.day}</span>
                          </div>
                          <span className={`text-sm font-semibold ${dayItem.enabled ? 'text-gray-800' : 'text-gray-400'}`}>{DAY_FULL[dayItem.day]}</span>
                        </div>
                        <div className={`w-10 h-5 rounded-full transition-colors relative ${dayItem.enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${dayItem.enabled ? 'left-5' : 'left-0.5'}`} />
                        </div>
                      </button>
                      {dayItem.enabled && (
                        <div className="flex items-center justify-center gap-3 px-4 pb-3">
                          <div className="text-center">
                            <span className="text-[10px] font-semibold text-gray-500 block mb-1">FROM</span>
                            <input type="time" value={dayItem.startTime} onChange={e => updateCustomDay(dIdx, 'startTime', e.target.value)}
                              className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm font-medium" />
                          </div>
                          <span className="text-gray-300 mt-4">→</span>
                          <div className="text-center">
                            <span className="text-[10px] font-semibold text-gray-500 block mb-1">TO</span>
                            <input type="time" value={dayItem.endTime} onChange={e => updateCustomDay(dIdx, 'endTime', e.target.value)}
                              className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm font-medium" />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {scheduleType && (
              <div className="flex gap-3 p-6 border-t border-gray-100 flex-shrink-0">
                <button onClick={() => setShowItemScheduleModal(false)} className="flex-1 py-2.5 border border-gray-200 rounded-xl font-medium text-gray-700">Cancel</button>
                <button onClick={saveItemSoldOutSchedule} disabled={savingCategory}
                  className="flex-1 py-2.5 text-white rounded-xl font-medium disabled:opacity-50" style={{ backgroundColor: ZOMATO_RED }}>
                  {savingCategory ? 'Saving...' : 'Save Schedule'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Category Schedule Modal */}
      {categoryScheduleModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">Schedule: {categoryScheduleModal.name}</h3>
              <button onClick={() => setCategoryScheduleModal(null)} className="p-1 text-gray-400"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Enabled</span>
              <button type="button" onClick={() => setCategorySchedule(p => ({ ...p, enabled: !p.enabled }))}
                className={`w-10 h-5 rounded-full transition-colors relative ${categorySchedule.enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${categorySchedule.enabled ? 'left-5' : 'left-0.5'}`} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Start Time</label>
                <input type="time" value={categorySchedule.startTime} onChange={e => setCategorySchedule(p => ({ ...p, startTime: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">End Time</label>
                <input type="time" value={categorySchedule.endTime} onChange={e => setCategorySchedule(p => ({ ...p, endTime: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <div className="flex gap-2">
                {['daily','specific_days'].map(t => (
                  <button key={t} type="button" onClick={() => setCategorySchedule(p => ({ ...p, type: t }))}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium border-2 ${categorySchedule.type === t ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-200 text-gray-600'}`}>
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
                  }} className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize ${categorySchedule.days?.includes(d) ? 'text-white' : 'bg-gray-100 text-gray-600'}`}
                    style={categorySchedule.days?.includes(d) ? { backgroundColor: ZOMATO_RED } : {}}>
                    {d.slice(0, 3)}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => setCategoryScheduleModal(null)} className="flex-1 py-2.5 border border-gray-200 rounded-xl font-medium text-gray-700">Cancel</button>
              <button onClick={handleSaveCategorySchedule} className="flex-1 py-2.5 text-white rounded-xl font-medium" style={{ backgroundColor: ZOMATO_RED }}>Save Schedule</button>
            </div>
          </div>
        </div>
      )}

      {/* Quantity Toggle Modal */}
      {showQtyModal && qtyModalItem && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">Manage Sizes</h3>
              <button onClick={() => setShowQtyModal(false)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-3">
              <p className="font-semibold text-gray-800">{qtyModalItem.name || qtyModalItem.label}</p>
              <p className="text-sm text-gray-500">Toggle availability for individual sizes.</p>
              {qtyModalItem.quantities?.map((q, qIdx) => {
                const qAvail = q.available !== false;
                return (
                  <button key={qIdx} onClick={() => toggleQuantityAvailability(qtyModalItem, qIdx)}
                    className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all ${
                      qAvail ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                    }`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${qAvail ? 'bg-green-100' : 'bg-red-100'}`}>
                        {qAvail ? <Check className="w-5 h-5 text-green-600" /> : <X className="w-5 h-5 text-red-500" />}
                      </div>
                      <div className="text-left">
                        <p className="font-bold text-gray-800">{q.quantity} {q.unit}</p>
                        <p className="text-sm text-gray-500">₹{q.price}{q.offerPrice ? ` (Offer: ₹${q.offerPrice})` : ''}</p>
                      </div>
                    </div>
                    <span className={`px-4 py-1.5 rounded-full text-xs font-bold text-white ${qAvail ? 'bg-green-500' : 'bg-red-500'}`}>
                      {qAvail ? 'Active' : 'Off'}
                    </span>
                  </button>
                );
              })}
              {/* Toggle All */}
              {qtyModalItem.quantities?.length > 1 && (() => {
                const allAvail = qtyModalItem.quantities.every(q => q.available !== false);
                return (
                  <button onClick={() => {
                    qtyModalItem.quantities.forEach((q, qIdx) => {
                      const isAvail = q.available !== false;
                      if (allAvail ? isAvail : !isAvail) toggleQuantityAvailability(qtyModalItem, qIdx);
                    });
                  }}
                    className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-semibold text-sm ${
                      allAvail ? 'border-red-200 bg-red-50 text-red-600' : 'border-green-200 bg-green-50 text-green-600'
                    }`}>
                    {allAvail ? '⏸ Turn Off All Sizes' : '▶ Turn On All Sizes'}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmDialog && renderConfirmDialog()}

      {/* Toast */}
      {renderToast()}
    </div>
  );
}
