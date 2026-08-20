import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, X, Check, Tag } from 'lucide-react';
import api from '../api';

export default function SubCategories() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null); // { _id, name } or null
  const [saving, setSaving] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), type === 'error' ? 4000 : 2500);
  };

  const load = useCallback(async () => {
    try { const r = await api.get('/subcategories'); setList(r.data || []); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const n = name.trim();
    if (!n) return;
    setSaving(true);
    try {
      if (editing) await api.put(`/subcategories/${editing._id}`, { name: n });
      else await api.post('/subcategories', { name: n });
      showToast('✅ Saved', 'success');
      setName(''); setEditing(null);
      await load();
    } catch (err) { showToast('❌ ' + (err.response?.data?.error || 'Failed to save'), 'error'); }
    finally { setSaving(false); }
  };

  const startEdit = (s) => { setEditing(s); setName(s.name); };
  const cancelEdit = () => { setEditing(null); setName(''); };

  const remove = (s) => {
    setConfirmDialog({
      title: 'Delete Sub-Category?',
      message: `Delete "${s.name}"? It will be removed from the picker (existing products keep their saved tags until re-saved).`,
      onConfirm: async () => {
        setConfirmDialog(null);
        try { await api.delete(`/subcategories/${s._id}`); showToast('✅ Deleted', 'success'); await load(); }
        catch { showToast('❌ Failed to delete', 'error'); }
      }
    });
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
      <div>
        <h1 className="text-2xl font-bold text-dark-900">Sub Categories</h1>
        <p className="text-dark-500 mt-0.5">Tags like “Spicy”, “Crispy” you can assign to product variants.</p>
      </div>

      {/* Add / edit form */}
      <div className="bg-white rounded-2xl shadow-card p-4 flex items-center gap-3 max-w-xl">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); }}
          placeholder="e.g. Spicy"
          className="flex-1 px-4 py-2.5 bg-dark-50 border border-dark-200 rounded-xl text-sm focus:border-primary-500"
        />
        {editing && (
          <button onClick={cancelEdit} className="px-3 py-2.5 text-dark-500 text-sm">Cancel</button>
        )}
        <button onClick={save} disabled={saving || !name.trim()}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
          {editing ? <><Check className="w-4 h-4" /> Update</> : <><Plus className="w-4 h-4" /> Add</>}
        </button>
      </div>

      {/* List */}
      {list.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center">
          <Tag className="w-14 h-14 text-dark-300 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-dark-900 mb-1">No Sub-Categories Yet</h3>
          <p className="text-dark-500">Add one above (e.g. Spicy, Crispy).</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {list.map(s => (
            <div key={s._id} className="group flex items-center gap-2 bg-white border border-dark-200 rounded-full pl-4 pr-2 py-1.5 shadow-sm">
              <span className="text-sm font-medium text-dark-700">{s.name}</span>
              <button onClick={() => startEdit(s)} className="p-1 text-dark-400 hover:text-blue-500 rounded-full hover:bg-blue-50"><Edit className="w-3.5 h-3.5" /></button>
              <button onClick={() => remove(s)} className="p-1 text-dark-400 hover:text-red-500 rounded-full hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
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
