import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { FaVideo, FaUpload, FaPlay, FaHeart, FaShare, FaChartLine, FaPlus, FaFilm, FaEye } from 'react-icons/fa';
import api from '../services/api';

const VideoShopping = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [videos, setVideos] = useState([]);
  const [showUpload, setShowUpload] = useState(false);
  const [selectedListing, setSelectedListing] = useState('');
  const [userListings, setUserListings] = useState([]);

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
      const [videosRes, listingsRes] = await Promise.all([
        api.get('/video-shopping'),
        api.get('/users/me/listings')
      ]);
      setVideos(videosRes.data || []);
      setUserListings(listingsRes.data || []);
    } catch (error) {
      console.error('Error fetching video data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!selectedListing) return;
    
    try {
      await api.post('/video-shopping/upload', {
        listingId: selectedListing,
        videoUrl: 'https://example.com/placeholder.mp4',
        duration: 15
      });
      setShowUpload(false);
      fetchData();
    } catch (error) {
      console.error('Error uploading video:', error);
    }
  };

  const handleLike = async (videoId) => {
    try {
      await api.post(`/video-shopping/${videoId}/like`);
      fetchData();
    } catch (error) {
      console.error('Error liking video:', error);
    }
  };

  const handleShare = async (videoId) => {
    try {
      await api.post(`/video-shopping/${videoId}/share`);
      fetchData();
    } catch (error) {
      console.error('Error sharing video:', error);
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
        <FaVideo /> Video Shopping
      </h1>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h3><FaChartLine /> Your Video Analytics</h3>
          <p>Total Videos: {videos.length}</p>
          <p>Total Views: {videos.reduce((sum, v) => sum + (v.analytics?.views || 0), 0)}</p>
          <p>Total Likes: {videos.reduce((sum, v) => sum + (v.analytics?.likes || 0), 0)}</p>
          <p>Total Shares: {videos.reduce((sum, v) => sum + (v.analytics?.shares || 0), 0)}</p>
        </div>
        
        <button onClick={() => setShowUpload(true)} className="btn btn-primary">
          <FaPlus /> Upload New Video
        </button>
      </div>

      {showUpload && (
        <div className="glass-card" style={{ padding: 20, marginBottom: 24 }}>
          <h3 style={{ marginTop: 0 }}>Upload Video</h3>
          <select 
            value={selectedListing} 
            onChange={(e) => setSelectedListing(e.target.value)}
            className="input"
            style={{ width: '100%', marginBottom: 16 }}
          >
            <option value="">Select a listing</option>
            {userListings.map(listing => (
              <option key={listing._id} value={listing._id}>{listing.title}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={handleUpload} className="btn btn-primary" disabled={!selectedListing}>
              <FaUpload /> Upload
            </button>
            <button onClick={() => setShowUpload(false)} className="btn btn-outline">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {videos.map(video => (
          <div key={video._id} className="glass-card" style={{ padding: 16 }}>
            <div style={{ position: 'relative', marginBottom: 12 }}>
              {video.thumbnailUrl ? (
                <img src={video.thumbnailUrl} alt={video.title} style={{ width: '100%', borderRadius: 'var(--td-radius-lg)' }} />
              ) : (
                <div style={{ 
                  background: 'var(--td-primary)', 
                  aspectRatio: '16/9', 
                  borderRadius: 'var(--td-radius-lg',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <FaFilm size={48} color="white" />
                </div>
              )}
              <div style={{ 
                position: 'absolute', 
                bottom: 8, 
                right: 8, 
                background: 'rgba(0,0,0,0.7)', 
                color: 'white', 
                padding: '4px 8px',
                borderRadius: 'var(--td-radius-full)',
                fontSize: 12
              }}>
                {video.duration}s
              </div>
            </div>
            
            <h4 style={{ margin: '0 0 8px 0' }}>{video.title || video.listing?.title}</h4>
            <p style={{ color: 'var(--td-text-secondary)', fontSize: 14, marginBottom: 12 }}>
              {video.description}
            </p>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--td-text-secondary)', fontSize: 14, marginBottom: 12 }}>
              <span><FaEye /> {video.analytics?.views || 0}</span>
              <span><FaHeart /> {video.analytics?.likes || 0}</span>
              <span><FaShare /> {video.analytics?.shares || 0}</span>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => handleLike(video._id)} className="btn btn-outline" style={{ flex: 1 }}>
                <FaHeart /> Like
              </button>
              <button onClick={() => handleShare(video._id)} className="btn btn-outline" style={{ flex: 1 }}>
                <FaShare /> Share
              </button>
            </div>
          </div>
        ))}

        {videos.length === 0 && (
          <div className="glass-card" style={{ padding: 40, gridColumn: '1/-1', textAlign: 'center' }}>
            <FaVideo size={64} style={{ opacity: 0.3, marginBottom: 16 }} />
            <h3>No videos yet</h3>
            <p>Upload your first product video to get started!</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoShopping;