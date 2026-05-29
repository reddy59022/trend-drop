import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getRatingsBySeller, createRating, deleteRating } from '../services/api'; // eslint-disable-line
import StarRating from '../components/StarRating';

const Reviews = () => {
  const { sellerId } = useParams();
  const { user } = useAuth(); // eslint-disable-line
  const navigate = useNavigate(); // eslint-disable-line
  const [data, setData] = useState({ averageRating: 0, count: 0, ratings: [] });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ listingId: '', rating: 5, review: '' });

  useEffect(() => {
    fetchRatings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellerId]);

  const fetchRatings = async () => {
    try {
      const res = await getRatingsBySeller(sellerId);
      setData(res.data);
    } catch (error) {
      console.error('Failed to load reviews', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await createRating({ listingId: form.listingId, rating: form.rating, review: form.review });
      setShowForm(false);
      setForm({ listingId: '', rating: 5, review: '' });
      fetchRatings();
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to submit review');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this review?')) return;
    try {
      await deleteRating(id);
      fetchRatings();
    } catch (error) {
      alert('Failed to delete review');
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading reviews...</div>;

  return (
    <div style={{ padding: '20px 16px', maxWidth: 600, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 20, fontSize: 24, fontWeight: 700 }}>Seller Reviews</h2>

      <div style={{
        background: '#f8f8f8', borderRadius: 12, padding: 20, marginBottom: 24,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, fontWeight: 700, color: '#FF4D6D' }}>
          {data.averageRating.toFixed(1)}
        </div>
        <StarRating rating={data.averageRating} size={24} />
        <div style={{ marginTop: 8, color: '#888', fontSize: 14 }}>
          Based on {data.count} review{data.count !== 1 ? 's' : ''}
        </div>
      </div>

      {user && user._id !== sellerId && (
        <button onClick={() => setShowForm(!showForm)} style={{
          width: '100%', padding: 12, background: '#FF4D6D', color: '#fff',
          border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
          marginBottom: 20, fontSize: 14,
        }}>
          {showForm ? 'Cancel' : 'Write a Review'}
        </button>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} style={{
          background: '#f8f8f8', borderRadius: 12, padding: 20, marginBottom: 24,
        }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 14 }}>
              Listing ID (paste the listing ID you purchased)
            </label>
            <input value={form.listingId} onChange={e => setForm({ ...form, listingId: e.target.value })}
              required style={{ width: '100%', padding: 10, border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }}
              placeholder="Paste listing ID" />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 14 }}>Rating</label>
            <StarRating rating={form.rating} size={28} interactive onChange={(r) => setForm({ ...form, rating: r })} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 14 }}>Review</label>
            <textarea value={form.review} onChange={e => setForm({ ...form, review: e.target.value })}
              rows={3} maxLength={500} style={{ width: '100%', padding: 10, border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }}
              placeholder="Share your experience..." />
          </div>
          <button type="submit" style={{
            padding: '10px 24px', background: '#FF4D6D', color: '#fff',
            border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
          }}>Submit Review</button>
        </form>
      )}

      {data.ratings.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>
          <p>No reviews yet</p>
        </div>
      ) : (
        data.ratings.map(r => (
          <div key={r._id} style={{
            background: '#fff', border: '1px solid #eee', borderRadius: 12,
            padding: 16, marginBottom: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <img src={r.reviewer?.avatar || '/default-avatar.png'} alt=""
                style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{r.reviewer?.name}</div>
                <StarRating rating={r.rating} size={14} />
              </div>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#aaa' }}>
                {new Date(r.createdAt).toLocaleDateString()}
              </span>
            </div>
            {r.review && <p style={{ fontSize: 14, color: '#555', margin: 0 }}>{r.review}</p>}
            {user && r.reviewer?._id === user._id && (
              <button onClick={() => handleDelete(r._id)} style={{
                marginTop: 8, background: 'none', border: 'none', color: '#e74c3c',
                fontSize: 12, cursor: 'pointer', padding: 0,
              }}>Delete</button>
            )}
          </div>
        ))
      )}
    </div>
  );
};

export default Reviews;