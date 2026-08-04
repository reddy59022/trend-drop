import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { formatPrice } from '../utils/helpers';
import { toast } from 'react-toastify';
import { 
  FaArrowLeft, FaTruck, FaShieldAlt, FaCheckCircle, FaTimesCircle, 
  FaClock, FaBoxOpen, FaExclamationTriangle, FaUndo, FaFileInvoiceDollar,
  FaSpinner, FaStar, FaRegStar, FaLock, FaHandshake, FaFileContract, FaCopy
} from 'react-icons/fa';

const StatusBadge = ({ status }) => {
  const statusConfig = {
    'pending': { color: '#f59e0b', bg: '#fffbeb', icon: FaClock, label: 'Pending' },
    'paid': { color: '#3b82f6', bg: '#eff6ff', icon: FaFileInvoiceDollar, label: 'Paid' },
    'confirmed': { color: '#059669', bg: '#ecfdf5', icon: FaCheckCircle, label: 'Confirmed' },
    'partially_shipped': { color: '#8b5cf6', bg: '#f5f3ff', icon: FaTruck, label: 'Partially Shipped' },
    'shipped': { color: '#8b5cf6', bg: '#f5f3ff', icon: FaTruck, label: 'Shipped' },
    'in_transit': { color: '#8b5cf6', bg: '#f5f3ff', icon: FaTruck, label: 'In Transit' },
    'out_for_delivery': { color: '#f59e0b', bg: '#fffbeb', icon: FaTruck, label: 'Out for Delivery' },
    'delivered': { color: '#10b981', bg: '#ecfdf5', icon: FaCheckCircle, label: 'Delivered' },
    'completed': { color: '#059669', bg: '#ecfdf5', icon: FaCheckCircle, label: 'Completed' },
    'buyer_confirmed': { color: '#059669', bg: '#ecfdf5', icon: FaCheckCircle, label: 'Confirmed' },
    'cancelled': { color: '#ef4444', bg: '#fef2f2', icon: FaTimesCircle, label: 'Cancelled' },
    'cancelled_by_buyer': { color: '#ef4444', bg: '#fef2f2', icon: FaTimesCircle, label: 'Cancelled' },
    'cancelled_by_seller': { color: '#ef4444', bg: '#fef2f2', icon: FaTimesCircle, label: 'Cancelled by Seller' },
    'refunded': { color: '#f59e0b', bg: '#fffbeb', icon: FaUndo, label: 'Refunded' },
    'return_requested': { color: '#f59e0b', bg: '#fffbeb', icon: FaUndo, label: 'Return Requested' },
    'return_accepted': { color: '#8b5cf6', bg: '#f5f3ff', icon: FaUndo, label: 'Return Accepted' },
    'return_in_transit': { color: '#8b5cf6', bg: '#f5f3ff', icon: FaTruck, label: 'Return In Transit' },
    'return_delivered': { color: '#10b981', bg: '#ecfdf5', icon: FaCheckCircle, label: 'Return Received' },
    'chargeback_open': { color: '#ef4444', bg: '#fef2f2', icon: FaExclamationTriangle, label: 'Dispute' },
    'chargeback_won': { color: '#10b981', bg: '#ecfdf5', icon: FaCheckCircle, label: 'Dispute Won' },
    'chargeback_lost': { color: '#ef4444', bg: '#fef2f2', icon: FaTimesCircle, label: 'Dispute Lost' },
  };
  const config = statusConfig[status] || { color: '#6b7280', bg: '#f3f4f6', icon: FaClock, label: status };
  const Icon = config.icon;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, 
      fontSize: 13, fontWeight: 600, color: config.color, background: config.bg }}>
      <Icon size={12} /> {config.label}
    </span>
  );
};

// ============================================================
// PromptModal — in-page prompt replacement.
// window.prompt() is silently blocked inside the iOS/Android
// Capacitor WebView (returns null immediately), which made
// escrow disputes / returns / insurance claims impossible on
// native platforms. This modal works on web + iOS + Android.
// ============================================================
const PromptModal = ({ title, placeholder, onConfirm, onCancel, value, setValue, confirmLabel = 'Submit' }) => {
  const inputRef = useRef(null);
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus?.(), 50);
  }, []);
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(8,8,26,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16, WebkitTapHighlightColor: 'transparent',
    }} onClick={onCancel}>
      <div className="glass-card" style={{ width: '100%', maxWidth: 420, padding: 'var(--td-space-lg)' }}
        onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontWeight: 700, marginBottom: 12, fontSize: 16 }}>{title}</h3>
        <textarea
          ref={inputRef}
          className="form-input"
          placeholder={placeholder || ''}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={3}
          style={{ width: '100%', marginBottom: 12, resize: 'vertical', minHeight: 80 }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-outline btn-sm" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={() => {
            if (!value.trim()) { toast.error('Please enter a value'); return; }
            onConfirm(value.trim());
          }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
};

