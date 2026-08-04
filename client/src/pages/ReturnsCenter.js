import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { toast } from 'react-toastify';
import { FaUndoAlt, FaCheckCircle, FaTimesCircle, FaTruck, FaInfoCircle, FaBoxOpen, FaDollarSign } from 'react-icons/fa';
import { formatPrice } from '../utils/helpers';
import { promptText } from '../services/native';
import moment from 'moment';

const RETURN_REASONS = [
  'Item not as described',
  'Defective',
  'Wrong item received',
  'Changed mind',
  'Item damaged in shipping',
  'Late delivery',
  'Other',
];

const ReturnsCenter = () => {
  const { user } = useAuth();
  const [returns, setReturns] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [form, setForm] = useState({ transactionId: '', reason: '', description: '' });

  useEffect(() => {
    if (!user) return;
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fetchData = async () => {
    try {
      const [returnsRes, transactionsRes] = await Promise.all([
        api.get('/returns').catch(() => ({ data: [] })),
        api.get('/transactions').catch(() => ({ data: [] })),
      ]);
      setReturns(returnsRes.data || []);
      // Find eligible transactions (completed/delivered) the user bought
      const txData = Array.isArray(transactionsRes.data) ? transactionsRes.data : (transactionsRes.data.transactions || []);
      const eligible = (txData || []).filter(t =>
        t.buyer?._id === user._id ||
        t.buyer === user._id ||
        t.buyer?.toString?.() === user._id?.toString?.()
      );
      setTransactions(eligible.filter(t => ['completed', 'delivered'].includes(t.status)));
    } catch (error) {
      console.error(error);
    }
    setLoading(false);
  };

  const createReturn = async (e) => {
    e.preventDefault();
    if (!form.transactionId || !form.reason) {
      toast.error('Please select a transaction and reason');
      return;
    }
    try {
      const res = await api.post('/returns', form);
      toast.success('Return request submitted!');
      setShowCreateForm(false);
      setForm({ transactionId: '', reason: '', description: '' });
      const updated = [res.data, ...returns];
      setReturns(updated);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to submit return request');
    }
  };

  const updateStatus = async (id, action, extra = {}) => {
    try {
      const res = await api.put(`/returns/${id}/${action}`, extra);
      toast.success(action === 'approve' ? 'Return approved' : action === 'deny' ? 'Return denied' : action === 'ship' ? 'Return shipped' : 'Return received & refunded');
      const updated = returns.map(r => r._id === id ? res.data : r);
      setReturns(updated);
    } catch (error) {
      toast.error(error.response?.data?.message || `Failed to ${action} return`);
    }
  };

  if (loading) return (
    <div className="page-container">
      <h1 className="page-title"><FaUndoAlt /> Returns Center</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 80, borderRadius: 'var(--td-radius-sm)' }} />)}
      </div>
    </div>
  );

  if (!user) return (
    <div className="page-container">
      <div className="empty-state">
        <div className="empty-state-icon">📦</div>
        <h2>Returns Center</h2>
        <p>Sign in to manage your returns</p>
        <Link to="/login" className="btn btn-primary btn-lg">Sign In</Link>
      </div>
    </div>
  );

  const filtered = activeFilter === 'all'
    ? returns
    : returns.filter(r => r.status === activeFilter);

  const isBuyer = (r) => String(r.buyer?._id || r.buyer) === String(user._id || user.id);

  const getStatusBadge = (status) => {
    const map = {
      pending: { label: 'Pending', color: 'var(--td-warning)' },
      approved: { label: 'Approved — Ship back', color: 'var(--td-info)' },
      denied: { label: 'Denied', color: 'var(--td-error)' },
      shipped: { label: 'In Transit', color: 'var(--td-info)' },
      received: { label: 'Received', color: 'var(--td-primary)' },
      refunded: { label: 'Refunded', color: 'var(--td-success)' },
      completed: { label: 'Completed', color: 'var(--td-success)' },
      disputed: { label: 'Disputed', color: 'var(--td-error)' },
    };
    const m = map[status] || { label: status, color: 'var(--td-text-tertiary)' };
    return <span className="badge" style={{ background: `${m.color}18`, color: m.color, borderRadius: 20 }}>{m.label}</span>;
  };

  const filters = ['all', 'pending', 'approved', 'denied', 'shipped', 'refunded'];

  return (
    <div className="page-container" style={{ maxWidth: 960, margin: '0 auto' }}>
      <div className="flex-between" style={{ marginBottom: 'var(--td-space-lg)', flexWrap: 'wrap', gap: 8 }}>
        <h1 className="page-title" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
          <FaUndoAlt /> Returns Center
        </h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreateForm(!showCreateForm)}>
          {showCreateForm ? 'Cancel' : '+ New Return Request'}
        </button>
      </div>

      {/* Create return form */}
      {showCreateForm && (
        <div className="glass-card" style={{ padding: 'var(--td-space-lg)', marginBottom: 'var(--td-space-lg)', animation: 'fadeInUp 0.3s ease-out' }}>
          <h3 style={{ marginBottom: 16 }}><FaBoxOpen /> Request a Return</h3>
          <form onSubmit={createReturn}>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' }}>Select Purchase</label>
              <select className="form-input" value={form.transactionId} onChange={e => setForm({ ...form, transactionId: e.target.value })}>
                <option value="">Choose a transaction...</option>
                {transactions.map(t => (
                  <option key={t._id} value={t._id}>
                    {t.listing?.title || t.itemTitle || 'Item'} — {t.status}
                  </option>
                ))}
              </select>
              {transactions.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--td-warning)', marginTop: 4 }}>
                  <FaInfoCircle size={11} /> No completed purchases available for return yet.
                </div>
              )}
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' }}>Reason</label>
              <select className="form-input" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}>
                <option value="">Select a reason...</option>
                {RETURN_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' }}>Description (optional)</label>
              <textarea className="form-input" style={{ minHeight: 80 }} placeholder="Tell the seller what went wrong..." maxLength={1000}
                value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
            <button type="submit" className="btn btn-primary">
              <FaDollarSign size={14} /> Submit Return Request
            </button>
          </form>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--td-space-lg)', flexWrap: 'wrap' }}>
        {filters.map(f => (
          <button key={f} className={`btn btn-sm ${activeFilter === f ? 'btn-primary' : 'btn-outline'}`} onClick={() => setActiveFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Returns list */}
      {filtered.length === 0 ? (
        <div className="empty-state" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
          <div className="empty-state-icon">📦</div>
          <h2>No returns {activeFilter !== 'all' ? `with status "${activeFilter}"` : 'yet'}</h2>
          <p>Your return requests and their status will appear here.</p>
          <Link to="/transactions" className="btn btn-primary">View Transactions</Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map((r) => {
            const buyerSide = isBuyer(r);
            const canApprove = !buyerSide && r.status === 'pending';
            const canDeny = !buyerSide && r.status === 'pending';
            const canShip = buyerSide && r.status === 'approved';
            const canReceive = !buyerSide && r.status === 'shipped';

            return (
              <div key={r._id} className="glass-card" style={{ padding: 'var(--td-space-md) var(--td-space-lg)', animation: 'fadeInUp 0.3s ease-out' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flex: 1, minWidth: 200 }}>
                    {r.listing?.images?.[0] && (
                      <img src={r.listing.images[0]} alt="" style={{ width: 56, height: 56, borderRadius: 'var(--td-radius-sm)', objectFit: 'cover' }} />
                    )}
                    <div>
                      <Link to={`/listing/${r.listing?._id || ''}`} style={{ fontWeight: 600, fontSize: 14 }}>{r.listing?.title || 'Item'}</Link>
                      <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>
                        {isBuyer(r) ? `Seller: ${r.seller?.name || ''}` : `Buyer: ${r.buyer?.name || ''}`} • {moment(r.createdAt).fromNow()}
                      </div>
                      <div style={{ fontSize: 13, marginTop: 4 }}>
                        {getStatusBadge(r.status)} {r.refundAmount > 0 && (
                          <span style={{ color: 'var(--td-success)', fontWeight: 600 }}>Refund: {formatPrice(r.refundAmount, 'USD')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', marginBottom: 6 }}>Reason: {r.reason}</div>
                    {(canApprove || canDeny || canShip || canReceive) && (
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        {canApprove && (
                          <>
                            <button className="btn btn-sm btn-primary" onClick={() => updateStatus(r._id, 'approve')}><FaCheckCircle size={12} /> Approve</button>
                            <button className="btn btn-sm btn-outline" style={{ color: 'var(--td-error)' }} onClick={async () => {
                              const res = await promptText({ title: 'Denial reason', placeholder: 'Why are you denying this return?', confirmLabel: 'Deny' });
                              const reason = res.ok && res.value ? res.value : 'Return denied by seller';
                              updateStatus(r._id, 'deny', { reason });
                            }}><FaTimesCircle size={12} /> Deny</button>
                          </>
                        )}
                        {canShip && (
                          <button className="btn btn-sm btn-primary" onClick={async () => {
                            const res = await promptText({ title: 'Enter return tracking number (optional)', placeholder: 'Tracking number', confirmLabel: 'Submit' });
                            const tracking = res.ok ? res.value : '';
                            updateStatus(r._id, 'ship', { trackingNumber: tracking });
                          }}><FaTruck size={12} /> Mark Shipped</button>
                        )}
                        {canReceive && (
                          <button className="btn btn-sm btn-success" onClick={() => updateStatus(r._id, 'receive')}>
                            <FaCheckCircle size={12} /> Confirm Received & Refund
                          </button>
                        )}
                      </div>
                    )}
                    {r.trackingNumber && (
                      <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', marginTop: 4 }}>Tracking: {r.trackingNumber}</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ReturnsCenter;