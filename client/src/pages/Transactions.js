import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getTransactions as fetchTransactionsApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { formatPrice, getStatusColor, getStatusLabel, formatDate } from '../utils/helpers';
import { FaTruck, FaCheckCircle, FaClock, FaBox, FaShoppingBag, FaChevronDown, FaChevronUp, FaChevronLeft, FaChevronRight, FaFilter } from 'react-icons/fa';

// All possible transaction statuses grouped by category for the filter UI
const STATUS_GROUPS = [
  { label: 'Sold & Ready to Ship', statuses: ['paid', 'processing'] },
  { label: 'In Transit', statuses: ['shipped', 'in_transit', 'out_for_delivery'] },
  { label: 'Delivered', statuses: ['delivered', 'completed', 'buyer_confirmed'] },
  { label: 'Cancelled / Refunded', statuses: ['cancelled', 'cancelled_by_buyer', 'cancelled_by_seller', 'auto_cancelled', 'refunded'] },
  { label: 'Returns', statuses: ['returned', 'return_requested', 'return_accepted', 'return_rejected', 'return_in_transit', 'return_delivered'] },
  { label: 'Disputed / Chargeback', statuses: ['disputed', 'dispute_resolved', 'chargeback_open', 'chargeback_won', 'chargeback_lost'] },
];

// Default status filters per type tab
const DEFAULT_STATUSES = {
  sold: ['paid', 'processing'],           // sold & ready to ship
  bought: ['paid', 'processing', 'shipped', 'in_transit'], // active orders
  all: null,                              // no filter (show everything)
};

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

// ---------------------------------------------------------------------------
// Seller earnings column
//
// `paymentBreakdown.sellerEarnings` is stored NET of the boost fee, but the
// boost row was never rendered, so the column could not add up (a $30 sale
// showed $24.60 with no $3.00 boost row). The API now sends the canonical
// `sellerBreakdown` (server/utils/transactionView.js); the helpers below only
// mirror it for payloads that predate that field (cached / older responses).
// ---------------------------------------------------------------------------
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// "standard" -> "Standard Boost" (matches config/boost.js tier names) without
// duplicating the tier table that Sell.js / EditListing.js already carry.
const tierLabelFromKey = (tier) => {
  const key = String(tier || '').trim();
  if (!key) return '';
  return `${key.charAt(0).toUpperCase()}${key.slice(1)} Boost`;
};

const deriveSellerBreakdown = (breakdown = {}, currency = 'USD') => {
  const itemPrice = round2(breakdown.subtotal);
  const platformFee = round2(breakdown.platformFee);
  const platformFeePercent = Number.isFinite(Number(breakdown.platformFeePercent))
    ? Number(breakdown.platformFeePercent)
    : null;
  const boostFee = round2(breakdown.boostFee);
  const boostTier = String(breakdown.boostTier || '');
  const shippingPayout = round2(breakdown.shippingPayout);
  const sellerEarnings = round2(breakdown.sellerEarnings);

  // Two legitimate ledger shapes (see server/utils/transactionView.js).
  const shippingExcluded = round2(itemPrice - platformFee - boostFee);
  const shippingIncluded = round2(shippingExcluded + shippingPayout);
  const matchesExcluded = Math.abs(shippingExcluded - sellerEarnings) <= 0.01;
  const matchesIncluded = Math.abs(shippingIncluded - sellerEarnings) <= 0.01;
  const shippingIncludedInEarnings = !matchesExcluded && matchesIncluded;
  const expectedEarnings = shippingIncludedInEarnings ? shippingIncluded : shippingExcluded;
  const residual = round2(sellerEarnings - expectedEarnings);

  return {
    currency,
    itemPrice,
    platformFee,
    platformFeePercent,
    boostFee,
    boostTier,
    boostTierLabel: boostFee > 0 ? tierLabelFromKey(boostTier) : '',
    shippingPayout,
    shippingIncludedInEarnings,
    sellerEarnings,
    expectedEarnings,
    residual,
    reconciled: Math.abs(residual) <= 0.01,
  };
};

// Signed money for adjustment rows ("-$4.60" / "+$4.60").
const formatSignedAmount = (value, currency) => {
  const amount = round2(value);
  return `${amount < 0 ? '-' : '+'}${formatPrice(Math.abs(amount), currency)}`;
};

