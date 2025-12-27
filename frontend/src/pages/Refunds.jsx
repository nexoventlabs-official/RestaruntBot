import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle, X, Clock, AlertCircle, CreditCard, Phone, Package } from 'lucide-react';
import api from '../api';
import Dialog from '../components/Dialog';

const refundStatusConfig = {
  scheduled: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500', label: 'Pending Approval' },
  pending: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500', label: 'Pending' },
  approved: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500', label: 'Approved' },
  completed: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', dot: 'bg-green-500', label: 'Completed' },
  rejected: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', dot: 'bg-red-500', label: 'Rejected' },
  failed: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', dot: 'bg-red-500', label: 'Failed' },
};

const RefundSkeleton = () => (
  <div className="bg-white rounded-2xl shadow-card overflow-hidden animate-pulse">
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="h-5 w-28 bg-dark-100 rounded"></div>
        <div className="h-6 w-24 bg-dark-100 rounded-lg"></div>
      </div>
      <div className="space-y-2">
        <div className="h-4 w-full bg-dark-100 rounded"></div>
        <div className="h-4 w-3/4 bg-dark-100 rounded"></div>
      </div>
      <div className="flex gap-2">
        <div className="h-10 flex-1 bg-dark-100 rounded-xl"></div>
        <div className="h-10 flex-1 bg-dark-100 rounded-xl"></div>
      </div>
    </div>
  </div>
);

