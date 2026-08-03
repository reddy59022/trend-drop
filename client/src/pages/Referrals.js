import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { toast } from 'react-toastify';
import { FaGift, FaLink, FaCopy, FaUsers, FaDollarSign, FaCheckCircle, FaShareAlt, FaTwitter, FaFacebookF } from 'react-icons/fa';
import { formatPrice } from '../utils/helpers';

const Referrals = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [referral, setReferral] = useState(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);
  const [copied, setCopied] = useState(false);
  const [shareText, setShareText] = useState('');

  useEffect(() => {
    if (!user) return;
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fetchData = async () => {
    try {
      const [statsRes, settingsRes] = await Promise.all([
        api.get('/referrals/my').catch(() => ({ data: { stats: { code: null, uses: 0, rewardClaimed: false, referredUsers: 0, rewardAmount: 10, status: 'none' } } })),
        api.get('/referrals/settings').catch(() => ({ data: { enabled: true, rewardAmount: 10, currency: 'USD', maxUsesPerCode: null, expiresInDays: 30 } })),
      ]);
      setStats(statsRes.data.stats);
      setSettings(settingsRes.data);
      if (statsRes.data.stats.code) {
        const link = `${window.location.origin}/register?ref=${statsRes.data.stats.code}`;
        setShareText(`Join me on AURAVEST and get $${statsRes.data.stats.rewardAmount || 10} off your first purchase! Use my code: ${statsRes.data.stats.code} 🛍️✨`);
      }
    } catch (error) {
      console.error(error);
    }
    setLoading(false);
  };

  const generateCode = async () => {
    try {
      const res = await api.post('/referrals/generate');
      setReferral(res.data.referral);
      setStats(prev => ({ ...prev, code: res.data.referral.code, status: 'active', rewardAmount: res.data.referral.rewardAmount }));
      const link = `${window.location.origin}/register?ref=${res.data.referral.code}`;
      setShareText(`Join me on AURAVEST and get $${res.data.referral.rewardAmount} off your first purchase! Use my code: ${res.data.referral.code} 🛍️✨`);
      toast.success('Your referral code has been generated!');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to generate code');
    }
  };

  const claimReward = async () => {
    try {
      const res = await api.post('/referrals/claim');
      toast.success(res.data.message);
      setStats(prev => ({ ...prev, rewardClaimed: true }));
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to claim reward');
    }
  };

  const copyCode = async () => {
    const code = referral?.code || stats?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const copyLink = async () => {
    const code = referral?.code || stats?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/register?ref=${code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const shareOnTwitter = () => {
    const text = encodeURIComponent(shareText);
    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank', 'noopener');
  };

  const shareOnFacebook = () => {
    const url = encodeURIComponent(`${window.location.origin}/register?ref=${referral?.code || stats?.code || ''}`);
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank', 'noopener');
  };

  if (loading) return (
    <div className="page-container">
      <h1 className="page-title"><FaGift /> Referral Program</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        {[...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 100, borderRadius: 'var(--td-radius-lg)' }} />)}
      </div>
    </div>
  );

  if (!user) return (
    <div className="page-container">
      <div className="empty-state">
        <div className="empty-state-icon">🎁</div>
        <h2>Referral Program</h2>
        <p>Sign in to get your personal referral link</p>
        <Link to="/login" className="btn btn-primary btn-lg">Sign In</Link>
      </div>
    </div>
  );

  const code = referral?.code || stats?.code;
  const earned = (stats?.uses || 0) * (stats?.rewardAmount || settings?.rewardAmount || 10);

  return (
    <div className="page-container" style={{ maxWidth: 960, margin: '0 auto' }}>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}><FaGift /> Referral Program</h1>

      {/* Hero */}
      <div className="glass-card" style={{ padding: 'var(--td-space-xl)', marginBottom: 'var(--td-space-lg)', textAlign: 'center', background: 'linear-gradient(135deg, var(--td-primary) 0%, #FF6B81 100%)', color: '#fff' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🎁</div>
        <h2 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Give $10, Get $10</h2>
        <p style={{ opacity: 0.9, maxWidth: 480, margin: '0 auto 20px' }}>
          Share your code with friends. When they join AURAVEST, you both earn ${(stats?.rewardAmount || settings?.rewardAmount || 10).toFixed(2)} in credit.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <div className="badge" style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 20, padding: '8px 16px', fontSize: 13 }}>
            <FaUsers /> {stats?.referredUsers || 0} friends joined
          </div>
          <div className="badge" style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 20, padding: '8px 16px', fontSize: 13 }}>
            <FaDollarSign /> {formatPrice(earned, 'USD')} earned
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 'var(--td-space-lg)' }}>
        <div className="glass-card" style={{ padding: 'var(--td-space-lg)', textAlign: 'center' }}>
          <div style={{ color: 'var(--td-primary)', marginBottom: 8 }}><FaLink size={20} /></div>
          <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Your Code</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{code || '—'}</div>
        </div>
        <div className="glass-card" style={{ padding: 'var(--td-space-lg)', textAlign: 'center' }}>
          <div style={{ color: 'var(--td-success)', marginBottom: 8 }}><FaUsers size={20} /></div>
          <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Total Referrals</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{stats?.uses || 0}</div>
        </div>
        <div className="glass-card" style={{ padding: 'var(--td-space-lg)', textAlign: 'center' }}>
          <div style={{ color: 'var(--td-warning)', marginBottom: 8 }}><FaDollarSign size={20} /></div>
          <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Reward Amount</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{formatPrice(stats?.rewardAmount || settings?.rewardAmount || 10, 'USD')}</div>
        </div>
        <div className="glass-card" style={{ padding: 'var(--td-space-lg)', textAlign: 'center' }}>
          <div style={{ color: stats?.rewardClaimed ? 'var(--td-success)' : 'var(--td-text-tertiary)', marginBottom: 8 }}><FaCheckCircle size={20} /></div>
          <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Status</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: stats?.rewardClaimed ? 'var(--td-success)' : 'var(--td-info)' }}>
            {stats?.rewardClaimed ? 'Claimed' : (stats?.status === 'none' ? 'Not started' : 'Active')}
          </div>
        </div>
      </div>

      {!code ? (
        <div className="glass-card" style={{ padding: 'var(--td-space-xl)', textAlign: 'center' }}>
          <div className="empty-state-icon">🎉</div>
          <h3 style={{ marginBottom: 8 }}>Get your referral code</h3>
          <p style={{ color: 'var(--td-text-tertiary)', marginBottom: 20 }}>
            Generate a unique code to share with friends and start earning
          </p>
          <button className="btn btn-primary btn-lg" onClick={generateCode}>
            <FaGift size={16} /> Generate My Code
          </button>
        </div>
      ) : (
        <>
          {/* Referral code + sharing */}
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)', marginBottom: 'var(--td-space-lg)' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}><FaShareAlt /> Share Your Code</h3>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--td-surface-2)', padding: '12px 20px', borderRadius: 'var(--td-radius-md)', border: '1px dashed var(--td-primary)', flex: 1, minWidth: 200 }}>
                <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: 2 }}>{code}</span>
                <button className="btn btn-sm btn-outline" onClick={copyCode} style={{ marginLeft: 'auto' }}>
                  {copied ? <FaCheckCircle style={{ color: 'var(--td-success)' }} /> : <FaCopy />} {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <button className="btn btn-sm btn-outline" onClick={copyLink}>
                <FaLink size={12} /> Copy Link
              </button>
              <button className="btn btn-sm btn-outline" onClick={shareOnTwitter}>
                <FaTwitter size={12} /> Tweet
              </button>
              <button className="btn btn-sm btn-outline" onClick={shareOnFacebook}>
                <FaFacebookF size={12} /> Share
              </button>
            </div>
            <div style={{ fontSize: 13, color: 'var(--td-text-tertiary)' }} className="share-preview">
              {shareText}
            </div>
          </div>

          {/* How it works */}
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)', marginBottom: 'var(--td-space-lg)' }}>
            <h3 style={{ marginBottom: 16 }}>How It Works</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <div>
                <div style={{ fontSize: 32, marginBottom: 8 }}>1️⃣</div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Share your code</div>
                <div style={{ fontSize: 13, color: 'var(--td-text-tertiary)' }}>Send your unique code to friends via text, social, or email.</div>
              </div>
              <div>
                <div style={{ fontSize: 32, marginBottom: 8 }}>2️⃣</div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>They join AURAVEST</div>
                <div style={{ fontSize: 13, color: 'var(--td-text-tertiary)' }}>Your friend signs up with your code and gets ${(stats?.rewardAmount || settings?.rewardAmount || 10).toFixed(2)} credit.</div>
              </div>
              <div>
                <div style={{ fontSize: 32, marginBottom: 8 }}>3️⃣</div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>You both earn</div>
                <div style={{ fontSize: 13, color: 'var(--td-text-tertiary)' }}>You get ${(stats?.rewardAmount || settings?.rewardAmount || 10).toFixed(2)} credit when they make their first purchase!</div>
              </div>
            </div>
          </div>

          {/* Claim reward */}
          {!stats?.rewardClaimed && (stats?.uses || 0) > 0 && (
            <div className="glass-card" style={{ padding: 'var(--td-space-lg)', marginBottom: 'var(--td-space-lg)', border: '1px solid var(--td-success)', textAlign: 'center' }}>
              <h3 style={{ color: 'var(--td-success)', marginBottom: 8 }}>
                <FaCheckCircle /> You earned ${formatPrice(earned, 'USD')}!
              </h3>
              <p style={{ fontSize: 14, color: 'var(--td-text-secondary)', marginBottom: 16 }}>
                Claim your reward to add it to your AURAVEST balance.
              </p>
              <button className="btn btn-success" onClick={claimReward}>
                <FaDollarSign size={14} /> Claim ${formatPrice(earned, 'USD')}
              </button>
            </div>
          )}
        </>
      )}

      {/* Referred users list */}
      {stats?.referredUsers > 0 && (
        <div className="glass-card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: 'var(--td-space-md) var(--td-space-lg)', borderBottom: '1px solid var(--td-border)', fontWeight: 700, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <FaUsers size={16} /> Referred Friends
          </div>
          <div className="empty-state" style={{ padding: 'var(--td-space-lg)' }}>
            <p style={{ fontSize: 14, color: 'var(--td-text-tertiary)' }}>
              You've referred {stats?.referredUsers} friend{stats?.referredUsers > 1 ? 's' : ''}. Track detailed referrals here as they join.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Referrals;