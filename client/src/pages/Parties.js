import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import api from '../services/api';
import { formatPrice } from '../utils/helpers';
import { toast } from 'react-toastify';
import { FaCalendarAlt, FaUsers, FaShare, FaClock, FaTag, FaHeart, FaSearch, FaPlus } from 'react-icons/fa';

const Parties = () => {
  const { user } = useAuth();
  const { currency } = useTheme();
  const navigate = useNavigate();
  const [parties, setParties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newParty, setNewParty] = useState({
    title: '',
    description: '',
    category: 'Women',
    startTime: '',
    endTime: '',
    discountPercent: 10,
  });

  const categories = ['All', 'Women', 'Men', 'Kids', 'Electronics', 'Home', 'Beauty', 'Accessories'];

  useEffect(() => {
    fetchParties();
  }, [selectedCategory]);

  const fetchParties = async () => {
    try {
      const url = selectedCategory === 'All' 
        ? '/api/parties' 
        : `/api/parties?category=${selectedCategory}`;
      const res = await api.get(url);
      setParties(res.data.parties);
    } catch (error) {
      toast.error('Failed to load parties');
    }
    setLoading(false);
  };

  const handleCreateParty = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('/api/parties', {
        ...newParty,
        startTime: new Date(newParty.startTime),
        endTime: new Date(newParty.endTime),
      });
      toast.success('Party created! 🎉');
      setShowCreateModal(false);
      fetchParties();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to create party');
    }
  };

  const handleShare = async (partyId) => {
    try {
      await api.post(`/api/parties/${partyId}/share`);
      toast.success('Party shared! 📱');
      fetchParties();
    } catch (error) {
      toast.error('Failed to share');
    }
  };

  const handleJoin = async (partyId) => {
    try {
      await api.post(`/api/parties/${partyId}/join`);
      toast.success('Joined party! 👋');
      fetchParties();
    } catch (error) {
      toast.error('Failed to join');
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <h1 className="page-title">🎪 Shopping Parties</h1>
        <div className="listings-grid">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="skeleton skeleton-card">
              <div className="skeleton skeleton-image" style={{ height: 120 }} />
              <div style={{ padding: 16 }}>
                <div className="skeleton skeleton-text-lg" />
                <div className="skeleton skeleton-text" style={{ width: '60%' }} />
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
          🎪 Shopping Parties
        </h1>
        {user && (
          <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            <FaPlus /> Host a Party
          </button>
        )}
      </div>

      {/* Category Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--td-space-lg)', flexWrap: 'wrap' }}>
        {categories.map(cat => (
          <button
            key={cat}
            className={`btn ${selectedCategory === cat ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setSelectedCategory(cat)}
            style={{ fontSize: 13 }}
          >
            {cat}
          </button>
        ))}
      </div>

      {parties.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🎪</div>
          <h2>No parties scheduled</h2>
          <p>Check back later for upcoming shopping events!</p>
          <Link to="/search" className="btn btn-primary">
            <FaSearch /> Browse Listings
          </Link>
        </div>
      ) : (
        <div className="listings-grid">
          {parties.map((party, i) => (
            <div key={party._id} className="glass-card" style={{ overflow: 'hidden', animation: `fadeInUp 0.3s ease-out ${i * 0.05}s both` }}>
              <div style={{ 
                background: 'linear-gradient(135deg, var(--td-primary), #ff6b8a)',
                padding: 'var(--td-space-md)',
                color: '#fff',
              }}>
                <h3 style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{party.title}</h3>
                <p style={{ fontSize: 12, opacity: 0.9 }}>{party.description}</p>
              </div>
              
              <div style={{ padding: 'var(--td-space-md)' }}>
                <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--td-text-secondary)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <FaCalendarAlt size={12} />
                    {new Date(party.startTime).toLocaleDateString()}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <FaUsers size={12} />
                    {party.participantCount} joined
                  </span>
                </div>
                
                <div style={{ 
                  marginTop: 12,
                  padding: 8,
                  background: 'var(--td-surface-2)',
                  borderRadius: 'var(--td-radius-sm)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>
                    <FaTag size={12} /> {party.discountPercent}% OFF
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>
                    <FaClock size={12} /> {party.status}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button 
                    className="btn btn-outline btn-sm" 
                    onClick={() => handleShare(party._id)}
                    style={{ flex: 1 }}
                  >
                    <FaShare /> Share
                  </button>
                  <button 
                    className="btn btn-primary btn-sm" 
                    onClick={() => handleJoin(party._id)}
                    style={{ flex: 1 }}
                  >
                    <FaHeart /> Join Party
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Party Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="glass-card" style={{ maxWidth: 500, margin: '40px auto', padding: 'var(--td-space-lg)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Host a Shopping Party</h3>
            <form onSubmit={handleCreateParty}>
              <div className="form-group">
                <label className="form-label">Title</label>
                <input
                  type="text"
                  className="form-input"
                  value={newParty.title}
                  onChange={e => setNewParty({...newParty, title: e.target.value})}
                  placeholder="Summer Clearance Sale"
                  required
                />
              </div>
              
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea
                  className="form-input"
                  value={newParty.description}
                  onChange={e => setNewParty({...newParty, description: e.target.value})}
                  placeholder="Describe your party..."
                  rows={3}
                />
              </div>
              
              <div className="form-group">
                <label className="form-label">Category</label>
                <select
                  className="form-input"
                  value={newParty.category}
                  onChange={e => setNewParty({...newParty, category: e.target.value})}
                >
                  {categories.filter(c => c !== 'All').map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              
              <div className="form-group">
                <label className="form-label">Start Date & Time</label>
                <input
                  type="datetime-local"
                  className="form-input"
                  value={newParty.startTime}
                  onChange={e => setNewParty({...newParty, startTime: e.target.value})}
                  required
                />
              </div>
              
              <div className="form-group">
                <label className="form-label">End Date & Time</label>
                <input
                  type="datetime-local"
                  className="form-input"
                  value={newParty.endTime}
                  onChange={e => setNewParty({...newParty, endTime: e.target.value})}
                  required
                />
              </div>
              
              <div className="form-group">
                <label className="form-label">Discount %</label>
                <input
                  type="number"
                  className="form-input"
                  value={newParty.discountPercent}
                  onChange={e => setNewParty({...newParty, discountPercent: parseInt(e.target.value)})}
                  min="5"
                  max="30"
                  required
                />
              </div>
              
              <div style={{ display: 'flex', gap: 12, marginTop: 'var(--td-space-md)' }}>
                <button type="button" className="btn btn-outline" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  Create Party
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Parties;