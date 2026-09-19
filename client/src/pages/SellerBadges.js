import React, { useState, useEffect, useRef } from 'react';
import { getMySellerBadge, requestSellerVerification, updateSellerBadgeStats } from '../services/api';
import { toast } from 'react-toastify';

const TIER_STYLES = {
  bronze: { color: '#CD7F32', label: 'Bronze', icon: '🥉' },
  silver: { color: '#C0C0C0', label: 'Silver', icon: '🥈' },
  gold: { color: '#FFD700', label: 'Gold', icon: '🥇' },
  platinum: { color: '#E5E4E2', label: 'Platinum', icon: '💎' },
  none: { color: 'var(--td-text-secondary)', label: 'No Badge', icon: '🏷️' },
};

const asNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

// Badge rates are stored as decimals (0.95), but normalize legacy percentage
// values too so the UI never displays 9500% when reading older records.
const asRate = (value) => {
  const number = asNumber(value);
  if (number === null || number < 0 || number > 100) return null;
  return number > 1 ? number / 100 : number;
};

const formatPercent = (rate, decimals = 0) => {
  if (rate === null || rate === undefined) return '—';
  const percentage = (rate * 100).toFixed(decimals);
  return `${decimals ? percentage : Number(percentage)}%`;
};

const formatResponseRate = (rate) => {
  if (rate === null || rate === undefined) return '—';
  return formatPercent(rate, Number.isInteger(rate * 100) ? 0 : 1);
};

const formatVerifiedSince = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : `since ${date.toLocaleDateString()}`;
};

const normalizeBadge = (rawBadge) => {
  if (!rawBadge) return null;
  const salesCount = asNumber(rawBadge.salesCount ?? rawBadge.totalSales);
  const avgRating = asNumber(rawBadge.avgRating ?? rawBadge.averageRating);
  return {
    ...rawBadge,
    // Support the legacy API names while the data migration completes, while
    // keeping malformed values out of both the cards and edit form.
    salesCount: salesCount !== null && Number.isInteger(salesCount) && salesCount >= 0 ? salesCount : null,
    avgRating: avgRating !== null && avgRating >= 0 && avgRating <= 5 ? avgRating : null,
    responseRate: asRate(rawBadge.responseRate),
    returnRate: asRate(rawBadge.returnRate),
  };
};

const TIER_REQUIREMENTS = [
  { tier: 'bronze', sales: '0+', rating: '4.0+', returnRate: '≤15%', benefits: 'Basic selling' },
  { tier: 'silver', sales: '10+', rating: '4.5+', returnRate: '≤10%', benefits: 'Badge visibility' },
  { tier: 'gold', sales: '50+', rating: '4.7+', returnRate: '≤5%', benefits: 'Featured listings' },
  { tier: 'platinum', sales: '200+', rating: '4.8+', returnRate: '≤2%', benefits: 'Top placement + priority' },
];

