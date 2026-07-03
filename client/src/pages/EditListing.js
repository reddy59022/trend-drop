import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { toast } from 'react-toastify';
import { FaCamera, FaTimes, FaImage, FaSpinner, FaInfoCircle, FaTruck, FaDollarSign, FaCheckCircle, FaArrowLeft, FaPlay, FaYoutube, FaInstagram, FaLink, FaRocket } from 'react-icons/fa';
import imageCompression from 'browser-image-compression';
import { countries, formatPrice } from '../utils/helpers';
import { useTheme } from '../context/ThemeContext';
import { parseVideoUrl, getVideoPlatformLabel, getVideoPlatformColor } from '../utils/videoEmbed';

// Boost tier configuration (same as Sell.js)
const BOOST_TIERS = {
  standard: { name: 'Standard Boost', feePercent: 10, color: '#4CAF50', features: ['Priority placement', 'Featured badge', 'Search boost'] },
  premium: { name: 'Premium Boost', feePercent: 15, color: '#FF9800', features: ['Top placement', 'Featured badge', 'Search boost', 'Homepage spotlight', 'Category highlight'] },
  elite: { name: 'Elite Boost', feePercent: 20, color: '#9C27B0', features: ['#1 placement', 'Featured badge', 'Search boost', 'Homepage spotlight', 'Category highlight', 'Push notification'] },
};

const defaultShippingFees = {
  US: 3.99, CA: 9.99, GB: 9.99, DE: 9.99, FR: 9.99, AU: 18.99,
  JP: 18.99, IN: 18.99, BR: 18.99, AE: 18.99, SG: 18.99,
  MX: 18.99, TR: 18.99, KR: 18.99, IT: 9.99, ES: 9.99,
  NL: 9.99, SE: 9.99, PL: 9.99, ZA: 18.99, CN: 18.99,
  NZ: 18.99, CH: 9.99,
};

