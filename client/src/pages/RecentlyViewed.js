import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import api from '../services/api';
import { formatPrice, defaultAvatar } from '../utils/helpers';
import { toast } from 'react-toastify';
import { FaHistory, FaTrash, FaSearch } from 'react-icons/fa';

const RecentlyViewed = () => {
  const { user } = useAuth();
  const { currency } = useTheme();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRecentlyViewed();
  }, []);

  const fetchRecentlyViewed = async () => {
    try {
      const res = await api.get('/recently-viewed');
      setItems(res.data.items || []);
    } catch (error) {
      toast.error('Failed to load recently viewed items');
    }
    setLoading(false);
  };

  const handleClearHistory = async () => {
    try {
      await api.delete('/recently-viewed/clear');
      setItems([]);
      toast.success('History cleared');
    } catch (error) {
      toast.error('Failed to clear history');
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <h1 className="page-title">Recently Viewed</h1>
        <div className="listings-grid">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="skeleton skeleton-card">
              <div className="skeleton skeleton-image" />
              <div style={{ padding: 16 }}>
                <div className="skeleton skeleton-text-lg" />
                <div className="skeleton skeleton-text" style={{ width: '40%' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--td-space-lg)' }}>
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <FaHistory /> Recently Viewed
        </h1>
        {items.length > 0 && (
          <button className="btn btn-outline" onClick={handleClearHistory}>
            <FaTrash /> Clear History
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">👁️</div>
          <h2>No recently viewed items</h2>
          <p>Items you view will appear here for easy access.</p>
          <Link to="/search" className="btn btn-primary">
            <FaSearch /> Browse Items
          </Link>
        </div>
      ) : (
        <div className="listings-grid">
          {items.map((item, i) => (
            <div key={item._id} className="listing-card" style={{ animation: `fadeInUp 0.3s ease-out ${i * 0.03}s both` }}>
              <div className="listing-card-image">
                <img src={item.images?.[0] || defaultAvatar} alt={item.title} />
              </div>
              <div className="listing-card-info">
                <h3 className="listing-card-title">{item.title}</h3>
                <div className="listing-card-price">
                  <span className="current-price">{formatPrice(item.price, item.currency, currency)}</span>
                </div>
                <Link to={`/listing/${item._id}`} className="btn btn-outline btn-sm" style={{ marginTop: 8 }}>
                  View Item
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RecentlyViewed;