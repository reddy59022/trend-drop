import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FaUpload, FaDownload, FaEdit, FaTrash, FaRocket, FaSpinner, FaCheckCircle, FaExclamationTriangle, FaFileCsv, FaTags, FaDollarSign, FaBox, FaUndo } from 'react-icons/fa';
import { toast } from 'react-toastify';
import api from '../services/api';
import { formatPrice } from '../utils/helpers';

const BulkListingManager = () => {
  const [listings, setListings] = useState([]);
  const [selectedListings, setSelectedListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [csvFile, setCsvFile] = useState(null);
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkDiscount, setBulkDiscount] = useState('');
  const [operationLoading, setOperationLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchListings();
  }, []);

  const fetchListings = async () => {
    try {
      const res = await api.get('/listings?seller=me&limit=100');
      setListings(res.data.listings || []);
    } catch (error) {
      console.error(error);
      toast.error('Failed to load listings');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAll = () => {
    if (selectedListings.length === listings.length) {
      setSelectedListings([]);
    } else {
      setSelectedListings(listings.map(l => l._id));
    }
  };

  const handleSelect = (id) => {
    setSelectedListings(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleBulkAction = async (action) => {
    if (selectedListings.length === 0) {
      toast.error('Please select at least one listing');
      return;
    }

    setOperationLoading(true);
    try {
      switch (action) {
        case 'active':
          await api.patch('/listings/bulk-status', { listingIds: selectedListings, status: 'active' });
          toast.success(`${selectedListings.length} listings activated`);
          break;
        case 'draft':
          await api.patch('/listings/bulk-status', { listingIds: selectedListings, status: 'draft' });
          toast.success(`${selectedListings.length} listings drafted`);
          break;
        case 'price':
          if (!bulkPrice) {
            toast.error('Please enter a price');
            return;
          }
          await api.patch('/listings/bulk-price', { listingIds: selectedListings, price: parseFloat(bulkPrice) });
          toast.success(`${selectedListings.length} prices updated`);
          break;
        case 'delete':
          if (window.confirm(`Delete ${selectedListings.length} listings?`)) {
            await api.delete('/listings/bulk', { data: { listingIds: selectedListings } });
            toast.success(`${selectedListings.length} listings deleted`);
          }
          break;
        default:
          break;
      }
      setSelectedListings([]);
      fetchListings();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Operation failed');
    } finally {
      setOperationLoading(false);
    }
  };

  const handleCsvUpload = async (e) => {
    e.preventDefault();
    if (!csvFile) {
      toast.error('Please select a CSV file');
      return;
    }

    setOperationLoading(true);
    const formData = new FormData();
    formData.append('csv', csvFile);

    try {
      const res = await api.post('/listings/bulk-import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      toast.success(`${res.data.imported} listings imported successfully`);
      fetchListings();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Import failed');
    } finally {
      setOperationLoading(false);
      setCsvFile(null);
      e.target.reset();
    }
  };

  const downloadTemplate = () => {
    const csvContent = 'title,description,price,category,condition,size,weight,images\n"Vintage Denim Jacket","Authentic 90s Levi\'s jacket",45,"Men","Good","M","1.2","https://example.com/image1.jpg;https://example.com/image2.jpg"\n';
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trenddrop-listings-template.csv';
    a.click();
  };

  if (loading) {
    return (
      <div className="page-container" style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--td-space-lg)' }}>
        <Link to="/seller-dashboard" className="continue-shopping" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          ← Back to Dashboard
        </Link>
      </div>
      
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <FaBox /> Bulk Listing Management
      </h1>

      <div className="glass-card" style={{ padding: 'var(--td-space-lg)', marginBottom: 'var(--td-space-xl)' }}>
        <h3 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>CSV Import</h3>
        <p style={{ fontSize: 14, color: 'var(--td-text-secondary)', marginBottom: 'var(--td-space-md)' }}>
          Upload a CSV file to create multiple listings at once. 
          <button onClick={downloadTemplate} className="btn btn-link btn-sm" style={{ marginLeft: 8 }}>
            <FaDownload size={12} /> Download Template
          </button>
        </p>
        
        <form onSubmit={handleCsvUpload} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <input 
            type="file" 
            accept=".csv" 
            onChange={e => setCsvFile(e.target.files[0])}
            className="form-input"
            style={{ flex: 1, maxWidth: 300 }}
          />
          <button 
            type="submit" 
            className="btn btn-primary"
            disabled={operationLoading || !csvFile}
          >
            {operationLoading ? <><FaSpinner className="spinner-sm" /> Importing...</> : <><FaUpload /> Import</>}
          </button>
        </form>
        
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--td-text-tertiary)' }}>
          Required columns: title, description, price, category, condition
          <br />
          Optional: size, weight, images (semicolon-separated URLs)
        </div>
      </div>

      <div className="glass-card" style={{ padding: 'var(--td-space-lg)', marginBottom: 'var(--td-space-xl)' }}>
        <h3 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Bulk Actions</h3>
        
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <button 
            className="btn btn-outline"
            onClick={() => handleBulkAction('active')}
            disabled={selectedListings.length === 0 || operationLoading}
          >
            <FaRocket size={14} /> Activate Selected
          </button>
          <button 
            className="btn btn-outline"
            onClick={() => handleBulkAction('draft')}
            disabled={selectedListings.length === 0 || operationLoading}
          >
            <FaFileCsv size={14} /> Draft Selected
          </button>
          <button 
            className="btn btn-outline btn-danger"
            onClick={() => handleBulkAction('delete')}
            disabled={selectedListings.length === 0 || operationLoading}
          >
            <FaTrash size={14} /> Delete Selected
          </button>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <input
            type="number"
            placeholder="New price ($)"
            value={bulkPrice}
            onChange={e => setBulkPrice(e.target.value)}
            className="form-input"
            style={{ width: 150 }}
            min="5"
            step="0.01"
          />
          <button 
            className="btn btn-primary"
            onClick={() => handleBulkAction('price')}
            disabled={selectedListings.length === 0 || !bulkPrice || operationLoading}
          >
            <FaDollarSign size={14} /> Update Price
          </button>
        </div>
        
        <div style={{ marginTop: 12, fontSize: 14, color: 'var(--td-text-secondary)' }}>
          {selectedListings.length} listings selected
        </div>
      </div>

      <div style={{ display: 'grid', gap: 'var(--td-space-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: 'var(--td-surface)', borderRadius: 'var(--td-radius-sm)' }}>
          <input 
            type="checkbox" 
            checked={selectedListings.length === listings.length && listings.length > 0}
            onChange={handleSelectAll}
            style={{ width: 18, height: 18 }}
          />
          <span style={{ fontWeight: 600, fontSize: 14 }}>Select All ({listings.length})</span>
        </div>

        {listings.map(listing => (
          <div key={listing._id} className="glass-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
            <input 
              type="checkbox" 
              checked={selectedListings.includes(listing._id)}
              onChange={() => handleSelect(listing._id)}
              style={{ width: 18, height: 18 }}
            />
            
            <img 
              src={listing.images?.[0] || '/placeholder.png'} 
              alt={listing.title}
              style={{ width: 80, height: 80, borderRadius: 'var(--td-radius-sm)', objectFit: 'cover' }}
            />
            
            <div style={{ flex: 1, minWidth: 0 }}>
              <h4 style={{ fontWeight: 600, marginBottom: 4, fontSize: 15 }}>{listing.title}</h4>
              <div style={{ fontSize: 13, color: 'var(--td-text-secondary)', marginBottom: 4 }}>
                {formatPrice(listing.price, listing.currency || 'USD')} • {listing.category}
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                <span style={{ 
                  padding: '2px 8px', 
                  borderRadius: 4, 
                  background: listing.available && !listing.sold ? 'var(--td-success)' : 'var(--td-error)',
                  color: '#fff'
                }}>
                  {listing.available && !listing.sold ? 'Active' : 'Sold/Inactive'}
                </span>
                <span>Stock: {listing.quantity}</span>
                <span>Sold: {listing.quantitySold || 0}</span>
              </div>
            </div>

            <Link 
              to={`/listing/${listing._id}/edit`}
              className="btn btn-ghost btn-sm"
            >
              <FaEdit /> Edit
            </Link>
          </div>
        ))}

        {listings.length === 0 && (
          <div className="empty-state" style={{ padding: 40 }}>
            <div className="empty-state-icon">📦</div>
            <h3>No Listings Yet</h3>
            <p>Create your first listing to use bulk management features</p>
            <Link to="/sell" className="btn btn-primary">Create Listing</Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default BulkListingManager;