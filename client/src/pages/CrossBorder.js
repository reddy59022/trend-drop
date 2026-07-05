import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { FaGlobeAmericas, FaPlus, FaSave, FaBox } from 'react-icons/fa';
import api from '../services/api';

const CrossBorder = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({
    country: 'US',
    currency: 'USD',
    taxId: '',
    shippingPartners: [],
  });
  const [availableCountries, setAvailableCountries] = useState([]);

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
      const [settingsRes, countriesRes] = await Promise.all([
        api.get('/cross-border'),
        api.get('/cross-border/countries'),
      ]);
      setSettings(settingsRes.data || {});
      setAvailableCountries(countriesRes.data || []);
    } catch (error) {
      console.error('Error fetching cross-border data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      await api.put('/cross-border', settings);
      fetchData();
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  };

  if (loading) {
    return (
      <div className="page-container" style={{ maxWidth: 800, margin: '0 auto' }}>
        <div className="skeleton" style={{ height: 60, borderRadius: 'var(--td-radius-lg)', marginBottom: 20 }} />
        <div className="skeleton" style={{ height: 400, borderRadius: 'var(--td-radius-lg)' }} />
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 800, margin: '0 auto' }}>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <FaGlobeAmericas /> International Selling
      </h1>

      <div className="glass-card" style={{ padding: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="form-group">
            <label className="form-label">Country</label>
            <select
              value={settings.country}
              onChange={e => setSettings({...settings, country: e.target.value})}
              className="form-input"
            >
              {availableCountries.map(c => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Currency</label>
            <input
              type="text"
              value={settings.currency}
              onChange={e => setSettings({...settings, currency: e.target.value})}
              className="form-input"
              placeholder="USD"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Tax ID (Optional)</label>
            <input
              type="text"
              value={settings.taxId || ''}
              onChange={e => setSettings({...settings, taxId: e.target.value})}
              className="form-input"
              placeholder="Tax identification number"
            />
          </div>
        </div>

        <div style={{ marginTop: 24 }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FaBox /> Shipping Partners
          </h3>
          <p style={{ color: 'var(--td-text-secondary)', fontSize: 14 }}>
            Connect with international shipping partners for seamless cross-border sales
          </p>
        </div>

        <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
          <button onClick={handleSave} className="btn btn-primary">
            <FaSave /> Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};

export default CrossBorder;