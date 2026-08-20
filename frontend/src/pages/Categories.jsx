import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, X, FolderPlus, Pause, Play, Ban, CalendarClock } from 'lucide-react';
import api from '../api';

export default function Categories() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [saving, setSaving] = useState(false);

  const [confirmDialog, setConfirmDialog] = useState(null);
  const [scheduleModal, setScheduleModal] = useState(null);
  const [schedule, setSchedule] = useState({ enabled: false, type: 'daily', startTime: '09:00', endTime: '22:00', days: [] });
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), type === 'error' ? 4000 : 2500);
  };

  const load = useCallback(async () => {
    try { const r = await api.get('/categories'); setList(r.data || []); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setEditing(null); setForm({ name: '', description: '' });
    setImageFile(null); setImagePreview(''); setShowModal(true);
  };
  const openEdit = (c) => {
    setEditing(c); setForm({ name: c.name, description: c.description || '' });
    setImageFile(null); setImagePreview(c.image || ''); setShowModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('name', form.name.trim());
      if (form.description) fd.append('description', form.description);
      if (imageFile) fd.append('image', imageFile);
      else if (editing && !imagePreview) fd.append('removeImage', 'true');
      if (editing) await api.put(`/categories/${editing._id}`, fd, { timeout: 60000 });
      else await api.post('/categories', fd, { timeout: 60000 });
      showToast('✅ Category saved', 'success');
      setShowModal(false); setEditing(null);
      await load();
    } catch (err) { showToast('❌ ' + (err.response?.data?.error || 'Failed to save'), 'error'); }
    finally { setSaving(false); }
  };

  const remove = (c) => {
    setConfirmDialog({
      title: 'Delete Category?',
      message: `Delete "${c.name}"? Items only in this category will also be removed.`,
      onConfirm: async () => {
        setConfirmDialog(null);
        try { await api.delete(`/categories/${c._id}`); showToast('✅ Category deleted', 'success'); await load(); }
        catch { showToast('❌ Failed to delete', 'error'); }
      }
    });
  };

  const togglePause = async (c) => {
    setBusyId(c._id);
    try { await api.patch(`/categories/${c._id}/toggle-pause`); await load(); }
    catch { showToast('❌ Failed', 'error'); }
    finally { setBusyId(null); }
  };

  const toggleSoldOut = async (c) => {
    setBusyId(c._id);
    try { await api.patch(`/categories/${c._id}/toggle-soldout`); await load(); }
    catch { showToast('❌ Failed', 'error'); }
    finally { setBusyId(null); }
  };

  const openSchedule = (c) => {
    setScheduleModal(c);
    setSchedule(c.schedule || { enabled: false, type: 'daily', startTime: '09:00', endTime: '22:00', days: [] });
  };

  const saveSchedule = async () => {
    try { await api.patch(`/categories/${scheduleModal._id}/schedule`, schedule); setScheduleModal(null); await load(); }
    catch { showToast('❌ Failed to save schedule', 'error'); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark-900">Categories</h1>
          <p className="text-dark-500 mt-0.5">{list.length} categories · used across storefront &amp; WhatsApp catalog</p>
        </div>
        <button onClick={openNew} className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-colors">
          <Plus className="w-4 h-4" /> Add Category
        </button>
      </div>

      {/* Grid */}
      {list.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center">
          <FolderPlus className="w-16 h-16 text-dark-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-dark-900 mb-2">No Categories Yet</h3>
          <p className="text-dark-500">Click “Add Category” to create your first one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {list.map(c => {
            const paused = c.isPaused || c.isSoldOut;
            return (
              <div key={c._id} className="bg-white rounded-2xl overflow-hidden shadow-card border border-dark-100">
                <div className="relative w-full aspect-square bg-dark-100">
                  {c.image
                    ? <img src={c.image} alt={c.name} className="absolute inset-0 w-full h-full object-cover" />
                    : <div className="absolute inset-0 flex items-center justify-center"><FolderPlus className="w-10 h-10 text-dark-300" /></div>}
                  {paused && (
                    <span className="absolute top-2 left-2 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase bg-red-500 text-white">
                      {c.isSoldOut ? 'Sold Out' : 'Paused'}
                    </span>
                  )}
                  {c.schedule?.enabled && (
                    <span className="absolute bottom-2 left-2 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase bg-blue-500 text-white">Scheduled</span>
                  )}
                </div>
                <div className="p-3">
                  <p className="font-semibold text-sm text-dark-800 truncate">{c.name}</p>
                  <div className="flex items-center gap-1 mt-2">
                    <button onClick={() => togglePause(c)} disabled={busyId === c._id}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-medium bg-blue-50 text-blue-600 hover:bg-blue-100"
                      title={c.isPaused ? 'Resume' : 'Pause'}>
                      {c.isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => toggleSoldOut(c)} disabled={busyId === c._id}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-medium bg-orange-50 text-orange-600 hover:bg-orange-100"
                      title={c.isSoldOut ? 'Mark available' : 'Sold out'}>
                      <Ban className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => openSchedule(c)}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-medium bg-purple-50 text-purple-600 hover:bg-purple-100"
                      title="Schedule">
                      <CalendarClock className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => openEdit(c)}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-medium bg-dark-50 text-dark-600 hover:bg-dark-100"
                      title="Edit">
                      <Edit className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => remove(c)}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-medium bg-red-50 text-red-600 hover:bg-red-100"
                      title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-dark-900">{editing ? 'Edit Category' : 'New Category'}</h2>
              <button onClick={() => { setShowModal(false); setEditing(null); }} className="p-2 hover:bg-dark-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-xl bg-dark-100 overflow-hidden flex-shrink-0">
                {imagePreview
                  ? <img src={imagePreview} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center"><FolderPlus className="w-6 h-6 text-dark-300" /></div>}
              </div>
              <div className="flex flex-col gap-2">
                <label className="cursor-pointer px-3 py-2 bg-primary-50 text-primary-600 rounded-lg text-sm font-medium hover:bg-primary-100 w-fit">
                  {imagePreview ? 'Change Image' : 'Upload Image'}
                  <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files[0]; if (f) { setImageFile(f); setImagePreview(URL.createObjectURL(f)); } }} className="hidden" />
                </label>
                {imagePreview && <button type="button" onClick={() => { setImageFile(null); setImagePreview(''); }} className="text-xs text-red-500 text-left">Remove</button>}
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-dark-700 mb-1">Name <span className="text-red-500">*</span></label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full px-4 py-3 bg-dark-50 border border-dark-200 rounded-xl text-sm" placeholder="e.g. Biryani" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-dark-700 mb-1">Description</label>
              <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                className="w-full px-4 py-3 bg-dark-50 border border-dark-200 rounded-xl text-sm" placeholder="Optional" />
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => { setShowModal(false); setEditing(null); }} className="flex-1 py-3 border border-dark-200 rounded-xl font-medium text-dark-700 hover:bg-dark-50">Cancel</button>
              <button onClick={save} disabled={saving || !form.name.trim()} className="flex-1 py-3 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 disabled:opacity-50">
                {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Category'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule modal */}
      {scheduleModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-dark-900">Schedule: {scheduleModal.name}</h3>
            <div className="flex items-center justify-between">
              <span className="text-sm text-dark-700">Enabled</span>
              <button type="button" onClick={() => setSchedule(p => ({ ...p, enabled: !p.enabled }))}
                className={`w-10 h-5 rounded-full transition-colors relative ${schedule.enabled ? 'bg-green-500' : 'bg-dark-300'}`}>
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${schedule.enabled ? 'left-5' : 'left-0.5'}`} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-dark-500 mb-1.5 uppercase">Start</label>
                <input type="time" value={schedule.startTime} onChange={e => setSchedule(p => ({ ...p, startTime: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-white border-2 border-dark-200 rounded-xl text-sm font-semibold text-dark-800 focus:border-primary-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-dark-500 mb-1.5 uppercase">End</label>
                <input type="time" value={schedule.endTime} onChange={e => setSchedule(p => ({ ...p, endTime: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-white border-2 border-dark-200 rounded-xl text-sm font-semibold text-dark-800 focus:border-primary-500" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-dark-500 mb-1">Type</label>
              <div className="flex gap-2">
                {['daily','specific_days'].map(t => (
                  <button key={t} type="button" onClick={() => setSchedule(p => ({ ...p, type: t }))}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium border ${schedule.type === t ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-dark-200 text-dark-600'}`}>
                    {t === 'daily' ? 'Daily' : 'Specific Days'}
                  </button>
                ))}
              </div>
            </div>
            {schedule.type === 'specific_days' && (
              <div className="flex flex-wrap gap-1.5">
                {['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].map(d => (
                  <button key={d} type="button" onClick={() => {
                    const days = schedule.days?.includes(d) ? schedule.days.filter(x => x !== d) : [...(schedule.days || []), d];
                    setSchedule(p => ({ ...p, days }));
                  }} className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize ${schedule.days?.includes(d) ? 'bg-primary-500 text-white' : 'bg-dark-100 text-dark-600'}`}>
                    {d.slice(0, 3)}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => setScheduleModal(null)} className="flex-1 py-2.5 border border-dark-200 rounded-xl font-medium text-dark-700">Cancel</button>
              <button onClick={saveSchedule} className="flex-1 py-2.5 bg-primary-600 text-white rounded-xl font-medium">Save Schedule</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-lg font-bold text-dark-900">{confirmDialog.title}</h3>
            <p className="text-sm text-dark-500">{confirmDialog.message}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDialog(null)} className="flex-1 py-2.5 border border-dark-200 rounded-xl font-medium text-dark-700">Cancel</button>
              <button onClick={confirmDialog.onConfirm} className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
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
