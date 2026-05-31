import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getWishlist, removeFromWishlist } from '../services/api';
import { useNavigate, Link } from 'react-router-dom';
import { FaHeart, FaTimes, FaSearch, FaShoppingBag } from 'react-icons/fa';
import { formatPrice, defaultAvatar } from '../utils/helpers';
import { toast } from 'react-toastify';

const Wishlist = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    fetchWishlist();
  }, [user, navigate]); // eslint-disable-line

  const fetchWishlist = async () => {
    try {
      const res = await getWishlist();
      setItems(res.data);
    } catch (error) { console.error(error); }
    finally { setLoading(false); }
  };

  const handleRemove = async (listingId) => {
    try {
      await removeFromWishlist(listingId);
      setItems(items.filter(item => item.listing?._id !== listingId));
      toast.success('Removed from wishlist');
    } catch (error) { toast.error('Failed to remove'); }
  };

  if (loading) return (
    <div className="page-container">
      <h1 className="page-title"><FaHeart /> Wishlist</h1>
      <div className="listings-grid">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="skeleton skeleton-card"><div className="skeleton skeleton-image" /><div style={{ padding: 16 }}><div className="skeleton skeleton-text-lg" /><div className="skeleton skeleton-text" style={{ width: '40%' }} /></div></div>
        ))}
      </div>
    </div>
  );

  const validItems = items.filter(item => item.listing);

  return (
    <div className="page-container">
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <FaHeart color="var(--td-primary)" /> Wishlist {validItems.length > 0 && <span style={{ fontSize: 16, color: 'var(--td-text-tertiary)', fontWeight: 400 }}>({validItems.length})</span>}
      </h1>

      {validItems.length === 0 ? (
        <div className="empty-state" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
          <div className="empty-state-icon">💝</div>
          <h2>Your wishlist is empty</h2>
          <p>Save items you love by tapping the heart icon on any listing.</p>
          <Link to="/search" className="btn btn-primary btn-lg"><FaSearch /> Browse Items</Link>
        </div>
      ) : (
        <div className="listings-grid" style={{ animation: 'fadeInUp 0.3s ease-out' }}>
          {validItems.map((item, i) => (
            <div key={item.listing._id} className="listing-card" 
              style={{ animation: `fadeInUp 0.3s ease-out ${i * 0.03}s both`, cursor: 'pointer' }}
              onClick={() => navigate(`/listing/${item.listing._id}`)}>
              <div className="listing-card-image">
                <img src={item.listing.images?.[0] || defaultAvatar} alt={item.listing.title} />
                <button
                  className="like-btn liked"
                  onClick={(e) => { e.stopPropagation(); handleRemove(item.listing._id); }}
                  title="Remove from wishlist"
                  style={{ animation: 'bounce 0.3s ease-out' }}
                >
                  <FaHeart />
                </button>
              </div>
              <div className="listing-card-info">
                <h3 className="listing-card-title">{item.listing.title}</h3>
                <div className="listing-card-price">
                  <span className="current-price">{formatPrice(item.listing.price, item.listing.currency)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Wishlist;