function Transactions() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState(null); // null = use default for type
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [pagination, setPagination] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);

  const getStatusFilterString = useCallback(() => {
    if (statusFilter && statusFilter.length > 0) return statusFilter.join(',');
    const defaults = DEFAULT_STATUSES[filter];
    return defaults ? defaults.join(',') : '';
  }, [statusFilter, filter]);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { type: filter, page, limit };
      const statusStr = getStatusFilterString();
      if (statusStr) params.status = statusStr;
      const res = await fetchTransactionsApi(params);
      setTransactions(res.data.transactions);
      setPagination(res.data.pagination);
    } catch (err) {
      console.error('Failed to fetch transactions:', err);
      setError('Failed to load transactions. Please try again.');
      setTransactions([]);
      setPagination(null);
    }
    setLoading(false);
  }, [filter, page, limit, getStatusFilterString]);

  // Fetch on filter, page, or limit change
  useEffect(() => { fetchTransactions(); }, [fetchTransactions]); // eslint-disable-line

  // When type filter changes, reset status filter to defaults and go to page 1
  const handleFilterChange = (newFilter) => {
    setFilter(newFilter);
    setStatusFilter(null); // reset to default for this type
    setPage(1);
    setExpandedId(null);
  };

  // When status filter changes, reset to page 1
  const handleStatusChange = (statuses) => {
    setStatusFilter(statuses);
    setPage(1);
    setShowStatusDropdown(false);
    setExpandedId(null);
  };

  // Clear status filter (show all statuses for current type)
  const handleClearStatusFilter = () => {
    setStatusFilter([]);
    setPage(1);
    setExpandedId(null);
  };

  // Handle page size change
  const handleLimitChange = (newLimit) => {
    setLimit(newLimit);
    setPage(1);
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'shipped': case 'in_transit': case 'out_for_delivery': return <FaTruck />;
      case 'delivered': case 'completed': case 'buyer_confirmed': return <FaCheckCircle />;
      case 'paid': case 'processing': return <FaClock />;
      default: return <FaBox />;
    }
  };

  const activeStatuses = statusFilter !== null ? statusFilter : (DEFAULT_STATUSES[filter] || []);

  const getActiveStatusLabel = () => {
    if (activeStatuses.length === 0) return 'All Statuses';
    if (activeStatuses.length === 1) return getStatusLabel(activeStatuses[0]);
    return `${activeStatuses.length} Statuses`;
  };

  if (loading && transactions.length === 0) return (
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
      <div className="tabs" style={{ marginBottom: 'var(--td-space-md)' }}>
        {['all', 'bought', 'sold'].map(f => (
          <button key={f} className={`tab ${filter === f ? 'active' : ''}`} onClick={() => handleFilterChange(f)}>
            {f === 'all' ? '📦 All' : f === 'bought' ? '🛒 Bought' : '💰 Sold'}
          </button>
        ))}
      </div>

      {/* Status Filter + Page Size Row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--td-space-md)', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowStatusDropdown(!showStatusDropdown)}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <FaFilter /> {getActiveStatusLabel()}
            {activeStatuses.length > 0 && filter !== 'all' && (
              <span style={{ fontSize: 10, background: 'var(--td-primary)', color: '#fff', borderRadius: 8, padding: '1px 6px' }}>default</span>
            )}
          </button>
          {showStatusDropdown && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 100,
              background: 'var(--td-bg-primary)', border: '1px solid var(--td-border)',
              borderRadius: 'var(--td-radius-md)', boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
              minWidth: 260, maxHeight: 400, overflowY: 'auto',
            }}>
              <div
                onClick={handleClearStatusFilter}
                style={{
                  padding: '10px 14px', cursor: 'pointer', fontSize: 14, fontWeight: 600,
                  borderBottom: '1px solid var(--td-border)',
                  background: activeStatuses.length === 0 ? 'var(--td-primary-light)' : 'transparent',
                  color: activeStatuses.length === 0 ? 'var(--td-primary)' : 'var(--td-text-primary)',
                }}
              >
                ✓ All Statuses
              </div>
              {STATUS_GROUPS.map(group => (
                <div key={group.label}>
                  <div style={{ padding: '8px 14px 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--td-text-tertiary)', letterSpacing: 0.5 }}>{group.label}</div>
                  {group.statuses.map(status => {
                    const isActive = activeStatuses.includes(status);
                    return (
                      <div
                        key={status}
                        onClick={() => handleStatusChange([status])}
                        style={{
                          padding: '8px 14px 8px 24px', cursor: 'pointer', fontSize: 13,
                          background: isActive ? 'var(--td-primary-light)' : 'transparent',
                          color: isActive ? 'var(--td-primary)' : 'var(--td-text-primary)',
                          fontWeight: isActive ? 600 : 400,
                        }}
                      >
                        {isActive ? '✓ ' : ''}{getStatusLabel(status)}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--td-text-secondary)' }}>
          <span>Show:</span>
          <select
            value={limit}
            onChange={(e) => handleLimitChange(Number(e.target.value))}
            style={{
              padding: '4px 8px', borderRadius: 'var(--td-radius-sm)',
              border: '1px solid var(--td-border)', background: 'var(--td-bg-primary)',
              color: 'var(--td-text-primary)', fontSize: 13, cursor: 'pointer',
            }}
          >
            {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        {pagination && (
          <div style={{ fontSize: 13, color: 'var(--td-text-tertiary)' }}>
            {pagination.total.toLocaleString()} order{pagination.total !== 1 ? 's' : ''}
            {pagination.totalPages > 1 && ` · Page ${pagination.currentPage} of ${pagination.totalPages}`}
          </div>
        )}
      </div>

      {error && !loading && (
        <div className="empty-state" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
          <div className="empty-state-icon">⚠️</div>
          <h2>Something went wrong</h2>
          <p>{error}</p>
          <button className="btn btn-primary" onClick={fetchTransactions}>Retry</button>
        </div>
      )}

      {!loading && !error && transactions.length === 0 ? (
        <div className="empty-state" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
          <div className="empty-state-icon">📦</div>
          <h2>No orders found</h2>
          <p>{activeStatuses.length > 0 ? 'No orders match the selected filters. Try a different status.' : 'Your transaction history will appear here'}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            {activeStatuses.length > 0 && (
              <button className="btn btn-secondary" onClick={handleClearStatusFilter}>Clear Status Filter</button>
            )}
            <Link to="/feed" className="btn btn-primary">Browse Items</Link>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {transactions.map(txn => {
            // The server decides the role from the record (never inferred from a
            // client hint); fall back to id comparison for older payloads.
            const viewerRole = txn.viewerRole
              || (((txn.buyer?._id?.toString() || txn.buyer?.toString()) === (user?.id || user?._id)?.toString()) ? 'buyer' : 'seller');
            const isBuyer = viewerRole === 'buyer';
            const isExpanded = expandedId === txn._id;
            const breakdown = txn.paymentBreakdown || {};
            // Seller-only money view: boost fee included, column reconciled.
            const sellerView = isBuyer
              ? null
              : (txn.sellerBreakdown || deriveSellerBreakdown(breakdown, txn.currency));
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
                      {isBuyer ? formatPrice(breakdown.totalPaid, txn.currency) : formatPrice(sellerView.sellerEarnings, txn.currency)}
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
                    {/* Tracking */}
                    {txn.shipping?.trackingNumber && (
                      <div style={{ background: 'var(--td-surface-secondary)', padding: 12, borderRadius: 'var(--td-radius-sm)', marginTop: 12, marginBottom: 12, fontSize: 13 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>Tracking: {txn.shipping.carrier}</div>
                        {txn.shipping.trackingUrl ? <a href={txn.shipping.trackingUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--td-primary)' }}>{txn.shipping.trackingNumber}</a> : <span>{txn.shipping.trackingNumber}</span>}
                        {txn.shipping.estimatedDelivery && <div style={{ color: 'var(--td-text-tertiary)', marginTop: 4 }}>Est. delivery: {formatDate(txn.shipping.estimatedDelivery)}</div>}
                      </div>
                    )}

                    {/* Payment Breakdown */}
                    {/* Seller column: every deduction is itemised (including the
                        seller-only boost fee) so the rows add up to "Your
                        Earnings" — the exact net figure credited as the payout. */}
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14, color: 'var(--td-text-secondary)' }}>{isBuyer ? 'What You Paid' : 'What You Earned'}</div>
                      <div style={{ fontSize: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {isBuyer ? (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--td-text-secondary)' }}>Item Price</span><span>{formatPrice(breakdown.subtotal, txn.currency)}</span></div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--td-text-secondary)' }}>Shipping</span><span>{formatPrice(breakdown.shippingCost, txn.currency)}</span></div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--td-text-secondary)' }}>{breakdown.buyerProtectionPercent != null ? `Buyer Protection (${breakdown.buyerProtectionPercent}%)` : 'Buyer Protection'}</span><span>{formatPrice(breakdown.buyerProtectionFee, txn.currency)}</span></div>
                            <div style={{ borderTop: '1px solid var(--td-border)', paddingTop: 6, marginTop: 4 }}><div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}><span>Total Paid</span><span>{formatPrice(breakdown.totalPaid, txn.currency)}</span></div></div>
                          </>
                        ) : (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--td-text-secondary)' }}>Item Price</span><span>{formatPrice(sellerView.itemPrice, txn.currency)}</span></div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--td-error)' }}><span>{sellerView.platformFeePercent != null ? `Platform Fee (${sellerView.platformFeePercent}%)` : 'Platform Fee'}</span><span>-{formatPrice(sellerView.platformFee, txn.currency)}</span></div>
                            {sellerView.boostFee > 0 && (
                              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--td-error)' }}>
                                <span>{sellerView.boostTierLabel ? `Boost Fee (${sellerView.boostTierLabel})` : 'Boost Fee'}</span>
                                <span>-{formatPrice(sellerView.boostFee, txn.currency)}</span>
                              </div>
                            )}
                            {sellerView.shippingIncludedInEarnings && sellerView.shippingPayout > 0 && (
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--td-text-secondary)' }}>Shipping Payout</span><span>+{formatPrice(sellerView.shippingPayout, txn.currency)}</span></div>
                            )}
                            {!sellerView.reconciled && (
                              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--td-error)' }} title="Historic record: this sale predates the itemised boost/bundled fees shown above.">
                                <span>Adjustments &amp; fees</span><span>{formatSignedAmount(sellerView.residual, txn.currency)}</span>
                              </div>
                            )}
                            <div style={{ borderTop: '1px solid var(--td-border)', paddingTop: 6, marginTop: 4 }}><div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: 'var(--td-success)' }}><span>Your Earnings</span><span>{formatPrice(sellerView.sellerEarnings, txn.currency)}</span></div></div>
                          </>
                        )}
                      </div>

                      {/* Shipping is a label-cost reimbursement: when the stored
                          net earnings already include it, it is shown as a row in
                          the tally above; otherwise it stays out of the total so
                          the column keeps adding up. */}
                      {!isBuyer && !sellerView.shippingIncludedInEarnings && sellerView.shippingPayout > 0 && (
                        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--td-border-light)' }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--td-text-tertiary)', marginBottom: 6 }}>
                            Shipping reimbursement <span style={{ fontWeight: 400 }}>— covers your label cost, not part of earnings</span>
                          </div>
                          <div style={{ fontSize: 14, display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--td-text-secondary)' }}>Shipping label payout</span>
                            <span>{formatPrice(sellerView.shippingPayout, txn.currency)}</span>
                          </div>
                        </div>
                      )}
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

          {/* Pagination Controls */}
          {pagination && pagination.totalPages > 1 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              marginTop: 'var(--td-space-lg)', padding: 'var(--td-space-md)',
              flexWrap: 'wrap',
            }}>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => setPage(1)}
                disabled={page === 1}
                style={{ opacity: page === 1 ? 0.5 : 1, minWidth: 36 }}
              >«</button>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={!pagination.hasPrevPage}
                style={{ opacity: !pagination.hasPrevPage ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <FaChevronLeft /> Prev
              </button>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--td-text-primary)', padding: '0 8px' }}>
                {pagination.currentPage} / {pagination.totalPages}
              </span>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => setPage(p => p + 1)}
                disabled={!pagination.hasNextPage}
                style={{ opacity: !pagination.hasNextPage ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 4 }}
              >
                Next <FaChevronRight />
              </button>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => setPage(pagination.totalPages)}
                disabled={page === pagination.totalPages}
                style={{ opacity: page === pagination.totalPages ? 0.5 : 1, minWidth: 36 }}
              >»</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default Transactions;