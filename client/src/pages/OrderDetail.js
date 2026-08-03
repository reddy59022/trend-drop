import React, { useState, useEffect } from 'react';
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

  useEffect(() => {
    const fetchOrder = async () => {
      try {
        const res = await api.get(`/transactions/${id}`);
        setOrder(res.data);
      } catch (error) {
        toast.error('Failed to load order details');
        navigate('/transactions');
      } finally {
        setLoading(false);
      }
    };
    fetchOrder();
    // Fetch insurance policies for sellers
    fetchInsurance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, navigate]);

  const fetchInsurance = async () => {
    try {
      const res = await api.get('/shipping-insurance/my').catch(() => ({ data: { policies: [] } }));
      setInsurancePolicies(res.data.policies || []);
    } catch { /* ignore */ }
  };

  // ===== Escrow handlers =====
  const handleEscrowInitiate = async () => {
    setEscrowLoading('initiate');
    try {
      const amount = order.paymentBreakdown?.totalPaid || order.itemPrice;
      const res = await api.post('/escrow/initiate', { transactionId: id, amount });
      toast.success(res.data.message);
      const refreshed = await api.get(`/transactions/${id}`);
      setOrder(refreshed.data);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to initiate escrow');
    } finally {
      setEscrowLoading(null);
    }
  };

  const handleEscrowConfirm = async (side) => {
    setEscrowLoading(side);
    try {
      const res = await api.post(`/escrow/confirm-${side}`, { transactionId: id });
      toast.success(res.data.message);
      const refreshed = await api.get(`/transactions/${id}`);
      setOrder(refreshed.data);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to confirm escrow');
    } finally {
      setEscrowLoading(null);
    }
  };

  const handleEscrowDispute = async () => {
    if (!order?.escrow?.status) return;
    const reason = window.prompt('Describe the issue with this transaction:');
    if (!reason) return;
    setEscrowLoading('dispute');
    try {
      const res = await api.post('/escrow/dispute', { transactionId: id, reason });
      toast.success(res.data.message);
      const refreshed = await api.get(`/transactions/${id}`);
      setOrder(refreshed.data);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to dispute escrow');
    } finally {
      setEscrowLoading(null);
    }
  };

  // ===== Shipping Insurance handlers =====
  const handlePurchaseInsurance = async (coverageType = 'standard') => {
    setInsuranceLoading(true);
    try {
      const res = await api.post('/shipping-insurance/purchase', { transactionId: id, coverageType });
      toast.success('Shipping insurance purchased!');
      const refreshed = await api.get(`/transactions/${id}`);
      setOrder(refreshed.data);
      fetchInsurance();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to purchase insurance');
    } finally {
      setInsuranceLoading(false);
    }
  };

  const handleFileInsuranceClaim = async (policyId) => {
    const reason = window.prompt('Reason for claim (e.g. Lost in transit, Damaged):');
    if (!reason) return;
    const description = window.prompt('Additional details (optional):') || '';
    try {
      await api.post(`/shipping-insurance/${policyId}/claim`, { reason, description });
      toast.success('Insurance claim filed!');
      fetchInsurance();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to file claim');
    }
  };

  const copyTracking = (tracking) => {
    navigator.clipboard?.writeText(tracking);
    setCopiedTracking(true);
    setTimeout(() => setCopiedTracking(false), 2000);
  };

  const handleAction = async (action, data = {}) => {
    setActionLoading(action);
    try {
      let res;
      switch (action) {
        case 'cancel':
          res = await api.post(`/orders/${id}/cancel`, { reason: data.reason || 'Cancelled by buyer' });
          break;
        case 'confirm':
          res = await api.post(`/orders/${id}/confirm-received`, {});
          break;
        case 'request-return':
          res = await api.post(`/orders/${id}/request-return`, { reason: data.reason });
          break;
        default:
          throw new Error('Unknown action');
      }
      toast.success(res.data.message || 'Action completed');
      // Refresh order
      const refreshed = await api.get(`/transactions/${id}`);
      setOrder(refreshed.data);
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
  const isBuyer = currentUserId && String(order.buyer?._id || order.buyer) === currentUserId;
  const isSeller = currentUserId && String(order.seller?._id || order.seller) === currentUserId;
  const escrow = order.escrow || null;
  const myInsurance = insurancePolicies.filter(p => String(p.transaction?._id || p.transaction) === id)[0] || null;
  const canInitiateEscrow = isBuyer && escrow?.status !== 'active' && escrow?.status !== 'disputed' &&
    (order.paymentBreakdown?.totalPaid || order.itemPrice) > 500 && ['paid', 'shipped', 'in_transit', 'out_for_delivery', 'delivered'].includes(order.status);
  
  const canCancel = ['paid', 'pending'].includes(order.status);
  const canConfirm = order.status === 'delivered' || order.status === 'shipped';
  const canRequestReturn = order.status === 'delivered';

  const trackingSteps = order.shipping?.trackingHistory || [];
  const timeline = [
    { status: 'paid', label: 'Order Placed', date: order.createdAt, icon: FaFileInvoiceDollar },
    { status: 'shipped', label: 'Shipped', date: order.shipping?.labelCreatedDate, icon: FaTruck },
    { status: 'delivered', label: 'Delivered', date: order.shipping?.actualDelivery, icon: FaCheckCircle },
    { status: 'completed', label: 'Completed', date: order.buyerConfirmed?.confirmedAt || order.updatedAt, icon: FaStar },
  ];

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--td-space-lg)' }}>
        <Link to="/transactions" className="continue-shopping"><FaArrowLeft size={14} /> Back to Orders</Link>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 'var(--td-space-lg)', flexWrap: 'wrap' }}>
        <h1 className="page-title" style={{ margin: 0 }}>Order Details</h1>
        <StatusBadge status={order.status} />
        <span style={{ fontSize: 13, color: 'var(--td-text-tertiary)', marginLeft: 'auto' }}>
          Order #{order._id.slice(-8).toUpperCase()}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 'var(--td-space-xl)', alignItems: 'start' }}>
        {/* Main Content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--td-space-md)' }}>
          {/* Item Details */}
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
            <h3 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Item Details</h3>
            {order.listing && (
              <div style={{ display: 'flex', gap: 16 }}>
                <Link to={`/listing/${order.listing._id}`}>
                  <img src={order.listing.images?.[0] || '/placeholder.png'} alt={order.listing.title}
                    style={{ width: 120, height: 120, borderRadius: 'var(--td-radius-sm)', objectFit: 'cover' }} />
                </Link>
                <div style={{ flex: 1 }}>
                  <Link to={`/listing/${order.listing._id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                    <h4 style={{ fontWeight: 600, marginBottom: 4 }}>{order.listing.title}</h4>
                  </Link>
                  <p style={{ fontSize: 13, color: 'var(--td-text-tertiary)', marginBottom: 4 }}>
                    {order.listing.brand} · {order.listing.size} · {order.listing.condition}
                  </p>
                  <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--td-primary)' }}>
                    {formatPrice(order.itemPrice, order.currency || 'USD')}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Order Timeline */}
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
            <h3 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Order Timeline</h3>
            <div style={{ position: 'relative', paddingLeft: 24 }}>
              <div style={{ position: 'absolute', left: 7, top: 4, bottom: 4, width: 2, background: 'var(--td-border)', borderRadius: 1 }} />
              {timeline.filter(t => t.date).map((step, i) => {
                const isActive = timeline.findIndex(t => t.status === order.status) >= i;
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
          {order.shipping?.trackingNumber && (
            <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
              <h3 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Tracking</h3>
              <div style={{ fontSize: 14 }}>
                <div className="flex-between" style={{ marginBottom: 8 }}>
                  <span style={{ color: 'var(--td-text-secondary)' }}>Carrier</span>
                  <span style={{ fontWeight: 600 }}>{order.shipping.carrier || 'N/A'}</span>
                </div>
                <div className="flex-between" style={{ marginBottom: 8 }}>
                  <span style={{ color: 'var(--td-text-secondary)' }}>Tracking #</span>
                  <span style={{ fontWeight: 600 }}>{order.shipping.trackingNumber}</span>
                </div>
                {order.shipping.trackingUrl && (
                  <a href={order.shipping.trackingUrl} target="_blank" rel="noopener noreferrer" 
                     className="btn btn-outline btn-sm" style={{ marginTop: 8 }}>
                    <FaTruck size={12} /> Track Package
                  </a>
                )}
              </div>
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
          )}

          {/* Shipping Address */}
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
            <h3 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Shipping Address</h3>
            <div style={{ fontSize: 14, lineHeight: 1.8 }}>
              <p style={{ fontWeight: 600 }}>{order.shippingAddress?.fullName || 'N/A'}</p>
              <p>{order.shippingAddress?.street1}</p>
              {order.shippingAddress?.street2 && <p>{order.shippingAddress.street2}</p>}
              <p>{order.shippingAddress?.city}, {order.shippingAddress?.state} {order.shippingAddress?.postalCode}</p>
              <p>{order.shippingAddress?.country}</p>
              {order.shippingAddress?.phone && <p>Phone: {order.shippingAddress.phone}</p>}
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
                    <span style={{ fontWeight: 700 }}>{formatPrice(escrow.amount, order.currency || 'USD')}</span>
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
              {myInsurance ? (
                <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="flex-between">
                    <span style={{ color: 'var(--td-text-secondary)' }}>Coverage</span>
                    <span style={{ fontWeight: 700, textTransform: 'capitalize' }}>{myInsurance.coverageType}</span>
                  </div>
                  <div className="flex-between">
                    <span style={{ color: 'var(--td-text-secondary)' }}>Premium</span>
                    <span style={{ fontWeight: 700 }}>{formatPrice(myInsurance.premium, myInsurance.currency || 'USD')}</span>
                  </div>
                  <div className="flex-between">
                    <span style={{ color: 'var(--td-text-secondary)' }}>Status</span>
                    <span style={{ fontWeight: 700, textTransform: 'capitalize', color: myInsurance.status === 'active' ? 'var(--td-success)' : 'var(--td-warning)' }}>
                      {myInsurance.status}
                    </span>
                  </div>
                  {myInsurance.expiresAt && (
                    <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>
                      Expires: {new Date(myInsurance.expiresAt).toLocaleDateString()}
                    </div>
                  )}
                  {myInsurance.claim?.status && (
                    <div style={{ fontSize: 12, padding: 8, background: 'var(--td-info)10', borderRadius: 'var(--td-radius-sm)', color: 'var(--td-info)' }}>
                      <strong>Claim ({myInsurance.claim.status}):</strong> {myInsurance.claim.reason}
                    </div>
                  )}
                  {myInsurance.status === 'active' && !myInsurance.claim?.status && (
                    <button className="btn btn-outline btn-block" onClick={() => handleFileInsuranceClaim(myInsurance._id)}>
                      <FaFileContract size={14} /> File a Claim
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: 13, color: 'var(--td-text-secondary)', marginBottom: 12 }}>
                    Protect this shipment against loss or damage. Claims covered up to $500 (standard) with only a 2% premium.
                  </p>
                  <button className="btn btn-outline btn-block" onClick={() => handlePurchaseInsurance('standard')} disabled={insuranceLoading}>
                    {insuranceLoading ? <FaSpinner className="spinner-sm" /> : <FaShieldAlt size={14} />} Purchase Insurance (2%)
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {/* Payment Summary */}
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
            <h3 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Payment Summary</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
              <div className="flex-between">
                <span style={{ color: 'var(--td-text-secondary)' }}>Item Price</span>
                <span>{formatPrice(order.paymentBreakdown?.subtotal || order.itemPrice, order.currency)}</span>
              </div>
              <div className="flex-between">
                <span style={{ color: 'var(--td-text-secondary)' }}>Shipping</span>
                <span>{formatPrice(order.paymentBreakdown?.shippingCost || 0, order.currency)}</span>
              </div>
              <div className="flex-between">
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--td-text-secondary)' }}>
                  <FaShieldAlt size={12} /> Protection Fee
                </span>
                <span>{formatPrice(order.paymentBreakdown?.buyerProtectionFee || 0, order.currency)}</span>
              </div>
              <div style={{ borderTop: '1px solid var(--td-border)', paddingTop: 8 }}>
                <div className="flex-between">
                  <span style={{ fontWeight: 700 }}>Total Paid</span>
                  <span style={{ fontWeight: 700, fontSize: 18, color: 'var(--td-primary)' }}>
                    {formatPrice(order.paymentBreakdown?.totalPaid || order.itemPrice, order.currency)}
                  </span>
                </div>
              </div>
              {order.isNegotiated && (
                <div style={{ marginTop: 4, padding: 6, background: 'var(--td-surface-2)', borderRadius: 'var(--td-radius-sm)', fontSize: 12, color: 'var(--td-success)', textAlign: 'center' }}>
                  Negotiated price: {formatPrice(order.negotiatedPrice, order.currency)}
                </div>
              )}
            </div>
          </div>

          {/* Seller Info */}
          {order.seller && (
            <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
              <h3 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Seller</h3>
              <Link to={`/profile/${order.seller._id}`} style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit' }}>
                <img src={order.seller.avatar || '/default-avatar.png'} alt={order.seller.name}
                  style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} />
                <div>
                  <p style={{ fontWeight: 600 }}>{order.seller.name}</p>
                  <p style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>{order.seller.country}</p>
                </div>
              </Link>
            </div>
          )}

          {/* Buyer Info */}
          {order.buyer && (
            <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
              <h3 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Buyer</h3>
              <Link to={`/profile/${order.buyer._id}`} style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit' }}>
                <img src={order.buyer.avatar || '/default-avatar.png'} alt={order.buyer.name}
                  style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} />
                <div>
                  <p style={{ fontWeight: 600 }}>{order.buyer.name}</p>
                  <p style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>{order.buyer.country}</p>
                </div>
              </Link>
            </div>
          )}

          {/* Actions */}
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
            <h3 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Actions</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {canCancel && (
                <button className="btn btn-outline btn-block" onClick={() => handleAction('cancel', { reason: 'Buyer requested cancellation' })}
                  disabled={actionLoading === 'cancel'}>
                  {actionLoading === 'cancel' ? <FaSpinner className="spinner-sm" /> : <FaTimesCircle size={14} />} Cancel Order
                </button>
              )}
              {canConfirm && (
                <button className="btn btn-success btn-block" onClick={() => handleAction('confirm')}
                  disabled={actionLoading === 'confirm'}>
                  {actionLoading === 'confirm' ? <FaSpinner className="spinner-sm" /> : <FaCheckCircle size={14} />} Confirm Received
                </button>
              )}
              {canRequestReturn && (
                <div>
                  <button className="btn btn-outline btn-block" 
                    onClick={() => {
                      const reason = window.prompt('Please describe the reason for return:');
                      if (reason) handleAction('request-return', { reason });
                    }}
                    disabled={actionLoading === 'request-return'}>
                    {actionLoading === 'request-return' ? <FaSpinner className="spinner-sm" /> : <FaUndo size={14} />} Request Return
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Return Info (if applicable) */}
          {order.returnDetails?.requestedAt && (
            <div className="glass-card" style={{ padding: 'var(--td-space-lg)', borderLeft: '3px solid var(--td-warning)' }}>
              <h3 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)', color: 'var(--td-warning)' }}>
                <FaUndo size={14} /> Return / Refund
              </h3>
              <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <p>Requested: {new Date(order.returnDetails.requestedAt).toLocaleDateString()}</p>
                <p>Reason: {order.returnDetails.reason || 'N/A'}</p>
                {order.returnDetails.acceptedAt && <p>Accepted: {new Date(order.returnDetails.acceptedAt).toLocaleDateString()}</p>}
                {order.returnDetails.trackingNumber && (
                  <p>
                    <button className="btn btn-sm btn-outline" onClick={() => copyTracking(order.returnDetails.trackingNumber)} style={{ marginTop: 4 }}>
                      {copiedTracking ? <FaCheckCircle size={12} /> : <FaCopy size={12} />} {copiedTracking ? 'Copied!' : 'Copy Return Tracking'}
                    </button>
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OrderDetail;