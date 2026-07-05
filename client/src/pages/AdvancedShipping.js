import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { FaTruck, FaPlus, FaCalculator, FaPrint, FaSearch } from 'react-icons/fa';
import api from '../services/api';

const AdvancedShipping = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [integrations, setIntegrations] = useState([]);
  const [rate, setRate] = useState(null);
  const [tracking, setTracking] = useState(null);

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
      const res = await api.get('/advanced-shipping');
      setIntegrations(res.data || []);
    } catch (error) {
      console.error('Error fetching shipping integrations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCalculateRate = async () => {
    try {
      const res = await api.post('/advanced-shipping/rates', {
        carrier: 'UPS',
        weight: 2,
        dimensions: { length: 10, width: 8, height: 6 },
        fromZip: '90210',
        toZip: '10001'
      });
      setRate(res.data);
    } catch (error) {
      console.error('Error calculating rate:', error);
    }
  };

  const handleGenerateLabel = async () => {
    try {
      const res = await api.post('/advanced-shipping/label', {
        carrier: 'UPS',
        service: 'Ground',
        toAddress: { name: 'Test', street: '123 St', city: 'City', state: 'NY', zip: '10001' },
        weight: 2
      });
      setRate(res.data);
    } catch (error) {
      console.error('Error generating label:', error);
    }
  };

  const handleTrack = async (trackingNumber) => {
    try {
      const res = await api.get(`/advanced-shipping/tracking/${trackingNumber}`);
      setTracking(res.data);
    } catch (error) {
      console.error('Error tracking shipment:', error);
    }
  };

  if (loading) {
    return (
      <div className="page-container" style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div className="skeleton" style={{ height: 60, borderRadius: 'var(--td-radius-lg)', marginBottom: 20 }} />
        <div className="skeleton" style={{ height: 200, borderRadius: 'var(--td-radius-lg)', marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 400, borderRadius: 'var(--td-radius-lg)' }} />
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <FaTruck /> Advanced Shipping
      </h1>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <button onClick={handleCalculateRate} className="btn btn-primary">
          <FaCalculator /> Calculate Rate
        </button>
        <button onClick={handleGenerateLabel} className="btn btn-primary">
          <FaPrint /> Generate Label
        </button>
      </div>

      {rate && (
        <div className="glass-card" style={{ padding: 20, marginBottom: 24 }}>
          <h3>Rate Estimate</h3>
          <p>Carrier: {rate.carrier}</p>
          <p>Estimated Cost: ${rate.estimatedCost}</p>
          <p>Estimated Days: {rate.estimatedDays}</p>
          {rate.labelUrl && (
            <a href={rate.labelUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
              Download Label
            </a>
          )}
        </div>
      )}

      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <FaTruck /> Carrier Integrations
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        {integrations.map(integration => (
          <div key={integration._id} className="glass-card" style={{ padding: 16, textAlign: 'center' }}>
            <h4>{integration.carrier}</h4>
            <p style={{ color: integration.isActive ? 'var(--td-success)' : 'var(--td-error)' }}>
              {integration.isActive ? 'Connected' : 'Disconnected'}
            </p>
          </div>
        ))}

        {integrations.length === 0 && (
          <div className="glass-card" style={{ padding: 40, gridColumn: '1/-1', textAlign: 'center' }}>
            <FaTruck size={64} style={{ opacity: 0.3, marginBottom: 16 }} />
            <h3>No carrier integrations</h3>
            <p>Connect your shipping carriers for real-time rates and label printing.</p>
            <button className="btn btn-primary" style={{ marginTop: 12 }}>
              <FaPlus /> Add Carrier
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdvancedShipping;