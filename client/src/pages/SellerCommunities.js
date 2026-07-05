import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { FaUsers, FaPlus, FaTrophy, FaBullhorn, FaCrown, FaUserFriends } from 'react-icons/fa';
import api from '../services/api';

const SellerCommunities = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [communities, setCommunities] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [formData, setFormData] = useState({ name: '', description: '', isPrivate: false });

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    fetchData();
  }, [user, navigate]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get('/seller-communities');
      setCommunities(res.data || []);
    } catch (error) {
      console.error('Error fetching communities:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      await api.post('/seller-communities', formData);
      setShowCreate(false);
      setFormData({ name: '', description: '', isPrivate: false });
      fetchData();
    } catch (error) {
      console.error('Error creating community:', error);
    }
  };

  const handleJoin = async (communityId, inviteCode) => {
    try {
      await api.post(`/seller-communities/${communityId}/join`, { inviteCode });
      fetchData();
    } catch (error) {
      console.error('Error joining community:', error);
    }
  };

  if (loading) {
    return (
      <div className="page-container" style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div className="skeleton" style={{ height: 60, borderRadius: 'var(--td-radius-lg)', marginBottom: 20 }} />
        <div className="skeleton" style={{ height: 200, borderRadius: 'var(--td-radius-lg)', marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 400, borderRadius: 'var(--td-radius-lg)' }} />
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <FaUsers /> Seller Communities
      </h1>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h3><FaTrophy /> Active Challenges</h3>
          <p>{communities.reduce((sum, c) => sum + (c.challenges?.length || 0), 0)} challenges across all communities</p>
        </div>
        
        <button onClick={() => setShowCreate(true)} className="btn btn-primary">
          <FaPlus /> Create Community
        </button>
      </div>

      {showCreate && (
        <div className="glass-card" style={{ padding: 20, marginBottom: 24 }}>
          <h3 style={{ marginTop: 0 }}>Create New Community</h3>
          <input
            type="text"
            placeholder="Community Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="input"
            style={{ width: '100%', marginBottom: 12 }}
          />
          <textarea
            placeholder="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="input"
            style={{ width: '100%', marginBottom: 12, minHeight: 80 }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={formData.isPrivate}
              onChange={(e) => setFormData({ ...formData, isPrivate: e.target.checked })}
            />
            Private Community
          </label>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={handleCreate} className="btn btn-primary" disabled={!formData.name}>
              Create
            </button>
            <button onClick={() => setShowCreate(false)} className="btn btn-outline">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {communities.map(community => (
          <div key={community._id} className="glass-card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>{community.name}</h3>
              {community.isPrivate && <FaCrown color="var(--td-warning)" />}
            </div>
            
            <p style={{ color: 'var(--td-text-secondary)', fontSize: 14, marginBottom: 12 }}>
              {community.description}
            </p>

            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <FaUserFriends /> {community.members?.length || 0} members
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <FaTrophy /> {community.challenges?.length || 0} active challenges
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FaBullhorn /> {community.campaigns?.length || 0} active campaigns
              </div>
            </div>

            <button 
              onClick={() => handleJoin(community._id, community.inviteCode)}
              className="btn btn-primary"
              style={{ width: '100%' }}
            >
              Join Community
            </button>
          </div>
        ))}

        {communities.length === 0 && (
          <div className="glass-card" style={{ padding: 40, gridColumn: '1/-1', textAlign: 'center' }}>
            <FaUsers size={64} style={{ opacity: 0.3, marginBottom: 16 }} />
            <h3>No communities yet</h3>
            <p>Be the first to create a seller community!</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default SellerCommunities;