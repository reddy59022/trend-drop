import React, { useState, useEffect } from 'react';
import { FaFire, FaChartLine, FaSync, FaClock, FaEye, FaRetweet, FaComment, FaHeart } from 'react-icons/fa';
import api from '../services/api';
import ListingCard from '../components/ListingCard';

const Trends = () => {
  const [trends, setTrends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState('week');
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    fetchTrends();
  }, [timeframe, activeTab]);

  const fetchTrends = async () => {
    setLoading(true);
    try {
      const endpoint = activeTab === 'viral' ? '/trends/viral' : '/trends';
      const res = await api.get(endpoint, { params: { timeframe } });
      setTrends(res.data || []);
    } catch (error) {
      console.error('Error fetching trends:', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshTrends = async () => {
    try {
      await api.post('/trends/refresh');
      fetchTrends();
    } catch (error) {
      console.error('Error refreshing trends:', error);
    }
  };

  return (
    <div className="page-container" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 12, margin: 0 }}>
          <FaFire color="var(--td-warning)" /> Trending Now
        </h1>
        <button onClick={refreshTrends} className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FaSync /> Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="glass-card" style={{ padding: 4, marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => setActiveTab('all')}
            className={`btn ${activeTab === 'all' ? 'btn-primary' : 'btn-outline'}`}
            style={{ flex: 1 }}
          >
            <FaChartLine /> All Trends
          </button>
          <button
            onClick={() => setActiveTab('viral')}
            className={`btn ${activeTab === 'viral' ? 'btn-primary' : 'btn-outline'}`}
            style={{ flex: 1 }}
          >
            <FaFire /> Viral
          </button>
        </div>
      </div>

      {/* Timeframe Filter */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {['day', 'week', 'month'].map(tf => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            className={`btn ${timeframe === tf ? 'btn-primary' : 'btn-outline'}`}
            style={{ flex: 1, minWidth: 100 }}
          >
            <FaClock /> {tf.charAt(0).toUpperCase() + tf.slice(1)}
          </button>
        ))}
      </div>

      {/* Trends Grid */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass-card" style={{ padding: 16, height: 200 }} />
          ))}
        </div>
      ) : trends.length === 0 ? (
        <div className="empty-state" style={{ padding: 'var(--td-space-xl)' }}>
          <div className="empty-state-icon">📊</div>
          <h3>No trends found</h3>
          <p>Try refreshing or changing the timeframe</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {trends.map(trend => (
            <div key={trend.postId} className="glass-card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <h3 style={{ margin: 0, flex: 1 }}>{trend.author}</h3>
                {trend.isViral && <FaFire color="var(--td-warning)" size={20} />}
              </div>

              <p style={{ color: 'var(--td-text-secondary)', marginBottom: 12 }}>{trend.text}</p>

              <div style={{ display: 'flex', gap: 16, fontSize: 14, color: 'var(--td-text-tertiary)', marginBottom: 12 }}>
                <span><FaHeart /> {trend.likes}</span>
                <span><FaRetweet /> {trend.reposts}</span>
                <span><FaComment /> {trend.replies}</span>
                <span><FaEye /> {trend.views}</span>
              </div>

              {trend.hashtags?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
                  {trend.hashtags.map(tag => (
                    <span key={tag} className="badge badge-outline" style={{ fontSize: 11 }}>
                      #{tag}
                    </span>
                  ))}
                </div>
              )}

              <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>
                {new Date(trend.timestamp).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Trends;