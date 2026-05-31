import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { getPayoutDashboard, getCommissionInfo, getRatingsBySeller } from '../services/api';
import StarRating from '../components/StarRating';
import { formatPrice } from '../utils/helpers';
import { FaStore, FaDollarSign, FaChartLine, FaStar, FaHistory, FaRocket, FaQuestionCircle } from 'react-icons/fa';

const SellerDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [commissionInfo, setCommissionInfo] = useState(null);
  const [reviews, setReviews] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    fetchData();
  }, [user, navigate]); // eslint-disable-line

  const fetchData = async () => {
    try {
      const [dashRes, commRes] = await Promise.all([
        getPayoutDashboard().catch(() => ({ data: { commissionRate: 0.10, commissionPercent: 10, totalSales: 0, totalCommission: 0, totalEarnings: 0, pendingAmount: 0, payoutHistory: [], recentTransactions: [] } })),
        getCommissionInfo().catch(() => ({ data: { commissionPercent: 10, sellerKeeps: '90%', comparedTo: {} } })),
      ]);
      setDashboard(dashRes.data);
      setCommissionInfo(commRes.data);
      try { const revRes = await getRatingsBySeller(user._id); setReviews(revRes.data); } catch { setReviews({ averageRating: 0, count: 0 }); }
    } catch (error) { console.error(error); }
    finally { setLoading(false); }
  };

  if (loading) return (
    <div className="page-container">
      <h1 className="page-title"><FaStore /> Seller Dashboard</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        {[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ height: 100, borderRadius: 'var(--td-radius-lg)' }} />)}
      </div>
    </div>
  );

  if (!dashboard) return <div className="page-container"><div className="empty-state"><h2>Failed to load</h2></div></div>;

  const stats = [
    { label: 'Total Sales', value: formatPrice(dashboard.totalSales || 0, user?.currency), color: 'var(--td-primary)', icon: <FaDollarSign /> },
    { label: 'Your Earnings', value: formatPrice(dashboard.totalEarnings || 0, user?.currency), color: 'var(--td-success)', icon: <FaChartLine /> },
    { label: 'Commission', value: formatPrice(dashboard.totalCommission || 0, user?.currency), color: 'var(--td-error)', icon: <FaDollarSign /> },
    { label: 'Pending Payout', value: formatPrice(dashboard.pendingAmount || 0, user?.currency), color: 'var(--td-warning)', icon: <FaHistory /> },
  ];

  return (
    <div className="page-container" style={{ maxWidth: 900, margin: '0 auto' }}>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}><FaStore /> Seller Dashboard</h1>

      {/* Commission Banner */}
      {commissionInfo && (
        <div className="commission-section" style={{ borderRadius: 'var(--td-radius-xl)', marginBottom: 'var(--td-space-lg)', animation: 'fadeInUp 0.3s ease-out' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, opacity: 0.9, marginBottom: 4 }}>TrendDrop Commission</div>
            <div style={{ fontSize: 48, fontWeight: 800, marginBottom: 4 }}>Only {commissionInfo.commissionPercent}%</div>
            <div style={{ fontSize: 16, marginBottom: 16 }}>You keep {commissionInfo.sellerKeeps} of every sale</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, background: 'rgba(255,255,255,0.12)', borderRadius: 'var(--td-radius-md)', padding: 16, maxWidth: 400, margin: '0 auto' }}>
              {Object.entries(commissionInfo.comparedTo || {}).map(([platform, rate]) => (
                <div key={platform} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', opacity: 0.8, marginBottom: 4, letterSpacing: 1 }}>{platform}</div>
                  <div style={{ fontSize: platform === 'trenddrop' ? 22 : 18, fontWeight: platform === 'trenddrop' ? 800 : 600 }}>{rate}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 'var(--td-space-lg)' }}>
        {stats.map((stat, i) => (
          <div key={i} className="glass-card" style={{ padding: 'var(--td-space-lg)', textAlign: 'center', animation: `fadeInUp 0.3s ease-out ${i * 0.05}s both` }}>
            <div style={{ color: stat.color, marginBottom: 8 }}>{stat.icon}</div>
            <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{stat.label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: stat.color }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Reviews & Quick Links */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 'var(--td-space-lg)' }}>
        {reviews && (
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)', display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--td-primary)' }}>{reviews.averageRating?.toFixed(1) || '0.0'}</div>
            <div><StarRating rating={reviews.averageRating || 0} size={18} readonly /><div style={{ fontSize: 13, color: 'var(--td-text-tertiary)', marginTop: 4 }}>{reviews.count || 0} reviews</div></div>
          </div>
        )}
        <div className="glass-card" style={{ padding: 'var(--td-space-lg)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--td-text-secondary)' }}>Quick Actions</h4>
          <Link to="/sell" className="btn btn-primary btn-sm btn-block"><FaRocket size={14} /> List New Item</Link>
          <Link to="/seller-dashboard" className="btn btn-outline btn-sm btn-block"><FaStore size={14} /> View Dashboard</Link>
        </div>
      </div>

      {/* Payout History */}
      <div className="glass-card" style={{ overflow: 'hidden', marginBottom: 'var(--td-space-lg)' }}>
        <div style={{ padding: 'var(--td-space-md) var(--td-space-lg)', borderBottom: '1px solid var(--td-border)', fontWeight: 700, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FaHistory size={16} /> Payout History
        </div>
        {dashboard.payoutHistory?.length === 0 ? (
          <div className="empty-state" style={{ padding: 'var(--td-space-xxl)' }}>
            <div className="empty-state-icon">💰</div>
            <h3>No payouts yet</h3>
            <p>Complete your first sale to see payouts here</p>
          </div>
        ) : (
          dashboard.payoutHistory?.map((p, i) => (
            <div key={i} style={{ padding: 'var(--td-space-md) var(--td-space-lg)', borderBottom: i < dashboard.payoutHistory.length - 1 ? '1px solid var(--td-border-light)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{p.listing?.title || 'Sale'}</div>
                <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>Sale: {formatPrice(p.salePrice)} • Fee: {formatPrice(p.commissionAmount)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, color: 'var(--td-success)', fontSize: 16 }}>+{formatPrice(p.payoutAmount)}</div>
                <div style={{ fontSize: 11, color: 'var(--td-text-tertiary)' }}>{p.paidAt ? new Date(p.paidAt).toLocaleDateString() : ''}</div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* How Payouts Work */}
      <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}><FaQuestionCircle /> How Payouts Work</h3>
        <div style={{ fontSize: 14, color: 'var(--td-text-secondary)', lineHeight: 2 }}>
          <div>1️⃣ <strong>List your item</strong> — It's free to list</div>
          <div>2️⃣ <strong>Buyer purchases</strong> — Payment is held securely</div>
          <div>3️⃣ <strong>Ship within 7 days</strong> — Use prepaid shipping label</div>
          <div>4️⃣ <strong>Buyer confirms delivery</strong> — Funds are released</div>
          <div>5️⃣ <strong>Get paid</strong> — Only {commissionInfo?.commissionPercent || 10}% commission deducted</div>
        </div>
      </div>
    </div>
  );
};

export default SellerDashboard;