import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getRatingsBySeller, createRating, deleteRating } from '../services/api'; // eslint-disable-line
import StarRating from '../components/StarRating';
import { FaStar, FaPen, FaTrash, FaUserCircle } from 'react-icons/fa';
import { defaultAvatar, timeAgo } from '../utils/helpers';
import { toast } from 'react-toastify';

const Reviews = () => {
  const { sellerId } = useParams();
  const { user } = useAuth(); // eslint-disable-line
  const [data, setData] = useState({ averageRating: 0, count: 0, ratings: [] });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ listingId: '', rating: 5, review: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { fetchRatings(); }, [sellerId]); // eslint-disable-line

  const fetchRatings = async () => {
    try { const res = await getRatingsBySeller(sellerId); setData(res.data); } catch (error) { console.error(error); }
    finally { setLoading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createRating({ listingId: form.listingId, rating: form.rating, review: form.review });
      toast.success('Review submitted!');
      setShowForm(false);
      setForm({ listingId: '', rating: 5, review: '' });
      fetchRatings();
    } catch (error) { toast.error(error.response?.data?.message || 'Failed'); }
    setSubmitting(false);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this review?')) return;
    try { await deleteRating(id); toast.success('Review deleted'); fetchRatings(); } catch (error) { toast.error('Failed'); }
  };

  if (loading) return (
    <div className="page-container">
      <h1 className="page-title"><FaStar /> Reviews</h1>
      <div className="skeleton" style={{ height: 120, borderRadius: 'var(--td-radius-lg)', marginBottom: 16 }} />
      {[...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 80, borderRadius: 'var(--td-radius-sm)', marginBottom: 8 }} />)}
    </div>
  );

  return (
    <div className="page-container" style={{ maxWidth: 600, margin: '0 auto' }}>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}><FaStar color="var(--td-primary)" /> Seller Reviews</h1>

      {/* Rating Summary */}
      <div className="glass-card" style={{ padding: 'var(--td-space-lg)', textAlign: 'center', marginBottom: 'var(--td-space-lg)', animation: 'fadeInUp 0.3s ease-out' }}>
        <div style={{ fontSize: 48, fontWeight: 800, color: 'var(--td-primary)', lineHeight: 1 }}>{data.averageRating.toFixed(1)}</div>
        <StarRating rating={data.averageRating} size={24} readonly />
        <div style={{ marginTop: 8, color: 'var(--td-text-tertiary)', fontSize: 14 }}>
          Based on {data.count} review{data.count !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Write Review Button */}
      {user && user._id !== sellerId && (
        <button className={`btn ${showForm ? 'btn-ghost' : 'btn-primary'} btn-block`} onClick={() => setShowForm(!showForm)} style={{ marginBottom: 'var(--td-space-md)' }}>
          {showForm ? 'Cancel' : <><FaPen size={14} /> Write a Review</>}
        </button>
      )}

      {/* Review Form */}
      {showForm && (
        <form className="glass-card" onSubmit={handleSubmit} style={{ padding: 'var(--td-space-lg)', marginBottom: 'var(--td-space-lg)', animation: 'fadeInUp 0.3s ease-out' }}>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label className="form-label">Listing ID (purchase you want to review)</label>
            <input className="form-input" value={form.listingId} onChange={e => setForm({ ...form, listingId: e.target.value })} required placeholder="Paste listing ID" />
          </div>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label className="form-label">Your Rating</label>
            <StarRating rating={form.rating} size={28} onRate={(r) => setForm({ ...form, rating: r })} />
          </div>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Your Review</label>
            <textarea className="form-input" value={form.review} onChange={e => setForm({ ...form, review: e.target.value })} rows={3} maxLength={500} placeholder="Share your experience..." />
            <div className="form-hint" style={{ textAlign: 'right' }}>{form.review.length}/500</div>
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? <><span className="spinner spinner-sm" /> Submitting...</> : 'Submit Review'}
          </button>
        </form>
      )}

      {/* Reviews List */}
      {data.ratings.length === 0 ? (
        <div className="empty-state" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
          <div className="empty-state-icon">⭐</div>
          <h2>No reviews yet</h2>
          <p>Be the first to review this seller!</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--td-space-md)' }}>
          {data.ratings.map((r, i) => (
            <div key={r._id} className="glass-card" style={{ padding: 'var(--td-space-md)', animation: `fadeInUp 0.3s ease-out ${i * 0.05}s both` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <img src={r.reviewer?.avatar || defaultAvatar} alt="" style={{ width: 38, height: 38, borderRadius: 'var(--td-radius-full)', objectFit: 'cover' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{r.reviewer?.name}</div>
                  <StarRating rating={r.rating} size={14} readonly />
                </div>
                <span style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>{timeAgo(r.createdAt)}</span>
              </div>
              {r.review && <p style={{ fontSize: 14, color: 'var(--td-text-secondary)', margin: 0, lineHeight: 1.6 }}>{r.review}</p>}
              {user && r.reviewer?._id === user._id && (
                <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(r._id)} style={{ marginTop: 8, color: 'var(--td-error)', padding: '4px 8px' }}>
                  <FaTrash size={12} /> Delete
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Reviews;