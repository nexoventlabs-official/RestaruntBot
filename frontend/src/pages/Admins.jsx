import { useState, useEffect } from 'react';
import { UserPlus, Trash2, Eye, EyeOff, RefreshCw, Shield, Loader2, X, Check, KeyRound } from 'lucide-react';
import api from '../api';

export default function Admins() {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Add admin form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [creating, setCreating] = useState(false);

  // Reset password modal state
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Delete confirmation state
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    fetchAdmins();
  }, []);

  const fetchAdmins = async () => {
    try {
      setLoading(true);
      const res = await api.get('/admins');
      setAdmins(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load admins');
    } finally {
      setLoading(false);
    }
  };

  const showToast = (type, message) => {
    if (type === 'success') {
      setSuccess(message);
      setTimeout(() => setSuccess(null), 4000);
    } else {
      setError(message);
      setTimeout(() => setError(null), 5000);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim()) {
      showToast('error', 'Username and password are required');
      return;
    }
    if (newPassword.length < 6) {
      showToast('error', 'Password must be at least 6 characters');
      return;
    }

    setCreating(true);
    try {
      const res = await api.post('/admins', {
        username: newUsername.trim(),
        password: newPassword
      });
      setAdmins(prev => [res.data, ...prev]);
      setNewUsername('');
      setNewPassword('');
      setShowAddForm(false);
      showToast('success', `Admin "${res.data.username}" created successfully`);
    } catch (err) {
      showToast('error', err.response?.data?.error || 'Failed to create admin');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (admin) => {
    if (!confirm(`Delete admin "${admin.username}"? This cannot be undone.`)) return;

    setDeletingId(admin._id);
    try {
      await api.delete(`/admins/${admin._id}`);
      setAdmins(prev => prev.filter(a => a._id !== admin._id));
      showToast('success', `Admin "${admin.username}" deleted`);
    } catch (err) {
      showToast('error', err.response?.data?.error || 'Failed to delete admin');
    } finally {
      setDeletingId(null);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!resetPassword.trim() || resetPassword.length < 6) {
      showToast('error', 'Password must be at least 6 characters');
      return;
    }

    setResetting(true);
    try {
      await api.patch(`/admins/${resetTarget._id}/password`, { password: resetPassword });
      setResetTarget(null);
      setResetPassword('');
      showToast('success', `Password reset for "${resetTarget.username}"`);
    } catch (err) {
      showToast('error', err.response?.data?.error || 'Failed to reset password');
    } finally {
      setResetting(false);
    }
  };

  const formatDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-dark-900 flex items-center gap-2">
            <Shield className="w-7 h-7 text-primary-600" />
            Admin Accounts
          </h1>
          <p className="text-dark-500 mt-1">Manage admin users who can log in at <code className="text-primary-600 bg-primary-50 px-2 py-0.5 rounded">/admin</code></p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchAdmins}
            className="flex items-center gap-2 px-4 py-2 bg-dark-100 hover:bg-dark-200 rounded-xl transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl transition-colors shadow-md"
          >
            <UserPlus className="w-4 h-4" />
            Add New Admin
          </button>
        </div>
      </div>

      {/* Success Toast */}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl flex items-center gap-2">
          <Check className="w-5 h-5" />
          {success}
          <button onClick={() => setSuccess(null)} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Error Toast */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center gap-2">
          <X className="w-5 h-5" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Add Admin Form */}
      {showAddForm && (
        <div className="bg-white rounded-2xl shadow-card p-6 border-2 border-primary-100">
          <h2 className="text-lg font-semibold text-dark-900 mb-4 flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary-600" />
            Create New Admin
          </h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-dark-700 mb-2">Username</label>
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="e.g. john_admin"
                className="w-full px-4 py-3 bg-dark-50 border border-dark-200 rounded-xl focus:border-primary-500 focus:bg-white transition-all outline-none"
                disabled={creating}
                required
                minLength={3}
                maxLength={50}
                pattern="[a-zA-Z0-9_.\-]+"
                title="Letters, numbers, underscore, dot, and hyphen only"
              />
              <p className="text-xs text-dark-400 mt-1">3-50 characters. Letters, numbers, _ . - only.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-700 mb-2">Password</label>
              <div className="relative">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="w-full px-4 py-3 pr-12 bg-dark-50 border border-dark-200 rounded-xl focus:border-primary-500 focus:bg-white transition-all outline-none"
                  disabled={creating}
                  required
                  minLength={6}
                  maxLength={128}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-dark-400 hover:text-dark-600"
                >
                  {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              <p className="text-xs text-dark-400 mt-1">The admin will use this password to log in at /admin/login</p>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="submit"
                disabled={creating}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-medium transition-colors disabled:opacity-50"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Create Admin
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setNewUsername('');
                  setNewPassword('');
                }}
                disabled={creating}
                className="px-6 py-3 bg-dark-100 hover:bg-dark-200 text-dark-700 rounded-xl font-medium transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Admins List */}
      {admins.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-card p-12 text-center">
          <Shield className="w-16 h-16 text-dark-200 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-dark-700">No admin accounts yet</h3>
          <p className="text-dark-500 mt-2">Click <span className="font-medium">"Add New Admin"</span> to create your first admin account.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-card overflow-hidden">
          <div className="p-5 border-b border-dark-100">
            <h2 className="text-lg font-semibold text-dark-900">
              {admins.length} Admin{admins.length !== 1 ? 's' : ''}
            </h2>
            <p className="text-sm text-dark-500 mt-1">These accounts can log in at /admin and access all pages except Bot Images, Flow Images, and this Admins page.</p>
          </div>
          <div className="divide-y divide-dark-100">
            {admins.map(admin => (
              <div key={admin._id} className="p-5 hover:bg-dark-50 transition-colors">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-primary-100 flex items-center justify-center">
                      <Shield className="w-6 h-6 text-primary-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-dark-900">{admin.username}</h3>
                      <p className="text-sm text-dark-500">
                        Admin · Created {formatDate(admin.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setResetTarget(admin)}
                      className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg transition-colors"
                      title="Reset password"
                    >
                      <KeyRound className="w-4 h-4" />
                      Reset Password
                    </button>
                    <button
                      onClick={() => handleDelete(admin)}
                      disabled={deletingId === admin._id}
                      className="flex items-center gap-2 px-3 py-2 text-sm bg-red-50 hover:bg-red-100 text-red-700 rounded-lg transition-colors disabled:opacity-50"
                      title="Delete admin"
                    >
                      {deletingId === admin._id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => !resetting && setResetTarget(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-dark-900 flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-blue-600" />
                Reset Password
              </h2>
              <button onClick={() => setResetTarget(null)} disabled={resetting} className="text-dark-400 hover:text-dark-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-dark-500 mb-4">
              Reset password for <span className="font-semibold text-dark-900">{resetTarget.username}</span>
            </p>
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-dark-700 mb-2">New Password</label>
                <div className="relative">
                  <input
                    type={showResetPassword ? 'text' : 'password'}
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full px-4 py-3 pr-12 bg-dark-50 border border-dark-200 rounded-xl focus:border-primary-500 focus:bg-white transition-all outline-none"
                    disabled={resetting}
                    required
                    minLength={6}
                    maxLength={128}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPassword(!showResetPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-dark-400 hover:text-dark-600"
                  >
                    {showResetPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={resetting}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors disabled:opacity-50"
                >
                  {resetting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Update Password
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setResetTarget(null);
                    setResetPassword('');
                  }}
                  disabled={resetting}
                  className="px-4 py-3 bg-dark-100 hover:bg-dark-200 text-dark-700 rounded-xl font-medium transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
