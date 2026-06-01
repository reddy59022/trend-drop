import React, { useState, useRef, useEffect } from 'react';
// Add lightweight client‑side image compression library
import imageCompression from 'browser-image-compression';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { toast } from 'react-toastify';
import { FaCamera, FaTimes, FaImage, FaSpinner, FaInfoCircle, FaTruck, FaDollarSign, FaCheckCircle, FaPlay, FaYoutube, FaInstagram, FaLink, FaRocket, FaStar, FaCrown, FaBolt } from 'react-icons/fa';
import { parseVideoUrl, getVideoPlatformLabel, getVideoPlatformColor } from '../utils/videoEmbed';
import { countries, formatPrice } from '../utils/helpers';

const steps = [
  { id: 'photos', label: 'Photos', icon: FaCamera },
  { id: 'details', label: 'Details', icon: FaInfoCircle },
  { id: 'shipping', label: 'Shipping', icon: FaTruck },
  { id: 'pricing', label: 'Pricing', icon: FaDollarSign },
  { id: 'boost', label: 'Boost', icon: FaRocket },
];

// Boost tier configuration
const BOOST_TIERS = {
  standard: {
    name: 'Standard Boost',
    feePercent: 10,
    icon: FaStar,
    color: '#4CAF50',
    features: ['Priority placement', 'Featured badge', 'Search boost'],
    description: 'Get your listing noticed with enhanced visibility',
  },
  premium: {
    name: 'Premium Boost',
    feePercent: 15,
    icon: FaRocket,
    color: '#FF9800',
    features: ['Top placement', 'Featured badge', 'Search boost', 'Homepage spotlight', 'Category highlight'],
    description: 'Maximum visibility for your listing across the platform',
  },
  elite: {
    name: 'Elite Boost',
    feePercent: 20,
    icon: FaCrown,
    color: '#9C27B0',
    features: ['#1 placement', 'Featured badge', 'Search boost', 'Homepage spotlight', 'Category highlight', 'Push notification to followers', 'Social media promotion'],
    description: 'Ultimate promotion with all premium features',
  },
};