const SellerBadges = () => {
  const [badge, setBadge] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [updatingStats, setUpdatingStats] = useState(false);
  const verificationInFlight = useRef(false);
  const statsUpdateInFlight = useRef(false);
  const [form, setForm] = useState({ salesCount: 0, avgRating: 0, responseRate: 0, returnRate: 0 });

  useEffect(() => {
    fetchBadge();
  }, []);

  const fetchBadge = async () => {
    try {
      const res = await getMySellerBadge();
      const normalizedBadge = normalizeBadge(res.data?.badge);
      setBadge(normalizedBadge);
      setLoadError(false);
      if (normalizedBadge) {
        setForm({
          salesCount: normalizedBadge.salesCount ?? 0,
          avgRating: normalizedBadge.avgRating ?? 0,
          responseRate: normalizedBadge.responseRate ?? 0,
          returnRate: normalizedBadge.returnRate ?? 0,
        });
      }
      return true;
    } catch (error) {
      console.error('Failed to fetch badge:', error);
      setLoadError(true);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (verificationInFlight.current) return;
    verificationInFlight.current = true;
    setVerifying(true);
    try {
      await requestSellerVerification();
      if (await fetchBadge()) {
        toast.success('Verification requested! Your badge will be reviewed by our team.');
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to request verification');
    } finally {
      verificationInFlight.current = false;
      setVerifying(false);
    }
  };

  const handleUpdateStats = async () => {
    if (statsUpdateInFlight.current) return;
    const validStats = Number.isInteger(form.salesCount) && form.salesCount >= 0
      && Number.isFinite(form.avgRating) && form.avgRating >= 0 && form.avgRating <= 5
      && Number.isFinite(form.responseRate) && form.responseRate >= 0 && form.responseRate <= 1
      && Number.isFinite(form.returnRate) && form.returnRate >= 0 && form.returnRate <= 1;
    if (!validStats) {
      toast.error('Enter valid stats: sales must be a whole number, rating 0–5, and rates 0–1.');
      return;
    }

    statsUpdateInFlight.current = true;
    setUpdatingStats(true);
    try {
      await updateSellerBadgeStats(form);
      if (await fetchBadge()) {
        toast.success('Seller stats updated — tier recalculated!');
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update stats');
    } finally {
      statsUpdateInFlight.current = false;
      setUpdatingStats(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container" style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
        <div className="spinner"></div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="page-container" style={{ maxWidth: 900, margin: '0 auto', padding: 'var(--td-space-lg)', textAlign: 'center' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Seller Badges</h1>
        <p role="alert" style={{ color: 'var(--td-text-secondary)', marginBottom: 16 }}>Unable to load seller badge.</p>
        <button className="btn btn-primary" onClick={() => { setLoading(true); fetchBadge(); }}>Retry</button>
      </div>
    );
  }

  const tierInfo = TIER_STYLES[badge?.tier] || TIER_STYLES.none;

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
            ✓ Verified Seller {formatVerifiedSince(badge.verifiedAt)}
          </div>
        )}
        {!badge?.isVerified && badge?.verificationRequested && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(234,179,8,0.1)', color: 'var(--td-warning)', borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 600, marginTop: 8 }}>
            Verification pending review
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginTop: 20 }}>
          <div className="stat-box" style={{ padding: 12, borderRadius: 12, background: 'var(--td-bg-secondary)' }}>
            <div style={{ fontSize: 11, color: 'var(--td-text-tertiary)' }}>Sales</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{badge?.salesCount ?? '—'}</div>
          </div>
          <div className="stat-box" style={{ padding: 12, borderRadius: 12, background: 'var(--td-bg-secondary)' }}>
            <div style={{ fontSize: 11, color: 'var(--td-text-tertiary)' }}>Avg Rating</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{badge?.avgRating !== null && badge?.avgRating !== undefined ? badge.avgRating.toFixed(1) : '—'}</div>
          </div>
          <div className="stat-box" style={{ padding: 12, borderRadius: 12, background: 'var(--td-bg-secondary)' }}>
            <div style={{ fontSize: 11, color: 'var(--td-text-tertiary)' }}>Response Rate</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{formatResponseRate(badge?.responseRate)}</div>
          </div>
          <div className="stat-box" style={{ padding: 12, borderRadius: 12, background: 'var(--td-bg-secondary)' }}>
            <div style={{ fontSize: 11, color: 'var(--td-text-tertiary)' }}>Return Rate</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{formatPercent(badge?.returnRate, 1)}</div>
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

        {!badge?.isVerified && !badge?.verificationRequested && (
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
            <label htmlFor="seller-sales-count" style={{ fontSize: 12, color: 'var(--td-text-secondary)' }}>Sales Count</label>
            <input
              id="seller-sales-count"
              className="form-input"
              type="number"
              min={0}
              step={1}
              value={form.salesCount}
              onChange={(e) => setForm({ ...form, salesCount: Number(e.target.value) })}
            />
          </div>
          <div>
            <label htmlFor="seller-avg-rating" style={{ fontSize: 12, color: 'var(--td-text-secondary)' }}>Avg Rating</label>
            <input
              id="seller-avg-rating"
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
            <label htmlFor="seller-response-rate" style={{ fontSize: 12, color: 'var(--td-text-secondary)' }}>Response Rate (0–1)</label>
            <input
              id="seller-response-rate"
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
            <label htmlFor="seller-return-rate" style={{ fontSize: 12, color: 'var(--td-text-secondary)' }}>Return Rate (0–1)</label>
            <input
              id="seller-return-rate"
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
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={handleUpdateStats} disabled={updatingStats}>
          {updatingStats ? 'Recalculating...' : 'Recalculate Tier'}
        </button>
      </div>
    </div>
  );
};

export default SellerBadges;