import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { toast } from 'react-toastify';
import { FaRocket, FaSpinner, FaCheckCircle, FaTimes } from 'react-icons/fa';

// Feature 3 — "Boost whole shop" toggle.
// When ON, every active listing is treated as basic (standard) boosted with
// the highest feed priority; each sale earns the platform the 10% boost fee.
const ShopBoostCard = () => {
  const [shopBoost, setShopBoost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get('/shop-boost')
      .then((res) => setShopBoost(res.data.shopBoost || { active: false }))
      .catch(() => toast.error('Failed to load shop boost status'))
      .finally(() => setLoading(false));
  }, []);

  const toggle = async () => {
    if (!shopBoost) return;
    setSaving(true);
    try {
      if (shopBoost.active) {
        const res = await api.patch('/shop-boost/deactivate');
        setShopBoost(res.data.shopBoost);
        toast.success('Shop boost turned off. Listings restored to normal.');
      } else {
        const res = await api.post('/shop-boost');
        setShopBoost(res.data.shopBoost);
        toast.success(`Shop boost ON — ${res.data.boostedListings || 0} listings boosted!`);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Something went wrong');
    }
    setSaving(false);
  };

  if (loading) {
    return <div className="skeleton" style={{ height: 90, borderRadius: 'var(--td-radius-lg)' }} />;
  }

  const active = shopBoost?.active === true;

  return (
    <div className="glass-card" style={{ padding: 'var(--td-space-lg)', marginBottom: 'var(--td-space-lg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 'var(--td-radius-md)',
            background: active ? 'rgba(0,200,83,0.12)' : 'var(--td-surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: active ? 'var(--td-success)' : 'var(--td-text-tertiary)',
            flexShrink: 0,
          }}
        >
          <FaRocket size={20} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>
            Boost Whole Shop
          </h4>
          <p style={{ fontSize: 13, color: 'var(--td-text-tertiary)', lineHeight: 1.5 }}>
            {active
              ? 'ON — every listing is boosted (basic) at the highest priority. 10% boost fee applies per sale.'
              : 'Boost every listing automatically — top of feeds, 10% per sale, highest priority.'}
          </p>
        </div>
        <button
          className={`btn ${active ? 'btn-outline' : 'btn-primary'}`}
          onClick={toggle}
          disabled={saving}
          style={{ whiteSpace: 'nowrap' }}
        >
          {saving ? <FaSpinner className="spinner-sm" /> : active ? <><FaTimes size={12} /> Turn Off</> : <><FaCheckCircle size={12} /> Turn On</>}
        </button>
      </div>
    </div>
  );
};

export default ShopBoostCard;