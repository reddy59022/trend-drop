import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { useNavigate } from 'react-router-dom';
import { FaCube, FaPlus, FaTrash, FaHeart, FaEye, FaHome, FaBed, FaChair, FaStore } from 'react-icons/fa';
import api from '../services/api';

const ARShowrooms = () => {
  const { user } = useAuth();
  const confirmDialog = useConfirm();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [showrooms, setShowrooms] = useState([]);
  const [activeTab, setActiveTab] = useState('browse');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newShowroom, setNewShowroom] = useState({
    name: '',
    description: '',
    roomType: 'custom',
    dimensions: { width: 10, length: 10, height: 3 },
    tags: [],
  });

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    fetchData();
  }, [user, navigate, activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'my') {
        const res = await api.get(`/ar-showrooms/seller/${user._id}`);
        setShowrooms(res.data || []);
      } else {
        const res = await api.get('/ar-showrooms');
        setShowrooms(res.data?.showrooms || []);
      }
    } catch (error) {
      console.error('Error fetching showrooms:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateShowroom = async (e) => {
    e.preventDefault();
    try {
      await api.post('/ar-showrooms', newShowroom);
      setShowCreateModal(false);
      setNewShowroom({
        name: '',
        description: '',
        roomType: 'custom',
        dimensions: { width: 10, length: 10, height: 3 },
        tags: [],
      });
      fetchData();
    } catch (error) {
      console.error('Error creating showroom:', error);
    }
  };

  const handleDeleteShowroom = async (id) => {
    const ok = await confirmDialog({
      title: 'Delete showroom?',
      message: 'Are you sure you want to delete this showroom?',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/ar-showrooms/${id}`);
      fetchData();
    } catch (error) {
      console.error('Error deleting showroom:', error);
    }
  };

  const handleLikeShowroom = async (id) => {
    try {
      await api.post(`/ar-showrooms/${id}/like`);
      fetchData();
    } catch (error) {
      console.error('Error liking showroom:', error);
    }
  };

  const getRoomIcon = (roomType) => {
    switch (roomType) {
      case 'bedroom': return <FaBed />;
      case 'living_room': return <FaChair />;
      case 'closet': return <FaCube />;
      case 'storefront': return <FaStore />;
      default: return <FaHome />;
    }
  };

  if (loading) {
    return (
      <div className="page-container" style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div className="skeleton" style={{ height: 60, borderRadius: 'var(--td-radius-lg)', marginBottom: 20 }} />
        <div className="skeleton" style={{ height: 400, borderRadius: 'var(--td-radius-lg)' }} />
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 12, margin: 0 }}>
          <FaCube /> AR Showrooms
        </h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <FaPlus /> Create Showroom
        </button>
      </div>

      {/* Tabs */}
      <div className="glass-card" style={{ padding: 4, marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => setActiveTab('browse')}
            className={`btn ${activeTab === 'browse' ? 'btn-primary' : 'btn-outline'}`}
            style={{ flex: 1 }}
          >
            <FaEye /> Browse Showrooms
          </button>
          <button
            onClick={() => setActiveTab('my')}
            className={`btn ${activeTab === 'my' ? 'btn-primary' : 'btn-outline'}`}
            style={{ flex: 1 }}
          >
            <FaCube /> My Showrooms
          </button>
        </div>
      </div>

      {/* Showrooms Grid/List */}
      {showrooms.length === 0 ? (
        <div className="empty-state" style={{ padding: 'var(--td-space-xl)' }}>
          <div className="empty-state-icon">🏠</div>
          <h3>No showrooms found</h3>
          <p>{activeTab === 'my' ? 'Create your first AR showroom to showcase your items in 3D' : 'Be the first to create an AR showroom!'}</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {showrooms.map(showroom => (
            <div key={showroom._id} className="glass-card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {getRoomIcon(showroom.roomType)}
                  {showroom.name}
                </h3>
                {activeTab === 'my' && (
                  <button
                    onClick={() => handleDeleteShowroom(showroom._id)}
                    className="btn btn-icon btn-ghost"
                    style={{ color: 'var(--td-error)', padding: 0 }}
                  >
                    <FaTrash />
                  </button>
                )}
              </div>
              
              <p style={{ color: 'var(--td-text-secondary)', fontSize: 14, marginBottom: 12 }}>
                {showroom.description || 'No description'}
              </p>

              <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--td-text-tertiary)', marginBottom: 12 }}>
                <span><FaCube /> {showroom.items?.length || 0} items</span>
                <span><FaEye /> {showroom.viewCount || 0} views</span>
                <span><FaHeart /> {showroom.likeCount || 0} likes</span>
              </div>

              {showroom.tags?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
                  {showroom.tags.map(tag => (
                    <span key={tag} className="badge badge-outline" style={{ fontSize: 11 }}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                {activeTab !== 'my' && (
                  <button
                    onClick={() => handleLikeShowroom(showroom._id)}
                    className="btn btn-outline btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    <FaHeart /> Like
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Showroom Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content glass-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Create AR Showroom</h2>
              <button className="modal-close btn btn-icon btn-ghost" onClick={() => setShowCreateModal(false)}>
                ×
              </button>
            </div>
            <form onSubmit={handleCreateShowroom}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Showroom Name</label>
                  <input
                    type="text"
                    value={newShowroom.name}
                    onChange={e => setNewShowroom({...newShowroom, name: e.target.value})}
                    className="form-input"
                    required
                    placeholder="My Living Room"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <textarea
                    value={newShowroom.description}
                    onChange={e => setNewShowroom({...newShowroom, description: e.target.value})}
                    className="form-textarea"
                    placeholder="Describe your showroom..."
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Room Type</label>
                  <select
                    value={newShowroom.roomType}
                    onChange={e => setNewShowroom({...newShowroom, roomType: e.target.value})}
                    className="form-input"
                  >
                    <option value="custom">Custom</option>
                    <option value="bedroom">Bedroom</option>
                    <option value="living_room">Living Room</option>
                    <option value="closet">Closet</option>
                    <option value="storefront">Storefront</option>
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Width (m)</label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={newShowroom.dimensions.width}
                      onChange={e => setNewShowroom({
                        ...newShowroom,
                        dimensions: {...newShowroom.dimensions, width: Number(e.target.value)}
                      })}
                      className="form-input"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Length (m)</label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={newShowroom.dimensions.length}
                      onChange={e => setNewShowroom({
                        ...newShowroom,
                        dimensions: {...newShowroom.dimensions, length: Number(e.target.value)}
                      })}
                      className="form-input"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Height (m)</label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={newShowroom.dimensions.height}
                      onChange={e => setNewShowroom({
                        ...newShowroom,
                        dimensions: {...newShowroom.dimensions, height: Number(e.target.value)}
                      })}
                      className="form-input"
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn btn-outline">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create Showroom
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ARShowrooms;