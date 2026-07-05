import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { FaBox, FaWarehouse, FaSync, FaExclamationTriangle, FaRedo, FaBarcode } from 'react-icons/fa';
import api from '../services/api';

const InventoryManagement = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [inventory, setInventory] = useState([]);
  const [showSync, setShowSync] = useState(false);

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
      const res = await api.get('/inventory');
      setInventory(res.data || []);
    } catch (error) {
      console.error('Error fetching inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    try {
      await api.post('/inventory/sync', {
        warehouse: 'WH-001',
        items: inventory.map(item => ({
          listingId: item.listing?._id,
          quantity: item.quantity,
          location: 'A-1-1'
        }))
      });
      setShowSync(false);
      fetchData();
    } catch (error) {
      console.error('Error syncing inventory:', error);
    }
  };

  const handleAutoReorder = async (itemId) => {
    try {
      await api.put(`/inventory/${itemId}/auto-reorder`, {
        enabled: true,
        quantity: 10,
        supplier: 'Main Supplier'
      });
      fetchData();
    } catch (error) {
      console.error('Error setting auto reorder:', error);
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
        <FaWarehouse /> Advanced Inventory Management
      </h1>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h3><FaBox /> Inventory Summary</h3>
          <p>Total Items: {inventory.length}</p>
          <p>Low Stock: {inventory.filter(i => i.quantity <= i.lowStockThreshold).length}</p>
          <p>Auto Reorder Enabled: {inventory.filter(i => i.autoReorder?.enabled).length}</p>
        </div>
        
        <button onClick={() => setShowSync(true)} className="btn btn-primary">
          <FaSync /> Sync Inventory
        </button>
      </div>

      {showSync && (
        <div className="glass-card" style={{ padding: 20, marginBottom: 24 }}>
          <h3>Sync Inventory</h3>
          <p>Sync all inventory items with warehouse system.</p>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={handleSync} className="btn btn-primary">
              Start Sync
            </button>
            <button onClick={() => setShowSync(false)} className="btn btn-outline">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {inventory.map(item => (
          <div key={item._id} className="glass-card" style={{ padding: 20 }}>
            <h4 style={{ margin: '0 0 8px 0' }}>{item.listing?.title}</h4>
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <FaBarcode /> SKU: {item.sku || 'N/A'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <FaBox /> Quantity: {item.quantity}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FaWarehouse /> Location: {item.location || 'N/A'}
              </div>
            </div>
            
            {item.quantity <= item.lowStockThreshold && (
              <div style={{ 
                padding: 8, 
                background: 'var(--td-warning)', 
                borderRadius: 'var(--td-radius-lg)',
                color: 'white',
                marginBottom: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}>
                <FaExclamationTriangle /> Low Stock Alert!
              </div>
            )}

            <button 
              onClick={() => handleAutoReorder(item._id)}
              className="btn btn-outline"
              style={{ width: '100%' }}
            >
              <FaRedo /> Enable Auto Reorder
            </button>
          </div>
        ))}

        {inventory.length === 0 && (
          <div className="glass-card" style={{ padding: 40, gridColumn: '1/-1', textAlign: 'center' }}>
            <FaBox size={64} style={{ opacity: 0.3, marginBottom: 16 }} />
            <h3>No inventory items</h3>
            <p>Sync your listings to start managing inventory across warehouses.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default InventoryManagement;