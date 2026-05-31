import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import { formatPrice, getStatusColor, getStatusLabel, formatDate } from '../utils/helpers';
import { FaTruck, FaCheckCircle, FaClock, FaBox, FaFilter, FaShoppingBag, FaDownload, FaChevronDown, FaChevronUp } from 'react-icons/fa';

function Transactions() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => { fetchTransactions(); }, [filter]); // eslint-disable-line

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const params = filter !== 'all' ? `?type=${filter}` : '';
      const res = await api.get(`/transactions${params}`);
      setTransactions(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'shipped': case 'in_transit': return <FaTruck />;
      case 'delivered': case 'completed': case 'buyer_confirmed': return <FaCheckCircle />;
      case 'paid': case 'processing': return <FaClock />;
      default: return <FaBox />;
    }
  };

  if (loading) return (
    <div className="page-container">
      <h1 className="page-title"><FaShoppingBag /> My Orders</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ height: 80, borderRadius: 'var(--td-radius-lg)' }} />)}
      </div>
    </div>
  );

  return (
    <div className="page-container" style={{ maxWidth: 800, margin: '0 auto' }}>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}><FaShoppingBag /> My Orders</h1>

      {/* Filter Tabs */}
      <div className="tabs" style={{ marginBottom: 'var(--td-space-lg)' }}>
        {['all', 'bought', 'sold'].map(f => (
          <button key={f} className={`tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? '📦 All' : f === 'bought' ? '🛒 Bought' : '💰 Sold'}
          </button>
        ))}
      </div>

      {transactions.length === 0 ? (
        <div className="empty-state" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
          <div className="empty-state-icon">📦</div>
          <h2>No orders yet</h2>
          <p>Your transaction history will appear here</p>
          <Link to="/feed" className="btn btn-primary">Browse Items</Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {transactions.map(txn => {
            const isBuyer = (txn.buyer?._id?.toString() || txn.buyer?.toString()) === (user?.id || user?._id)?.toString();
            const isExpanded = expandedId === txn._id;
            const breakdown = txn.paymentBreakdown || {};
            const statusColor = getStatusColor(txn.status);

            return (
              <div key={txn._id} className="glass-card" style={{ overflow: 'hidden', animation: 'fadeInUp 0.3s ease-out' }}>
                <div onClick={() => setExpandedId(isExpanded ? null : txn._id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 'var(--td-space-md)', cursor: 'pointer' }}>
                  <img src={txn.listing?.images?.[0] || ''} alt="" style={{ width: 64, height: 64, borderRadius: 'var(--td-radius-sm)', objectFit: 'cover' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Link to={`/listing/${txn.listing?._id}`} onClick={e => e.stopPropagation()}
                      style={{ fontWeight: 600, textDecoration: 'none', color: 'var(--td-text)', fontSize: 15 }}>
                      {txn.listing?.title}
                    </Link>
                    <div style={{ fontSize: 13, color: 'var(--td-text-secondary)', marginTop: 2 }}>
                      {isBuyer ? `Seller: ${txn.seller?.name}` : `Buyer: ${txn.buyer?.name}`}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', marginTop: 2 }}>{formatDate(txn.createdAt)}</div>
                  </div>
                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                    <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--td-primary)' }}>
                      {isBuyer ? formatPrice(breakdown.totalPaid, txn.currency) : formatPrice(breakdown.sellerEarnings, txn.currency)}
                    </div>
                    <span className="badge" style={{ background: `${statusColor}15`, color: statusColor, display: 'flex', alignItems: 'center', gap: 4 }}>
                      {getStatusIcon(txn.status)} {getStatusLabel(txn.status)}
                    </span>
                    {isExpanded ? <FaChevronUp size={12} color="var(--td-text-tertiary)" /> : <FaChevronDown size={12} color="var(--td-text-tertiary)" />}
                  </div>
                </div>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div style={{ padding: '0 var(--td-space-md) var(--td-space-md)', borderTop: '1px solid var(--td-border-light)', animation: 'fadeIn 0.2s ease-out' }}>
                    {/* Shipping Label */}
                    {!isBuyer && (txn.shipping?.trackingNumber || txn.shipping?.labelCreated) && (
                      <button className="btn btn-primary btn-sm" onClick={async (e) => {
                        e.stopPropagation();
                        try { const res = await api.get(`/shipping/label/${txn._id}`, { responseType: 'blob' }); const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' })); const link = document.createElement('a'); link.href = url; link.download = `label-${txn._id}.pdf`; document.body.appendChild(link); link.click(); link.remove(); } catch { toast.error('Download failed'); }
                      }}><FaDownload size={12} /> Download Label</button>
                    )}

                    {/* Tracking */}
                    {txn.shipping?.trackingNumber && (
                      <div style={{ background: 'var(--td-surface-secondary)', padding: 12, borderRadius: 'var(--td-radius-sm)', marginTop: 12, marginBottom: 12, fontSize: 13 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>Tracking: {txn.shipping.carrier}</div>
                        {txn.shipping.trackingUrl ? <a href={txn.shipping.trackingUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--td-primary)' }}>{txn.shipping.trackingNumber}</a> : <span>{txn.shipping.trackingNumber}</span>}
                        {txn.shipping.estimatedDelivery && <div style={{ color: 'var(--td-text-tertiary)', marginTop: 4 }}>Est. delivery: {formatDate(txn.shipping.estimatedDelivery)}</div>}
                      </div>
                    )}

                    {/* Payment Breakdown */}
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14, color: 'var(--td-text-secondary)' }}>{isBuyer ? 'What You Paid' : 'What You Earned'}</div>
                      <div style={{ fontSize: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {isBuyer ? (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--td-text-secondary)' }}>Item Price</span><span>{formatPrice(breakdown.subtotal, txn.currency)}</span></div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--td-text-secondary)' }}>Shipping</span><span>{formatPrice(breakdown.shippingCost, txn.currency)}</span></div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--td-text-secondary)' }}>Buyer Protection (5%)</span><span>{formatPrice(breakdown.buyerProtectionFee, txn.currency)}</span></div>
                            <div style={{ borderTop: '1px solid var(--td-border)', paddingTop: 6, marginTop: 4 }}><div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}><span>Total Paid</span><span>{formatPrice(breakdown.totalPaid, txn.currency)}</span></div></div>
                          </>
                        ) : (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--td-text-secondary)' }}>Item Price</span><span>{formatPrice(breakdown.subtotal, txn.currency)}</span></div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--td-error)' }}><span>Platform Fee (10%)</span><span>-{formatPrice(breakdown.platformFee, txn.currency)}</span></div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--td-text-secondary)' }}>Shipping Payout</span><span>{formatPrice(breakdown.shippingPayout, txn.currency)}</span></div>
                            <div style={{ borderTop: '1px solid var(--td-border)', paddingTop: 6, marginTop: 4 }}><div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: 'var(--td-success)' }}><span>Your Earnings</span><span>{formatPrice(breakdown.sellerEarnings, txn.currency)}</span></div></div>
                          </>
                        )}
                      </div>
                    </div>

                    {txn.shippingAddress && (
                      <div style={{ marginTop: 12, fontSize: 13, color: 'var(--td-text-tertiary)' }}>
                        <strong>Ship to:</strong> {txn.shippingAddress.fullName}, {txn.shippingAddress.street1}, {txn.shippingAddress.city}, {txn.shippingAddress.state} {txn.shippingAddress.postalCode}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Transactions;