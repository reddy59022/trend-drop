import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FaMapMarkerAlt, FaCheckCircle, FaEdit, FaUserPlus, FaUserMinus, FaHeart, FaStar, FaTshirt } from 'react-icons/fa';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import ListingCard from '../components/ListingCard';

const Profile = () => {
  const { id } = useParams();
  const { user: currentUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);
  const [listingsCount, setListingsCount] = useState(0);

  useEffect(() => {
    fetchProfile();
    // eslint-disable-next-line
  }, [id]);

  const fetchProfile = async () => {
    try {
      const [userRes, listingsRes] = await Promise.all([
        api.get(`/users/${id}`),
        api.get(`/listings/user/${id}?limit=20`),
      ]);
      setProfile(userRes.data.user);
      setListingsCount(userRes.data.listingsCount);
      setListings(listingsRes.data.listings);
      if (currentUser) {
        setIsFollowing(
          userRes.data.user.followers?.some(
            (f) => (f._id || f) === (currentUser.id || currentUser._id)
          ) || false
        );
      }
    } catch (error) {
      toast.error('User not found');
    }
    setLoading(false);
  };

  const handleFollow = async () => {
    if (!currentUser) return toast.error('Please login');
    try {
      const res = await api.post(`/users/${id}/follow`);
      setIsFollowing(res.data.following);
      fetchProfile();
    } catch (error) {
      toast.error('Failed to follow');
    }
  };

  if (loading) return (
    <div className="page-container">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 40 }}>
        <div className="skeleton skeleton-avatar" style={{ width: 120, height: 120 }} />
        <div className="skeleton skeleton-text-lg" style={{ width: 200 }} />
        <div className="skeleton skeleton-text" style={{ width: 300 }} />
        <div style={{ display: 'flex', gap: 24 }}>
          {[1, 2, 3].map(i => <div key={i} className="skeleton skeleton-text" style={{ width: 80 }} />)}
        </div>
      </div>
    </div>
  );

  if (!profile) return null;

  const isOwnProfile = currentUser && (currentUser.id || currentUser._id) === id;

  return (
    <div className="page-container">
      {/* Cover */}
      <div style={{
        background: 'linear-gradient(135deg, var(--td-secondary) 0%, #2D2D44 50%, var(--td-primary) 100%)',
        borderRadius: 'var(--td-radius-xl)',
        height: 200,
        marginBottom: -60,
        position: 'relative',
        animation: 'fadeInUp 0.4s ease-out',
      }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 'var(--td-radius-xl)',
          background: 'radial-gradient(circle at 30% 50%, rgba(255, 255, 255, 0.08) 0%, transparent 50%)',
        }} />
      </div>

      {/* Profile Card */}
      <div className="profile-header" style={{ animation: 'fadeInUp 0.5s ease-out 0.1s both', borderRadius: 'var(--td-radius-xl)' }}>
        <div style={{ flexShrink: 0 }}>
          <img
            src={profile.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.name || 'U')}&background=FF385C&color=fff&size=200`}
            alt={profile.name}
            className="profile-avatar"
          />
        </div>
        <div className="profile-info" style={{ paddingTop: 16 }}>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {profile.name}
            {profile.verified && <FaCheckCircle size={22} color="var(--td-primary)" title="Verified" />}
          </h1>
          {profile.closetName && <p className="closet-name">🏪 {profile.closetName}</p>}
          {profile.location && (
            <p className="profile-location"><FaMapMarkerAlt /> {profile.location}</p>
          )}
          {profile.bio && <p className="profile-bio">{profile.bio}</p>}
          <div className="profile-stats">
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <strong style={{ fontSize: 20 }}>{listingsCount}</strong>
              <span style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>Listings</span>
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <strong style={{ fontSize: 20 }}>{profile.followers?.length || 0}</strong>
              <span style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>Followers</span>
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <strong style={{ fontSize: 20 }}>{profile.following?.length || 0}</strong>
              <span style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>Following</span>
            </span>
          </div>
          <div className="profile-actions">
            {isOwnProfile ? (
              <>
                <Link to="/settings" className="btn btn-outline btn-sm"><FaEdit size={14} /> Edit Profile</Link>
                <Link to="/sell" className="btn btn-primary btn-sm"><FaTshirt size={14} /> Sell Something</Link>
              </>
            ) : (
              currentUser && (
                <button className={`btn ${isFollowing ? 'btn-outline' : 'btn-primary'}`} onClick={handleFollow}>
                  {isFollowing ? <><FaUserMinus size={14} /> Unfollow</> : <><FaUserPlus size={14} /> Follow</>}
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* Listings */}
      <div style={{ marginTop: 'var(--td-space-xl)' }}>
        <div className="section-header">
          <h2 className="section-title">
            {isOwnProfile ? 'My Closet' : `${profile.name}'s Closet`}
          </h2>
        </div>
        {listings.length === 0 ? (
          <div className="empty-state" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
            <div className="empty-state-icon">👕</div>
            <h2>No listings yet</h2>
            <p>{isOwnProfile ? 'Start selling items from your closet!' : 'This seller hasn\'t listed anything yet.'}</p>
            {isOwnProfile && <Link to="/sell" className="btn btn-primary">Create First Listing</Link>}
          </div>
        ) : (
          <div className="listings-grid">
            {listings.map((listing, i) => (
              <div key={listing._id} style={{ animation: `fadeInUp 0.4s ease-out ${i * 0.03}s both` }}>
                <ListingCard listing={listing} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Profile;