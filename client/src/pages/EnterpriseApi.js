import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { FaCode, FaDownload, FaLink, FaKey, FaChartBar, FaShareSquare } from 'react-icons/fa';
import api from '../services/api';
import { toast } from 'react-toastify';

const EnterpriseApi = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState([]);
  const [showExport, setShowExport] = useState(false);

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
      const res = await api.get('/enterprise/listings');
      setListings(res.data || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (type) => {
    try {
      const res = await api.post('/enterprise/export', { type });
      toast.success(`Export started: ${res.data.downloadUrl}`);
    } catch (error) {
      console.error('Error exporting:', error);
    }
  };

  const handleRegisterWebhook = async () => {
    try {
      const res = await api.post('/enterprise/webhook', {
        url: 'https://your-app.com/webhook',
        events: ['order.created', 'order.shipped']
      });
      toast.success('Webhook registered!');
    } catch (error) {
      console.error('Error registering webhook:', error);
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
        <FaCode /> Enterprise API Suite
      </h1>

      <div className="glass-card" style={{ padding: 24, marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>API Access</h3>
        <p>Your API key for enterprise integrations:</p>
        <div style={{ 
          background: 'var(--td-surface)', 
          padding: 16, 
          borderRadius: 'var(--td-radius-lg)', 
          fontFamily: 'monospace',
          marginBottom: 16
        }}>
          api_key_{user?._id?.substring(0, 8)}_*****
        </div>
        <p>Rate Limit: 1000 requests/hour</p>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <button onClick={() => handleExport('listings')} className="btn btn-primary">
          <FaDownload /> Export Listings
        </button>
        <button onClick={() => handleExport('orders')} className="btn btn-primary">
          <FaDownload /> Export Orders
        </button>
        <button onClick={handleRegisterWebhook} className="btn btn-primary">
          <FaShareSquare /> Register Webhook
        </button>
      </div>

      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <FaChartBar /> Available Endpoints
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        <div className="glass-card" style={{ padding: 16 }}>
          <h4><FaDownload /> GET /api/enterprise/listings</h4>
          <p>Get all seller listings (up to 100)</p>
        </div>
        <div className="glass-card" style={{ padding: 16 }}>
          <h4><FaDownload /> GET /api/enterprise/orders</h4>
          <p>Get order transaction data</p>
        </div>
        <div className="glass-card" style={{ padding: 16 }}>
          <h4><FaShareSquare /> POST /api/enterprise/webhook</h4>
          <p>Register webhook endpoints</p>
        </div>
        <div className="glass-card" style={{ padding: 16 }}>
          <h4><FaDownload /> POST /api/enterprise/export</h4>
          <p>Download bulk data exports</p>
        </div>
      </div>
    </div>
  );
};

export default EnterpriseApi;