const EditListing = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { currency } = useTheme();
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [listing, setListing] = useState(null);
  const [previews, setPreviews] = useState([]);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoPreview, setVideoPreview] = useState(null);
  
  // Boost state
  const [enableBoost, setEnableBoost] = useState(false);
  const [selectedBoostTier, setSelectedBoostTier] = useState('standard');
  const [boostDuration, setBoostDuration] = useState(14);

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

  const steps = [
    { id: 'photos', label: 'Photos', icon: FaCamera },
    { id: 'details', label: 'Details', icon: FaInfoCircle },
    { id: 'shipping', label: 'Shipping', icon: FaTruck },
    { id: 'pricing', label: 'Pricing', icon: FaDollarSign },
    { id: 'boost', label: 'Boost', icon: FaRocket },
  ];

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
      setVideoUrl(listingData.videoUrl || '');
      if (listingData.videoUrl) {
        setVideoPreview(parseVideoUrl(listingData.videoUrl));
      }
      
      // Initialize boost state from existing listing
      if (listingData.boost?.active) {
        setEnableBoost(true);
        setSelectedBoostTier(listingData.boost.tier || 'standard');
        setBoostDuration(listingData.boost.durationDays || 14);
      }
      
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
    if (previews.length === 0 && !videoUrl.trim()) {
      toast.error('Add at least one image or a video URL');
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
        const response = await fetch(img);
        const blob = await response.blob();
        data.append('images', blob);
      }

      // Add video URL if present
      if (videoUrl.trim()) {
        data.append('videoUrl', videoUrl.trim());
      }

      // Add boost fields if boost is enabled
      if (enableBoost && selectedBoostTier) {
        data.append('boostTier', selectedBoostTier);
        data.append('boostDuration', boostDuration);
      } else if (!enableBoost && listing?.boost?.active) {
        data.append('removeBoost', 'true');
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

  const listingPrice = parseFloat(formData.price) || 0;
  const boostFee = enableBoost && listingPrice > 0 ? listingPrice * (BOOST_TIERS[selectedBoostTier]?.feePercent / 100) : 0;
  const platformFee = listingPrice * 0.08;
  const sellerEarnings = listingPrice - platformFee - boostFee;

  return (
    <div className="page-container" style={{ maxWidth: 800, margin: '0 auto' }}>
      <button className="back-btn" onClick={() => navigate(-1)}>
        <FaArrowLeft /> Back
      </button>
      
      <h1 className="page-title"><FaImage /> Edit Listing</h1>

      <form onSubmit={handleSubmit}>
        <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
          
          {/* PHOTOS SECTION */}
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Photos</h2>
          <p className="form-hint">Add up to 10 photos. First photo is your cover image.</p>
          
          <div className="image-upload-area">
            <div className="image-previews">
              {previews.map((preview, index) => (
                <div key={index} className="image-preview">
                  <img src={preview} alt={`Preview ${index + 1}`} />
                  {index === 0 && <span className="badge badge-primary" style={{ position: 'absolute', top: 4, left: 4 }}>Cover</span>}
                  <button type="button" className="remove-image" onClick={() => removeImage(index)}><FaTimes size={12} /></button>
                </div>
              ))}
            </div>
            {previews.length < 10 && (
              <button type="button" className="upload-btn" onClick={() => fileInputRef.current.click()}>
                <FaCamera size={32} /><span>Add Photos</span><span style={{ fontSize: 11 }}>{previews.length}/10</span>
              </button>
            )}
            <input ref={fileInputRef} type="file" multiple accept="image/*" onChange={handleImageChange} style={{ display: 'none' }} />
          </div>

          {/* VIDEO URL SECTION */}
          <div style={{ marginTop: 'var(--td-space-lg)', borderTop: '1px solid var(--td-border)', paddingTop: 'var(--td-space-md)' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <FaPlay size={16} style={{ color: 'var(--td-primary)' }} /> Product Video <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--td-text-tertiary)' }}>(optional)</span>
            </h2>
            <p className="form-hint" style={{ marginBottom: 'var(--td-space-sm)' }}>
              Add a YouTube, Instagram Reel, Facebook video, or TikTok URL to showcase your item in action
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="url"
                value={videoUrl}
                onChange={(e) => {
                  const url = e.target.value;
                  setVideoUrl(url);
                  if (url.trim()) {
                    setVideoPreview(parseVideoUrl(url));
                  } else {
                    setVideoPreview(null);
                  }
                }}
                placeholder="https://youtube.com/watch?v=... or Instagram reel URL"
                className="form-input"
                style={{ flex: 1 }}
              />
              {videoPreview && (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => { setVideoUrl(''); setVideoPreview(null); }}
                  style={{ padding: '8px 12px', color: 'var(--td-error)' }}
                >
                  <FaTimes size={16} />
                </button>
              )}
            </div>
            {videoPreview && (
              <div style={{
                marginTop: 'var(--td-space-sm)',
                padding: 'var(--td-space-md)',
                background: `${getVideoPlatformColor(videoPreview)}10`,
                borderRadius: 'var(--td-radius-sm)',
                border: `1px solid ${getVideoPlatformColor(videoPreview)}30`,
              }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: getVideoPlatformColor(videoPreview) }}>
                  {getVideoPlatformLabel(videoPreview)} linked
                </div>
              </div>
            )}
          </div>

          {/* FORM FIELDS */}
          <div className="form-grid" style={{ marginTop: 'var(--td-space-lg)' }}>
            <div className="form-group full-width">
              <label className="form-label">Title *</label>
              <input type="text" name="title" value={formData.title} onChange={handleChange} required className="form-input" />
            </div>

            <div className="form-group full-width">
              <label className="form-label">Description *</label>
              <textarea name="description" value={formData.description} onChange={handleChange} required rows={4} className="form-input" />
            </div>

            <div className="form-group">
              <label className="form-label">Category *</label>
              <select name="category" value={formData.category} onChange={handleChange} className="form-input">
                <option>Women</option>
                <option>Men</option>
                <option>Kids</option>
                <option>Electronics</option>
                <option>Home</option>
                <option>Beauty</option>
                <option>Accessories</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Brand</label>
              <input type="text" name="brand" value={formData.brand} onChange={handleChange} className="form-input" />
            </div>

            <div className="form-group">
              <label className="form-label">Size</label>
              <input type="text" name="size" value={formData.size} onChange={handleChange} placeholder="e.g. M, 10" className="form-input" />
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
              <label className="form-label">Color</label>
              <input type="text" name="color" value={formData.color} onChange={handleChange} className="form-input" />
            </div>
          </div>

          {/* SHIPPING SECTION */}
          <div style={{ marginTop: 'var(--td-space-lg)' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Shipping</h2>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Ships From</label>
                <select name="shipsFrom" value={formData.shipsFrom} onChange={handleChange} className="form-input">
                  {countries.map(c => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Weight</label>
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
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" name="domesticShipping" checked={formData.domesticShipping} onChange={e => setFormData(prev => ({ ...prev, domesticShipping: e.target.checked }))} style={{ accentColor: 'var(--td-primary)' }} /> Domestic
                </label>
              </div>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" name="internationalShipping" checked={formData.internationalShipping} onChange={e => setFormData(prev => ({ ...prev, internationalShipping: e.target.checked }))} style={{ accentColor: 'var(--td-primary)' }} /> International
                </label>
              </div>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" name="freeShipping" checked={formData.freeShipping} onChange={e => setFormData(prev => ({ ...prev, freeShipping: e.target.checked }))} style={{ accentColor: 'var(--td-primary)' }} /> Free Shipping
                </label>
              </div>
              <div className="form-group full-width">
                <label className="form-label">Shipping Fee ({currency || 'USD'})</label>
                <input type="number" name="shippingCost" value={formData.shippingCost} onChange={handleChange} min="0" step="0.01" className="form-input" />
                <p className="form-hint">Default for {formData.shipsFrom}: {formatPrice(defaultShippingFees[formData.shipsFrom] || 3.99, currency || 'USD')}</p>
              </div>
            </div>
          </div>

          {/* PRICING SECTION */}
          <div style={{ marginTop: 'var(--td-space-lg)' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Pricing</h2>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Price * ({currency || 'USD'})</label>
                <input type="number" name="price" value={formData.price} onChange={handleChange} min="5" step="0.01" required className="form-input" />
                {formData.price > 0 && <p className="form-hint">You'll earn ~{formatPrice(sellerEarnings, currency || 'USD')} after fees</p>}
              </div>
              <div className="form-group">
                <label className="form-label">Original Price</label>
                <input type="number" name="originalPrice" value={formData.originalPrice} onChange={handleChange} min="0" step="0.01" className="form-input" />
              </div>
              <div className="form-group">
                <label className="form-label">Quantity</label>
                <input type="number" name="quantity" value={formData.quantity} onChange={handleChange} min="1" max="999" className="form-input" />
              </div>
              <div className="form-group">
                <label className="form-label">Status</label>
                <select name="status" value={formData.status} onChange={handleChange} className="form-input">
                  <option value="active">Active</option>
                  <option value="draft">Draft</option>
                </select>
              </div>
            </div>
          </div>

          {/* BOOST SECTION */}
          <div style={{ marginTop: 'var(--td-space-lg)' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <FaRocket size={16} style={{ color: 'var(--td-primary)' }} /> Boost Your Listing
            </h2>
            <p className="form-hint" style={{ marginBottom: 'var(--td-space-md)' }}>
              Increase visibility and sell faster. Boost fee is deducted from your earnings when the item sells.
            </p>
            
            <div style={{ padding: 'var(--td-space-md)', background: enableBoost ? 'rgba(255, 56, 92, 0.06)' : 'var(--td-surface)', borderRadius: 'var(--td-radius-sm)', border: `2px solid ${enableBoost ? 'var(--td-primary)' : 'var(--td-border)'}`, marginBottom: 'var(--td-space-md)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={enableBoost} onChange={(e) => setEnableBoost(e.target.checked)} style={{ accentColor: 'var(--td-primary)', width: 20, height: 20 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>Enable Boost Promotion</div>
                  <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>
                    {enableBoost ? 'Boost is active - select your preferred tier below' : 'No boost - listing will appear in standard results'}
                  </div>
                </div>
              </label>
            </div>

            {enableBoost && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 'var(--td-space-md)' }}>
                  {Object.entries(BOOST_TIERS).map(([key, tier]) => {
                    const isSelected = selectedBoostTier === key;
                    return (
                      <div key={key} onClick={() => setSelectedBoostTier(key)} style={{
                        padding: 'var(--td-space-md)',
                        borderRadius: 'var(--td-radius-sm)',
                        border: `2px solid ${isSelected ? tier.color : 'var(--td-border)'}`,
                        background: isSelected ? `${tier.color}10` : 'var(--td-surface)',
                        cursor: 'pointer',
                      }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{tier.name}</div>
                        <div style={{ fontSize: 12, color: tier.color, fontWeight: 600 }}>{tier.feePercent}% fee</div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginBottom: 'var(--td-space-md)' }}>
                  <label className="form-label" style={{ fontSize: 14, fontWeight: 600 }}>Boost Duration</label>
                  <select value={boostDuration} onChange={e => setBoostDuration(Number(e.target.value))} className="form-input" style={{ maxWidth: 200 }}>
                    <option value={7}>7 days</option>
                    <option value={14}>14 days (recommended)</option>
                    <option value={21}>21 days</option>
                    <option value={30}>30 days</option>
                  </select>
                </div>

                {listingPrice > 0 && (
                  <div style={{ padding: 'var(--td-space-md)', background: 'var(--td-surface)', borderRadius: 'var(--td-radius-sm)', border: '1px solid var(--td-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: 'var(--td-success)' }}>
                      <span>You'll Earn:</span>
                      <span>{formatPrice(sellerEarnings, currency || 'USD')}</span>
                    </div>
                  </div>
                )}
              </>
            )}
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