import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import api from '../services/api';
import { FaBell, FaMapMarkerAlt, FaCamera, FaBarcode, FaFingerprint, FaMobileAlt, FaSave } from 'react-icons/fa';

function MobileSettings() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [preferences, setPreferences] = useState({
    pushNotifications: { enabled: true, priceDrop: true, messages: true, offers: true, orderUpdates: true },
    location: { country: 'US', region: '', useForShipping: true },
    quickActions: { cameraSell: true, quickMessage: true, barcodeScan: false },
    biometric: { enabled: false, type: 'none' },
  });
  const [shippingEstimate, setShippingEstimate] = useState(null);

  useEffect(() => {
    fetchPreferences();
    detectPlatform();
  }, []);

  const detectPlatform = () => {
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    let platform = 'Web';
    if (/android/i.test(userAgent)) platform = 'Android';
    if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) platform = 'iOS';
    return platform;
  };

  const fetchPreferences = async () => {
    try {
      const res = await api.get('/mobile/preferences');
      setPreferences(res.data);
    } catch (error) {
      console.log('No existing preferences, using defaults');
    }
  };

  const getShippingEstimate = async () => {
    try {
      const res = await api.get(`/mobile/shipping-estimate?country=${preferences.location.country}&weight=1`);
      setShippingEstimate(res.data);
    } catch (error) {
      console.error('Failed to get shipping estimate', error);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const keys = name.split('.');
    const key1 = keys[0];
    const key2 = keys[1];
    
    setPreferences(prev => {
      const newPrefs = { ...prev };
      if (key1 && key2) {
        newPrefs[key1] = { ...prev[key1], [key2]: type === 'checkbox' ? checked : value };
      } else {
        newPrefs[key1] = type === 'checkbox' ? checked : value;
      }
      return newPrefs;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.put('/mobile/preferences', preferences);
      toast.success('Mobile settings saved! 📱');
    } catch (err) {
      toast.error('Failed to save settings');
    }
    setLoading(false);
  };

  const registerPushToken = async () => {
    try {
      // In a real app, this would get the push token from Capacitor Push Notifications plugin
      const mockToken = `mock-token-${Date.now()}`;
      const platform = detectPlatform();
      
      await api.post('/mobile/push-token', {
        token: mockToken,
        platform,
        appVersion: '1.0.0',
      });
      toast.success('Push notifications enabled!');
    } catch (err) {
      toast.error('Failed to enable push notifications');
    }
  };

  if (!user) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="empty-state-icon">📱</div>
          <h2>Mobile Settings</h2>
          <p>Please login to access mobile features.</p>
          <button className="btn btn-primary" onClick={() => navigate('/login')}>Login</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <FaMobileAlt /> Mobile Settings
      </h1>

      <form onSubmit={handleSubmit}>
        <div className="glass-card" style={{ padding: 'var(--td-space-lg)', marginBottom: 'var(--td-space-lg)' }}>
          <h3 style={{ marginBottom: 'var(--td-space-md)' }}>
            <FaBell /> Push Notifications
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--td-space-sm)' }}>
            <label className="flex-between" style={{ cursor: 'pointer' }}>
              <span>Enable Push Notifications</span>
              <input
                type="checkbox"
                name="pushNotifications.enabled"
                checked={preferences.pushNotifications.enabled}
                onChange={handleChange}
              />
            </label>
            <label className="flex-between" style={{ cursor: 'pointer' }}>
              <span>Price Drop Alerts</span>
              <input
                type="checkbox"
                name="pushNotifications.priceDrop"
                checked={preferences.pushNotifications.priceDrop}
                onChange={handleChange}
              />
            </label>
            <label className="flex-between" style={{ cursor: 'pointer' }}>
              <span>New Messages</span>
              <input
                type="checkbox"
                name="pushNotifications.messages"
                checked={preferences.pushNotifications.messages}
                onChange={handleChange}
              />
            </label>
            <label className="flex-between" style={{ cursor: 'pointer' }}>
              <span>New Offers</span>
              <input
                type="checkbox"
                name="pushNotifications.offers"
                checked={preferences.pushNotifications.offers}
                onChange={handleChange}
              />
            </label>
            <label className="flex-between" style={{ cursor: 'pointer' }}>
              <span>Order Updates</span>
              <input
                type="checkbox"
                name="pushNotifications.orderUpdates"
                checked={preferences.pushNotifications.orderUpdates}
                onChange={handleChange}
              />
            </label>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={registerPushToken}
            style={{ marginTop: 'var(--td-space-md)' }}
          >
            Register Push Token
          </button>
        </div>

        <div className="glass-card" style={{ padding: 'var(--td-space-lg)', marginBottom: 'var(--td-space-lg)' }}>
          <h3 style={{ marginBottom: 'var(--td-space-md)' }}>
            <FaMapMarkerAlt /> Location & Shipping
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--td-space-sm)' }}>
            <label className="form-group">
              <span className="form-label">Shipping Country</span>
              <select
                name="location.country"
                value={preferences.location.country}
                onChange={handleChange}
                className="form-input"
              >
                <option value="US">United States (Domestic)</option>
                <option value="CA">Canada</option>
                <option value="GB">United Kingdom</option>
                <option value="DE">Germany</option>
                <option value="FR">France</option>
                <option value="AU">Australia</option>
              </select>
            </label>
            <label className="flex-between" style={{ cursor: 'pointer' }}>
              <span>Use for Shipping Estimates</span>
              <input
                type="checkbox"
                name="location.useForShipping"
                checked={preferences.location.useForShipping}
                onChange={handleChange}
              />
            </label>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={getShippingEstimate}
              style={{ marginTop: 'var(--td-space-sm)' }}
            >
              Get Shipping Estimate
            </button>
            {shippingEstimate && (
              <div style={{ marginTop: 'var(--td-space-sm)', padding: 'var(--td-space-sm)', background: 'var(--td-surface-secondary)', borderRadius: 'var(--td-radius-sm)' }}>
                <strong>Estimated Shipping:</strong> ${shippingEstimate.shippingCost} - {shippingEstimate.estimatedDays} days
              </div>
            )}
          </div>
        </div>

        <div className="glass-card" style={{ padding: 'var(--td-space-lg)', marginBottom: 'var(--td-space-lg)' }}>
          <h3 style={{ marginBottom: 'var(--td-space-md)' }}>
            <FaCamera /> Quick Actions
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--td-space-sm)' }}>
            <label className="flex-between" style={{ cursor: 'pointer' }}>
              <span>Camera-first Selling Flow</span>
              <input
                type="checkbox"
                name="quickActions.cameraSell"
                checked={preferences.quickActions.cameraSell}
                onChange={handleChange}
              />
            </label>
            <label className="flex-between" style={{ cursor: 'pointer' }}>
              <span>Quick Message Templates</span>
              <input
                type="checkbox"
                name="quickActions.quickMessage"
                checked={preferences.quickActions.quickMessage}
                onChange={handleChange}
              />
            </label>
            <label className="flex-between" style={{ cursor: 'pointer' }}>
              <span><FaBarcode /> Barcode Scanner</span>
              <input
                type="checkbox"
                name="quickActions.barcodeScan"
                checked={preferences.quickActions.barcodeScan}
                onChange={handleChange}
              />
            </label>
          </div>
        </div>

        <div className="glass-card" style={{ padding: 'var(--td-space-lg)', marginBottom: 'var(--td-space-lg)' }}>
          <h3 style={{ marginBottom: 'var(--td-space-md)' }}>
            <FaFingerprint /> Biometric Authentication
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--td-space-sm)' }}>
            <label className="flex-between" style={{ cursor: 'pointer' }}>
              <span>Enable Biometric Login</span>
              <input
                type="checkbox"
                name="biometric.enabled"
                checked={preferences.biometric.enabled}
                onChange={handleChange}
              />
            </label>
            <label className="form-group">
              <span className="form-label">Biometric Type</span>
              <select
                name="biometric.type"
                value={preferences.biometric.type}
                onChange={handleChange}
                className="form-input"
              >
                <option value="none">None</option>
                <option value="touch">Touch ID / Fingerprint</option>
                <option value="face">Face ID / Face Unlock</option>
              </select>
            </label>
            <p style={{ fontSize: 12, color: 'var(--td-text-secondary)' }}>
              Note: Available on supported mobile devices only.
            </p>
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-primary btn-block btn-lg"
          disabled={loading}
        >
          {loading ? <><span className="spinner spinner-sm" /> Saving...</> : <><FaSave /> Save Mobile Settings</>}
        </button>
      </form>
    </div>
  );
}

export default MobileSettings;