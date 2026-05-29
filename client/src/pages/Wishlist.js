import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getWishlist, removeFromWishlist } from '../services/api';
import { useNavigate } from 'react-router-dom';

const Wishlist = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    fetchWishlist();
  }, [user, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchWishlist = async () => {
    try {
      const res = await getWishlist();
      setItems(res.data);
    } catch (error) {
      console.error('Failed to load wishlist', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (listingId) => {
    try {
      await removeFromWishlist(listingId);
      setItems(items.filter(item => item.listing?._id !== listingId));
    } catch (error) {
      console.error('Failed to remove', error);
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading wishlist...</div>;

  return (
    <div style={{ padding: '20px 16px', maxWidth: 800, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 20, fontSize: 24, fontWeight: 700 }}>
        My Wishlist {items.length > 0 && <span style={{ fontSize: 16, color: '#888', fontWeight: 400 }}>({items.length})</span>}
      </h2>

      {items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>♡</div>
          <p style={{ fontSize: 18, marginBottom: 8 }}>Your wishlist is empty</p>
          <p style={{ fontSize: 14 }}>Save items you love by tapping the heart icon</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 16 }}>
          {items.filter(item => item.listing).map(item => (
            <div key={item.listing._id} style={{
              border: '1px solid #eee', borderRadius: 12, overflow: 'hidden',
              background: '#fff', cursor: 'pointer', position: 'relative',
            }}>
              <div onClick={() => navigate(`/listing/${item.listing._id}`)}>
                <img src={item.listing.images?.[0] || '/placeholder.png'} alt=""
                  style={{ width: '100%', height: 200, objectFit: 'cover' }} />
                <div style={{ padding: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                    {item.listing.title}
                  </div>
                  <div style={{ color: '#FF4D6D', fontWeight: 700, fontSize: 16 }}>
                    ${item.listing.price}
                  </div>
                </div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); handleRemove(item.listing._id); }}
                style={{
                  position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.5)',
                  color: '#fff', border: 'none', borderRadius: '50%', width: 30, height: 30,
                  cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="Remove from wishlist"
              >×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Wishlist;