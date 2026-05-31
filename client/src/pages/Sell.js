import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { toast } from 'react-toastify';
import { FaCamera, FaTimes } from 'react-icons/fa';
import { countries, formatPrice } from '../utils/helpers';

const Sell = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [images, setImages] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [loading, setLoading] = useState(false);
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
    shipsFrom: user?.country || 'US',
    domesticShipping: true,
    internationalShipping: false,
    freeShipping: false,
    shippingCost: '',
    quantity: '1',
  });

  useEffect(() => {
    if (!user) navigate('/login');
  }, [user, navigate]);

  if (!user) return null;

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleImageChange = (e) => {
    const files = Array.from(e.target.files);
    if (images.length + files.length > 10) {
      toast.error('Maximum 10 images allowed');
      return;
    }
    setImages((prev) => [...prev, ...files]);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviews((prev) => [...prev, reader.result]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (index) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (images.length === 0) {
      toast.error('Please add at least one image');
      return;
    }
    if (!formData.title || !formData.description || !formData.price) {
      toast.error('Please fill in all required fields');
      return;
    }
    if (Number(formData.price) < 0.50) {
      toast.error('Minimum listing price is $0.50');
      return;
    }

    setLoading(true);
    try {
      const data = new FormData();
      images.forEach((img) => data.append('images', img));
      Object.keys(formData).forEach((key) => {
        if (formData[key]) data.append(key, formData[key]);
      });

      const res = await api.post('/listings', data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      toast.success('Listing created successfully!');
      navigate(`/listing/${res.data._id}`);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to create listing');
    }
    setLoading(false);
  };

  return (
    <div className="page-container">
      <h1 className="page-title">Sell an Item</h1>
      <form className="sell-form" onSubmit={handleSubmit}>
        {/* Image Upload */}
        <div className="form-section">
          <h2>Photos</h2>
          <p className="form-hint">Add up to 10 photos</p>
          <div className="image-upload-area">
            <div className="image-previews">
              {previews.map((preview, index) => (
                <div key={index} className="image-preview">
                  <img src={preview} alt={`Preview ${index + 1}`} />
                  <button
                    type="button"
                    className="remove-image"
                    onClick={() => removeImage(index)}
                  >
                    <FaTimes />
                  </button>
                </div>
              ))}
            </div>
            {images.length < 10 && (
              <button
                type="button"
                className="upload-btn"
                onClick={() => fileInputRef.current.click()}
              >
                <FaCamera size={32} />
                <span>Add Photos</span>
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
        </div>

        {/* Listing Details */}
        <div className="form-section">
          <h2>Details</h2>
          <div className="form-grid">
            <div className="form-group full-width">
              <label htmlFor="title">Title *</label>
              <input
                type="text"
                id="title"
                name="title"
                value={formData.title}
                onChange={handleChange}
                placeholder="e.g. Nike Air Max 90"
                required
                className="form-input"
              />
            </div>
            <div className="form-group full-width">
              <label htmlFor="description">Description *</label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="Describe your item..."
                required
                rows="4"
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label htmlFor="category">Category *</label>
              <select id="category" name="category" value={formData.category} onChange={handleChange} className="form-input">
                <option value="Women">Women</option>
                <option value="Men">Men</option>
                <option value="Kids">Kids</option>
                <option value="Electronics">Electronics</option>
                <option value="Home">Home</option>
                <option value="Beauty">Beauty</option>
                <option value="Accessories">Accessories</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="brand">Brand</label>
              <input
                type="text"
                id="brand"
                name="brand"
                value={formData.brand}
                onChange={handleChange}
                placeholder="e.g. Nike"
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label htmlFor="size">Size</label>
              <input
                type="text"
                id="size"
                name="size"
                value={formData.size}
                onChange={handleChange}
                placeholder="e.g. M, 10, One Size"
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label htmlFor="condition">Condition *</label>
              <select id="condition" name="condition" value={formData.condition} onChange={handleChange} className="form-input">
                <option value="New with tags">New with tags</option>
                <option value="New without tags">New without tags</option>
                <option value="Good">Good</option>
                <option value="Fair">Fair</option>
                <option value="Poor">Poor</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="color">Color</label>
              <input
                type="text"
                id="color"
                name="color"
                value={formData.color}
                onChange={handleChange}
                placeholder="e.g. Black"
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label htmlFor="quantity">Quantity</label>
              <input
                type="number"
                id="quantity"
                name="quantity"
                value={formData.quantity}
                onChange={handleChange}
                min="1"
                max="999"
                className="form-input"
              />
              <p style={{ color: '#666', fontSize: 12, marginTop: 4 }}>
                How many of this item do you have? Auto-decrements on each sale.
              </p>
            </div>
          </div>
        </div>

        {/* Weight & Shipping */}
        <div className="form-section">
          <h2>Weight & Shipping</h2>
          <p className="form-hint">Shipping is charged to buyers. Domestic shipping is cheaper than international.</p>
          <div className="form-grid">
            <div className="form-group">
              <label>Ships From</label>
              <select name="shipsFrom" value={formData.shipsFrom} onChange={handleChange} className="form-input">
                {countries.map(c => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Weight</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="number" name="weight" value={formData.weight} onChange={handleChange} min="0.1" step="0.1" className="form-input" style={{ flex: 1 }} />
                <select name="weightUnit" value={formData.weightUnit} onChange={handleChange} className="form-input" style={{ width: 80 }}>
                  <option value="kg">kg</option>
                  <option value="lb">lb</option>
                  <option value="oz">oz</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>
                <input type="checkbox" name="domesticShipping" checked={formData.domesticShipping} onChange={(e) => setFormData(prev => ({ ...prev, domesticShipping: e.target.checked }))} style={{ marginRight: 6 }} />
                Domestic Shipping
              </label>
            </div>
            <div className="form-group">
              <label>
                <input type="checkbox" name="internationalShipping" checked={formData.internationalShipping} onChange={(e) => setFormData(prev => ({ ...prev, internationalShipping: e.target.checked }))} style={{ marginRight: 6 }} />
                International Shipping
              </label>
            </div>
            <div className="form-group">
              <label>
                <input type="checkbox" name="freeShipping" checked={formData.freeShipping} onChange={(e) => setFormData(prev => ({ ...prev, freeShipping: e.target.checked }))} style={{ marginRight: 6 }} />
                Free Shipping (domestic only)
              </label>
            </div>
          </div>
        </div>

        {/* Pricing */}
        <div className="form-section">
          <h2>Pricing</h2>
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="price">Listing Price * ({user?.currency || 'USD'})</label>
              <input
                type="number"
                id="price"
                name="price"
                value={formData.price}
                onChange={handleChange}
                placeholder="0.00"
                min="0"
                step="0.01"
                required
                className="form-input"
              />
              {formData.price > 0 && (
                <p style={{ color: '#666', fontSize: 12, marginTop: 4 }}>
                  You'll earn ~{formatPrice(formData.price * 0.9, user?.currency)} after 10% platform fee
                </p>
              )}
            </div>
            <div className="form-group">
              <label htmlFor="originalPrice">Original Price ({user?.currency || 'USD'})</label>
              <input
                type="number"
                id="originalPrice"
                name="originalPrice"
                value={formData.originalPrice}
                onChange={handleChange}
                placeholder="0.00"
                min="0"
                step="0.01"
                className="form-input"
              />
            </div>
          </div>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
            {loading ? 'Listing...' : 'List Item'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default Sell;