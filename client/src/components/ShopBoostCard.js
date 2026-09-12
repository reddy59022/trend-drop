import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { toast } from 'react-toastify';
import { FaRocket, FaSpinner, FaTimes, FaBolt, FaCrown, FaChartLine } from 'react-icons/fa';

// Feature 3 — "Boost whole shop" toggle (Enterprise-grade card).
const ShopBoostCard = () => {
  const [shopBoost, setShopBoost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [boostedCount, setBoostedCount] = useState(0);

  useEffect(() => { fetchStatus(); }, []);

  const fetchStatus = async () => {
    try {
      const res = await api.get('/shop-boost');
      setShopBoost(res.data.shopBoost || { active: false });
      setBoostedCount(res.data.boostedListings || 0);
    } catch {} finally { setLoading(false); }
  };

  const toggle = async () => {
    if (!shopBoost) return;
    setSaving(true);
    try {
      if (shopBoost.active) {
        const res = await api.patch('/shop-boost/deactivate');
        setShopBoost(res.data.shopBoost); setBoostedCount(0);
        toast.success('Shop boost turned off. Listings restored to normal.');
      } else {
        const res = await api.post('/shop-boost');
        setShopBoost(res.data.shopBoost); setBoostedCount(res.data.boostedListings || 0);
        toast.success(`🚀 Shop boost ON — ${res.data.boostedListings || 0} listings boosted!`);
      }
    } catch (error) { toast.error(error.response?.data?.message || 'Something went wrong'); }
    setSaving(false);
  };

  if (loading) return <div className="skeleton" style={{ height: 140, borderRadius: 'var(--td-radius-lg)' }} />;

  const active = shopBoost?.active === true;
  const endDate = shopBoost?.endDate ? new Date(shopBoost.endDate) : null;
  const daysRemaining = endDate ? Math.max(0, Math.ceil((endDate - Date.now()) / (1000 * 60 * 60 * 24))) : 0;

  return (
    <div className="glass-card" style={{ padding: 'var(--td-space-xl)', marginBottom: 'var(--td-space-lg)', borderRadius: 'var(--td-radius-xl)', border: active ? '2px solid var(--td-success)' : '1px solid var(--td-border)', background: active ? 'linear-gradient(135deg, rgba(16,217,142,0.08) 0%, rgba(108,59,255,0.05) 100%)' : 'var(--td-surface)', boxShadow: active ? '0 0 30px rgba(16,217,142,0.15)' : 'var(--td-shadow-card)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
        <div style={{ width: 56, height: 56, borderRadius: 'var(--td-radius-lg)', background: active ? 'linear-gradient(135deg, var(--td-success) 0%, #06b6d4 100%)' : 'var(--td-surface-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: active ? '#fff' : 'var(--td-text-tertiary)', flexShrink: 0, boxShadow: active ? '0 4px 15px rgba(16,217,142,0.4)' : 'none' }}><FaRocket size={24} /></div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Boost Whole Shop</h3>
            {active && <span style={{ background: 'var(--td-success)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--td-radius-full)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Active</span>}
          </div>
          <p style={{ fontSize: 14, color: 'var(--td-text-secondary)', margin: 0, lineHeight: 1.5 }}>{active ? 'Every listing boosted at highest priority — top of feeds, maximum visibility.' : 'Boost every listing automatically — appear at the top of feeds with maximum visibility.'}</p>
        </div>
      </div>
      {active && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16, padding: 'var(--td-space-md)', background: 'rgba(16,217,142,0.05)', borderRadius: 'var(--td-radius-md)', border: '1px solid rgba(16,217,142,0.2)' }}>
          <div style={{ textAlign: 'center' }}><div style={{ fontSize: 20, fontWeight: 800, color: 'var(--td-success)' }}>{boostedCount}</div><div style={{ fontSize: 11, color: 'var(--td-text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Boosted</div></div>
          <div style={{ textAlign: 'center' }}><div style={{ fontSize: 20, fontWeight: 800, color: 'var(--td-primary)' }}>{daysRemaining}d</div><div style={{ fontSize: 11, color: 'var(--td-text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Remaining</div></div>
          <div style={{ textAlign: 'center' }}><div style={{ fontSize: 20, fontWeight: 800, color: 'var(--td-accent)' }}>10%</div><div style={{ fontSize: 11, color: 'var(--td-text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Fee/Sale</div></div>
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {[<FaBolt size={10} />, <FaCrown size={10} />, <FaChartLine size={10} />].map((icon, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: active ? 600 : 400, color: active ? 'var(--td-success)' : 'var(--td-text-tertiary)', padding: '4px 10px', borderRadius: 'var(--td-radius-full)', background: active ? 'rgba(16,217,142,0.1)' : 'var(--td-surface-tertiary)' }}>{icon} {['Highest priority','Top placement','Max visibility'][i]}</span>
        ))}
      </div>
      <button className={`btn ${active ? 'btn-outline' : 'btn-primary'} btn-lg`} onClick={toggle} disabled={saving} style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
        {saving ? <><FaSpinner className="spinner-sm" /> Processing...</> : active ? <><FaTimes size={14} /> Turn Off</> : <><FaRocket size={14} /> Turn On Shop Boost</>}
      </button>
    </div>
  );
};

export default ShopBoostCard;