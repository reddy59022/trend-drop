import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { FaChartLine, FaFire, FaBell, FaSync, FaRobot, FaLightbulb } from 'react-icons/fa';
import api from '../services/api';

const TrendForecast = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [forecasts, setForecasts] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [timeframe, setTimeframe] = useState('weekly');
  const [alerts, setAlerts] = useState([]);

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
      const res = await api.get('/trend-forecast');
      setForecasts(res.data || []);
    } catch (error) {
      console.error('Error fetching trend forecasts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateForecast = async (category) => {
    try {
      await api.post('/trend-forecast/generate', { category, timeframe });
      fetchData();
    } catch (error) {
      console.error('Error generating forecast:', error);
    }
  };

  const setupAlerts = async () => {
    try {
      const categories = forecasts.map(f => f.category);
      await api.post('/trend-forecast/alerts', { categories });
      setAlerts(categories);
    } catch (error) {
      console.error('Error setting up alerts:', error);
    }
  };

  const getConfidenceColor = (confidence) => {
    if (confidence >= 90) return 'var(--td-success)';
    if (confidence >= 70) return 'var(--td-warning)';
    return 'var(--td-error)';
  };

  if (loading) {
    return (
      <div className="page-container" style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div className="skeleton" style={{ height: 60, borderRadius: 'var(--td-radius-lg)', marginBottom: 20 }} />
        <div className="skeleton" style={{ height: 200, borderRadius: 'var(--td-radius-lg)', marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 300, borderRadius: 'var(--td-radius-lg)' }} />
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <FaRobot /> AI Trend Forecasting
      </h1>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>Timeframe</label>
          <select 
            value={timeframe} 
            onChange={(e) => setTimeframe(e.target.value)}
            className="input"
            style={{ width: '100%' }}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="seasonal">Seasonal</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button onClick={setupAlerts} className="btn btn-primary">
            <FaBell /> Setup Trend Alerts
          </button>
        </div>
      </div>

      <div className="glass-card" style={{ padding: 24, marginBottom: 24 }}>
        <h3 style={{ marginTop: 0, marginBottom: 16 }}>
          <FaLightbulb /> Smart Recommendations
        </h3>
        <p style={{ color: 'var(--td-text-secondary)', marginBottom: 16 }}>
          Our AI analyzes market trends to predict demand and identify hot-selling items.
        </p>
        {alerts.length > 0 && (
          <div style={{ padding: 16, background: 'var(--td-success)', borderRadius: 'var(--td-radius-lg)', color: 'white' }}>
            Active alerts for: {alerts.join(', ')}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {forecasts.map(forecast => (
          <div key={forecast.category} className="glass-card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>{forecast.category}</h3>
              <div style={{ 
                padding: '4px 12px', 
                borderRadius: 'var(--td-radius-full)',
                background: getConfidenceColor(forecast.confidence),
                color: 'white',
                fontSize: 12,
                fontWeight: 600
              }}>
                {forecast.confidence}% Confidence
              </div>
            </div>
            
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: 'var(--td-text-secondary)', fontSize: 14 }}>Predicted Demand</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--td-primary)' }}>
                +{forecast.predictedDemand}%
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ color: 'var(--td-text-secondary)', fontSize: 14, marginBottom: 4 }}>
                Trending Items ({forecast.trendingItems?.length || 0})
              </div>
              {forecast.trendingItems?.slice(0, 3).map((item, idx) => (
                <div key={idx} style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 8, 
                  padding: 4,
                  fontSize: 14
                }}>
                  <FaFire color="var(--td-warning)" />
                  {item.listing?.title || `Item #${idx + 1}`}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button 
                onClick={() => setSelectedCategory(forecast.category)}
                className="btn btn-outline"
                style={{ flex: 1 }}
              >
                View Details
              </button>
              <button 
                onClick={() => handleGenerateForecast(forecast.category)}
                className="btn btn-primary"
                style={{ flex: 1 }}
              >
                <FaSync /> Refresh
              </button>
            </div>
          </div>
        ))}

        {forecasts.length === 0 && (
          <div className="glass-card" style={{ padding: 20, gridColumn: '1/-1', textAlign: 'center' }}>
            <p>No trend data available. Click below to generate forecasts.</p>
            <button onClick={() => handleGenerateForecast('Women')} className="btn btn-primary">
              Generate Trend Forecast
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TrendForecast;