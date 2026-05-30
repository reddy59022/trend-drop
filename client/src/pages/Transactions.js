import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { formatPrice, getStatusColor, getStatusLabel, formatDate } from '../utils/helpers';
import { FaTruck, FaCheckCircle, FaClock, FaBox } from 'react-icons/fa';

function Transactions() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    fetchTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const params = filter !== 'all' ? `?type=${filter}` : '';
      const res = await api.get(`/transactions${params}`);
      setTransactions(res.data);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'shipped': case 'in_transit': return <FaTruck />;
      case 'delivered': case 'completed': return <FaCheckCircle />;
      case 'paid': case 'processing': return <FaClock />;
      default: return <FaBox />;
    }
  };

  if (loading) return <div className="page-container" style={{ textAlign: 'center', padding: 60 }}><div className="spinner"></div></div>;

  return (
    <div className="page-container" style={{ maxWidth: 800, margin: '0 auto', padding: 20 }}>
      <h1 style={{ marginBottom: 20 }}>My Orders</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {['all', 'bought', 'sold'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: '8px 20px', borderRadius: 20, border: 'none', cursor: 'pointer', textTransform: 'capitalize',
              background: filter === f ? '#e91e63' : '#f0f0f0', color: filter === f ? '#fff' : '#333',
              fontWeight: filter === f ? 600 : 400 }}>
            {f}
          </button>
        ))}
      </div>

      {transactions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>
          <p>No orders yet.</p>
          <Link to="/feed" style={{ color: '#e91e63' }}>Browse items</Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {transactions.map(txn => {
            const isBuyer = (txn.buyer?._id?.toString() || txn.buyer?.toString()) === (user?.id || user?._id)?.toString();
            const isExpanded = expandedId === txn._id;
            const breakdown = txn.paymentBreakdown || {};

            return (
              <div key={txn._id} style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, overflow: 'hidden' }}>
                {/* Main row */}
                <div onClick={() => setExpandedId(isExpanded ? null : txn._id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 16, cursor: 'pointer' }}>
                  <img src={txn.listing?.images?.[0] || ''} alt="" style={{ width: 60, height: 60, borderRadius: 8, objectFit: 'cover' }} />
                  <div style={{ flex: 1 }}>
                    <Link to={`/listing/${txn.listing?._id}`} onClick={e => e.stopPropagation()}
                      style={{ fontWeight: 600, textDecoration: 'none', color: '#333' }}>
                      {txn.listing?.title}
                    </Link>
                    <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
                      {isBuyer ? `Seller: ${txn.seller?.name}` : `Buyer: ${txn.buyer?.name}`}
                    </div>
                    <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{formatDate(txn.createdAt)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 600 }}>
                      {isBuyer ? formatPrice(breakdown.totalPaid, txn.currency) : formatPrice(breakdown.sellerEarnings, txn.currency)}
                    </div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 12,
                      background: getStatusColor(txn.status) + '20', color: getStatusColor(txn.status), fontSize: 12, fontWeight: 600, marginTop: 4 }}>
                      {getStatusIcon(txn.status)} {getStatusLabel(txn.status)}
                    </div>
                  </div>
                </div>

                {/* Expanded breakdown */}
                {isExpanded && (
                  <div style={{ padding: '0 16px 16px', borderTop: '1px solid #f0f0f0' }}>
                    {/* Tracking info */}
                    {txn.shipping?.trackingNumber && (
                      <div style={{ background: '#f8f9fa', padding: 12, borderRadius: 8, marginTop: 12, marginBottom: 12 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>Tracking</div>
                        <div style={{ fontSize: 13 }}>
                          <span>{txn.shipping.carrier}:</span>{' '}
                          {txn.shipping.trackingUrl ? (
                            <a href={txn.shipping.trackingUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#e91e63' }}>
                              {txn.shipping.trackingNumber}
                            </a>
                          ) : txn.shipping.trackingNumber}
                        </div>
                        {txn.shipping.estimatedDelivery && (
                          <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                            Est. delivery: {formatDate(txn.shipping.estimatedDelivery)}
                          </div>
                        )}
                        {/* Tracking history */}
                        {txn.shipping.trackingHistory?.length > 0 && (
                          <div style={{ marginTop: 8 }}>
                            {txn.shipping.trackingHistory.map((h, i) => (
                              <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid #eee' }}>
                                <span style={{ color: '#999', minWidth: 100 }}>{formatDate(h.timestamp, 'MMM D, h:mm A')}</span>
                                <span style={{ fontWeight: 600 }}>{h.label}</span>
                                <span style={{ color: '#666' }}>{h.location}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Payment breakdown */}
                    <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 8 }}>
                      {isBuyer ? 'What You Paid' : 'What You Earned'}
                    </div>

                    {isBuyer ? (
                      <div style={{ fontSize: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Item Price</span><span>{formatPrice(breakdown.subtotal, txn.currency)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Shipping</span><span>{formatPrice(breakdown.shippingCost, txn.currency)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Buyer Protection ({breakdown.buyerProtectionPercent || 5}%)</span>
                          <span>{formatPrice(breakdown.buyerProtectionFee, txn.currency)}</span>
                        </div>
                        {breakdown.tax > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Tax</span><span>{formatPrice(breakdown.tax, txn.currency)}</span>
                          </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid #eee', paddingTop: 8, marginTop: 4 }}>
                          <span>Total Paid</span><span>{formatPrice(breakdown.totalPaid, txn.currency)}</span>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Item Price</span><span>{formatPrice(breakdown.subtotal, txn.currency)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#ef4444' }}>
                          <span>Platform Fee ({breakdown.platformFeePercent || 10}%)</span>
                          <span>-{formatPrice(breakdown.platformFee, txn.currency)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Shipping Payout</span><span>{formatPrice(breakdown.shippingPayout, txn.currency)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid #eee', paddingTop: 8, marginTop: 4, color: '#10b981' }}>
                          <span>Your Earnings</span><span>{formatPrice(breakdown.sellerEarnings, txn.currency)}</span>
                        </div>
                      </div>
                    )}

                    {/* Address info */}
                    {isBuyer && txn.shippingAddress && (
                      <div style={{ marginTop: 12, fontSize: 13, color: '#666' }}>
                        <strong>Shipping to:</strong> {txn.shippingAddress.fullName}, {txn.shippingAddress.street1}, {txn.shippingAddress.city}, {txn.shippingAddress.state} {txn.shippingAddress.postalCode}, {txn.shippingAddress.country}
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