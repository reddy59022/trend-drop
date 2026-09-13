import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { toast } from 'react-toastify';
import { FaUndoAlt, FaCheckCircle, FaTimesCircle, FaTruck, FaInfoCircle, FaBoxOpen, FaDollarSign, FaChevronDown, FaChevronUp, FaTag, FaPaperclip } from 'react-icons/fa';
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

const MAX_IMAGES = 5;

const ReturnsCenter = () => {
  const { user } = useAuth();
  const [returns, setReturns] = useState([]);
  const [eligible, setEligible] = useState([]);
  const [ineligible, setIneligible] = useState([]);
  const [returnWindowDays, setReturnWindowDays] = useState(3);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [form, setForm] = useState({ transactionId: '', reason: '', description: '', images: [] });

  useEffect(() => {
    if (!user) return;
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fetchData = async () => {
    try {
      const [returnsRes, eligibleRes] = await Promise.all([
        api.get('/returns').catch(() => ({ data: [] })),
        api.get('/returns/eligible').catch(() => ({ data: { eligible: [], ineligible: [], returnWindowDays: 3 } })),
      ]);
      setReturns(Array.isArray(returnsRes.data) ? returnsRes.data : (returnsRes.data.returns || []));
      const elig = eligibleRes.data || {};
      setEligible(Array.isArray(elig.eligible) ? elig.eligible : []);
      setIneligible(Array.isArray(elig.ineligible) ? elig.ineligible : []);
      setReturnWindowDays(elig.returnWindowDays || 3);
    } catch (error) {
      console.error(error);
    }
    setLoading(false);
  };

  // ENTERPRISE STANDARD: buyer must attach 1-5 photos so the seller/support
  // team can review the item before approving. Files are held locally for
  // preview and uploaded together with the return request (one multipart call).
  const handleImageAdd = (files) => {
    const remaining = MAX_IMAGES - form.images.length;
    if (remaining <= 0) { toast.error(`Maximum ${MAX_IMAGES} photos allowed`); return; }
    const picked = Array.from(files || []).slice(0, remaining).filter((f) => f.type?.startsWith('image/'));
    if (!picked.length) return;
    setForm((f) => ({ ...f, images: [...f.images, ...picked].slice(0, MAX_IMAGES) }));
  };

  const removeImage = (idx) => setForm((f) => ({ ...f, images: f.images.filter((_, i) => i !== idx) }));

  const createReturn = async (e) => {
    e.preventDefault();
    if (!form.transactionId || !form.reason) {
      toast.error('Please select a purchase and reason');
      return;
    }
    if (form.images.length < 1) {
      toast.error('Please attach at least 1 photo of the item (up to 5)');
      return;
    }
    try {
      // Send multipart form data so image files upload in the same request.
      const fd = new FormData();
      fd.append('transactionId', form.transactionId);
      fd.append('reason', form.reason);
      if (form.description) fd.append('description', form.description);
      for (const img of form.images) {
        fd.append("images", img);
      }
      const res = await api.post('/returns', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Return request submitted!');
      setShowCreateForm(false);
      setForm({ transactionId: '', reason: '', description: '', images: [] });
      const updated = [res.data, ...returns];
      setReturns(updated);
      fetchData(); // refresh eligibility (item no longer returnable)
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
      fetchData();
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
                {eligible.map(t => (
                  <option key={String(t.transactionId)} value={String(t.transactionId)}>
                    {t.title} — {formatPrice(t.price, t.currency)} ({t.daysRemaining} day{t.daysRemaining === 1 ? '' : 's'} left)
                  </option>
                ))}
              </select>
              {eligible.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--td-warning)', marginTop: 6, padding: 10, background: 'var(--td-warning-light, rgba(255,193,7,0.08))', borderRadius: 'var(--td-radius-sm)' }}>
                  <FaInfoCircle size={12} style={{ marginRight: 6 }} />
                  None of your items are eligible for return. Items can be returned within {returnWindowDays} days of delivery, if no return has already been requested.
                </div>
              )}
              {ineligible.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', marginTop: 6 }}>
                  {ineligible.slice(0, 3).map((x) => (
                    <div key={String(x.transactionId)} style={{ marginBottom: 2 }}>• {x.title}: {x.reason}</div>
                  ))}
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
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' }}>
                Photos <span style={{ color: 'var(--td-error)' }}>*</span>
                <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--td-text-tertiary)', marginLeft: 6 }}>
                  (1–{MAX_IMAGES} required — helps support review your request)
                </span>
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--td-bg-secondary, rgba(0,0,0,0.04))', borderRadius: 'var(--td-radius-sm)', cursor: form.images.length >= MAX_IMAGES  ? 'not-allowed' : 'pointer', opacity: form.images.length >= MAX_IMAGES ? 0.5 : 1 }}>
                <FaPaperclip size={13} /> Add Photos
                <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                  disabled={form.images.length >= MAX_IMAGES }
                  onChange={(e) => { handleImageAdd(e.target.files); e.target.value = ''; }} />
              </label>
              {form.images.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {form.images.map((img, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      <img src={img instanceof File ? URL.createObjectURL(img) : img} alt={`Evidence ${i + 1}`} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 'var(--td-radius-sm)', border: '1px solid var(--td-border, rgba(0,0,0,0.1))' }} />
                      <button type="button" onClick={() => removeImage(i)} aria-label="Remove photo"
                        style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'var(--td-error)', color: '#fff', fontSize: 11, cursor: 'pointer', lineHeight: '20px' }}>×</button>
                    </div>
                  ))}
                </div>
              )}
              {form.images.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--td-warning)', marginTop: 4 }}>
                  <FaInfoCircle size={11} /> At least 1 photo is required.
                </div>
              )}
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
            const expanded = expandedId === r._id;
            const hasDetail = !!(r.returnLabel || r.returnTrackingNumber || r.trackingNumber ||
              (r.images && r.images.length > 0) || r.denialReason || r.description ||
              r.labelCarrier || (r.refundAmount > 0));

            return (
              <div key={r._id} className="glass-card" style={{ padding: 'var(--td-space-md) var(--td-space-lg)', animation: 'fadeInUp 0.3s ease-out' }}>
                <div
                  role={hasDetail ? 'button' : undefined}
                  tabIndex={hasDetail ? 0 : undefined}
                  onClick={() => hasDetail && setExpandedId(expanded ? null : r._id)}
                  onKeyDown={(e) => { if (hasDetail && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setExpandedId(expanded ? null : r._id); } }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', cursor: hasDetail ? 'pointer' : 'default' }}
                  aria-expanded={expanded}
                >
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flex: 1, minWidth: 200 }}>
                    {r.listing?.images?.[0] && (
                      <img src={r.listing.images[0]} alt="" style={{ width: 56, height: 56, borderRadius: 'var(--td-radius-sm)', objectFit: 'cover' }} />
                    )}
                    <div>
                      <Link to={`/listing/${r.listing?._id || ''}`} style={{ fontWeight: 600, fontSize: 14 }} onClick={(e) => e.stopPropagation()}>{r.listing?.title || 'Item'}</Link>
                      <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>
                        {buyerSide ? `Seller: ${r.seller?.name || ''}` : `Buyer: ${r.buyer?.name || ''}`} • {moment(r.createdAt).fromNow()}
                      </div>
                      <div style={{ fontSize: 13, marginTop: 4 }}>
                        {getStatusBadge(r.status)} {r.refundAmount > 0 && (
                          <span style={{ color: 'var(--td-success)', fontWeight: 600 }}>Refund: {formatPrice(r.refundAmount, 'USD')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                      Reason: {r.reason}
                      {hasDetail && (expanded ? <FaChevronUp size={11} /> : <FaChevronDown size={11} />)}
                    </div>
                    {(canApprove || canDeny || canShip || canReceive) && (
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        {canApprove && (
                          <>
                            <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); updateStatus(r._id, 'approve'); }}><FaCheckCircle size={12} /> Approve</button>
                            <button className="btn btn-sm btn-outline" style={{ color: 'var(--td-error)' }} onClick={async (e) => {
                              e.stopPropagation();
                              const res = await promptText({ title: 'Denial reason', placeholder: 'Why are you denying this return?', confirmLabel: 'Deny' });
                              const reason = res.ok && res.value ? res.value : 'Return denied by seller';
                              updateStatus(r._id, 'deny', { reason });
                            }}><FaTimesCircle size={12} /> Deny</button>
                          </>
                        )}
                        {canShip && (
                          <button className="btn btn-sm btn-primary" onClick={async (e) => {
                            e.stopPropagation();
                            const res = await promptText({ title: 'Enter return tracking number', placeholder: 'Tracking number from the label', confirmLabel: 'Submit' });
                            const tracking = res.ok ? (res.value || r.returnTrackingNumber) : r.returnTrackingNumber;
                            updateStatus(r._id, 'ship', { trackingNumber: tracking });
                          }}><FaTruck size={12} /> Mark Shipped</button>
                        )}
                        {canReceive && (
                          <button className="btn btn-sm btn-success" onClick={(e) => { e.stopPropagation(); updateStatus(r._id, 'receive'); }}>
                            <FaCheckCircle size={12} /> Confirm Received & Refund
                          </button>
                        )}
                      </div>
                    )}
                    {!expanded && (r.returnTrackingNumber || r.trackingNumber) && (
                      <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', marginTop: 4 }}>
                        Tracking: {r.returnTrackingNumber || r.trackingNumber}
                      </div>
                    )}
                  </div>
                </div>

                {/* Expanded detail panel — openable/clickable for every status */}
                {expanded && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--td-border, rgba(0,0,0,0.08))', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* Return label — BUYER ONLY (server strips it for sellers) */}
                    {buyerSide && r.returnLabel && (
                      <div style={{ padding: 12, background: 'var(--td-info-light, rgba(33,150,243,0.08))', borderRadius: 'var(--td-radius-sm)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                          <FaTag size={13} style={{ color: 'var(--td-info)' }} />
                          <span style={{ fontWeight: 600, fontSize: 13 }}>Prepaid Return Label</span>
                          {r.labelCarrier && <span className="badge" style={{ background: 'rgba(33,150,243,0.1)', color: 'var(--td-info)', borderRadius: 20 }}>{r.labelCarrier}</span>}
                        </div>
                        <a href={r.returnLabel} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-primary" onClick={(e) => e.stopPropagation()}>
                          View / Print Return Label
                        </a>
                        {r.labelCost > 0 && <span style={{ fontSize: 12, color: 'var(--td-text-tertiary)', marginLeft: 10 }}>Label cost: {formatPrice(r.labelCost, 'USD')} (prepaid)</span>}
                      </div>
                    )}
                    {/* Return tracking — visible to BOTH buyer and seller */}
                    {(r.returnTrackingNumber || r.trackingNumber) && (
                      <div style={{ fontSize: 13 }}>
                        <span style={{ fontWeight: 600 }}>Return tracking number: </span>
                        <code style={{ background: 'rgba(0,0,0,0.04)', padding: '2px 8px', borderRadius: 4 }}>{r.returnTrackingNumber || r.trackingNumber}</code>
                      </div>
                    )}
                    {/* Attached photos */}
                    {r.images && r.images.length > 0 && (
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Attached photos ({r.images.length})</div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {r.images.map((img, i) => (
                            <a key={i} href={img} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                              <img src={img} alt={`Return evidence ${i + 1}`} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 'var(--td-radius-sm)' }} />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    {r.denialReason && (
                      <div style={{ fontSize: 13, color: 'var(--td-error)' }}>
                        <span style={{ fontWeight: 600 }}>Denial reason: </span>{r.denialReason}
                      </div>
                    )}
                    {r.description && (
                      <div style={{ fontSize: 13 }}>
                        <span style={{ fontWeight: 600 }}>Buyer description: </span>{r.description}
                      </div>
                    )}
                    {r.sellerResponse && (
                      <div style={{ fontSize: 13 }}>
                        <span style={{ fontWeight: 600 }}>Seller response: </span>{r.sellerResponse}
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
};

export default ReturnsCenter;