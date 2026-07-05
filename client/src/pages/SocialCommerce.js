import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { FaShareAlt, FaInstagram, FaTiktok, FaPinterest, FaSnapchat, FaFacebook, FaPlus, FaSync, FaCog, FaTrash, FaChartBar, FaStore } from 'react-icons/fa';
import api from '../services/api';

const SocialCommerce = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState([]);
  const [availablePlatforms, setAvailablePlatforms] = useState([]);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState('');
  const [accountId, setAccountId] = useState('');

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
      const [connRes, platformsRes] = await Promise.all([
        api.get('/social-commerce'),
        api.get('/social-commerce/available'),
      ]);
      setConnections(connRes.data || []);
      setAvailablePlatforms(platformsRes.data || []);
    } catch (error) {
      console.error('Error fetching social commerce data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async (e) => {
    e.preventDefault();
    try {
      await api.post('/social-commerce/connect', {
        platform: selectedPlatform,
        accountId,
      });
      setShowConnectModal(false);
      setSelectedPlatform('');
      setAccountId('');
      fetchData();
    } catch (error) {
      console.error('Error connecting:', error);
    }
  };

  const handleSync = async (connectionId) => {
    try {
      await api.post(`/social-commerce/${connectionId}/sync`);
      fetchData();
    } catch (error) {
      console.error('Error syncing:', error);
    }
  };

  const handleDisconnect = async (connectionId) => {
    if (!window.confirm('Disconnect this account?')) return;
    try {
      await api.delete(`/social-commerce/${connectionId}`);
      fetchData();
    } catch (error) {
      console.error('Error disconnecting:', error);
    }
  };

  const getPlatformIcon = (platform) => {
    switch (platform) {
      case 'instagram': return <FaInstagram />;
      case 'tiktok': return <FaTiktok />;
      case 'pinterest': return <FaPinterest />;
      case 'snapchat': return <FaSnapchat />;
      case 'facebook': return <FaFacebook />;
      default: return <FaShareAlt />;
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
          <FaShareAlt /> Social Commerce
        </h1>
        <button
          onClick={() => setShowConnectModal(true)}
          className="btn btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <FaPlus /> Connect Platform
        </button>
      </div>

      {connections.length === 0 ? (
        <div className="empty-state" style={{ padding: 'var(--td-space-xl)' }}>
          <div className="empty-state-icon">📱</div>
          <h3>No social platforms connected</h3>
          <p>Connect your social media accounts to auto-post your listings and grow your sales</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {connections.map(conn => (
            <div key={conn._id} className="glass-card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {getPlatformIcon(conn.platform)}
                  {conn.platform.charAt(0).toUpperCase() + conn.platform.slice(1)}
                </h3>
                <span className={`badge ${conn.isActive ? 'badge-success' : 'badge-error'}`}>
                  {conn.isActive ? 'Connected' : 'Disconnected'}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>{conn.stats?.totalPosts || 0}</div>
                  <div style={{ fontSize: 12, color: 'var(--td-text-secondary)' }}>Posts</div>
                </div>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>{conn.stats?.totalViews || 0}</div>
                  <div style={{ fontSize: 12, color: 'var(--td-text-secondary)' }}>Views</div>
                </div>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>{conn.stats?.totalClicks || 0}</div>
                  <div style={{ fontSize: 12, color: 'var(--td-text-secondary)' }}>Clicks</div>
                </div>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--td-success)' }}>
                    {conn.stats?.totalConversions || 0}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--td-text-secondary)' }}>Conversions</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={() => handleSync(conn._id)}
                  className="btn btn-outline btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <FaSync /> Sync Now
                </button>
                <button
                  onClick={() => handleDisconnect(conn._id)}
                  className="btn btn-ghost btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--td-error)' }}
                >
                  <FaTrash /> Disconnect
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Connect Modal */}
      {showConnectModal && (
        <div className="modal-overlay" onClick={() => setShowConnectModal(false)}>
          <div className="modal-content glass-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Connect Social Platform</h2>
              <button className="modal-close btn btn-icon btn-ghost" onClick={() => setShowConnectModal(false)}>
                ×
              </button>
            </div>
            <form onSubmit={handleConnect}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Select Platform</label>
                  <select
                    value={selectedPlatform}
                    onChange={e => setSelectedPlatform(e.target.value)}
                    className="form-input"
                    required
                  >
                    <option value="">Choose a platform</option>
                    {availablePlatforms.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Account ID</label>
                  <input
                    type="text"
                    value={accountId}
                    onChange={e => setAccountId(e.target.value)}
                    className="form-input"
                    required
                    placeholder="Your account username or ID"
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowConnectModal(false)} className="btn btn-outline">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Connect
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SocialCommerce;