import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { FaStore, FaPlus, FaUsers, FaPercentage, FaChartLine } from 'react-icons/fa';
import api from '../services/api';

const Vendors = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [vendors, setVendors] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedListing, setSelectedListing] = useState('');

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
      const res = await api.get('/vendors');
      setVendors(res.data || []);
    } catch (error) {
      console.error('Error fetching vendors:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      await api.post('/vendors', { listingId: selectedListing, commission: 10 });
      setShowCreate(false);
      setSelectedListing('');
      fetchData();
    } catch (error) {
      console.error('Error creating vendor listing:', error);
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
        <FaStore /> Multi-Vendor Marketplace
      </h1>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h3><FaChartLine /> Vendor Performance</h3>
          <p>Total Listings: {vendors.length}</p>
          <p>Co-Vendors: {vendors.reduce((sum, v) => sum + (v.sellers?.length || 0) - 1, 0)}</p>
        </div>
        
        <button onClick={() => setShowCreate(true)} className="btn btn-primary">
          <FaPlus /> Create Vendor Listing
        </button>
      </div>

      {showCreate && (
        <div className="glass-card" style={{ padding: 20, marginBottom: 24 }}>
          <h3>Create Vendor Listing</h3>
          <select 
            value={selectedListing} 
            onChange={(e) => setSelectedListing(e.target.value)}
            className="input"
            style={{ width: '100%', marginBottom: 16 }}
          >
            <option value="">Select a listing</option>
            <option value="listing-1">Listing 1</option>
          </select>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={handleCreate} className="btn btn-primary" disabled={!selectedListing}>
              Create
            </button>
            <button onClick={() => setShowCreate(false)} className="btn btn-outline">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {vendors.map(vendor => (
          <div key={vendor._id} className="glass-card" style={{ padding: 20 }}>
            <h4 style={{ margin: '0 0 12px 0' }}>{vendor.listing?.title}</h4>
            
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <FaUsers /> Sellers: {vendor.sellers?.length || 0}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <FaPercentage /> Commission: {vendor.sellers?.[0]?.commission || 0}%
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FaChartLine /> Rating: {vendor.performance?.rating || 5}/5
              </div>
            </div>

            <button className="btn btn-outline" style={{ width: '100%' }}>
              Manage Vendors
            </button>
          </div>
        ))}

        {vendors.length === 0 && (
          <div className="glass-card" style={{ padding: 40, gridColumn: '1/-1', textAlign: 'center' }}>
            <FaStore size={64} style={{ opacity: 0.3, marginBottom: 16 }} />
            <h3>No vendor listings yet</h3>
            <p>Create your first multi-vendor listing to get started!</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Vendors;