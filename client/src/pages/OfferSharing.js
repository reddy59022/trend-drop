import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { FaUsers, FaShare, FaGift, FaTrash, FaEdit, FaTimes, FaPlus, FaTag, FaUserFriends } from 'react-icons/fa';
import { getOfferSharingStats, shareOfferToLikers, createBundleOffer } from '../services/api';
import api from '../services/api';
import { toast } from 'react-toastify';

const OfferSharing = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState({ totalOffers: 0, sharedOffers: 0, totalShares: 0 });
  const [loading, setLoading] = useState(true);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showBundleModal, setShowBundleModal] = useState(false);
  const [userListings, setUserListings] = useState([]);
  const [selectedListing, setSelectedListing] = useState(null);
  const [selectedListings, setSelectedListings] = useState([]);
  const [shareData, setShareData] = useState({ discountValue: 10, discountType: 'percentage' });
  const [bundleData, setBundleData] = useState({ buyerId: '', discountPercent: 10 });

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    fetchStats();
    fetchUserListings();
  }, [user, navigate]);

  const fetchStats = async () => {
    try {
      const res = await getOfferSharingStats();
      setStats(res.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUserListings = async () => {
    try {
      const res = await api.get('/listings?status=active&limit=50');
      setUserListings(res.data.listings || res.data.docs || []);
    } catch (error) {
      console.error('Error fetching listings:', error);
    }
  };

  const handleShareToLikers = async () => {
    if (!selectedListing) return;
    try {
      const res = await shareOfferToLikers(selectedListing, shareData);
      toast.success(`Share offers sent to ${res.data.offersCount} likers!`);
      setShowShareModal(false);
      fetchStats();
    } catch (error) {
      console.error('Error sharing offer:', error);
      toast.error('Error: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleCreateBundle = async () => {
    if (selectedListings.length < 2) return;
    try {
      const res = await createBundleOffer({
        listingIds: selectedListings,
        buyerId: bundleData.buyerId,
      });
      toast.success('Bundle offer created!');
      setShowBundleModal(false);
      setSelectedListings([]);
    } catch (error) {
      console.error('Error creating bundle:', error);
      toast.error('Error: ' + (error.response?.data?.message || error.message));
    }
  };

  if (loading) {
    return (
      <div className="page-container" style={{ maxWidth: 800, margin: '0 auto' }}>
        <div className="skeleton" style={{ height: 60, borderRadius: 'var(--td-radius-lg)', marginBottom: 20 }} />
        <div className="skeleton" style={{ height: 120, borderRadius: 'var(--td-radius-lg)', marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 120, borderRadius: 'var(--td-radius-lg)' }} />
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 800, margin: '0 auto' }}>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <FaShare /> Offer Sharing
      </h1>

      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
        <div className="glass-card" style={{ padding: 'var(--td-space-lg)', textAlign: 'center' }}>
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--td-primary)' }}>{stats.totalOffers}</div>
          <div style={{ fontSize: 14, color: 'var(--td-text-secondary)' }}>Total Offers</div>
        </div>
        <div className="glass-card" style={{ padding: 'var(--td-space-lg)', textAlign: 'center' }}>
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--td-secondary)' }}>{stats.sharedOffers}</div>
          <div style={{ fontSize: 14, color: 'var(--td-text-secondary)' }}>Shared Offers</div>
        </div>
        <div className="glass-card" style={{ padding: 'var(--td-space-lg)', textAlign: 'center' }}>
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--td-accent)' }}>{stats.totalShares}</div>
          <div style={{ fontSize: 14, color: 'var(--td-text-secondary)' }}>Total Shares</div>
        </div>
      </div>

      {/* Actions */}
      <div className="glass-card" style={{ padding: 'var(--td-space-lg)', marginBottom: 24 }}>
        <h3 style={{ marginBottom: 16 }}>Share Offers</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowShareModal(true)}
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <FaUsers /> Offer to Likers
          </button>
          <button
            onClick={() => setShowBundleModal(true)}
            className="btn btn-outline"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <FaGift /> Create Bundle Offer
          </button>
        </div>
      </div>

      {/* Your Listings */}
      <div className="glass-card" style={{ padding: 'var(--td-space-lg)', marginBottom: 24 }}>
        <h3 style={{ marginBottom: 16 }}>Your Active Listings</h3>
        {userListings.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--td-space-xl)', color: 'var(--td-text-tertiary)' }}>
            No active listings found
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 12 }}>
            {userListings.map(listing => (
              <div
                key={listing._id}
                className="glass-card"
                style={{
                  padding: 8,
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
                onClick={() => { setSelectedListing(listing._id); setShowShareModal(true); }}
              >
                <img
                  src={listing.images?.[0] || '/placeholder.png'}
                  alt={listing.title}
                  style={{ width: '100%', height: 80, objectFit: 'cover', borderRadius: 6, marginBottom: 6 }}
                />
                <div style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.2, height: 32, overflow: 'hidden' }}>
                  {listing.title.substring(0, 30)}...
                </div>
                <div style={{ fontSize: 12, color: 'var(--td-primary)', marginTop: 4 }}>
                  ${listing.price}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* How It Works */}
      <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
        <h3 style={{ marginBottom: 12 }}>How Offer Sharing Works</h3>
        <ul style={{ paddingLeft: 20, color: 'var(--td-text-secondary)', lineHeight: 1.8 }}>
          <li><strong>Offer to Likers:</strong> Send special discount offers to everyone who liked your listing</li>
          <li><strong>Bundle Offers:</strong> Create combined offers with 10% discount when buyers purchase multiple items</li>
          <li>Shared offers are tracked in your seller dashboard statistics</li>
        </ul>
      </div>

      {/* Share to Likers Modal */}
      {showShareModal && (
        <div className="modal-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div className="glass-card" style={{ padding: 'var(--td-space-xl)', maxWidth: 400, width: '90%' }}>
            <h3 style={{ marginBottom: 16 }}>Share Offer to Likers</h3>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>Discount (%)</label>
              <input
                type="number"
                value={shareData.discountValue}
                onChange={(e) => setShareData({ ...shareData, discountValue: Number(e.target.value) })}
                className="form-input"
                min="1"
                max="50"
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={handleShareToLikers} className="btn btn-primary" style={{ flex: 1 }}>
                Send Offers
              </button>
              <button onClick={() => setShowShareModal(false)} className="btn btn-outline" style={{ flex: 1 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bundle Offer Modal */}
      {showBundleModal && (
        <div className="modal-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div className="glass-card" style={{ padding: 'var(--td-space-xl)', maxWidth: 500, width: '90%' }}>
            <h3 style={{ marginBottom: 16 }}>Create Bundle Offer</h3>
            <p style={{ fontSize: 13, color: 'var(--td-text-secondary)', marginBottom: 12 }}>
              Select at least 2 listings to create a bundle (10% automatic discount)
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 8, marginBottom: 16 }}>
              {userListings.map(listing => (
                <div
                  key={listing._id}
                  onClick={() => {
                    setSelectedListings(prev =>
                      prev.includes(listing._id)
                        ? prev.filter(id => id !== listing._id)
                        : [...prev, listing._id]
                    );
                  }}
                  style={{
                    padding: 6,
                    border: selectedListings.includes(listing._id) ? '2px solid var(--td-primary)' : '1px solid var(--td-border)',
                    borderRadius: 6,
                    cursor: 'pointer',
                    background: selectedListings.includes(listing._id) ? 'rgba(108, 92, 231, 0.1)' : 'transparent',
                  }}
                >
                  <img
                    src={listing.images?.[0] || '/placeholder.png'}
                    alt={listing.title}
                    style={{ width: '100%', height: 60, objectFit: 'cover', borderRadius: 4 }}
                  />
                  <div style={{ fontSize: 10, marginTop: 4, textAlign: 'center' }}>
                    ${listing.price}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleCreateBundle} className="btn btn-primary" style={{ flex: 1 }} disabled={selectedListings.length < 2}>
                Create Bundle ({selectedListings.length} selected)
              </button>
              <button onClick={() => setShowBundleModal(false)} className="btn btn-outline" style={{ flex: 1 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OfferSharing;