// Clipboard safe copy — works on iOS WebView (navigator.clipboard
// can be absent/rejected) with a hidden-textarea execCommand fallback.
const copyText = (text) => {
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch { return false; }
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => true, () => fallback());
  } else {
    fallback();
  }
};

const OrderDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [returnReason, setReturnReason] = useState('');
  const [insurancePolicies, setInsurancePolicies] = useState([]);
  const [escrowLoading, setEscrowLoading] = useState(false);
  const [insuranceLoading, setInsuranceLoading] = useState(false);
  const [copiedTracking, setCopiedTracking] = useState(false);
  // In-page prompt state (replaces window.prompt — blocked on native WebView)
  const [prompt, setPrompt] = useState(null);
  const [promptValue, setPromptValue] = useState('');

  const askPrompt = (title, placeholder, onConfirm, confirmLabel) => {
    setPromptValue('');
    setPrompt({ title, placeholder, onConfirm, confirmLabel });
  };

  // ===== Data loading: Enterprise Order preferred, legacy transaction fallback =====
  const fetchOrderData = useCallback(async () => {
    try {
      const res = await api.get(`/orders/${id}`);
      return res.data.order || res.data;
    } catch (err) {
      if (err.response?.status === 404 || err.response?.status === 403) {
        // Legacy single-transaction order (pre-Enterprise Order data)
        const res = await api.get(`/transactions/${id}`);
        return res.data;
      }
      throw err;
    }
  }, [id]);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchOrderData();
        setOrder(data);
      } catch (error) {
        toast.error('Failed to load order details');
        navigate('/transactions');
      } finally {
        setLoading(false);
      }
    };
    load();
    fetchInsurance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, navigate, fetchOrderData]);

  const refreshOrder = async () => {
    try {
      const data = await fetchOrderData();
      setOrder(data);
      return data;
    } catch (error) {
      toast.error('Failed to refresh order');
      return null;
    }
  };

  const fetchInsurance = async () => {
    try {
      const res = await api.get('/shipping-insurance/my').catch(() => ({ data: { policies: [] } }));
      setInsurancePolicies(res.data.policies || []);
    } catch { /* ignore */ }
  };

  // ===== Normalize Enterprise Order → display shape =====
  // Consolidated Orders have items[]/totals/shipments; legacy transactions
  // have listing/itemPrice/paymentBreakdown. Derive a single view object.
  let viewOrder = order || {};
  if (viewOrder.items && viewOrder.items.length > 0 && !viewOrder.listing) {
    const first = viewOrder.items[0];
    viewOrder = {
      ...viewOrder,
      listing: first.listing || {},
      seller: first.seller,
      itemPrice: first.price,
      currency: viewOrder.currency || first.currency || 'USD',
      paymentBreakdown: {
        subtotal: viewOrder.totals?.subtotal,
        shippingCost: viewOrder.totals?.shipping,
        buyerProtectionFee: viewOrder.totals?.protectionFees,
        totalPaid: viewOrder.totals?.total,
      },
      shippingAddress: viewOrder.shippingAddress || {},
    };
    if (!viewOrder.shipping && viewOrder.shipments?.length) {
      const s = viewOrder.shipments[0];
      viewOrder.shipping = {
        trackingNumber: s.trackingNumber,
        carrier: s.carrier,
        trackingUrl: s.trackingUrl,
        trackingHistory: [],
        labelCreatedDate: s.shippedAt,
        actualDelivery: (s.status === 'delivered' || s.status === 'confirmed') ? s.shippedAt : null,
      };
    }
  }
  const isConsolidated = !!(order?.items && order?.items.length >= 0 && order?.totals);

  // Actionable unit(s): each consolidated item maps to its own Transaction,
  // so lifecycle actions target the transaction id. Legacy orders target the
  // order id directly.
  const actionUnits = (isConsolidated && order.items?.length)
    ? order.items.map((it) => ({
        id: it.transaction?._id || it.transaction,
        title: it.title || it.listing?.title,
        status: it.transaction?.status || order.status,
        image: it.image || it.listing?.images?.[0],
      }))
    : [{ id, title: viewOrder.listing?.title, status: viewOrder.status }];

  const primaryTransactionId = actionUnits[0]?.id || id;

  // ===== Escrow handlers =====
  const handleEscrowInitiate = async () => {
    setEscrowLoading('initiate');
    try {
      const amount = viewOrder.paymentBreakdown?.totalPaid || viewOrder.itemPrice;
      const res = await api.post('/escrow/initiate', { transactionId: primaryTransactionId, amount });
      toast.success(res.data.message);
      await refreshOrder();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to initiate escrow');
    } finally {
      setEscrowLoading(null);
    }
  };

  const handleEscrowConfirm = async (side) => {
    setEscrowLoading(side);
    try {
      const res = await api.post(`/escrow/confirm-${side}`, { transactionId: primaryTransactionId });
      toast.success(res.data.message);
      await refreshOrder();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to confirm escrow');
    } finally {
      setEscrowLoading(null);
    }
  };

  const handleEscrowDispute = () => {
    if (!viewOrder?.escrow?.status) return;
    askPrompt(
      'Describe the issue with this transaction:',
      'e.g. Item not as described, never arrived…',
      async (reason) => {
        setEscrowLoading('dispute');
        try {
          const res = await api.post('/escrow/dispute', { transactionId: primaryTransactionId, reason });
          toast.success(res.data.message);
          await refreshOrder();
        } catch (error) {
          toast.error(error.response?.data?.message || 'Failed to dispute escrow');
        } finally {
          setEscrowLoading(null);
        }
      },
      'File Dispute'
    );
  };

  // ===== Shipping Insurance handlers =====
  const handlePurchaseInsurance = async (coverageType = 'standard') => {
    setInsuranceLoading(true);
    try {
      const res = await api.post('/shipping-insurance/purchase', { transactionId: primaryTransactionId, coverageType });
      toast.success('Shipping insurance purchased!');
      await refreshOrder();
      fetchInsurance();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to purchase insurance');
    } finally {
      setInsuranceLoading(false);
    }
  };

  const handleFileInsuranceClaim = async (policyId) => {
    askPrompt(
      'Reason for claim (e.g. Lost in transit, Damaged):',
      'Reason for claim',
      async (reason) => {
        askPrompt(
          'Additional details (optional):',
          'Optional details',
          async (description) => {
            try {
              await api.post(`/shipping-insurance/${policyId}/claim`, { reason, description });
              toast.success('Insurance claim filed!');
              fetchInsurance();
            } catch (error) {
              toast.error(error.response?.data?.message || 'Failed to file claim');
            }
          },
          'File Claim'
        );
      },
      'Continue'
    );
  };

  const copyTracking = (tracking) => {
    copyText(tracking);
    setCopiedTracking(true);
    setTimeout(() => setCopiedTracking(false), 2000);
  };

  const handleAction = async (action, data = {}) => {
    setActionLoading(`${action}:${data.transactionId || id}`);
    try {
      let res;
      switch (action) {
        case 'cancel':
          res = await api.post(`/orders/${data.transactionId || id}/cancel`, { reason: data.reason || 'Cancelled by buyer' });
          break;
        case 'confirm':
          res = await api.post(`/orders/${data.transactionId || id}/confirm-received`, {});
          break;
        case 'request-return':
          res = await api.post(`/orders/${data.transactionId || id}/request-return`, { reason: data.reason });
          break;
        default:
          throw new Error('Unknown action');
      }
      toast.success(res.data.message || 'Action completed');
      await refreshOrder();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="page-container" style={{ textAlign: 'center', padding: '80px 0' }}>
        <div className="spinner" style={{ margin: '0 auto 16px' }} />
        <p style={{ color: 'var(--td-text-tertiary)' }}>Loading order details...</p>
      </div>
    );
  }

  if (!order) return null;

  const currentUserId = String(currentUser?._id || currentUser?.id || '');
  const isBuyer = currentUserId && String(viewOrder.buyer?._id || viewOrder.buyer) === currentUserId;
  const isSeller = currentUserId && String(viewOrder.seller?._id || viewOrder.seller) === currentUserId;
  const escrow = viewOrder.escrow || null;
  const myInsurance = insurancePolicies.filter(p => String(p.transaction?._id || p.transaction) === primaryTransactionId)[0] || null;
  const canInitiateEscrow = isBuyer && escrow?.status !== 'active' && escrow?.status !== 'disputed' &&
    (viewOrder.paymentBreakdown?.totalPaid || viewOrder.itemPrice) > 500 && ['paid', 'shipped', 'in_transit', 'out_for_delivery', 'delivered'].includes(viewOrder.status);
  
  const trackingSteps = viewOrder.shipping?.trackingHistory || [];
  const buildTimeline = () => {
    if (isConsolidated && order.items?.length) {
      const steps = [];
      steps.push({ status: 'paid', label: 'Order Placed', date: order.createdAt, icon: FaFileInvoiceDollar });
      const shippedAt = order.shipments?.find(s => s.shippedAt)?.shippedAt;
      const anyShipped = order.shipments?.some(s => ['shipped', 'in_transit', 'delivered', 'confirmed'].includes(s.status));
      const anyDelivered = order.shipments?.some(s => ['delivered', 'confirmed'].includes(s.status));
      if (anyShipped) steps.push({ status: 'shipped', label: 'Shipped', date: shippedAt, icon: FaTruck });
      if (anyDelivered) steps.push({ status: 'delivered', label: 'Delivered', date: shippedAt, icon: FaCheckCircle });
      if (order.status === 'completed') steps.push({ status: 'completed', label: 'Completed', date: order.updatedAt, icon: FaStar });
      if (order.status === 'cancelled' || order.status === 'refunded') steps.push({ status: order.status, label: order.status === 'cancelled' ? 'Cancelled' : 'Refunded', date: order.updatedAt, icon: FaTimesCircle });
      return steps;
    }
    return [
      { status: 'paid', label: 'Order Placed', date: viewOrder.createdAt, icon: FaFileInvoiceDollar },
      { status: 'shipped', label: 'Shipped', date: viewOrder.shipping?.labelCreatedDate, icon: FaTruck },
      { status: 'delivered', label: 'Delivered', date: viewOrder.shipping?.actualDelivery, icon: FaCheckCircle },
      { status: 'completed', label: 'Completed', date: viewOrder.buyerConfirmed?.confirmedAt || viewOrder.updatedAt, icon: FaStar },
    ];
  };
  const timeline = buildTimeline();
  const orderNumber = order.orderNumber || (order._id ? order._id.slice(-8).toUpperCase() : '');

  return (
    <div className="page-container">
      {prompt && (
        <PromptModal
          title={prompt.title}
          placeholder={prompt.placeholder}
          value={promptValue}
          setValue={setPromptValue}
          confirmLabel={prompt.confirmLabel}
          onConfirm={(val) => { prompt.onConfirm(val); setPrompt(null); }}
          onCancel={() => setPrompt(null)}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--td-space-lg)' }}>
        <Link to="/transactions" className="continue-shopping"><FaArrowLeft size={14} /> Back to Orders</Link>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 'var(--td-space-lg)', flexWrap: 'wrap' }}>
        <h1 className="page-title" style={{ margin: 0 }}>Order Details</h1>
        <StatusBadge status={viewOrder.status || order.status} />
        <span style={{ fontSize: 13, color: 'var(--td-text-tertiary)', marginLeft: 'auto' }}>
          Order #{orderNumber}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 'var(--td-space-xl)', alignItems: 'start' }}>
        {/* Main Content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--td-space-md)' }}>
          {/* Item Details */}
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
            <h3 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Item Details</h3>
            {isConsolidated && order.items?.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {order.items.map((it, i) => {
                  const listing = it.listing || {};
                  const seller = it.seller || {};
                  return (
                    <div key={i} style={{ display: 'flex', gap: 16, paddingTop: i > 0 ? 14 : 0, borderTop: i > 0 ? '1px solid var(--td-border-light)' : 'none' }}>
                      <Link to={`/listing/${listing._id}`}>
                        <img src={it.image || listing.images?.[0] || '/placeholder.png'} alt={listing.title || it.title}
                          style={{ width: 120, height: 120, borderRadius: 'var(--td-radius-sm)', objectFit: 'cover' }} />
                      </Link>
                      <div style={{ flex: 1 }}>
                        <Link to={`/listing/${listing._id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                          <h4 style={{ fontWeight: 600, marginBottom: 4 }}>{listing.title || it.title}</h4>
                        </Link>
                        <p style={{ fontSize: 13, color: 'var(--td-text-tertiary)', marginBottom: 4 }}>
                          {[listing.brand, listing.size, listing.condition].filter(Boolean).join(' · ')}
                          {seller.name ? ` · Seller: ${seller.name}` : ''}
                        </p>
                        <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--td-primary)' }}>
                          {formatPrice(it.price, it.currency || viewOrder.currency || 'USD')} × {it.quantity || 1}
                        </p>
                        <div style={{ marginTop: 4 }}>
                          <StatusBadge status={it.transaction?.status || order.status} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : viewOrder.listing ? (
              <div style={{ display: 'flex', gap: 16 }}>
                <Link to={`/listing/${viewOrder.listing._id}`}>
                  <img src={viewOrder.listing.images?.[0] || '/placeholder.png'} alt={viewOrder.listing.title}
                    style={{ width: 120, height: 120, borderRadius: 'var(--td-radius-sm)', objectFit: 'cover' }} />
                </Link>
                <div style={{ flex: 1 }}>
                  <Link to={`/listing/${viewOrder.listing._id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                    <h4 style={{ fontWeight: 600, marginBottom: 4 }}>{viewOrder.listing.title}</h4>
                  </Link>
                  <p style={{ fontSize: 13, color: 'var(--td-text-tertiary)', marginBottom: 4 }}>
                    {viewOrder.listing.brand} · {viewOrder.listing.size} · {viewOrder.listing.condition}
                  </p>
                  <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--td-primary)' }}>
                    {formatPrice(viewOrder.itemPrice, viewOrder.currency || 'USD')}
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          {/* Order Timeline */}
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
            <h3 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Order Timeline</h3>
            <div style={{ position: 'relative', paddingLeft: 24 }}>
              <div style={{ position: 'absolute', left: 7, top: 4, bottom: 4, width: 2, background: 'var(--td-border)', borderRadius: 1 }} />
              {timeline.filter(t => t.date).map((step, i) => {
                const currentStatus = order.status || viewOrder.status;
                const activeSet = ['paid', 'shipped', 'delivered', 'completed'].filter(s =>
                  s === 'paid' || (s === 'shipped' && ['shipped', 'partially_shipped', 'in_transit', 'delivered', 'completed'].includes(currentStatus)) ||
                  (s === 'delivered' && ['delivered', 'completed'].includes(currentStatus)) ||
                  (s === 'completed' && currentStatus === 'completed'));
                const isActive = activeSet.indexOf(step.status) >= 0;
                const Icon = step.icon;
                return (
                  <div key={step.status} style={{ position: 'relative', paddingBottom: 16, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{
                      width: 16, height: 16, borderRadius: '50%', position: 'absolute', left: -16,
                      background: isActive ? 'var(--td-primary)' : 'var(--td-surface-2)',
                      border: `2px solid ${isActive ? 'var(--td-primary)' : 'var(--td-border)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {isActive && <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'white' }} />}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: isActive ? 'var(--td-text)' : 'var(--td-text-tertiary)' }}>
                        <Icon size={12} style={{ marginRight: 4 }} /> {step.label}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>
                        {new Date(step.date).toLocaleDateString('en-US', { 
                          month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' 
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tracking */}
          {viewOrder.shipping?.trackingNumber || (isConsolidated && order.shipments?.some(s => s.trackingNumber)) ? (
            <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
              <h3 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Tracking</h3>
              {isConsolidated && order.shipments?.filter(s => s.trackingNumber).length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {order.shipments.filter(s => s.trackingNumber).map((s, i) => (
                    <div key={i} style={{ fontSize: 14, padding: 8, background: 'var(--td-surface-2)', borderRadius: 'var(--td-radius-sm)' }}>
                      <div className="flex-between" style={{ marginBottom: 4 }}>
                        <span style={{ color: 'var(--td-text-secondary)' }}>Package {i + 1} — Carrier</span>
                        <span style={{ fontWeight: 600 }}>{s.carrier || 'N/A'}</span>
                      </div>
                      <div className="flex-between" style={{ marginBottom: 4 }}>
                        <span style={{ color: 'var(--td-text-secondary)' }}>Tracking #</span>
                        <span style={{ fontWeight: 600 }}>{s.trackingNumber}</span>
                      </div>
                      <div className="flex-between">
                        <span style={{ color: 'var(--td-text-secondary)' }}>Status</span>
                        <StatusBadge status={s.status} />
                      </div>
                      {s.trackingUrl && (
                        <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" 
                           className="btn btn-outline btn-sm" style={{ marginTop: 8 }}>
                          <FaTruck size={12} /> Track Package
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 14 }}>
                  <div className="flex-between" style={{ marginBottom: 8 }}>
                    <span style={{ color: 'var(--td-text-secondary)' }}>Carrier</span>
                    <span style={{ fontWeight: 600 }}>{viewOrder.shipping.carrier || 'N/A'}</span>
                  </div>
                  <div className="flex-between" style={{ marginBottom: 8 }}>
                    <span style={{ color: 'var(--td-text-secondary)' }}>Tracking #</span>
                    <span style={{ fontWeight: 600 }}>{viewOrder.shipping.trackingNumber}</span>
                  </div>
                  {viewOrder.shipping.trackingUrl && (
                    <a href={viewOrder.shipping.trackingUrl} target="_blank" rel="noopener noreferrer" 
                       className="btn btn-outline btn-sm" style={{ marginTop: 8 }}>
                      <FaTruck size={12} /> Track Package
                    </a>
                  )}
                </div>
              )}
              {trackingSteps.length > 0 && (
                <div style={{ marginTop: 'var(--td-space-md)' }}>
                  <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Tracking History</h4>
                  {trackingSteps.map((step, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, padding: '4px 0', fontSize: 12 }}>
                      <span style={{ color: 'var(--td-text-tertiary)', minWidth: 80 }}>
                        {new Date(step.timestamp).toLocaleDateString()}
                      </span>
                      <span style={{ fontWeight: 500 }}>{step.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {/* Shipping Address */}
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
            <h3 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Shipping Address</h3>
            <div style={{ fontSize: 14, lineHeight: 1.8 }}>
              <p style={{ fontWeight: 600 }}>{viewOrder.shippingAddress?.fullName || 'N/A'}</p>
              <p>{viewOrder.shippingAddress?.street1}</p>
              {viewOrder.shippingAddress?.street2 && <p>{viewOrder.shippingAddress.street2}</p>}
              <p>{viewOrder.shippingAddress?.city}, {viewOrder.shippingAddress?.state} {viewOrder.shippingAddress?.postalCode}</p>
              <p>{viewOrder.shippingAddress?.country}</p>
              {viewOrder.shippingAddress?.phone && <p>Phone: {viewOrder.shippingAddress.phone}</p>}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--td-space-md)' }}>
          {/* ===== Escrow Section ===== */}
          {(escrow?.status && escrow.status !== 'inactive') || (canInitiateEscrow) ? (
            <div className="glass-card" style={{ padding: 'var(--td-space-lg)', borderLeft: `3px solid ${escrow?.status === 'active' ? 'var(--td-info)' : escrow?.status === 'disputed' ? 'var(--td-error)' : 'var(--td-success)'}` }}>
              <h3 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <FaLock size={14} style={{ color: 'var(--td-info)' }} /> Escrow Protection
              </h3>

              {!escrow || escrow.status === 'inactive' ? (
                <div>
                  <p style={{ fontSize: 13, color: 'var(--td-text-secondary)', marginBottom: 12 }}>
                    <FaShieldAlt size={12} /> This is a high-value order (over $500). Initiate escrow to hold funds securely until you confirm the item.
                  </p>
                  <button className="btn btn-info btn-block" onClick={handleEscrowInitiate} disabled={escrowLoading === 'initiate'}>
                    {escrowLoading === 'initiate' ? <FaSpinner className="spinner-sm" /> : <FaHandshake size={14} />} Initiate Escrow
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="flex-between">
                    <span style={{ color: 'var(--td-text-secondary)' }}>Status</span>
                    <span style={{ fontWeight: 700, color: escrow.status === 'disputed' ? 'var(--td-error)' : escrow.status === 'released' || escrow.status === 'resolved' ? 'var(--td-success)' : 'var(--td-info)' }}>
                      {escrow.status.charAt(0).toUpperCase() + escrow.status.slice(1)}
                    </span>
                  </div>
                  <div className="flex-between">
                    <span style={{ color: 'var(--td-text-secondary)' }}>Amount Held</span>
                    <span style={{ fontWeight: 700 }}>{formatPrice(escrow.amount, viewOrder.currency || 'USD')}</span>
                  </div>
                  {escrow.initiatedAt && (
                    <div className="flex-between">
                      <span style={{ color: 'var(--td-text-secondary)' }}>Initiated</span>
                      <span>{new Date(escrow.initiatedAt).toLocaleDateString()}</span>
                    </div>
                  )}
                  {escrow.status === 'active' && (
                    <>
                      <div className="flex-between">
                        <span style={{ color: 'var(--td-text-secondary)' }}>Buyer Confirmed</span>
                        <span style={{ color: escrow.releaseConditions?.buyerConfirmed ? 'var(--td-success)' : 'var(--td-text-tertiary)' }}>
                          {escrow.releaseConditions?.buyerConfirmed ? <FaCheckCircle size={13} /> : <FaTimesCircle size={13} />}
                        </span>
                      </div>
                      <div className="flex-between">
                        <span style={{ color: 'var(--td-text-secondary)' }}>Seller Confirmed</span>
                        <span style={{ color: escrow.releaseConditions?.sellerConfirmed ? 'var(--td-success)' : 'var(--td-text-tertiary)' }}>
                          {escrow.releaseConditions?.sellerConfirmed ? <FaCheckCircle size={13} /> : <FaTimesCircle size={13} />}
                        </span>
                      </div>
                      {escrow.releaseConditions?.inspectionPeriodDays && (
                        <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', background: 'var(--td-surface-2)', padding: 8, borderRadius: 'var(--td-radius-sm)' }}>
                          {escrow.releaseConditions.inspectionPeriodDays}-day inspection period. Both parties must confirm to release funds.
                        </div>
                      )}
                    </>
                  )}
                  {escrow.dispute?.reason && (
                    <div style={{ fontSize: 12, padding: 8, background: 'var(--td-error)10', borderRadius: 'var(--td-radius-sm)', color: 'var(--td-error)' }}>
                      <strong>Dispute:</strong> {escrow.dispute.reason}
                    </div>
                  )}

                  {escrow.status === 'active' && currentUser && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                      {isBuyer && (
                        <>
                          <button className="btn btn-success btn-block" onClick={() => handleEscrowConfirm('buyer')} disabled={escrowLoading === 'buyer'}>
                            {escrowLoading === 'buyer' ? <FaSpinner className="spinner-sm" /> : <FaCheckCircle size={14} />} I Confirm the Item
                          </button>
                          <button className="btn btn-outline btn-block" style={{ color: 'var(--td-error)' }} onClick={handleEscrowDispute} disabled={escrowLoading === 'dispute'}>
                            {escrowLoading === 'dispute' ? <FaSpinner className="spinner-sm" /> : <FaExclamationTriangle size={14} />} File Dispute
                          </button>
                        </>
                      )}
                      {isSeller && (
                        <button className="btn btn-success btn-block" onClick={() => handleEscrowConfirm('seller')} disabled={escrowLoading === 'seller'}>
                          {escrowLoading === 'seller' ? <FaSpinner className="spinner-sm" /> : <FaCheckCircle size={14} />} Confirm Sale Complete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}

          {/* ===== Shipping Insurance Section ===== */}
          {(isSeller || myInsurance) ? (
            <div className="glass-card" style={{ padding: 'var(--td-space-lg)', borderLeft: '3px solid var(--td-warning)' }}>
              <h3 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <FaShieldAlt size={14} style={{ color: 'var(--td-warning)' }} /> Shipping Insurance
              </h3>
              {!myInsurance && isSeller ? (
                <div>
                  <p style={{ fontSize: 13, color: 'var(--td-text-secondary)', marginBottom: 12 }}>
                    Protect this package against loss or damage in transit.
                  </p>
                  <button className="btn btn-warning btn-block" onClick={() => handlePurchaseInsurance('standard')} disabled={insuranceLoading}>
                    {insuranceLoading ? <FaSpinner className="spinner-sm" /> : <FaShieldAlt size={14} />} Purchase Insurance
                  </button>
                </div>
              ) : myInsurance ? (
                <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="flex-between">
                    <span style={{ color: 'var(--td-text-secondary)' }}>Coverage</span>
                    <span style={{ fontWeight: 700 }}>{myInsurance.coverageType || 'Standard'}</span>
                  </div>
                  <div className="flex-between">
                    <span style={{ color: 'var(--td-text-secondary)' }}>Status</span>
                    <span style={{ fontWeight: 700, color: myInsurance.status === 'active' ? 'var(--td-success)' : 'var(--td-text-tertiary)' }}>
                      {myInsurance.status === 'active' ? 'Active' : myInsurance.status}
                    </span>
                  </div>
                  {myInsurance.status === 'active' && (
                    <button className="btn btn-outline btn-block" onClick={() => handleFileInsuranceClaim(myInsurance._id)}>
                      <FaExclamationTriangle size={14} /> File Claim
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ===== Buyer Actions ===== */}
          {(isBuyer && ['paid', 'shipped', 'in_transit', 'out_for_delivery'].includes(viewOrder.status)) ? (
            <div className="glass-card" style={{ padding: 'var(--td-space-lg)', borderLeft: '3px solid var(--td-success)' }}>
              <h3 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Order Actions</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="btn btn-success btn-block"
                  onClick={() => handleAction('confirm', { transactionId: primaryTransactionId })}
                  disabled={actionLoading === `confirm:${primaryTransactionId}`}>
                  {actionLoading === `confirm:${primaryTransactionId}` ? <FaSpinner className="spinner-sm" /> : <FaCheckCircle size={14} />} I've Received the Item
                </button>
                <button className="btn btn-outline btn-block" style={{ color: 'var(--td-error)' }}
                  onClick={() => askPrompt('Reason for cancellation:', 'e.g. Changed my mind', async (reason) => {
                    await handleAction('cancel', { transactionId: primaryTransactionId, reason });
                  }, 'Cancel Order')}
                  disabled={actionLoading === `cancel:${primaryTransactionId}`}>
                  {actionLoading === `cancel:${primaryTransactionId}` ? <FaSpinner className="spinner-sm" /> : <FaTimesCircle size={14} />} Cancel Order
                </button>
              </div>
            </div>
          ) : null}

          {/* ===== Price Summary ===== */}
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
            <h3 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Price Summary</h3>
            <div style={{ fontSize: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="flex-between">
                <span style={{ color: 'var(--td-text-secondary)' }}>Subtotal</span>
                <span>{formatPrice(viewOrder.paymentBreakdown?.subtotal != null ? viewOrder.paymentBreakdown.subtotal : viewOrder.itemPrice, viewOrder.currency || 'USD')}</span>
              </div>
              <div className="flex-between">
                <span style={{ color: 'var(--td-text-secondary)' }}>Shipping</span>
                <span>{formatPrice(viewOrder.paymentBreakdown?.shippingCost || 0, viewOrder.currency || 'USD')}</span>
              </div>
              {viewOrder.paymentBreakdown?.buyerProtectionFee != null && (
                <div className="flex-between">
                  <span style={{ color: 'var(--td-text-secondary)' }}>Buyer Protection</span>
                  <span>{formatPrice(viewOrder.paymentBreakdown.buyerProtectionFee, viewOrder.currency || 'USD')}</span>
                </div>
              )}
              <div style={{ height: 1, background: 'var(--td-border)', margin: '4px 0' }} />
              <div className="flex-between" style={{ fontWeight: 700, fontSize: 16 }}>
                <span>Total Paid</span>
                <span style={{ color: 'var(--td-primary)' }}>{formatPrice(viewOrder.paymentBreakdown?.totalPaid != null ? viewOrder.paymentBreakdown.totalPaid : viewOrder.itemPrice, viewOrder.currency || 'USD')}</span>
              </div>
            </div>
          </div>

          {/* ===== Buyer Protection ===== */}
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)', borderLeft: '3px solid var(--td-primary)' }}>
            <h3 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <FaShieldAlt size={14} style={{ color: 'var(--td-primary)' }} /> Buyer Protection
            </h3>
            <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--td-text-secondary)' }}>
              Every order is covered by AURAVEST Buyer Protection. If your item doesn't arrive,
              arrives damaged, or isn't as described, you're eligible for a full refund.
            </p>
            <div style={{ marginTop: 8, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="flex-between">
                <span><FaCheckCircle size={12} style={{ color: 'var(--td-success)', marginRight: 6 }} />Item not as described</span>
              </div>
              <div className="flex-between">
                <span><FaCheckCircle size={12} style={{ color: 'var(--td-success)', marginRight: 6 }} />Item never arrived</span>
              </div>
              <div className="flex-between">
                <span><FaCheckCircle size={12} style={{ color: 'var(--td-success)', marginRight: 6 }} />Damaged in transit</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrderDetail;
