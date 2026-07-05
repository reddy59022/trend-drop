import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { FaGem, FaTrophy, FaHistory, FaGift, FaStar } from 'react-icons/fa';
import api from '../services/api';

const LoyaltyProgram = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loyalty, setLoyalty] = useState(null);

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
      const res = await api.get('/loyalty');
      setLoyalty(res.data);
    } catch (error) {
      console.error('Error fetching loyalty data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getTierColor = (tier) => {
    switch (tier) {
      case 'Platinum': return 'var(--td-primary)';
      case 'Gold': return 'var(--td-warning)';
      default: return 'var(--td-success)';
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
        <FaGem /> Customer Loyalty Program
      </h1>

      <div className="glass-card" style={{ padding: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <div style={{ 
            width: 80, 
            height: 80, 
            borderRadius: '50%', 
            background: getTierColor(loyalty?.tier),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <FaStar size={32} color="white" />
          </div>
          <div>
            <h2 style={{ margin: 0 }}>{loyalty?.tier || 'Silver'} Member</h2>
            <p style={{ margin: 0, color: 'var(--td-text-secondary)' }}>
              {loyalty?.points || 0} Points Available
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div>
            <h4 style={{ marginBottom: 8 }}>Next Tier Benefits</h4>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              <li>• 5% bonus points on purchases</li>
              <li>• Free shipping on orders</li>
              <li>• Early access to sales</li>
            </ul>
          </div>
          <div>
            <h4 style={{ marginBottom: 8 }}>Anniversary Rewards</h4>
            <p>{loyalty?.anniversaryRewards?.length || 0} rewards earned</p>
          </div>
        </div>
      </div>

      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <FaHistory /> Points History
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {loyalty?.pointsHistory?.map((entry, idx) => (
          <div key={idx} className="glass-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span>{entry.reason}</span>
              <span style={{ 
                color: entry.amount > 0 ? 'var(--td-success)' : 'var(--td-error)',
                fontWeight: 600
              }}>
                {entry.amount > 0 ? '+' : ''}{entry.amount}
              </span>
            </div>
            <small style={{ color: 'var(--td-text-secondary)' }}>
              {new Date(entry.createdAt).toLocaleDateString()}
            </small>
          </div>
        ))}

        {(!loyalty?.pointsHistory || loyalty.pointsHistory.length === 0) && (
          <div className="glass-card" style={{ padding: 40, gridColumn: '1/-1', textAlign: 'center' }}>
            <FaGift size={64} style={{ opacity: 0.3, marginBottom: 16 }} />
            <h3>No points history yet</h3>
            <p>Make purchases and referrals to earn loyalty points!</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default LoyaltyProgram;