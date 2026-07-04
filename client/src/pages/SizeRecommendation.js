import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import api from '../services/api';
import { formatPrice, countries } from '../utils/helpers';
import { toast } from 'react-toastify';
import { FaRulerHorizontal, FaUser, FaShoppingBag, FaHeart, FaShare, FaComment, FaHashtag, FaSearch, FaCamera, FaVideo } from 'react-icons/fa';

const SizeRecommendation = () => {
  const { user } = useAuth();
  const { currency } = useTheme();
  const navigate = useNavigate();
  const [measurements, setMeasurements] = useState({
    bust: '',
    waist: '',
    hip: '',
    inseam: '',
  });
  const [recommendations, setRecommendations] = useState([]);
  const [savedMeasurements, setSavedMeasurements] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchMeasurements();
  }, []);

  const fetchMeasurements = async () => {
    try {
      const res = await api.get('/size-guides/recommendations');
      setSavedMeasurements(res.data);
    } catch (error) {
      // No saved measurements yet
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('/size-guides/recommendations', measurements);
      setSavedMeasurements(res.data);
      toast.success('Measurements saved! 📏');
    } catch (error) {
      toast.error('Failed to save measurements');
    }
    setLoading(false);
  };

  if (!user) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="empty-state-icon">📏</div>
          <h2>Size Recommendations</h2>
          <p>Please login to save your measurements and get personalized recommendations.</p>
          <Link to="/login" className="btn btn-primary">Login</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <FaRulerHorizontal /> Size Recommendations
      </h1>

      <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
        <h3 style={{ marginBottom: 'var(--td-space-md)' }}>Your Measurements</h3>
        <form onSubmit={handleSave}>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Bust (in)</label>
              <input
                type="number"
                className="form-input"
                value={measurements.bust}
                onChange={e => setMeasurements({...measurements, bust: e.target.value})}
                placeholder="34"
                step="0.5"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Waist (in)</label>
              <input
                type="number"
                className="form-input"
                value={measurements.waist}
                onChange={e => setMeasurements({...measurements, waist: e.target.value})}
                placeholder="26"
                step="0.5"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Hip (in)</label>
              <input
                type="number"
                className="form-input"
                value={measurements.hip}
                onChange={e => setMeasurements({...measurements, hip: e.target.value})}
                placeholder="36"
                step="0.5"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Inseam (in)</label>
              <input
                type="number"
                className="form-input"
                value={measurements.inseam}
                onChange={e => setMeasurements({...measurements, inseam: e.target.value})}
                placeholder="32"
                step="0.5"
              />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Saving...' : 'Save Measurements'}
          </button>
        </form>
      </div>

      {savedMeasurements && (
        <div className="glass-card" style={{ marginTop: 'var(--td-space-lg)', padding: 'var(--td-space-lg)' }}>
          <h3 style={{ marginBottom: 'var(--td-space-md)' }}>Your Recommended Size</h3>
          <div style={{ padding: 'var(--td-space-md)', background: 'var(--td-primary)', color: '#fff', borderRadius: 'var(--td-radius-md)' }}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>Size {savedMeasurements.recommendedSize}</div>
            <div style={{ fontSize: 14, opacity: 0.9 }}>Confidence: {savedMeasurements.confidenceScore}%</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SizeRecommendation;