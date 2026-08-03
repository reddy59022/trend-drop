import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getMySellerBadge, requestSellerVerification, updateSellerBadgeStats } from '../services/api';

const TIER_STYLES = {
  bronze: { color: '#CD7F32', label: 'Bronze', icon: '🥉' },
  silver: { color: '#C0C0C0', label: 'Silver', icon: '🥈' },
  gold: { color: '#FFD700', label: 'Gold', icon: '🥇' },
  platinum: { color: '#E5E4E2', label: 'Platinum', icon: '💎' },
};

const TIER_REQUIREMENTS = [
  { tier: 'bronze', sales: '0+', rating: '4.0+', returnRate: '≤15%', benefits: 'Basic selling' },
  { tier: 'silver', sales: '10+', rating: '4.5+', returnRate: '≤10%', benefits: 'Badge visibility' },
  { tier: 'gold', sales: '50+', rating: '4.7+', returnRate: '≤5%', benefits: 'Featured listings' },
  { tier: 'platinum', sales: '200+', rating: '4.8+', returnRate: '≤2%', benefits: 'Top placement + priority' },
];

const SellerBadges = () => {
  const { user } = useAuth();
  const [badge, setBadge] = useState(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [form, setForm] = useState({ salesCount: 0, avgRating: 0, responseRate: 0, returnRate: 0 });

  useEffect(() => {
    fetchBadge();
  }, []);

  const fetchBadge = async () => {
    try {
      const res = await getMySellerBadge();
      setBadge(res.data.badge);
      if (res.data.badge) {
        setForm({
          salesCount: res.data.badge.salesCount || 0,
          avgRating: res.data.badge.avgRating || 0,
          responseRate: res.data.badge.responseRate || 0,
          returnRate: res.data.badge.returnRate || 0,
        });
      }
    } catch (error) {
      console.error('Failed to fetch badge:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    try {
      await requestSellerVerification();
      await fetchBadge();
      alert('Verification requested! Your badge will be reviewed by our team.');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to request verification');
    } finally {
      setVerifying(false);
    }
  };

  const handleUpdateStats = async () => {
    try {
      await updateSellerBadgeStats(form);
      await fetchBadge();
      alert('Seller stats updated — tier recalculated!');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to update stats');
    }
  };

  if (loading) {
    return (
      <div className="page-container" style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
        <div className="spinner"></div>
      </div>
    );
  }

  const tierInfo = TIER_STYLES[badge?.tier] || TIER_STYLES.bronze;

  return (
    <div className="page-container" style={{ maxWidth: 900, margin: '0 auto', padding: 'var(--td-space-lg)' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Seller Badges</h1>
      <p style={{ color: 'var(--td-text-secondary)', marginBottom: 24 }}>
        Earn badges by maintaining high ratings, response rates, and low return rates.
      </p>

      {/* Current Badge Card */}
      <div className="glass-card" style={{ padding: 'var(--td-space-xl)', marginBottom: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 56, marginBottom: 8 }}>{tierInfo.icon}</div>
        <h2 style={{ fontSize: 28, fontWeight: 800, color: tierInfo.color, textTransform: 'uppercase', letterSpacing: 1 }}>
          {tierInfo.label}
        </h2>
        {badge?.isVerified && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(34,197,94,0.1)', color: 'var(--td-success)', borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 600, marginTop: 8 }}>
            ✓ Verified Seller {badge.verifiedAt ? `since ${new Date(badge.verifiedAt).toLocaleDateString()}` : ''}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginTop: 20 }}>
          <div className="stat-box" style={{ padding: 12, borderRadius: 12, background: 'var(--td-bg-secondary)' }}>
            <div style={{ fontSize: 11, color: 'var(--td-text-tertiary)' }}>Sales</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{badge?.salesCount || 0}</div>
          </div>
          <div className="stat-box" style={{ padding: 12, borderRadius: 12, background: 'var(--td-bg-secondary)' }}>
            <div style={{ fontSize: 11, color: 'var(--td-text-tertiary)' }}>Avg Rating</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{badge?.avgRating ? badge.avgRating.toFixed(1) : '—'}</div>
          </div>
          <div className="stat-box" style={{ padding: 12, borderRadius: 12, background: 'var(--td-bg-secondary)' }}>
            <div style={{ fontSize: 11, color: 'var(--td-text-tertiary)' }}>Response Rate</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{badge?.responseRate ? `${Math.round(badge.responseRate * 100)}%` : '—'}</div>
          </div>
          <div className="stat-box" style={{ padding: 12, borderRadius: 12, background: 'var(--td-bg-secondary)' }}>
            <div style={{ fontSize: 11, color: 'var(--td-text-tertiary)' }}>Return Rate</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{badge?.returnRate ? `${(badge.returnRate * 100).toFixed(1)}%` : '—'}</div>
          </div>
        </div>

        {/* Benefits */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 16 }}>
          <span className={`badge ${badge?.benefits?.featuredListings ? 'badge-primary' : ''}`}>
            {badge?.benefits?.featuredListings ? '✅ Featured Listings' : '⚪ Featured Listings'}
          </span>
          <span className={`badge ${badge?.benefits?.reducedFees ? 'badge-primary' : ''}`}>
            {badge?.benefits?.reducedFees ? '✅ Reduced Fees' : '⚪ Reduced Fees'}
          </span>
          <span className={`badge ${badge?.benefits?.prioritySupport ? 'badge-primary' : ''}`}>
            {badge?.benefits?.prioritySupport ? '✅ Priority Support' : '⚪ Priority Support'}
          </span>
        </div>

        {!badge?.isVerified && (
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={handleVerify} disabled={verifying}>
            {verifying ? 'Requesting...' : 'Request Verification'}
          </button>
        )}
      </div>

      {/* Tier Requirements Table */}
      <div className="glass-card" style={{ padding: 'var(--td-space-lg)', marginBottom: 24 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Tier Requirements</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--td-border-light)', textAlign: 'left' }}>
                <th style={{ padding: 8, fontSize: 12, textTransform: 'uppercase', color: 'var(--td-text-tertiary)' }}>Tier</th>
                <th style={{ padding: 8, fontSize: 12, textTransform: 'uppercase', color: 'var(--td-text-tertiary)' }}>Sales</th>
                <th style={{ padding: 8, fontSize: 12, textTransform: 'uppercase', color: 'var(--td-text-tertiary)' }}>Rating</th>
                <th style={{ padding: 8, fontSize: 12, textTransform: 'uppercase', color: 'var(--td-text-tertiary)' }}>Return Rate</th>
                <th style={{ padding: 8, fontSize: 12, textTransform: 'uppercase', color: 'var(--td-text-tertiary)' }}>Benefits</th>
              </tr>
            </thead>
            <tbody>
              {TIER_REQUIREMENTS.map((t) => {
                const isCurrent = t.tier === badge?.tier;
                return (
                  <tr key={t.tier} style={{ borderBottom: '1px solid var(--td-border-light)', background: isCurrent ? 'rgba(255,215,0,0.05)' : 'transparent' }}>
                    <td style={{ padding: 8, fontWeight: 600 }}>
                      {TIER_STYLES[t.tier].icon} {TIER_STYLES[t.tier].label} {isCurrent && '⭐'}
                    </td>
                    <td style={{ padding: 8 }}>{t.sales}</td>
                    <td style={{ padding: 8 }}>{t.rating}</td>
                    <td style={{ padding: 8 }}>{t.returnRate}</td>
                    <td style={{ padding: 8, fontSize: 13 }}>{t.benefits}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Update Stats (for tier recalculation) */}
      <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Update Seller Stats</h3>
        <p style={{ fontSize: 13, color: 'var(--td-text-secondary)', marginBottom: 12 }}>
          Enter your latest selling metrics to recalculate your tier.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--td-text-secondary)' }}>Sales Count</label>
            <input
              className="form-input"
              type="number"
              min={0}
              value={form.salesCount}
              onChange={(e) => setForm({ ...form, salesCount: Number(e.target.value) })}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--td-text-secondary)' }}>Avg Rating</label>
            <input
              className="form-input"
              type="number"
              min={0}
              max={5}
              step={0.1}
              value={form.avgRating}
              onChange={(e) => setForm({ ...form, avgRating: Number(e.target.value) })}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--td-text-secondary)' }}>Response Rate (0-1)</label>
            <input
              className="form-input"
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={form.responseRate}
              onChange={(e) => setForm({ ...form, responseRate: Number(e.target.value) })}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--td-text-secondary)' }}>Return Rate (0-1)</label>
            <input
              className="form-input"
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={form.returnRate}
              onChange={(e) => setForm({ ...form, returnRate: Number(e.target.value) })}
            />
          </div>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={handleUpdateStats}>
          Recalculate Tier
        </button>
      </div>
    </div>
  );
};

export default SellerBadges;