export default function Refunds() {
  const [refunds, setRefunds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [filter, setFilter] = useState('pending'); // pending, completed, rejected, all
  
  // Dialog states
  const [dialog, setDialog] = useState({ isOpen: false, title: '', message: '', type: 'info', onConfirm: null, showCancel: false });
  const [rejectDialog, setRejectDialog] = useState({ isOpen: false, orderId: null, reason: '' });

  const fetchRefunds = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get(`/orders/refunds?status=${filter}`);
      setRefunds(res.data?.orders || []);
    } catch (err) {
      console.error('Failed to fetch refunds:', err);
      setRefunds([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchRefunds();
  }, [fetchRefunds]);

  // SSE for real-time updates
  useEffect(() => {
    let eventSource = null;
    const connect = () => {
      const baseUrl = api.defaults.baseURL?.replace('/api', '') || '';
      eventSource = new EventSource(`${baseUrl}/api/events`);
      eventSource.onmessage = (event) => {
        try {
          const { type } = JSON.parse(event.data);
          if (type === 'orders') fetchRefunds();
        } catch (e) {}
      };
      eventSource.onerror = () => {
        eventSource?.close();
        setTimeout(connect, 3000);
      };
    };
    connect();
    return () => eventSource?.close();
  }, [fetchRefunds]);

  const approveRefund = async (orderId) => {
    if (processingId) return;
    
    setDialog({
      isOpen: true,
      title: 'Approve Refund',
      message: `Are you sure you want to approve the refund for order ${orderId}? This will process the refund via Razorpay.`,
      type: 'confirm',
      showCancel: true,
      onConfirm: async () => {
        setDialog(prev => ({ ...prev, isOpen: false }));
        setProcessingId(orderId);
        try {
          // Use longer timeout for refund operations (60 seconds)
          await api.post(`/orders/${orderId}/refund/approve`, {}, { timeout: 60000 });
          setDialog({
            isOpen: true,
            title: 'Refund Approved',
            message: 'The refund has been successfully processed.',
            type: 'success',
            showCancel: false,
            onConfirm: () => setDialog(prev => ({ ...prev, isOpen: false }))
          });
          fetchRefunds();
        } catch (err) {
          // Check if it's a timeout error - refund might still be processing
          const isTimeout = err.code === 'ECONNABORTED' || err.message?.includes('timeout');
          setDialog({
            isOpen: true,
            title: isTimeout ? 'Processing' : 'Refund Failed',
            message: isTimeout 
              ? 'Refund is taking longer than expected. Please check the status in a moment.'
              : (err.response?.data?.error || 'Failed to approve refund. Please try again.'),
            type: isTimeout ? 'warning' : 'error',
            showCancel: false,
            onConfirm: () => {
              setDialog(prev => ({ ...prev, isOpen: false }));
              fetchRefunds();
            }
          });
        } finally {
          setProcessingId(null);
        }
      }
    });
  };

  const openRejectDialog = (orderId) => {
    if (processingId) return;
    setRejectDialog({ isOpen: true, orderId, reason: '' });
  };

  const handleRejectConfirm = async () => {
    const { orderId, reason } = rejectDialog;
    setRejectDialog(prev => ({ ...prev, isOpen: false }));
    setProcessingId(orderId);
    
    try {
      await api.post(`/orders/${orderId}/refund/reject`, { reason: reason || 'Rejected by admin' });
      setDialog({
        isOpen: true,
        title: 'Refund Rejected',
        message: 'The refund request has been rejected.',
        type: 'success',
        showCancel: false,
        onConfirm: () => setDialog(prev => ({ ...prev, isOpen: false }))
      });
      fetchRefunds();
    } catch (err) {
      setDialog({
        isOpen: true,
        title: 'Rejection Failed',
        message: err.response?.data?.error || 'Failed to reject refund. Please try again.',
        type: 'error',
        showCancel: false,
        onConfirm: () => setDialog(prev => ({ ...prev, isOpen: false }))
      });
    } finally {
      setProcessingId(null);
    }
  };

  const rejectRefund = (orderId) => openRejectDialog(orderId);

  const pendingCount = refunds.filter(r => r.refundStatus === 'scheduled' || r.refundStatus === 'pending').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg">
            <RefreshCw className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-dark-900">Refund Requests</h1>
            <p className="text-sm text-dark-400">{pendingCount} pending approval</p>
          </div>
        </div>
        
        {/* Filter Tabs */}
        <div className="flex gap-2 bg-dark-100 p-1 rounded-xl">
          {[
            { value: 'pending', label: 'Pending' },
            { value: 'completed', label: 'Completed' },
            { value: 'rejected', label: 'Rejected' },
            { value: 'all', label: 'All' },
          ].map(tab => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                filter === tab.value 
                  ? 'bg-white text-dark-900 shadow-sm' 
                  : 'text-dark-500 hover:text-dark-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Refunds List */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
          <RefundSkeleton />
          <RefundSkeleton />
          <RefundSkeleton />
        </div>
      ) : refunds.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-card p-12 text-center">
          <div className="w-20 h-20 bg-dark-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <RefreshCw className="w-10 h-10 text-dark-300" />
          </div>
          <h3 className="text-lg font-semibold text-dark-700">No refund requests</h3>
          <p className="text-dark-400 mt-1">
            {filter === 'pending' ? 'No pending refunds to approve' : 'No refunds found'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
          {refunds.map(order => {
            const config = refundStatusConfig[order.refundStatus] || refundStatusConfig.pending;
            const isPending = order.refundStatus === 'scheduled' || order.refundStatus === 'pending';
            const isProcessing = processingId === order.orderId;
            
            return (
              <div key={order._id} className="bg-white rounded-2xl shadow-card overflow-hidden hover:shadow-lg transition-shadow">
                {/* Header */}
                <div className="px-5 py-4 border-b border-dark-100">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-lg ${config.bg} flex items-center justify-center`}>
                        <RefreshCw className={`w-4 h-4 ${config.text}`} />
                      </div>
                      <div>
                        <p className="font-bold text-dark-900 text-sm">{order.orderId}</p>
                        <p className="text-xs text-dark-400">
                          {new Date(order.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${config.bg} ${config.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`}></span>
                      {config.label}
                    </span>
                  </div>
                  
                  {/* Customer Info */}
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 bg-gradient-to-br from-primary-100 to-primary-200 rounded-full flex items-center justify-center">
                      <span className="text-xs font-bold text-primary-700">
                        {(order.customer?.name || 'C')[0].toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-dark-800 truncate">{order.customer?.name || 'Customer'}</p>
                      <div className="flex items-center gap-1 text-xs text-dark-400">
                        <Phone className="w-3 h-3" />
                        {order.customer?.phone}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Content */}
                <div className="p-5 space-y-4">
                  {/* Refund Amount */}
                  <div className="bg-amber-50 rounded-xl p-4 text-center">
                    <p className="text-xs text-amber-600 font-medium mb-1">Refund Amount</p>
                    <p className="text-2xl font-bold text-amber-700">₹{order.refundAmount || order.totalAmount}</p>
                  </div>

                  {/* Order Details */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-dark-400">Order Total</span>
                      <span className="font-medium text-dark-700">₹{order.totalAmount}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-dark-400">Payment Method</span>
                      <span className="font-medium text-dark-700 flex items-center gap-1">
                        <CreditCard className="w-3.5 h-3.5" />
                        {order.paymentMethod?.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-dark-400">Payment ID</span>
                      <span className="font-mono text-xs text-dark-500 truncate max-w-[150px]">
                        {order.razorpayPaymentId || order.paymentId || 'N/A'}
                      </span>
                    </div>
                    {order.cancellationReason && (
                      <div className="pt-2 border-t border-dark-100">
                        <p className="text-xs text-dark-400 mb-1">Cancellation Reason</p>
                        <p className="text-sm text-dark-600">{order.cancellationReason}</p>
                      </div>
                    )}
                  </div>

                  {/* Items Preview */}
                  <div className="bg-dark-50 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Package className="w-3.5 h-3.5 text-dark-400" />
                      <span className="text-xs font-semibold text-dark-500 uppercase">Items</span>
                    </div>
                    <div className="space-y-1">
                      {order.items?.slice(0, 2).map((item, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <span className="text-dark-600 truncate">{item.quantity}x {item.name}</span>
                          <span className="text-dark-400">₹{item.price * item.quantity}</span>
                        </div>
                      ))}
                      {order.items?.length > 2 && (
                        <p className="text-xs text-dark-400">+{order.items.length - 2} more</p>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  {isPending && (
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => approveRefund(order.orderId)}
                        disabled={isProcessing}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                      >
                        {isProcessing ? (
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <CheckCircle className="w-4 h-4" />
                        )}
                        Approve
                      </button>
                      <button
                        onClick={() => rejectRefund(order.orderId)}
                        disabled={isProcessing}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-dark-200 text-dark-600 rounded-xl text-sm font-medium hover:bg-dark-50 transition-all disabled:opacity-50"
                      >
                        <X className="w-4 h-4" />
                        Reject
                      </button>
                    </div>
                  )}

                  {/* Completed/Rejected Info */}
                  {order.refundStatus === 'completed' && order.refundId && (
                    <div className="bg-green-50 rounded-xl p-3">
                      <div className="flex items-center gap-2 text-green-700">
                        <CheckCircle className="w-4 h-4" />
                        <span className="text-sm font-medium">Refund Processed</span>
                      </div>
                      <p className="text-xs text-green-600 mt-1 font-mono">{order.refundId}</p>
                    </div>
                  )}

                  {order.refundStatus === 'failed' && (
                    <div className="bg-red-50 rounded-xl p-3">
                      <div className="flex items-center gap-2 text-red-700">
                        <AlertCircle className="w-4 h-4" />
                        <span className="text-sm font-medium">Refund Failed</span>
                      </div>
                      <p className="text-xs text-red-600 mt-1">Please try again or process manually</p>
                      <button
                        onClick={() => approveRefund(order.orderId)}
                        disabled={isProcessing}
                        className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                      >
                        Retry Refund
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Approve/Error/Success Dialog */}
      <Dialog
        isOpen={dialog.isOpen}
        onClose={() => setDialog(prev => ({ ...prev, isOpen: false }))}
        title={dialog.title}
        message={dialog.message}
        type={dialog.type}
        onConfirm={dialog.onConfirm}
        showCancel={dialog.showCancel}
        confirmText={dialog.type === 'confirm' ? 'Approve' : 'OK'}
      />

      {/* Reject Dialog with Input */}
      <Dialog
        isOpen={rejectDialog.isOpen}
        onClose={() => setRejectDialog(prev => ({ ...prev, isOpen: false }))}
        title="Reject Refund"
        message={`Are you sure you want to reject the refund for order ${rejectDialog.orderId}?`}
        type="warning"
        onConfirm={handleRejectConfirm}
        showCancel={true}
        confirmText="Reject"
        showInput={true}
        inputValue={rejectDialog.reason}
        onInputChange={(value) => setRejectDialog(prev => ({ ...prev, reason: value }))}
        inputPlaceholder="Enter rejection reason (optional)"
      />
    </div>
  );
}
