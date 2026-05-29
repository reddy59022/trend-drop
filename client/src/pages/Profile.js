import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FaMapMarkerAlt } from 'react-icons/fa';
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

  if (loading) return <div className="page-container"><div className="spinner"></div></div>;
  if (!profile) return null;

  const isOwnProfile = currentUser && (currentUser.id || currentUser._id) === id;

  return (
    <div className="page-container">
      <div className="profile-header">
        <img
          src={profile.avatar || 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#ddd"/><circle cx="50" cy="38" r="16" fill="#bbb"/><ellipse cx="50" cy="72" rx="26" ry="20" fill="#bbb"/></svg>')}
          alt={profile.name}
          className="profile-avatar"
        />
        <div className="profile-info">
          <h1>{profile.name}</h1>
          {profile.closetName && <p className="closet-name">{profile.closetName}</p>}
          {profile.location && (
            <p className="profile-location"><FaMapMarkerAlt /> {profile.location}</p>
          )}
          {profile.bio && <p className="profile-bio">{profile.bio}</p>}
          <div className="profile-stats">
            <span><strong>{listingsCount}</strong> Listings</span>
            <span><strong>{profile.followers?.length || 0}</strong> Followers</span>
            <span><strong>{profile.following?.length || 0}</strong> Following</span>
          </div>
          <div className="profile-actions">
            {isOwnProfile ? (
              <Link to="/settings" className="btn btn-outline">Edit Profile</Link>
            ) : (
              currentUser && (
                <button
                  className={`btn ${isFollowing ? 'btn-outline' : 'btn-primary'}`}
                  onClick={handleFollow}
                >
                  {isFollowing ? 'Following' : 'Follow'}
                </button>
              )
            )}
          </div>
        </div>
      </div>

      <h2 className="section-title">
        {isOwnProfile ? 'My Closet' : `${profile.name}'s Closet`}
      </h2>
      {listings.length === 0 ? (
        <div className="empty-state">
          <p>No listings yet</p>
        </div>
      ) : (
        <div className="listings-grid">
          {listings.map((listing) => (
            <ListingCard key={listing._id} listing={listing} />
          ))}
        </div>
      )}
    </div>
  );
};

export default Profile;