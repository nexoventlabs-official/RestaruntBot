/* eslint-disable no-alert */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Plus, Edit, Trash2, X, Image, Search, Send, Check, ChevronDown, ChevronUp, Upload, Users, Tag, Target } from 'lucide-react';
import api from '../api';

/* ─── helpers ─── */
const foodDot = (ft) =>
  ft === 'veg' ? 'bg-green-500' : ft === 'egg' ? 'bg-yellow-500' : ft === 'nonveg' || ft === 'non-veg' ? 'bg-red-500' : 'bg-gray-300';

const fmtDate = (d) => { if (!d) return ''; return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };

const TEMPLATE_STATUS_CONFIG = {
  approved: { color: '#22C55E', bg: '#DCFCE7', label: '✅ Approved' },
  pending:  { color: '#F59E0B', bg: '#FEF3C7', label: '⏳ Pending Review' },
  rejected: { color: '#EF4444', bg: '#FEE2E2', label: '❌ Rejected' },
  none:     { color: '#6B7280', bg: '#F3F4F6', label: '—  No Template' },
};

const TARGET_LABELS = {
  all: 'All Customers',
  top_percentage: 'Top Spenders %',
  min_spent: 'Min Spent ₹',
  min_orders: 'Min Orders',
};

export default function Offers() {
  /* ═══════════ LIST STATE ═══════════ */
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sendingOffer, setSendingOffer] = useState(null);
  const [retryingTemplate, setRetryingTemplate] = useState(null);
  const [togglingOffer, setTogglingOffer] = useState(null);
  const [detailOffer, setDetailOffer] = useState(null);
  const pollRef = useRef(null);

  /* ═══════════ FORM STATE ═══════════ */
  const [showForm, setShowForm] = useState(false);
  const [editingOffer, setEditingOffer] = useState(null);
  const [offerType, setOfferType] = useState('');
  const [percentage, setPercentage] = useState('');
  const [image, setImage] = useState(null);
  const [newImageFile, setNewImageFile] = useState(null);
  const [newImagePreview, setNewImagePreview] = useState('');
  const [whatsAppImage, setWhatsAppImage] = useState(null);
  const [newWhatsAppFile, setNewWhatsAppFile] = useState(null);
  const [newWhatsAppPreview, setNewWhatsAppPreview] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');

  // Targeting
  const [targetType, setTargetType] = useState('all');
  const [targetPercentage, setTargetPercentage] = useState('10');
  const [targetMinSpent, setTargetMinSpent] = useState('1000');
  const [targetMinOrders, setTargetMinOrders] = useState('3');
  const [customerStats, setCustomerStats] = useState({ total: 0, selected: 0 });
  const [loadingCustomerStats, setLoadingCustomerStats] = useState(false);
  const statsDebounceRef = useRef(null);

  // Items / Categories selection
  const [_categories, setCategories] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [selectedItems, setSelectedItems] = useState([]);
  const [selectedVariants, setSelectedVariants] = useState([]);
  const [selectedQuantities, setSelectedQuantities] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [showItemModal, setShowItemModal] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState(null);
  const [itemSearch, setItemSearch] = useState('');
  const [loadingData, setLoadingData] = useState(false);

  const [saving, setSaving] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);

  /* ═══════════ FETCH OFFERS ═══════════ */
  const fetchOffers = useCallback(async () => {
    try { const r = await api.get('/offers'); setOffers(r.data || []); } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchOffers().finally(() => setLoading(false)); }, [fetchOffers]);

  /* ═══════════ TEMPLATE STATUS POLLING ═══════════ */
  const templateStatusKey = offers.map(o => `${o._id}:${o.templateStatus}`).join(',');
  useEffect(() => {
    const pending = offers.filter(o => o.templateStatus === 'pending');
    if (pending.length === 0) { if (pollRef.current) clearInterval(pollRef.current); return; }

    const poll = async () => {
      let updated = false;
      for (const offer of pending) {
        try {
          const r = await api.get(`/offers/${offer._id}/template-status`);
          if (r.data.templateStatus && r.data.templateStatus !== offer.templateStatus) updated = true;
        } catch { /* ignore */ }
      }
      if (updated) fetchOffers();
    };

    poll();
    pollRef.current = setInterval(poll, 30000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [templateStatusKey, fetchOffers, offers]);

  /* ═══════════ OFFER ACTIONS ═══════════ */
  const toggleActive = async (offer) => {
    setTogglingOffer(offer._id);
    try {
      await api.patch(`/offers/${offer._id}/toggle`);
      setOffers(prev => prev.map(o => o._id === offer._id ? { ...o, isActive: !o.isActive } : o));
    } catch { alert('Failed to toggle'); }
    finally { setTogglingOffer(null); }
  };

  const sendOffer = async (offer) => {
    // Pre-check template status
    if (offer.templateStatus === 'pending') return alert('Template is still waiting for Meta approval. Please wait.');
    if (offer.templateStatus === 'rejected') return alert(`Template was rejected: ${offer.rejectionReason || 'Unknown reason'}. Please retry or edit the offer.`);
    if (!offer.templateStatus || offer.templateStatus === 'none') return alert('No template exists. The system will attempt to create one.');

    const targetLabel = offer.targetType && offer.targetType !== 'all'
      ? `targeted customers (${TARGET_LABELS[offer.targetType] || offer.targetType})`
      : 'ALL customers';

    if (!confirm(`Send this offer to ${targetLabel}?\n\nRecent contacts will get an interactive message, others will get the approved template.`)) return;

    setSendingOffer(offer._id);
    try {
      const r = await api.post(`/offers/${offer._id}/send`);
      const d = r.data;
      alert(`Sent! ${d.sent || 0} delivered, ${d.failed || 0} failed.\nInteractive: ${d.sentViaInteractive || 0}, Template: ${d.sentViaTemplate || 0}`);
      fetchOffers();
    } catch (err) { alert(err.response?.data?.error || 'Failed to send'); }
    finally { setSendingOffer(null); }
  };

  const retryTemplate = async (offer) => {
    if (!confirm('Re-submit this template to Meta for review?')) return;
    setRetryingTemplate(offer._id);
    try {
      await api.post(`/offers/${offer._id}/retry-template`);
      alert('Template re-submitted for review.');
      fetchOffers();
    } catch { alert('Failed to retry'); }
    finally { setRetryingTemplate(null); }
  };

  const deleteOffer = (offer) => {
    setConfirmDialog({
      title: 'Delete Offer?',
      message: 'This will:\n• Remove the offer completely\n• Delete the Meta WhatsApp template\n• Remove offer prices from menu items',
      onConfirm: async () => {
        try {
          await api.delete(`/offers/${offer._id}`);
          setOffers(prev => prev.filter(o => o._id !== offer._id));
          setDetailOffer(null);
        } catch { alert('Failed to delete'); }
        finally { setConfirmDialog(null); }
      },
    });
  };

  /* ═══════════ FORM HELPERS ═══════════ */
  const openForm = async (offer = null) => {
    setLoadingData(true);
    try {
      const [catRes, menuRes] = await Promise.all([api.get('/categories'), api.get('/menu')]);
      setCategories(catRes.data || []);
      setMenuItems(menuRes.data || []);
    } catch { /* ignore */ }
    finally { setLoadingData(false); }

    if (offer) {
      setEditingOffer(offer);
      setOfferType(offer.offerType || '');
      setPercentage(offer.percentage !== null && offer.percentage !== undefined ? offer.percentage.toString() : '');
      setImage(offer.imageMobile || offer.imageTablet || offer.imageDesktop || null);
      setNewImageFile(null); setNewImagePreview('');
      setWhatsAppImage(offer.imageWhatsApp || null);
      setNewWhatsAppFile(null); setNewWhatsAppPreview('');
      setSelectedCategories(offer.appliedCategories || []);
      setSelectedItems(Array.isArray(offer.appliedItems) ? offer.appliedItems.map(i => typeof i === 'string' ? i : i._id) : []);
      setSelectedVariants(offer.appliedVariants || []);
      setSelectedQuantities(offer.appliedQuantities || []);
      setValidFrom(offer.validFrom ? new Date(offer.validFrom).toISOString().slice(0, 16) : '');
      setValidUntil(offer.validUntil ? new Date(offer.validUntil).toISOString().slice(0, 16) : '');
      setTargetType(offer.targetType || 'all');
      setTargetPercentage(offer.targetPercentage?.toString() || '10');
      setTargetMinSpent(offer.targetMinSpent?.toString() || '1000');
      setTargetMinOrders(offer.targetMinOrders?.toString() || '3');
    } else {
      setEditingOffer(null);
      setOfferType(''); setPercentage('');
      setImage(null); setNewImageFile(null); setNewImagePreview('');
      setWhatsAppImage(null); setNewWhatsAppFile(null); setNewWhatsAppPreview('');
      setSelectedCategories([]); setSelectedItems([]); setSelectedVariants([]); setSelectedQuantities([]);
      setValidFrom(''); setValidUntil('');
      setTargetType('all'); setTargetPercentage('10'); setTargetMinSpent('1000'); setTargetMinOrders('3');
    }
    setCustomerStats({ total: 0, selected: 0 });
    setShowForm(true);
  };

  /* ═══════════ CUSTOMER STATS (debounced) ═══════════ */
  useEffect(() => {
    if (!showForm) return;
    if (statsDebounceRef.current) clearTimeout(statsDebounceRef.current);
    if (targetType === 'all') { setCustomerStats({ total: 0, selected: 0 }); return; }

    setLoadingCustomerStats(true);
    statsDebounceRef.current = setTimeout(async () => {
      try {
        let url = '';
        if (targetType === 'top_percentage') url = `/offers/customers/top/${parseInt(targetPercentage) || 10}`;
        else if (targetType === 'min_spent') url = `/offers/customers/min-spent/${parseFloat(targetMinSpent) || 1000}`;
        else if (targetType === 'min_orders') url = `/offers/customers/min-orders/${parseInt(targetMinOrders) || 3}`;
        const r = await api.get(url);
        setCustomerStats({ total: r.data.totalCustomers || 0, selected: r.data.selectedCount || 0 });
      } catch { setCustomerStats({ total: 0, selected: 0 }); }
      finally { setLoadingCustomerStats(false); }
    }, 800);
    return () => { if (statsDebounceRef.current) clearTimeout(statsDebounceRef.current); };
  }, [showForm, targetType, targetPercentage, targetMinSpent, targetMinOrders]);

  /* ═══════════ ITEM SELECTION ═══════════ */
  const filteredMenuItems = useMemo(() => {
    if (!itemSearch.trim()) return menuItems;
    const q = itemSearch.toLowerCase().trim();
    return menuItems.filter(i => i.name.toLowerCase().includes(q) || i.variants?.some(v => v.label?.toLowerCase().includes(q)));
  }, [menuItems, itemSearch]);

  const isVariantSelected = useCallback((itemId, variantIndex) => {
    return selectedItems.includes(itemId) || selectedVariants.includes(`${itemId}_${variantIndex}`);
  }, [selectedItems, selectedVariants]);

  const isQuantitySelected = useCallback((itemId, variantIndex, quantityIndex) => {
    if (selectedItems.includes(itemId)) return true;
    if (selectedVariants.includes(`${itemId}_${variantIndex}`)) return true;
    return selectedQuantities.includes(`${itemId}_${variantIndex}_${quantityIndex}`);
  }, [selectedItems, selectedVariants, selectedQuantities]);

  const toggleItem = useCallback((itemId) => {
    const item = menuItems.find(i => i._id === itemId);
    if (!item) return;
    const cats = Array.isArray(item.category) ? item.category : [item.category].filter(Boolean);

    if (selectedItems.includes(itemId)) {
      // Deselect item
      const newItems = selectedItems.filter(id => id !== itemId);
      const newVariants = selectedVariants.filter(v => !v.startsWith(`${itemId}_`));
      setSelectedItems(newItems);
      setSelectedVariants(newVariants);
      setSelectedQuantities(prev => prev.filter(q => !q.startsWith(`${itemId}_`)));
      // Auto-demote categories
      cats.forEach(catName => {
        const catItems = menuItems.filter(m => (Array.isArray(m.category) ? m.category : [m.category]).includes(catName));
        const allSelected = catItems.every(m => m._id === itemId ? false : newItems.includes(m._id));
        if (!allSelected) setSelectedCategories(prev => prev.filter(c => c !== catName));
      });
    } else {
      // Select item (clears individual variant selections)
      const newItems = [...selectedItems, itemId];
      const newVariants = selectedVariants.filter(v => !v.startsWith(`${itemId}_`));
      setSelectedItems(newItems);
      setSelectedVariants(newVariants);
      setSelectedQuantities(prev => prev.filter(q => !q.startsWith(`${itemId}_`)));
      // Auto-promote categories
      cats.forEach(catName => {
        const catItems = menuItems.filter(m => (Array.isArray(m.category) ? m.category : [m.category]).includes(catName));
        const allSelected = catItems.every(m => newItems.includes(m._id));
        if (allSelected && !selectedCategories.includes(catName)) setSelectedCategories(prev => [...prev, catName]);
      });
    }
  }, [menuItems, selectedItems, selectedVariants, selectedCategories]);

  const toggleVariant = useCallback((itemId, variantIndex) => {
    const item = menuItems.find(i => i._id === itemId);
    if (!item) return;
    const key = `${itemId}_${variantIndex}`;
    const totalV = item.variants?.length || 0;

    if (selectedItems.includes(itemId)) {
      // Parent is fully selected → uncheck this variant, move others to selectedVariants
      const newItems = selectedItems.filter(id => id !== itemId);
      const otherKeys = [];
      for (let i = 0; i < totalV; i++) { if (i !== variantIndex) otherKeys.push(`${itemId}_${i}`); }
      setSelectedItems(newItems);
      setSelectedVariants(prev => [...prev.filter(v => !v.startsWith(`${itemId}_`)), ...otherKeys]);
      // Clear quantity selections for this item (others promoted to variant level)
      setSelectedQuantities(prev => prev.filter(q => !q.startsWith(`${itemId}_`)));
    } else if (selectedVariants.includes(key)) {
      // Deselect this variant and its quantities
      setSelectedVariants(prev => prev.filter(v => v !== key));
      setSelectedQuantities(prev => prev.filter(q => !q.startsWith(`${key}_`)));
    } else {
      // Select this variant (all its quantities) — check if all now selected → upgrade to parent
      const newVariants = [...selectedVariants, key];
      const selectedCount = newVariants.filter(v => v.startsWith(`${itemId}_`)).length;
      // Also clear any individual quantity selections for this variant (promoted to variant level)
      setSelectedQuantities(prev => prev.filter(q => !q.startsWith(`${key}_`)));
      if (selectedCount >= totalV) {
        setSelectedItems(prev => [...prev, itemId]);
        setSelectedVariants(prev => prev.filter(v => !v.startsWith(`${itemId}_`)));
      } else {
        setSelectedVariants(newVariants);
      }
    }
  }, [menuItems, selectedItems, selectedVariants]);

  const toggleQuantity = useCallback((itemId, variantIndex, quantityIndex) => {
    const item = menuItems.find(i => i._id === itemId);
    if (!item) return;
    const variant = item.variants?.[variantIndex];
    if (!variant) return;
    const vKey = `${itemId}_${variantIndex}`;
    const qKey = `${itemId}_${variantIndex}_${quantityIndex}`;
    const totalQ = variant.quantities?.length || 0;
    const totalV = item.variants?.length || 0;

    if (selectedItems.includes(itemId)) {
      // Item fully selected → demote to individual variants, then demote this variant to individual quantities minus this one
      const newItems = selectedItems.filter(id => id !== itemId);
      const otherVariantKeys = [];
      for (let i = 0; i < totalV; i++) { if (i !== variantIndex) otherVariantKeys.push(`${itemId}_${i}`); }
      // For the affected variant, add all quantities except this one
      const otherQuantityKeys = [];
      for (let i = 0; i < totalQ; i++) { if (i !== quantityIndex) otherQuantityKeys.push(`${itemId}_${variantIndex}_${i}`); }
      setSelectedItems(newItems);
      setSelectedVariants(prev => [...prev.filter(v => !v.startsWith(`${itemId}_`)), ...otherVariantKeys]);
      setSelectedQuantities(prev => [...prev.filter(q => !q.startsWith(`${itemId}_`)), ...otherQuantityKeys]);
    } else if (selectedVariants.includes(vKey)) {
      // Variant fully selected → demote to individual quantities minus this one
      const otherQuantityKeys = [];
      for (let i = 0; i < totalQ; i++) { if (i !== quantityIndex) otherQuantityKeys.push(`${itemId}_${variantIndex}_${i}`); }
      setSelectedVariants(prev => prev.filter(v => v !== vKey));
      setSelectedQuantities(prev => [...prev.filter(q => !q.startsWith(`${vKey}_`)), ...otherQuantityKeys]);
    } else if (selectedQuantities.includes(qKey)) {
      // Deselect this quantity
      setSelectedQuantities(prev => prev.filter(q => q !== qKey));
    } else {
      // Select this quantity — check for promotions
      const newQuantities = [...selectedQuantities, qKey];
      const selectedQCount = newQuantities.filter(q => q.startsWith(`${vKey}_`)).length;
      if (selectedQCount >= totalQ) {
        // All quantities selected → promote to variant level
        const cleanedQuantities = newQuantities.filter(q => !q.startsWith(`${vKey}_`));
        const newVariants = [...selectedVariants, vKey];
        const selectedVCount = newVariants.filter(v => v.startsWith(`${itemId}_`)).length;
        if (selectedVCount >= totalV) {
          // All variants selected → promote to item level
          setSelectedItems(prev => [...prev, itemId]);
          setSelectedVariants(prev => prev.filter(v => !v.startsWith(`${itemId}_`)));
          setSelectedQuantities(cleanedQuantities.filter(q => !q.startsWith(`${itemId}_`)));
        } else {
          setSelectedVariants(newVariants);
          setSelectedQuantities(cleanedQuantities);
        }
      } else {
        setSelectedQuantities(newQuantities);
      }
    }
  }, [menuItems, selectedItems, selectedVariants, selectedQuantities]);

  const selectAll = useCallback(() => {
    const ids = filteredMenuItems.map(i => i._id);
    const allSelected = ids.every(id => selectedItems.includes(id));
    if (allSelected) {
      setSelectedItems(prev => prev.filter(id => !ids.includes(id)));
      setSelectedVariants(prev => prev.filter(v => !ids.some(id => v.startsWith(`${id}_`))));
      setSelectedQuantities(prev => prev.filter(q => !ids.some(id => q.startsWith(`${id}_`))));
      setSelectedCategories([]);
    } else {
      setSelectedItems(prev => [...new Set([...prev, ...ids])]);
      setSelectedVariants(prev => prev.filter(v => !ids.some(id => v.startsWith(`${id}_`))));
      setSelectedQuantities(prev => prev.filter(q => !ids.some(id => q.startsWith(`${id}_`))));
      // Add all categories
      const allCats = new Set();
      filteredMenuItems.forEach(i => (Array.isArray(i.category) ? i.category : [i.category]).forEach(c => allCats.add(c)));
      setSelectedCategories(prev => [...new Set([...prev, ...allCats])]);
    }
  }, [filteredMenuItems, selectedItems]);

  const totalSelected = useMemo(() => {
    let count = 0;
    selectedItems.forEach(id => {
      const item = menuItems.find(i => i._id === id);
      count += item?.variants?.length || 1;
    });
    count += selectedVariants.length;
    // Count individual quantity selections (only those not already covered by variant/item)
    count += selectedQuantities.length;
    return count;
  }, [selectedItems, selectedVariants, selectedQuantities, menuItems]);

  /* ═══════════ SCHEDULE QUICK BUTTONS ═══════════ */
  const setNow = () => setValidFrom(new Date().toISOString().slice(0, 16));
  const addDays = (days) => {
    if (!validFrom) return;
    const d = new Date(validFrom); d.setDate(d.getDate() + days);
    setValidUntil(d.toISOString().slice(0, 16));
  };
  const addMonth = () => {
    if (!validFrom) return;
    const d = new Date(validFrom); d.setMonth(d.getMonth() + 1);
    setValidUntil(d.toISOString().slice(0, 16));
  };

  /* ═══════════ FORM SUBMIT ═══════════ */
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!image && !newImageFile) return alert('Please add a banner image.');
    if (!offerType.trim()) return alert('Please enter an offer type.');
    if (percentage && (isNaN(percentage) || parseFloat(percentage) <= 0 || parseFloat(percentage) > 100))
      return alert('Percentage must be between 1 and 100.');

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('isActive', 'true');
      fd.append('offerType', offerType.trim());
      if (percentage) fd.append('percentage', percentage);
      if (validFrom) fd.append('validFrom', new Date(validFrom).toISOString());
      if (validUntil) fd.append('validUntil', new Date(validUntil).toISOString());
      if (selectedItems.length > 0) fd.append('appliedItems', JSON.stringify(selectedItems));
      if (selectedVariants.length > 0) fd.append('appliedVariants', JSON.stringify(selectedVariants));
      if (selectedQuantities.length > 0) fd.append('appliedQuantities', JSON.stringify(selectedQuantities));
      if (selectedCategories.length > 0) fd.append('appliedCategories', JSON.stringify(selectedCategories));
      fd.append('targetType', targetType);
      if (targetType === 'top_percentage') fd.append('targetPercentage', targetPercentage);
      else if (targetType === 'min_spent') fd.append('targetMinSpent', targetMinSpent);
      else if (targetType === 'min_orders') fd.append('targetMinOrders', targetMinOrders);

      if (newImageFile) {
        fd.append('imageMobile', newImageFile);
        fd.append('imageTablet', newImageFile);
        fd.append('imageDesktop', newImageFile);
      }

      if (newWhatsAppFile) {
        fd.append('imageWhatsApp', newWhatsAppFile);
      }

      // Optimistic UI: close form immediately and add placeholder to list
      const optimisticOffer = {
        _id: `temp_${Date.now()}`,
        offerType: offerType.trim(),
        percentage: percentage ? parseFloat(percentage) : null,
        isActive: true,
        templateStatus: 'pending',
        validFrom: validFrom ? new Date(validFrom).toISOString() : null,
        validUntil: validUntil ? new Date(validUntil).toISOString() : null,
        targetType,
        createdAt: new Date().toISOString(),
        imageMobile: newImagePreview || image,
        imageTablet: newImagePreview || image,
        imageDesktop: newImagePreview || image,
        _optimistic: true,
      };

      if (editingOffer) {
        // For edits, update the existing offer in the list optimistically
        setOffers(prev => prev.map(o => o._id === editingOffer._id ? { ...o, offerType: offerType.trim(), percentage: percentage ? parseFloat(percentage) : o.percentage, _optimistic: true } : o));
      } else {
        // For create, add placeholder to list
        setOffers(prev => [optimisticOffer, ...prev]);
      }
      setShowForm(false);
      setSaving(false);

      // Process in background
      let res;
      if (editingOffer) {
        res = await api.put(`/offers/${editingOffer._id}`, fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 90000 });
      } else {
        res = await api.post('/offers', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 90000 });
      }

      // Refresh with real data from server
      fetchOffers();
    } catch (err) {
      // Remove optimistic entry on failure and show error
      if (!editingOffer) {
        setOffers(prev => prev.filter(o => !o._optimistic));
      }
      fetchOffers();
      if (err.code === 'ECONNABORTED') alert('Upload timed out. Check your internet connection and try again.');
      else alert(err.response?.data?.error || 'Failed to save offer');
    }
  };

  /* ═══════════ LOADING ═══════════ */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  /* ═══════════ RENDER ═══════════ */
  return (
    <div className="space-y-4">
      {/* ── HEADER ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark-900">Offers</h1>
          <p className="text-dark-500 mt-0.5">{offers.length} offers</p>
        </div>
        <button onClick={() => openForm()} className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-colors">
          <Plus className="w-4 h-4" /> Create Offer
        </button>
      </div>

      {/* ── STATS ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: offers.length, color: 'text-dark-900' },
          { label: 'Active', value: offers.filter(o => o.isActive).length, color: 'text-green-600' },
          { label: 'Approved', value: offers.filter(o => o.templateStatus === 'approved').length, color: 'text-blue-600' },
          { label: 'Pending', value: offers.filter(o => o.templateStatus === 'pending').length, color: 'text-yellow-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl p-3 shadow-card text-center">
            <p className="text-dark-400 text-xs">{s.label}</p>
            <p className={`text-xl font-bold mt-0.5 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* ── OFFER CARDS ── */}
      {offers.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center">
          <Tag className="w-16 h-16 text-dark-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-dark-900 mb-2">No Offers Yet</h3>
          <p className="text-dark-500">Create your first offer to attract customers.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {offers.map(offer => {
            const ts = TEMPLATE_STATUS_CONFIG[offer.templateStatus] || TEMPLATE_STATUS_CONFIG.none;
            const imgUrl = offer.imageMobile || offer.imageTablet || offer.imageDesktop;
            return (
              <div key={offer._id} className={`bg-white rounded-2xl overflow-hidden shadow-card hover:shadow-lg transition-all ${offer._optimistic ? 'relative' : ''}`}>
                {/* Saving overlay for optimistic entries */}
                {offer._optimistic && (
                  <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-10 flex items-center justify-center rounded-2xl">
                    <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl shadow-lg">
                      <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm font-medium text-dark-700">Saving...</span>
                    </div>
                  </div>
                )}
                {/* Image */}
                <div className="relative aspect-[19/6] bg-dark-100 cursor-pointer" onClick={() => setDetailOffer(offer)}>
                  {imgUrl ? <img src={`${imgUrl}?t=${offer.updatedAt || ''}`} alt="" className="w-full h-full object-cover" /> :
                    <div className="w-full h-full flex items-center justify-center"><Image className="w-8 h-8 text-dark-300" /></div>}
                  {/* Badges */}
                  <span className={`absolute top-2 left-2 px-2 py-0.5 rounded-lg text-[10px] font-bold ${offer.isActive ? 'bg-green-500 text-white' : 'bg-dark-500 text-white'}`}>
                    {offer.isActive ? 'Active' : 'Inactive'}
                  </span>
                  {offer.offerType && (
                    <span className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/60 text-white rounded text-[10px] font-medium">{offer.offerType}</span>
                  )}
                </div>

                {/* Template status bar */}
                <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium" style={{ backgroundColor: ts.bg, color: ts.color }}>
                  <span className="flex-1">{ts.label}</span>
                  {offer.templateStatus === 'pending' && <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />}
                  {offer.broadcastSentAt && <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[9px]">Sent</span>}
                  {offer.templateStatus === 'rejected' && (
                    <button onClick={(e) => { e.stopPropagation(); retryTemplate(offer); }} disabled={retryingTemplate === offer._id}
                      className="px-2 py-0.5 bg-red-100 text-red-600 rounded text-[10px] font-bold hover:bg-red-200 disabled:opacity-50">
                      {retryingTemplate === offer._id ? '...' : 'Retry'}
                    </button>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 px-3 py-2.5 border-t border-dark-100">
                  <button onClick={() => sendOffer(offer)} disabled={sendingOffer === offer._id}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-green-50 text-green-700 rounded-lg text-xs font-medium hover:bg-green-100 disabled:opacity-50">
                    <Send className="w-3.5 h-3.5" />
                    {sendingOffer === offer._id ? 'Sending...' : offer.targetType && offer.targetType !== 'all' ? '🎯 Send' : 'Send'}
                  </button>
                  <button onClick={() => toggleActive(offer)} disabled={togglingOffer === offer._id}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${offer.isActive ? 'bg-green-100 text-green-700 hover:bg-red-100 hover:text-red-700' : 'bg-dark-100 text-dark-600 hover:bg-green-100 hover:text-green-700'} disabled:opacity-50`}>
                    {togglingOffer === offer._id ? '...' : offer.isActive ? 'On' : 'Off'}
                  </button>
                  <button onClick={() => openForm(offer)} className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg"><Edit className="w-4 h-4" /></button>
                  <button onClick={() => deleteOffer(offer)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══════════ OFFER DETAIL MODAL ═══════════ */}
      {detailOffer && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-dark-100 flex-shrink-0">
              <h3 className="text-lg font-bold text-dark-900">Offer Details</h3>
              <button onClick={() => setDetailOffer(null)} className="p-2 hover:bg-dark-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {/* Image */}
              {(detailOffer.imageMobile || detailOffer.imageTablet) && (
                <div className="aspect-[19/6] rounded-xl overflow-hidden bg-dark-100">
                  <img src={detailOffer.imageMobile || detailOffer.imageTablet || detailOffer.imageDesktop} alt="" className="w-full h-full object-cover" />
                </div>
              )}
              {/* Status chips */}
              <div className="flex gap-2 flex-wrap">
                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${detailOffer.isActive ? 'bg-green-100 text-green-700' : 'bg-dark-100 text-dark-500'}`}>
                  {detailOffer.isActive ? 'Active' : 'Inactive'}
                </span>
                {(() => { const ts = TEMPLATE_STATUS_CONFIG[detailOffer.templateStatus] || TEMPLATE_STATUS_CONFIG.none; return (
                  <span className="px-2.5 py-1 rounded-lg text-xs font-bold" style={{ backgroundColor: ts.bg, color: ts.color }}>{ts.label}</span>
                ); })()}
              </div>
              {/* Fields */}
              <div className="space-y-3">
                <div><p className="text-xs text-dark-400">Offer Type</p><p className="text-sm font-semibold text-dark-900">{detailOffer.offerType || '—'}</p></div>
                {detailOffer.percentage && <div><p className="text-xs text-dark-400">Discount</p><p className="text-sm font-semibold text-dark-900">{detailOffer.percentage}%</p></div>}
                {detailOffer.appliedCategories?.length > 0 && (
                  <div>
                    <p className="text-xs text-dark-400 mb-1">Categories</p>
                    <div className="flex flex-wrap gap-1">{detailOffer.appliedCategories.map(c => <span key={c} className="px-2 py-0.5 bg-primary-50 text-primary-700 rounded text-xs font-medium">{c}</span>)}</div>
                  </div>
                )}
                <div><p className="text-xs text-dark-400">Applied Items</p><p className="text-sm font-semibold text-dark-900">{detailOffer.appliedItems?.length || 0} items, {detailOffer.appliedVariants?.length || 0} variants</p></div>
                <div><p className="text-xs text-dark-400">Target</p><p className="text-sm font-semibold text-dark-900">{TARGET_LABELS[detailOffer.targetType] || 'All'}{detailOffer.targetedCustomers ? ` (${detailOffer.targetedCustomers} customers)` : ''}</p></div>
                {detailOffer.validFrom && <div><p className="text-xs text-dark-400">Valid From</p><p className="text-sm text-dark-700">{fmtDate(detailOffer.validFrom)}</p></div>}
                {detailOffer.validUntil && <div><p className="text-xs text-dark-400">Valid Until</p><p className="text-sm text-dark-700">{fmtDate(detailOffer.validUntil)}</p></div>}
                {detailOffer.createdAt && <div><p className="text-xs text-dark-400">Created</p><p className="text-sm text-dark-700">{fmtDate(detailOffer.createdAt)}</p></div>}
                {detailOffer.broadcastSentAt && <div><p className="text-xs text-dark-400">Broadcast Sent</p><p className="text-sm text-dark-700">{fmtDate(detailOffer.broadcastSentAt)}</p></div>}
                {detailOffer.rejectionReason && <div><p className="text-xs text-red-500">Rejection Reason</p><p className="text-sm text-red-700">{detailOffer.rejectionReason}</p></div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ CREATE/EDIT FORM MODAL ═══════════ */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="border-b border-dark-100 px-6 py-4 flex items-center justify-between flex-shrink-0">
              <h2 className="text-xl font-bold text-dark-900">{editingOffer ? 'Edit Offer' : 'Create Offer'}</h2>
              <button onClick={() => setShowForm(false)} className="p-2 hover:bg-dark-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
              {/* Banner Image (19:6) */}
              <div>
                <label className="block text-sm font-semibold text-dark-700 mb-1">Banner Image <span className="text-red-500">*</span> <span className="text-xs text-dark-400">(19:6 ratio)</span></label>
                <div className="aspect-[19/6] rounded-xl bg-dark-100 overflow-hidden relative group cursor-pointer">
                  {(newImagePreview || image) ? (
                    <>
                      <img src={newImagePreview || image} alt="" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                        <label className="cursor-pointer px-3 py-2 bg-white/90 rounded-lg text-sm font-medium text-dark-700">
                          Change <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files[0]; if (f) { setNewImageFile(f); setNewImagePreview(URL.createObjectURL(f)); }}} className="hidden" />
                        </label>
                        <button type="button" onClick={() => { setNewImageFile(null); setNewImagePreview(''); setImage(null); }}
                          className="px-3 py-2 bg-red-500/90 text-white rounded-lg text-sm font-medium">Remove</button>
                      </div>
                    </>
                  ) : (
                    <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer hover:bg-dark-200 transition-colors">
                      <Upload className="w-8 h-8 text-dark-300 mb-2" />
                      <span className="text-sm text-dark-500">Upload Banner</span>
                      <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files[0]; if (f) { setNewImageFile(f); setNewImagePreview(URL.createObjectURL(f)); }}} className="hidden" />
                    </label>
                  )}
                </div>
              </div>

              {/* WhatsApp Image (1:1) */}
              <div>
                <label className="block text-sm font-semibold text-dark-700 mb-1">WhatsApp Image <span className="text-xs text-dark-400">(1:1 ratio, for WhatsApp & Popup)</span></label>
                <div className="w-40 aspect-square rounded-xl bg-dark-100 overflow-hidden relative group cursor-pointer">
                  {(newWhatsAppPreview || whatsAppImage) ? (
                    <>
                      <img src={newWhatsAppPreview || whatsAppImage} alt="" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <label className="cursor-pointer px-2 py-1.5 bg-white/90 rounded-lg text-xs font-medium text-dark-700">
                          Change <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files[0]; if (f) { setNewWhatsAppFile(f); setNewWhatsAppPreview(URL.createObjectURL(f)); }}} className="hidden" />
                        </label>
                        <button type="button" onClick={() => { setNewWhatsAppFile(null); setNewWhatsAppPreview(''); setWhatsAppImage(null); }}
                          className="px-2 py-1.5 bg-red-500/90 text-white rounded-lg text-xs font-medium">Remove</button>
                      </div>
                    </>
                  ) : (
                    <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer hover:bg-dark-200 transition-colors">
                      <Upload className="w-6 h-6 text-dark-300 mb-1" />
                      <span className="text-xs text-dark-500">Upload 1:1</span>
                      <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files[0]; if (f) { setNewWhatsAppFile(f); setNewWhatsAppPreview(URL.createObjectURL(f)); }}} className="hidden" />
                    </label>
                  )}
                </div>
              </div>

              {/* Offer Type */}
              <div>
                <label className="block text-sm font-semibold text-dark-700 mb-1">Offer Type <span className="text-red-500">*</span></label>
                <input type="text" value={offerType} onChange={e => setOfferType(e.target.value)}
                  className="w-full px-4 py-3 bg-dark-50 border border-dark-200 rounded-xl text-sm" placeholder='e.g., "1+1 Offer", "Buy 2 Get 1", "50% Off"' />
              </div>

              {/* Discount % */}
              <div>
                <label className="block text-sm font-semibold text-dark-700 mb-1">Discount % <span className="text-xs text-dark-400">(optional)</span></label>
                <div className="relative">
                  <input type="number" value={percentage} onChange={e => setPercentage(e.target.value)} min="1" max="100" step="1"
                    className="w-full px-4 py-3 bg-dark-50 border border-dark-200 rounded-xl text-sm pr-10" placeholder="e.g., 20" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-400 font-bold">%</span>
                </div>
              </div>

              {/* Apply Offer To */}
              <div className="bg-dark-50/50 border border-dark-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Tag className="w-5 h-5 text-primary-500" />
                  <h4 className="text-sm font-bold text-dark-800">Apply Offer To</h4>
                </div>
                <p className="text-xs text-dark-400">
                  {percentage && percentage.trim()
                    ? `Select categories and items to apply ${percentage}% discount`
                    : 'Select categories and items for this offer'}
                </p>
                <button type="button" onClick={() => setShowItemModal(true)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-dark-200 rounded-xl hover:border-primary-300 transition-all">
                  <Search className="w-4 h-4 text-primary-500" />
                  <span className="flex-1 text-left text-sm text-dark-600">
                    {(selectedItems.length > 0 || selectedVariants.length > 0)
                      ? `${selectedItems.length} item(s), ${selectedVariants.length} variant(s) selected`
                      : 'Select Items'}
                  </span>
                  <ChevronDown className="w-4 h-4 text-dark-400" />
                </button>
                {selectedCategories.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selectedCategories.map(c => <span key={c} className="px-2 py-0.5 bg-primary-100 text-primary-700 rounded text-xs font-medium">{c}</span>)}
                  </div>
                )}
                {(selectedItems.length > 0 || selectedVariants.length > 0) && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-green-50 rounded-lg">
                    <Check className="w-4 h-4 text-green-500" />
                    <p className="text-xs text-green-700 font-medium">
                      {percentage && percentage.trim()
                        ? `${percentage}% discount will be applied to ${selectedItems.length} item(s) & ${selectedVariants.length} variant(s)`
                        : `Offer will apply to ${selectedItems.length} item(s) & ${selectedVariants.length} variant(s)`}
                    </p>
                  </div>
                )}
              </div>

              {/* Customer Targeting */}
              <div>
                <label className="block text-sm font-semibold text-dark-700 mb-2">Target Audience</label>
                <div className="space-y-2">
                  {[
                    { type: 'all', label: 'All Customers', icon: Users, desc: 'Send to everyone' },
                    { type: 'top_percentage', label: 'Top Spenders %', icon: Target, desc: 'Top spending customers' },
                    { type: 'min_spent', label: 'Min Spent ₹', icon: Target, desc: 'Customers who spent at least' },
                    { type: 'min_orders', label: 'Min Orders', icon: Target, desc: 'Customers with minimum orders' },
                  ].map(opt => (
                    <div key={opt.type}>
                      <button type="button" onClick={() => setTargetType(opt.type)}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${targetType === opt.type ? 'border-primary-500 bg-primary-50' : 'border-dark-200 hover:border-dark-300'}`}>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${targetType === opt.type ? 'border-primary-500' : 'border-dark-300'}`}>
                          {targetType === opt.type && <div className="w-2.5 h-2.5 rounded-full bg-primary-500" />}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-dark-800">{opt.label}</p>
                          <p className="text-[11px] text-dark-400">{opt.desc}</p>
                        </div>
                      </button>
                      {/* Inline input for targeting params */}
                      {targetType === opt.type && opt.type === 'top_percentage' && (
                        <div className="ml-11 mt-2">
                          <input type="number" value={targetPercentage} onChange={e => setTargetPercentage(e.target.value)} min="1" max="100"
                            className="w-32 px-3 py-2 bg-dark-50 border border-dark-200 rounded-lg text-sm" placeholder="10" />
                          <span className="text-xs text-dark-400 ml-2">%</span>
                        </div>
                      )}
                      {targetType === opt.type && opt.type === 'min_spent' && (
                        <div className="ml-11 mt-2">
                          <span className="text-xs text-dark-400 mr-1">₹</span>
                          <input type="number" value={targetMinSpent} onChange={e => setTargetMinSpent(e.target.value)} min="0"
                            className="w-32 px-3 py-2 bg-dark-50 border border-dark-200 rounded-lg text-sm" placeholder="1000" />
                        </div>
                      )}
                      {targetType === opt.type && opt.type === 'min_orders' && (
                        <div className="ml-11 mt-2">
                          <input type="number" value={targetMinOrders} onChange={e => setTargetMinOrders(e.target.value)} min="1"
                            className="w-32 px-3 py-2 bg-dark-50 border border-dark-200 rounded-lg text-sm" placeholder="3" />
                          <span className="text-xs text-dark-400 ml-2">orders</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {/* Stats */}
                {targetType !== 'all' && (
                  <div className="mt-3 px-3 py-2 bg-blue-50 rounded-lg">
                    {loadingCustomerStats ? (
                      <div className="flex items-center gap-2 text-xs text-blue-600">
                        <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /> Calculating...
                      </div>
                    ) : (
                      <p className="text-xs text-blue-700 font-medium">
                        {customerStats.selected} of {customerStats.total} customers will see this offer
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Schedule */}
              <div>
                <label className="block text-sm font-semibold text-dark-700 mb-2">Schedule</label>
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-xs text-dark-500">Valid From</label>
                      <button type="button" onClick={setNow} className="px-2 py-0.5 bg-primary-50 text-primary-600 rounded text-[10px] font-medium hover:bg-primary-100">Now</button>
                    </div>
                    <input type="datetime-local" value={validFrom} onChange={e => setValidFrom(e.target.value)}
                      className="w-full px-4 py-2.5 bg-dark-50 border border-dark-200 rounded-xl text-sm" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-xs text-dark-500">Valid Until</label>
                      {validFrom && (
                        <>
                          <button type="button" onClick={() => addDays(1)} className="px-2 py-0.5 bg-dark-100 text-dark-600 rounded text-[10px] font-medium hover:bg-dark-200">+1d</button>
                          <button type="button" onClick={() => addDays(7)} className="px-2 py-0.5 bg-dark-100 text-dark-600 rounded text-[10px] font-medium hover:bg-dark-200">+7d</button>
                          <button type="button" onClick={addMonth} className="px-2 py-0.5 bg-dark-100 text-dark-600 rounded text-[10px] font-medium hover:bg-dark-200">+1m</button>
                        </>
                      )}
                    </div>
                    <input type="datetime-local" value={validUntil} onChange={e => setValidUntil(e.target.value)}
                      className="w-full px-4 py-2.5 bg-dark-50 border border-dark-200 rounded-xl text-sm" />
                  </div>
                  {validFrom && validUntil && (
                    <p className="text-xs text-dark-500 bg-dark-50 rounded-lg px-3 py-2">
                      Active from <strong>{fmtDate(validFrom)}</strong> to <strong>{fmtDate(validUntil)}</strong>
                    </p>
                  )}
                </div>
              </div>

              {/* Submit */}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="flex-1 px-4 py-3 border border-dark-200 rounded-xl font-medium text-dark-700 hover:bg-dark-50">Cancel</button>
                <button type="submit" disabled={saving}
                  className="flex-1 px-4 py-3 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center gap-2">
                  {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving...</> : editingOffer ? 'Update Offer' : 'Create Offer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════ ITEM SELECTION MODAL ═══════════ */}
      {showItemModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="border-b border-dark-100 px-5 py-4 flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-bold text-dark-900">Select Items ({totalSelected})</h3>
              <div className="flex items-center gap-2">
                <button type="button" onClick={selectAll} className="px-3 py-1.5 bg-primary-50 text-primary-600 rounded-lg text-xs font-medium hover:bg-primary-100">
                  {filteredMenuItems.every(i => selectedItems.includes(i._id)) ? 'Deselect All' : 'Select All'}
                </button>
                <button onClick={() => setShowItemModal(false)} className="p-2 hover:bg-dark-100 rounded-lg"><X className="w-5 h-5" /></button>
              </div>
            </div>
            {/* Search */}
            <div className="px-5 py-3 border-b border-dark-100">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
                <input type="text" value={itemSearch} onChange={e => setItemSearch(e.target.value)} placeholder="Search items..."
                  className="w-full pl-10 pr-4 py-2 bg-dark-50 border border-dark-200 rounded-lg text-sm" />
              </div>
            </div>
            {/* Items list */}
            <div className="overflow-y-auto flex-1 px-5 py-3 space-y-2">
              {loadingData ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-3 border-primary-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filteredMenuItems.length === 0 ? (
                <p className="text-center text-dark-500 py-8">No items found.</p>
              ) : (
                filteredMenuItems.map(item => {
                  const isFullySelected = selectedItems.includes(item._id);
                  const hasVariants = item.variants && item.variants.length > 0;
                  const isExpanded = expandedItemId === item._id;
                  const anyVariantSelected = selectedVariants.some(v => v.startsWith(`${item._id}_`));

                  return (
                    <div key={item._id} className="border border-dark-200 rounded-xl overflow-hidden">
                      {/* Item header */}
                      <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-dark-50 transition-colors">
                        <button type="button" onClick={() => toggleItem(item._id)}
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                            isFullySelected ? 'bg-primary-500 border-primary-500' : anyVariantSelected ? 'bg-primary-200 border-primary-400' : 'border-dark-300 hover:border-dark-400'
                          }`}>
                          {isFullySelected && <Check className="w-3 h-3 text-white" />}
                          {!isFullySelected && anyVariantSelected && <div className="w-2 h-2 bg-primary-500 rounded-sm" />}
                        </button>
                        <div className="w-9 h-9 rounded-lg bg-dark-100 overflow-hidden flex-shrink-0">
                          {item.image ? <img src={item.image} alt="" className="w-full h-full object-cover" /> :
                            <div className="w-full h-full flex items-center justify-center"><Image className="w-4 h-4 text-dark-300" /></div>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-dark-800 truncate">{item.name}</p>
                          <p className="text-[10px] text-dark-400">{hasVariants ? `${item.variants.length} variants` : '1 item'}</p>
                        </div>
                        {hasVariants && (
                          <button type="button" onClick={() => setExpandedItemId(isExpanded ? null : item._id)}
                            className="p-1 hover:bg-dark-100 rounded">
                            {isExpanded ? <ChevronUp className="w-4 h-4 text-dark-400" /> : <ChevronDown className="w-4 h-4 text-dark-400" />}
                          </button>
                        )}
                      </div>

                      {/* Variant rows */}
                      {hasVariants && isExpanded && (
                        <div className="border-t border-dark-100">
                          {item.variants.map((v, vi) => {
                            const vSelected = isVariantSelected(item._id, vi);
                            const ft = v.foodType || item.foodType;
                            const pctNum = parseFloat(percentage);
                            const hasDiscount = !isNaN(pctNum) && pctNum > 0;
                            const hasQuantities = v.quantities && v.quantities.length > 0;
                            // Check if variant has any quantity selected (even partially)
                            const hasAnyQtySelected = hasQuantities && v.quantities.some((_, qi) => isQuantitySelected(item._id, vi, qi));
                            return (
                              <div key={vi}>
                                <div className="flex items-center gap-3 px-3 py-2.5 pl-10 border-b border-dark-50 last:border-0 hover:bg-dark-50/50 cursor-pointer"
                                  onClick={() => toggleVariant(item._id, vi)}>
                                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                                      vSelected ? 'bg-primary-500 border-primary-500' : hasAnyQtySelected ? 'bg-primary-300 border-primary-300' : 'border-dark-300 hover:border-dark-400'
                                    }`}>
                                    {vSelected && <Check className="w-3 h-3 text-white" />}
                                    {!vSelected && hasAnyQtySelected && <div className="w-2 h-0.5 bg-white rounded" />}
                                  </div>
                                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${foodDot(ft)}`} />
                                  <div className="w-8 h-8 rounded-lg bg-dark-100 overflow-hidden flex-shrink-0">
                                    {v.image ? <img src={v.image} alt="" className="w-full h-full object-cover" /> : null}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-dark-700 truncate">{v.label || `Variant ${vi + 1}`}</p>
                                    {!hasQuantities && v.price ? (
                                      <p className="text-[11px] text-dark-500">
                                        {hasDiscount && vSelected ? (
                                          <><span className="line-through text-dark-400">₹{v.price}</span> <span className="text-green-600 font-bold">₹{Math.round(v.price * (1 - pctNum / 100))}</span> <span className="text-green-500 text-[9px]">({Math.round(pctNum)}% OFF)</span></>
                                        ) : `₹${v.price}`}
                                      </p>
                                    ) : hasQuantities ? (
                                      <p className="text-[11px] text-dark-400">{v.quantities.length} sizes</p>
                                    ) : null}
                                  </div>
                                  {vSelected && <span className="px-2.5 py-0.5 bg-green-50 text-green-600 text-[10px] font-semibold rounded-full">Active</span>}
                                </div>
                                {/* Quantity/size sub-rows with checkboxes */}
                                {hasQuantities && (
                                  <div className="bg-dark-50/30">
                                    {v.quantities.map((q, qi) => {
                                      const origPrice = parseFloat(q.price);
                                      const offerPrice = hasDiscount ? Math.round(origPrice * (1 - pctNum / 100)) : null;
                                      const qSelected = isQuantitySelected(item._id, vi, qi);
                                      return (
                                        <div key={qi} className="flex items-center gap-3 px-3 py-2 pl-16 border-b border-dark-50/50 last:border-0 hover:bg-dark-100/30 cursor-pointer"
                                          onClick={() => toggleQuantity(item._id, vi, qi)}>
                                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                                            qSelected ? 'bg-primary-500 border-primary-500' : 'border-dark-300'
                                          }`}>
                                            {qSelected && <Check className="w-2.5 h-2.5 text-white" />}
                                          </div>
                                          <span className="text-[11px] font-medium text-dark-600 flex-1">{q.quantity} {q.unit}</span>
                                          <span className="text-[11px] text-dark-500">
                                            {offerPrice !== null && qSelected ? (
                                              <><span className="line-through text-dark-400">₹{q.price}</span>{' '}<span className="text-green-600 font-bold">₹{offerPrice}</span></>
                                            ) : `₹${q.price}`}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            <div className="border-t border-dark-100 px-5 py-3 flex items-center justify-between flex-shrink-0">
              <p className="text-sm text-dark-500">{totalSelected} variants selected</p>
              <button type="button" onClick={() => setShowItemModal(false)}
                className="px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ CONFIRM DIALOG ═══════════ */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-lg font-bold text-dark-900">{confirmDialog.title}</h3>
            <p className="text-sm text-dark-500 whitespace-pre-line">{confirmDialog.message}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDialog(null)} className="flex-1 py-2.5 border border-dark-200 rounded-xl font-medium text-dark-700">Cancel</button>
              <button onClick={confirmDialog.onConfirm} className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
