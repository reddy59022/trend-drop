import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { toast } from 'react-toastify';
import { FaCamera, FaTimes, FaImage, FaSpinner, FaInfoCircle, FaTruck, FaDollarSign, FaCheckCircle, FaArrowLeft } from 'react-icons/fa';
import imageCompression from 'browser-image-compression';
import { countries, formatPrice } from '../utils/helpers';

const EditListing = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [listing, setListing] = useState(null);
  const [previews, setPreviews] = useState([]);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    price: '',
    originalPrice: '',
    category: 'Women',
    brand: '',
    size: '',
    condition: 'Good',
    color: '',
    weight: '0.5',
    weightUnit: 'kg',
    shipsFrom: 'US',
    domesticShipping: true,
    internationalShipping: false,
    freeShipping: false,
    shippingCost: '3.99',
    quantity: '1',
    status: 'active',
  });

  useEffect(() => {
    fetchListing();
  }, [id]);

  const fetchListing = async () => {
    try {
      const res = await api.get(`/listings/${id}`);
      const listingData = res.data.listing;
      
      // Check if user is the owner
      if (user && (user.id || user._id) !== listingData.seller?._id) {
        toast.error('Not authorized to edit this listing');
        navigate('/');
        return;
      }

      setListing(listingData);
      setPreviews(listingData.images || []);
      setFormData({
        title: listingData.title || '',
        description: listingData.description || '',
        price: listingData.price || '',
        originalPrice: listingData.originalPrice || '',
        category: listingData.category || 'Women',
        brand: listingData.brand || '',
        size: listingData.size || '',
        condition: listingData.condition || 'Good',
        color: listingData.color || '',
        weight: listingData.weight || '0.5',
        weightUnit: listingData.weightUnit || 'kg',
        shipsFrom: listingData.shipsFrom || 'US',
        domesticShipping: listingData.shipping?.domestic ?? true,
        internationalShipping: listingData.shipping?.international ?? false,
        freeShipping: listingData.shipping?.freeShipping ?? false,
        shippingCost: listingData.shipping?.shippingCost || '3.99',
        quantity: listingData.quantity || '1',
        status: listingData.status || 'active',
      });
    } catch (error) {
      toast.error('Failed to load listing');
      navigate('/');
    }
    setLoading(false);
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleImageChange = async (e) => {
    const files = Array.from(e.target.files);
    if (previews.length + files.length > 10) {
      toast.error('Max 10 images');
      return;
    }

    const newPreviews = [...previews];
    for (const file of files) {
      try {
        const options = {
          maxSizeMB: 0.5,
          maxWidthOrHeight: 800,
          useWebWorker: true,
          fileType: 'image/webp',
        };
        const compressed = await imageCompression(file, options);
        const previewDataUrl = await imageCompression.getDataUrlFromFile(compressed);
        newPreviews.push(previewDataUrl);
      } catch (err) {
        const reader = new FileReader();
        const dataUrlPromise = new Promise(res => {
          reader.onloadend = () => res(reader.result);
          reader.readAsDataURL(file);
        });
        newPreviews.push(await dataUrlPromise);
      }
    }
    setPreviews(newPreviews);
  };

  const removeImage = (index) => {
    setPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (previews.length === 0) {
      toast.error('Add at least one image');
      return;
    }
    setSaving(true);
    try {
      const data = new FormData();
      
      // Add existing images
      const existingImages = previews.filter(p => !p.startsWith('data:'));
      data.append('existingImages', JSON.stringify(existingImages));
      
      // Add new image files
      const newImages = previews.filter(p => p.startsWith('data:'));
      for (const img of newImages) {
        // Convert data URL to file
        const response = await fetch(img);
        const blob = await response.blob();
        data.append('images', blob);
      }

      Object.keys(formData).forEach(key => {
        if (formData[key] !== undefined) data.append(key, formData[key]);
      });

      const res = await api.put(`/listings/${id}`, data, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      toast.success('Listing updated!');
      navigate(`/listing/${id}`);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save');
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="skeleton" style={{ height: 400, borderRadius: 'var(--td-radius-lg)' }} />
      </div>
    );
  }

  if (!listing) return null;

  return (
    <div className="page-container" style={{ maxWidth: 800, margin: '0 auto' }}>
      <button className="back-btn" onClick={() => navigate(-1)}>
        <FaArrowLeft /> Back
      </button>
      
      <h1 className="page-title"><FaImage /> Edit Listing</h1>

      <form onSubmit={handleSubmit}>
        <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
          <h2>Photos</h2>
          <p className="form-hint">First photo is your cover image</p>
          
          <div className="image-upload-area">
            <div className="image-previews">
              {previews.map((preview, index) => (
                <div key={index} className="image-preview">
                  <img src={preview} alt="" />
                  {index === 0 && <span className="badge badge-primary" style={{ position: 'absolute', top: 4, left: 4 }}>Cover</span>}
                  <button type="button" className="remove-image" onClick={() => removeImage(index)}>
                    <FaTimes size={12} />
                  </button>
                </div>
              ))}
            </div>
            
            {previews.length < 10 && (
              <button type="button" className="upload-btn" onClick={() => fileInputRef.current.click()}>
                <FaCamera size={32} />
                <span>Add Photos</span>
                <span style={{ fontSize: 11 }}>{previews.length}/10</span>
              </button>
            )}
            
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              onChange={handleImageChange}
              style={{ display: 'none' }}
            />
          </div>

          <div className="form-grid" style={{ marginTop: 'var(--td-space-lg)' }}>
            <div className="form-group full-width">
              <label className="form-label">Title *</label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleChange}
                required
                className="form-input"
              />
            </div>

            <div className="form-group full-width">
              <label className="form-label">Description *</label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                required
                rows={4}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Category *</label>
              <select name="category" value={formData.category} onChange={handleChange} className="form-input">
                <option>Women</option>
                <option>Men</option>
                <option>Kids</option>
                <option>Electronics</option>
                <option>Home</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Brand</label>
              <input type="text" name="brand" value={formData.brand} onChange={handleChange} className="form-input" />
            </div>

            <div className="form-group">
              <label className="form-label">Price * ({user?.currency || 'USD'})</label>
              <input type="number" name="price" value={formData.price} onChange={handleChange} min="5" step="0.01" required className="form-input" />
              <p className="form-hint">You'll earn ~{formatPrice(formData.price * 0.9, user?.currency)} after 10% fee</p>
            </div>

            <div className="form-group">
              <label className="form-label">Quantity</label>
              <input type="number" name="quantity" value={formData.quantity} onChange={handleChange} min="1" max="999" className="form-input" />
            </div>

            <div className="form-group">
              <label className="form-label">Condition *</label>
              <select name="condition" value={formData.condition} onChange={handleChange} className="form-input">
                <option>New with tags</option>
                <option>New without tags</option>
                <option>Good</option>
                <option>Fair</option>
                <option>Poor</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Status</label>
              <select name="status" value={formData.status} onChange={handleChange} className="form-input">
                <option value="active">Active</option>
                <option value="draft">Draft</option>
              </select>
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-lg" disabled={saving} style={{ marginTop: 'var(--td-space-lg)' }}>
            {saving ? <><FaSpinner className="spinner-sm" /> Saving...</> : <><FaCheckCircle /> Save Changes</>}
          </button>
        </div>
      </form>
    </div>
  );
};

export default EditListing;