const Sell = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [images, setImages] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoPreview, setVideoPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [boostConfig, setBoostConfig] = useState(null);
  
  // Boost selection state - default to 'premium' (middle tier)
  const [selectedBoostTier, setSelectedBoostTier] = useState('premium');
  const [boostDuration, setBoostDuration] = useState(14);
  const [enableBoost, setEnableBoost] = useState(true);
  
  // Country-specific default shipping fees (in USD)
  const defaultShippingFees = {
    US: 3.99, CA: 9.99, GB: 9.99, DE: 9.99, FR: 9.99, AU: 18.99,
    JP: 18.99, IN: 18.99, BR: 18.99, AE: 18.99, SG: 18.99,
    MX: 18.99, TR: 18.99, KR: 18.99, IT: 9.99, ES: 9.99,
    NL: 9.99, SE: 9.99, PL: 9.99, ZA: 18.99, CN: 18.99,
    NZ: 18.99, CH: 9.99,
  };
  const defaultShippingLabels = {
    US: 'Domestic (USPS)', CA: 'North America', GB: 'Europe', DE: 'Europe',
    FR: 'Europe', AU: 'Asia-Pacific', JP: 'Asia-Pacific', IN: 'Asia-Pacific',
    BR: 'South America', AE: 'Middle East', SG: 'Asia-Pacific',
    MX: 'North America', TR: 'Europe', KR: 'Asia-Pacific', IT: 'Europe',
    ES: 'Europe', NL: 'Europe', SE: 'Europe', PL: 'Europe',
    ZA: 'Africa', CN: 'Asia-Pacific', NZ: 'Asia-Pacific', CH: 'Europe',
  };

  const [formData, setFormData] = useState({
    title: '', description: '', price: '', originalPrice: '',
    category: 'Women', brand: '', size: '', condition: 'Good',
    color: '', weight: '0.5', weightUnit: 'kg',
    shipsFrom: user?.country || 'US',
    domesticShipping: true, internationalShipping: false, freeShipping: false,
    shippingCost: String(defaultShippingFees[user?.country || 'US'] || '3.99'),
    quantity: '1',
  });

  // Fetch boost config on mount
  useEffect(() => {
    const fetchBoostConfig = async () => {
      try {
        const res = await api.get('/boost/config');
        setBoostConfig(res.data);
      } catch (err) {
        console.error('Failed to fetch boost config:', err);
      }
    };
    fetchBoostConfig();
  }, []);

  useEffect(() => { if (!user) navigate('/login'); }, [user, navigate]);
  if (!user) return null;

  const handleChange = (e) => { setFormData({ ...formData, [e.target.name]: e.target.value }); };

  // Calculate boost fee for display
  const calculateBoostFee = (price, tier) => {
    const tierConfig = BOOST_TIERS[tier];
    if (!tierConfig || !price) return 0;
    return (price * tierConfig.feePercent / 100);
  };

  // Calculate platform fee (8%)
  const calculatePlatformFee = (price) => {
    if (!price) return 0;
    return price * 0.08;
  };

  // Calculate seller earnings
  const calculateSellerEarnings = (price, tier) => {
    if (!price) return 0;
    const platformFee = calculatePlatformFee(price);
    const boostFee = enableBoost ? calculateBoostFee(price, tier) : 0;
    return price - platformFee - boostFee;
  };

  const handleImageChange = async (e) => {
    const files = Array.from(e.target.files);
    if (images.length + files.length > 10) { toast.error('Max 10 images'); return; }
    const compressedFiles = [];
    const newPreviews = [];
    for (const file of files) {
      try {
        const options = {
          maxSizeMB: 0.5,
          maxWidthOrHeight: 800,
          useWebWorker: true,
          fileType: 'image/webp',
        };
        const compressed = await imageCompression(file, options);
        compressedFiles.push(compressed);
        const previewDataUrl = await imageCompression.getDataUrlFromFile(compressed);
        newPreviews.push(previewDataUrl);
      } catch (err) {
        console.error('Compression error', err);
        compressedFiles.push(file);
        const reader = new FileReader();
        const dataUrlPromise = new Promise(res => {
          reader.onloadend = () => res(reader.result);
          reader.readAsDataURL(file);
        });
        newPreviews.push(await dataUrlPromise);
      }
    }
    setImages(prev => [...prev, ...compressedFiles]);
    setPreviews(prev => [...prev, ...newPreviews]);
  };

  const removeImage = (index) => {
    setImages(prev => prev.filter((_, i) => i !== index));
    setPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (images.length === 0 && !videoUrl.trim()) { toast.error('Add at least one image or a video URL'); return; }
    if (!formData.title || !formData.description || !formData.price) { toast.error('Fill required fields'); return; }
    setLoading(true);
    try {
      const data = new FormData();
      images.forEach(img => data.append('images', img));
      if (videoUrl.trim()) {
        data.append('videoUrl', videoUrl.trim());
      }
      Object.keys(formData).forEach(key => { if (formData[key]) data.append(key, formData[key]); });
      
      // Add boost fields if boost is enabled
      if (enableBoost && selectedBoostTier) {
        data.append('boostTier', selectedBoostTier);
        data.append('boostDuration', boostDuration);
      }
      
      const res = await api.post('/listings', data, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Listing created!');
      navigate(`/listing/${res.data._id}`);
    } catch (error) { toast.error(error.response?.data?.message || 'Failed'); }
    setLoading(false);
  };

  const listingPrice = parseFloat(formData.price) || 0;
  const platformFee = calculatePlatformFee(listingPrice);
  const boostFee = enableBoost ? calculateBoostFee(listingPrice, selectedBoostTier) : 0;
  const sellerEarnings = calculateSellerEarnings(listingPrice, selectedBoostTier);

  return (
    <div className="page-container" style={{ maxWidth: 800, margin: '0 auto' }}>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}><FaImage /> List an Item</h1>

      {/* Progress Steps */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--td-space-lg)', animation: 'fadeInUp 0.3s ease-out' }}>
        {steps.map((step, i) => {
          const StepIcon = step.icon;
          const isActive = i === currentStep;
          const isComplete = i < currentStep;
          return (
            <button key={step.id} onClick={() => setCurrentStep(i)}
              style={{
                flex: 1, padding: '12px 8px', borderRadius: 'var(--td-radius-sm)', border: `2px solid ${isActive ? 'var(--td-primary)' : isComplete ? 'var(--td-success)' : 'var(--td-border)'}`,
                background: isActive ? 'rgba(255, 56, 92, 0.06)' : isComplete ? 'rgba(0, 200, 83, 0.06)' : 'var(--td-surface)',
                color: isActive ? 'var(--td-primary)' : isComplete ? 'var(--td-success)' : 'var(--td-text-tertiary)',
                cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                fontSize: 12, fontWeight: isActive ? 700 : 500, transition: 'all 0.2s',
              }}>
              {isComplete ? <FaCheckCircle size={16} /> : <StepIcon size={16} />}
              {step.label}
            </button>
          );
        })}
      </div>

      <form className="sell-form" onSubmit={handleSubmit}>
        {/* Step 0: Photos */}
        {currentStep === 0 && (
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)', animation: 'fadeInUp 0.3s ease-out' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Photos</h2>
            <p className="form-hint">Add up to 10 photos. First photo is your cover image.</p>
            <div className="image-upload-area">
              <div className="image-previews">
                {previews.map((preview, index) => (
                  <div key={index} className="image-preview">
                    <img src={preview} alt={`Preview ${index + 1}`} />
                    {index === 0 && <span style={{ position: 'absolute', top: 4, left: 4, background: 'var(--td-primary)', color: '#fff', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>Cover</span>}
                    <button type="button" className="remove-image" onClick={() => removeImage(index)}><FaTimes size={12} /></button>
                  </div>
                ))}
              </div>
              {images.length < 10 && (
                <button type="button" className="upload-btn" onClick={() => fileInputRef.current.click()}>
                  <FaCamera size={32} /><span>Add Photos</span><span style={{ fontSize: 11 }}>{images.length}/10</span>
                </button>
              )}
              <input ref={fileInputRef} type="file" multiple accept="image/*" onChange={handleImageChange} style={{ display: 'none' }} />
            </div>

            {/* Video URL Section */}
            <div style={{ marginTop: 'var(--td-space-lg)', borderTop: '1px solid var(--td-border)', paddingTop: 'var(--td-space-md)' }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                <FaPlay size={16} style={{ color: 'var(--td-primary)' }} /> Product Video <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--td-text-tertiary)' }}>(optional)</span>
              </h2>
              <p className="form-hint" style={{ marginBottom: 'var(--td-space-sm)' }}>
                Add a YouTube, Instagram Reel, Facebook video, TikTok, or direct video URL to showcase your item in action
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="url"
                  value={videoUrl}
                  onChange={(e) => {
                    const url = e.target.value;
                    setVideoUrl(url);
                    if (url.trim()) {
                      const parsed = parseVideoUrl(url);
                      setVideoPreview(parsed);
                    } else {
                      setVideoPreview(null);
                    }
                  }}
                  placeholder="https://youtube.com/watch?v=... or Instagram/Facebook reel URL"
                  className="form-input"
                  style={{ flex: 1 }}
                />
                {videoPreview && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => {
                      setVideoUrl('');
                      setVideoPreview(null);
                    }}
                    style={{ padding: '8px 12px', color: 'var(--td-error)' }}
                    title="Remove video"
                  >
                    <FaTimes size={16} />
                  </button>
                )}
              </div>
              
              {/* Video Preview */}
              {videoPreview && (
                <div style={{
                  marginTop: 'var(--td-space-sm)',
                  padding: 'var(--td-space-md)',
                  background: `${getVideoPlatformColor(videoPreview)}10`,
                  borderRadius: 'var(--td-radius-sm)',
                  border: `1px solid ${getVideoPlatformColor(videoPreview)}30`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}>
                  <div style={{
                    width: 40, height: 40,
                    borderRadius: 'var(--td-radius-sm)',
                    background: getVideoPlatformColor(videoPreview),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {videoPreview.platform === 'youtube' && <FaYoutube size={20} color="#fff" />}
                    {videoPreview.platform === 'instagram' && <FaInstagram size={20} color="#fff" />}
                    {videoPreview.platform === 'facebook' && <FaLink size={20} color="#fff" />}
                    {videoPreview.platform === 'direct' && <FaPlay size={20} color="#fff" />}
                    {!['youtube', 'instagram', 'facebook', 'direct'].includes(videoPreview.platform) && <FaPlay size={20} color="#fff" />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: getVideoPlatformColor(videoPreview) }}>
                      {getVideoPlatformLabel(videoPreview)} linked
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {videoPreview.url}
                    </div>
                  </div>
                  <FaCheckCircle size={18} style={{ color: 'var(--td-success)', flexShrink: 0 }} />
                </div>
              )}
            </div>

            <button type="button" className="btn btn-primary" onClick={() => setCurrentStep(1)} disabled={images.length === 0 && !videoPreview} style={{ marginTop: 'var(--td-space-md)' }}>
              Next: Add Details →
            </button>
          </div>
        )}

        {/* Step 1: Details */}
        {currentStep === 1 && (
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)', animation: 'fadeInUp 0.3s ease-out' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Item Details</h2>
            <div className="form-grid">
              <div className="form-group full-width"><label className="form-label">Title *</label><input type="text" name="title" value={formData.title} onChange={handleChange} placeholder="e.g. Nike Air Max 90" required className="form-input" /></div>
              <div className="form-group full-width"><label className="form-label">Description *</label><textarea name="description" value={formData.description} onChange={handleChange} placeholder="Describe your item..." required rows={4} className="form-input" /></div>
              <div className="form-group"><label className="form-label">Category *</label><select name="category" value={formData.category} onChange={handleChange} className="form-input"><option>Women</option><option>Men</option><option>Kids</option><option>Electronics</option><option>Home</option><option>Beauty</option><option>Accessories</option></select></div>
              <div className="form-group"><label className="form-label">Brand</label><input type="text" name="brand" value={formData.brand} onChange={handleChange} placeholder="e.g. Nike" className="form-input" /></div>
              <div className="form-group"><label className="form-label">Size</label><input type="text" name="size" value={formData.size} onChange={handleChange} placeholder="e.g. M, 10" className="form-input" /></div>
              <div className="form-group"><label className="form-label">Condition *</label><select name="condition" value={formData.condition} onChange={handleChange} className="form-input"><option>New with tags</option><option>New without tags</option><option>Good</option><option>Fair</option><option>Poor</option></select></div>
              <div className="form-group"><label className="form-label">Color</label><input type="text" name="color" value={formData.color} onChange={handleChange} placeholder="e.g. Black" className="form-input" /></div>
              <div className="form-group"><label className="form-label">Quantity</label><input type="number" name="quantity" value={formData.quantity} onChange={handleChange} min="1" max="999" className="form-input" /></div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 'var(--td-space-md)' }}>
              <button type="button" className="btn btn-outline" onClick={() => setCurrentStep(0)}>← Back</button>
              <button type="button" className="btn btn-primary" onClick={() => setCurrentStep(2)} disabled={!formData.title || !formData.description}>Next: Shipping →</button>
            </div>
          </div>
        )}

        {/* Step 2: Shipping */}
        {currentStep === 2 && (
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)', animation: 'fadeInUp 0.3s ease-out' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Shipping</h2>
            <div className="form-grid">
              <div className="form-group"><label className="form-label">Ships From</label><select name="shipsFrom" value={formData.shipsFrom} onChange={handleChange} className="form-input">{countries.map(c => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}</select></div>
              <div className="form-group"><label className="form-label">Weight</label><div style={{ display: 'flex', gap: 8 }}><input type="number" name="weight" value={formData.weight} onChange={handleChange} min="0.1" step="0.1" className="form-input" style={{ flex: 1 }} /><select name="weightUnit" value={formData.weightUnit} onChange={handleChange} className="form-input" style={{ width: 80 }}><option value="kg">kg</option><option value="lb">lb</option><option value="oz">oz</option></select></div></div>
              <div className="form-group"><label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" name="domesticShipping" checked={formData.domesticShipping} onChange={e => setFormData(prev => ({ ...prev, domesticShipping: e.target.checked }))} style={{ accentColor: 'var(--td-primary)' }} /> Domestic</label></div>
              <div className="form-group"><label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" name="internationalShipping" checked={formData.internationalShipping} onChange={e => setFormData(prev => ({ ...prev, internationalShipping: e.target.checked }))} style={{ accentColor: 'var(--td-primary)' }} /> International</label></div>
               <div className="form-group"><label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" name="freeShipping" checked={formData.freeShipping} onChange={e => setFormData(prev => ({ ...prev, freeShipping: e.target.checked }))} style={{ accentColor: 'var(--td-primary)' }} /> Free Shipping</label></div>
               <div className="form-group full-width">
                 <label className="form-label">Shipping Fee ({user?.currency || 'USD'})</label>
                 <input
                   type="number"
                   name="shippingCost"
                   value={formData.shippingCost}
                   onChange={handleChange}
                   min="0"
                   step="0.01"
                   className="form-input"
                   placeholder={defaultShippingFees[formData.shipsFrom] || '3.99'}
                 />
                 <p className="form-hint" style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                   <FaTruck size={12} /> Default for {formData.shipsFrom}: {formatPrice(defaultShippingFees[formData.shipsFrom] || 3.99, user?.currency)} ({defaultShippingLabels[formData.shipsFrom] || 'International'})
                 </p>
                 <p className="form-hint" style={{ marginTop: 4, fontSize: 11, color: 'var(--td-error)' }}>
                   ⚠️ If actual shipping cost exceeds this amount, the difference will be deducted from your payout.
                 </p>
               </div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 'var(--td-space-md)' }}>
              <button type="button" className="btn btn-outline" onClick={() => setCurrentStep(1)}>← Back</button>
              <button type="button" className="btn btn-primary" onClick={() => setCurrentStep(3)}>Next: Pricing →</button>
            </div>
          </div>
        )}

        {/* Step 3: Pricing */}
        {currentStep === 3 && (
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)', animation: 'fadeInUp 0.3s ease-out' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Pricing</h2>
            <div className="form-grid">
              <div className="form-group"><label className="form-label">Listing Price * ({user?.currency || 'USD'})</label><input type="number" name="price" value={formData.price} onChange={handleChange} placeholder="0.00" min="0" step="0.01" required className="form-input" />{formData.price > 0 && <p className="form-hint">You'll earn ~{formatPrice(formData.price * 0.9, user?.currency)} after 10% fee</p>}</div>
              <div className="form-group"><label className="form-label">Original Price</label><input type="number" name="originalPrice" value={formData.originalPrice} onChange={handleChange} placeholder="0.00" min="0" step="0.01" className="form-input" /></div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 'var(--td-space-lg)' }}>
              <button type="button" className="btn btn-outline" onClick={() => setCurrentStep(2)}>← Back</button>
              <button type="button" className="btn btn-primary" onClick={() => setCurrentStep(4)}>Next: Boost Options →</button>
            </div>
          </div>
        )}

        {/* Step 4: Boost Options */}
        {currentStep === 4 && (
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)', animation: 'fadeInUp 0.3s ease-out' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <FaRocket style={{ color: 'var(--td-primary)' }} /> Boost Your Listing
            </h2>
            <p className="form-hint" style={{ marginBottom: 'var(--td-space-md)' }}>
              Increase visibility and sell faster. Boost fee is deducted from your earnings when the item sells.
            </p>

            {/* Enable/Disable Boost Toggle */}
            <div style={{ 
              padding: 'var(--td-space-md)', 
              background: enableBoost ? 'rgba(255, 56, 92, 0.06)' : 'var(--td-surface)',
              borderRadius: 'var(--td-radius-sm)',
              border: `2px solid ${enableBoost ? 'var(--td-primary)' : 'var(--td-border)'}`,
              marginBottom: 'var(--td-space-md)',
            }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={enableBoost}
                  onChange={(e) => setEnableBoost(e.target.checked)}
                  style={{ accentColor: 'var(--td-primary)', width: 20, height: 20 }}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>Enable Boost Promotion</div>
                  <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>
                    {enableBoost ? 'Boost is active - select your preferred tier below' : 'No boost - listing will appear in standard results'}
                  </div>
                </div>
              </label>
            </div>

            {/* Boost Tier Selection */}
            {enableBoost && (
              <>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 'var(--td-space-sm)', color: 'var(--td-text-secondary)' }}>
                  Select Boost Tier
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 'var(--td-space-md)' }}>
                  {Object.entries(BOOST_TIERS).map(([key, tier]) => {
                    const TierIcon = tier.icon;
                    const isSelected = selectedBoostTier === key;
                    const fee = calculateBoostFee(listingPrice, key);
                    const isRecommended = key === 'premium';
                    
                    return (
                      <div
                        key={key}
                        onClick={() => setSelectedBoostTier(key)}
                        style={{
                          padding: 'var(--td-space-md)',
                          borderRadius: 'var(--td-radius-sm)',
                          border: `2px solid ${isSelected ? tier.color : 'var(--td-border)'}`,
                          background: isSelected ? `${tier.color}10` : 'var(--td-surface)',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          position: 'relative',
                        }}
                      >
                        {isRecommended && (
                          <div style={{
                            position: 'absolute',
                            top: -10,
                            right: 12,
                            background: tier.color,
                            color: '#fff',
                            padding: '2px 8px',
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 700,
                          }}>
                            RECOMMENDED
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <div style={{
                            width: 32, height: 32,
                            borderRadius: 'var(--td-radius-sm)',
                            background: tier.color,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <TierIcon size={16} color="#fff" />
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{tier.name}</div>
                            <div style={{ fontSize: 12, color: tier.color, fontWeight: 600 }}>{tier.feePercent}% fee</div>
                          </div>
                        </div>
                        <p style={{ fontSize: 12, color: 'var(--td-text-tertiary)', marginBottom: 8, lineHeight: 1.4 }}>
                          {tier.description}
                        </p>
                        <div style={{ fontSize: 11, color: 'var(--td-text-secondary)' }}>
                          <strong>Features:</strong>
                          <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                            {tier.features.slice(0, 3).map((f, i) => (
                              <li key={i}>{f}</li>
                            ))}
                            {tier.features.length > 3 && <li>+{tier.features.length - 3} more</li>}
                          </ul>
                        </div>
                        {listingPrice > 0 && (
                          <div style={{ 
                            marginTop: 8, 
                            padding: '6px 8px', 
                            background: `${tier.color}15`, 
                            borderRadius: 4,
                            fontSize: 12,
                            fontWeight: 600,
                            color: tier.color,
                          }}>
                            Fee: {formatPrice(fee, user?.currency)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Duration Selection */}
                <div style={{ marginBottom: 'var(--td-space-md)' }}>
                  <label className="form-label" style={{ fontSize: 14, fontWeight: 600 }}>Boost Duration</label>
                  <select 
                    value={boostDuration}
                    onChange={(e) => setBoostDuration(Number(e.target.value))}
                    className="form-input"
                    style={{ maxWidth: 200 }}
                  >
                    <option value={7}>7 days</option>
                    <option value={14}>14 days (recommended)</option>
                    <option value={21}>21 days</option>
                    <option value={30}>30 days</option>
                  </select>
                </div>

                {/* Earnings Summary */}
                {listingPrice > 0 && (
                  <div style={{
                    padding: 'var(--td-space-md)',
                    background: 'var(--td-surface)',
                    borderRadius: 'var(--td-radius-sm)',
                    border: '1px solid var(--td-border)',
                  }}>
                    <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Earnings Summary</h4>
                    <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--td-text-tertiary)' }}>Listing Price:</span>
                        <span style={{ fontWeight: 600 }}>{formatPrice(listingPrice, user?.currency)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--td-text-tertiary)' }}>Platform Fee (8%):</span>
                        <span style={{ fontWeight: 600, color: 'var(--td-error)' }}>-{formatPrice(platformFee, user?.currency)}</span>
                      </div>
                      {enableBoost && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--td-text-tertiary)' }}>Boost Fee ({BOOST_TIERS[selectedBoostTier]?.feePercent}%):</span>
                          <span style={{ fontWeight: 600, color: 'var(--td-error)' }}>-{formatPrice(boostFee, user?.currency)}</span>
                        </div>
                      )}
                      <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between',
                        paddingTop: 8,
                        borderTop: '1px solid var(--td-border)',
                        fontWeight: 700,
                      }}>
                        <span>You'll Earn:</span>
                        <span style={{ color: 'var(--td-success)', fontSize: 16 }}>{formatPrice(sellerEarnings, user?.currency)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 'var(--td-space-lg)' }}>
              <button type="button" className="btn btn-outline" onClick={() => setCurrentStep(3)}>← Back</button>
              <button type="submit" className="btn btn-primary btn-lg" disabled={loading} style={{ flex: 1 }}>
                {loading ? <><FaSpinner className="spinner-sm" /> Creating...</> : <><FaCheckCircle /> Publish Listing</>}
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
};

export default Sell;