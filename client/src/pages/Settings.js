import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { toast } from 'react-toastify';
import { countries, formatPrice } from '../utils/helpers';
import api from '../services/api';
import { FaUser, FaTruck, FaGlobe, FaCreditCard, FaShieldAlt, FaSave, FaSignOutAlt, FaTrash, FaCamera, FaInstagram, FaTiktok, FaPinterest, FaYoutube, FaTwitter, FaFacebook, FaStore } from 'react-icons/fa';

const currenciesList = [
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR', 'MXN', 'BRL', 'KRW', 'CNY', 'CHF',
  'SEK', 'NOK', 'DKK', 'NZD', 'SGD', 'HKD', 'THB', 'ZAR', 'AED', 'SAR', 'PLN', 'TRY',
];

const languages = [
  { code: 'en', name: 'English' }, { code: 'es', name: 'Español' }, { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' }, { code: 'pt', name: 'Português' },
  { code: 'ja', name: '日本語' }, { code: 'ko', name: '한국어' }, { code: 'zh', name: '中文' },
  { code: 'ar', name: 'العربية' }, { code: 'hi', name: 'हिन्दी' },
];

function Settings() {
  const { user, updateProfile, updateAvatar, logout } = useAuth();
  const navigate = useNavigate();
  const confirmDialog = useConfirm();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('profile');
  const [formData, setFormData] = useState({
    name: '', bio: '', location: '', closetName: '',
    country: 'US', phone: '', phoneCode: '+1', currency: 'USD', language: 'en',
    shippingAddress: { fullName: '', street1: '', street2: '', city: '', state: '', postalCode: '', country: 'US', phone: '' },
    payoutMethod: { type: '', paypalEmail: '', bankName: '', accountNumber: '', routingNumber: '', accountHolder: '' },
  });

  useEffect(() => {
    if (user) {
      setFormData({
        name: user.name || '', bio: user.bio || '', location: user.location || '',
        closetName: user.closetName || '', country: user.country || 'US',
        phone: user.phone || '', phoneCode: user.phoneCode || '+1',
        currency: user.currency || 'USD', language: user.language || 'en',
        shippingAddress: user.shippingAddress || { fullName: '', street1: '', street2: '', city: '', state: '', postalCode: '', country: 'US', phone: '' },
        payoutMethod: user.payoutMethod || { type: '', paypalEmail: '', bankName: '', accountNumber: '', routingNumber: '', accountHolder: '' },
      });
    }
  }, [user]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name.startsWith('shippingAddress.')) {
      const field = name.split('.')[1];
      setFormData(prev => ({ ...prev, shippingAddress: { ...prev.shippingAddress, [field]: value } }));
    } else if (name.startsWith('payoutMethod.')) {
      const field = name.split('.')[1];
      setFormData(prev => ({ ...prev, payoutMethod: { ...prev.payoutMethod, [field]: value } }));
    } else if (name.startsWith('socialLinks.')) {
      const field = name.split('.')[1];
      setFormData(prev => ({ ...prev, socialLinks: { ...(prev.socialLinks || {}), [field]: value } }));
    } else if (name.startsWith('store.')) {
      const field = name.split('.')[1];
      setFormData(prev => ({ ...prev, store: { ...(prev.store || {}), [field]: value } }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
      if (name === 'country') {
        const c = countries.find(co => co.code === value);
        if (c) setFormData(prev => ({ ...prev, phoneCode: c.phoneCode }));
      }
    }
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('avatar', file);
    try {
      await updateAvatar(fd);
      toast.success('Avatar updated!');
    } catch (err) { toast.error('Failed to update avatar'); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await updateProfile({
        name: formData.name, bio: formData.bio, location: formData.location,
        closetName: formData.closetName, country: formData.country,
        phone: formData.phone, phoneCode: formData.phoneCode,
        currency: formData.currency, language: formData.language,
        shippingAddress: formData.shippingAddress, payoutMethod: formData.payoutMethod,
        socialLinks: formData.socialLinks || {},
        store: formData.store || {},
      });
      toast.success('Profile updated!');
    } catch (err) { toast.error('Failed to update profile'); }
    setLoading(false);
  };

  const handleDeleteAccount = async () => {
    const ok = await confirmDialog({
      title: 'Delete account?',
      message: 'Are you sure you want to delete your account? This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete('/auth/account');
      logout();
      toast.success('Account deleted');
      navigate('/');
    } catch (err) {
      toast.error('Failed to delete');
    }
  };

  const tabs = [
    { id: 'profile', label: 'Profile', icon: <FaUser size={14} /> },
    { id: 'shipping', label: 'Shipping', icon: <FaTruck size={14} /> },
    { id: 'preferences', label: 'Preferences', icon: <FaGlobe size={14} /> },
    { id: 'social', label: 'Social Links', icon: <FaInstagram size={14} /> },
    { id: 'store', label: 'Store', icon: <FaStore size={14} /> },
    { id: 'payout', label: 'Payout', icon: <FaCreditCard size={14} /> },
    { id: 'account', label: 'Account', icon: <FaShieldAlt size={14} /> },
  ];

  const selectedCountry = countries.find(c => c.code === formData.country);

  return (
    <div className="page-container" style={{ maxWidth: 700, margin: '0 auto' }}>
      <h1 className="page-title">Settings</h1>

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: 'var(--td-space-lg)' }}>
        {tabs.map(tab => (
          <button key={tab.id} className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} style={{ animation: 'fadeInUp 0.3s ease-out' }}>
        {activeTab === 'profile' && (
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--td-space-md)' }}>
            <div className="avatar-upload" style={{ marginBottom: 12 }}>
              <label className="avatar-label">
                <input type="file" accept="image/*" onChange={handleAvatarChange} style={{ display: 'none' }} />
                <div style={{ position: 'relative' }}>
                  <img src={user?.avatar || ''} alt="" style={{ width: 100, height: 100, borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--td-primary)' }} />
                  <div style={{ position: 'absolute', bottom: 0, right: 0, width: 32, height: 32, borderRadius: '50%', background: 'var(--td-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12 }}>
                    <FaCamera size={14} />
                  </div>
                </div>
              </label>
            </div>
            <div className="form-group"><label className="form-label">Full Name</label><input name="name" value={formData.name} onChange={handleChange} className="form-input" placeholder="Your name" /></div>
            <div className="form-group"><label className="form-label">Closet Name</label><input name="closetName" value={formData.closetName} onChange={handleChange} className="form-input" placeholder="e.g. Vintage Vault" /></div>
            <div className="form-group"><label className="form-label">Bio</label><textarea name="bio" value={formData.bio} onChange={handleChange} className="form-input" placeholder="Tell the world about your style..." rows={3} /></div>
            <div className="form-group"><label className="form-label">Location</label><input name="location" value={formData.location} onChange={handleChange} className="form-input" placeholder="City, Country" /></div>
          </div>
        )}

        {activeTab === 'shipping' && (
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--td-space-md)' }}>
            <div className="form-group"><label className="form-label">Full Name</label><input name="shippingAddress.fullName" value={formData.shippingAddress.fullName} onChange={handleChange} className="form-input" placeholder="Recipient name" /></div>
            <div className="form-group"><label className="form-label">Street Address</label><input name="shippingAddress.street1" value={formData.shippingAddress.street1} onChange={handleChange} className="form-input" placeholder="Street address" /></div>
            <div className="form-group"><label className="form-label">Apt/Suite (Optional)</label><input name="shippingAddress.street2" value={formData.shippingAddress.street2} onChange={handleChange} className="form-input" placeholder="Apt, Suite, etc." /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group"><label className="form-label">City</label><input name="shippingAddress.city" value={formData.shippingAddress.city} onChange={handleChange} className="form-input" placeholder="City" /></div>
              <div className="form-group"><label className="form-label">State</label><input name="shippingAddress.state" value={formData.shippingAddress.state} onChange={handleChange} className="form-input" placeholder="State/Province" /></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group"><label className="form-label">ZIP Code</label><input name="shippingAddress.postalCode" value={formData.shippingAddress.postalCode} onChange={handleChange} className="form-input" placeholder="ZIP" /></div>
              <div className="form-group"><label className="form-label">Country</label><select name="shippingAddress.country" value={formData.shippingAddress.country} onChange={handleChange} className="form-input">{countries.map(c => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}</select></div>
            </div>
            <div className="form-group"><label className="form-label">Phone</label><input name="shippingAddress.phone" value={formData.shippingAddress.phone} onChange={handleChange} className="form-input" placeholder="Delivery phone" /></div>
          </div>
        )}

        {activeTab === 'preferences' && (
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--td-space-md)' }}>
            <div className="form-group"><label className="form-label">Country</label><select name="country" value={formData.country} onChange={handleChange} className="form-input">{countries.map(c => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Phone</label><div style={{ display: 'flex', gap: 8 }}><input value={formData.phoneCode} readOnly className="form-input" style={{ width: 80 }} /><input name="phone" value={formData.phone} onChange={handleChange} className="form-input" placeholder={selectedCountry?.phoneFormat || 'Phone'} style={{ flex: 1 }} /></div></div>
            <div className="form-group"><label className="form-label">Currency</label><select name="currency" value={formData.currency} onChange={handleChange} className="form-input">{currenciesList.map(c => <option key={c} value={c}>{c}</option>)}</select><p className="form-hint">All prices will be displayed in {formData.currency}</p></div>
            <div className="form-group"><label className="form-label">Language</label><select name="language" value={formData.language} onChange={handleChange} className="form-input">{languages.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}</select></div>
          </div>
        )}

        {activeTab === 'social' && (
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--td-space-md)' }}>
            <p style={{ fontSize: 13, color: 'var(--td-text-tertiary)', marginBottom: 8 }}>Connect your social media accounts to your profile.</p>
            <div className="form-group"><label className="form-label"><FaInstagram /> Instagram</label><input name="socialLinks.instagram" value={formData.socialLinks?.instagram || ''} onChange={handleChange} className="form-input" placeholder="username (without @)" /></div>
            <div className="form-group"><label className="form-label"><FaTiktok /> TikTok</label><input name="socialLinks.tiktok" value={formData.socialLinks?.tiktok || ''} onChange={handleChange} className="form-input" placeholder="username" /></div>
            <div className="form-group"><label className="form-label"><FaPinterest /> Pinterest</label><input name="socialLinks.pinterest" value={formData.socialLinks?.pinterest || ''} onChange={handleChange} className="form-input" placeholder="username" /></div>
            <div className="form-group"><label className="form-label"><FaYoutube /> YouTube</label><input name="socialLinks.youtube" value={formData.socialLinks?.youtube || ''} onChange={handleChange} className="form-input" placeholder="channel handle" /></div>
            <div className="form-group"><label className="form-label"><FaTwitter /> Twitter</label><input name="socialLinks.twitter" value={formData.socialLinks?.twitter || ''} onChange={handleChange} className="form-input" placeholder="username" /></div>
            <div className="form-group"><label className="form-label"><FaFacebook /> Facebook</label><input name="socialLinks.facebook" value={formData.socialLinks?.facebook || ''} onChange={handleChange} className="form-input" placeholder="page or profile name" /></div>
          </div>
        )}

        {activeTab === 'store' && (
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--td-space-md)' }}>
            <p style={{ fontSize: 13, color: 'var(--td-text-tertiary)', marginBottom: 8 }}>Customize your storefront appearance.</p>
            <div className="form-group"><label className="form-label">Store Tagline</label><input name="store.tagline" value={formData.store?.tagline || ''} onChange={handleChange} className="form-input" placeholder="A short description of your store" maxLength={200} /></div>
            <div className="form-group"><label className="form-label">Custom Color Theme</label><input name="store.colorTheme" value={formData.store?.colorTheme || ''} onChange={handleChange} className="form-input" placeholder="e.g. #4CAF50" /></div>
            <div className="form-group"><label className="form-label">Banner Image URL</label><input name="store.banner" value={formData.store?.banner || ''} onChange={handleChange} className="form-input" placeholder="https://..." /></div>
            <div className="form-group"><label className="form-label">Store Logo URL</label><input name="store.logo" value={formData.store?.logo || ''} onChange={handleChange} className="form-input" placeholder="https://..." /></div>
            <div className="form-group"><label className="form-label">Return Policy</label><textarea name="store.returnPolicy" value={formData.store?.returnPolicy || ''} onChange={handleChange} className="form-input" placeholder="Describe your return policy..." rows={3} /></div>
          </div>
        )}

        {activeTab === 'payout' && (
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--td-space-md)' }}>
            {user?.balance && (
              <div style={{ background: 'var(--td-surface-secondary)', padding: 16, borderRadius: 'var(--td-radius-sm)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="flex-between"><span style={{ color: 'var(--td-text-secondary)' }}>Available</span><strong style={{ color: 'var(--td-success)' }}>{formatPrice(user.balance.available, user.currency)}</strong></div>
                <div className="flex-between"><span style={{ color: 'var(--td-text-secondary)' }}>Pending</span><strong>{formatPrice(user.balance.pending, user.currency)}</strong></div>
                <div className="flex-between"><span style={{ color: 'var(--td-text-secondary)' }}>Total Earned</span><strong>{formatPrice(user.balance.totalEarned, user.currency)}</strong></div>
              </div>
            )}
            <div className="form-group"><label className="form-label">Payout Method</label><select name="payoutMethod.type" value={formData.payoutMethod.type} onChange={handleChange} className="form-input"><option value="">Select method</option><option value="paypal">PayPal</option><option value="bank">Bank Transfer</option></select></div>
            {formData.payoutMethod.type === 'paypal' && <div className="form-group"><label className="form-label">PayPal Email</label><input name="payoutMethod.paypalEmail" value={formData.payoutMethod.paypalEmail} onChange={handleChange} className="form-input" placeholder="you@paypal.com" /></div>}
            {formData.payoutMethod.type === 'bank' && <>
              <div className="form-group"><label className="form-label">Bank Name</label><input name="payoutMethod.bankName" value={formData.payoutMethod.bankName} onChange={handleChange} className="form-input" placeholder="Bank name" /></div>
              <div className="form-group"><label className="form-label">Account Holder</label><input name="payoutMethod.accountHolder" value={formData.payoutMethod.accountHolder} onChange={handleChange} className="form-input" placeholder="Account holder name" /></div>
              <div className="form-group"><label className="form-label">Account Number</label><input name="payoutMethod.accountNumber" value={formData.payoutMethod.accountNumber} onChange={handleChange} className="form-input" placeholder="Account number" /></div>
              <div className="form-group"><label className="form-label">Routing/SWIFT Code</label><input name="payoutMethod.routingNumber" value={formData.payoutMethod.routingNumber} onChange={handleChange} className="form-input" placeholder="Routing number" /></div>
            </>}
          </div>
        )}

        {activeTab === 'account' && (
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--td-space-md)' }}>
            <div style={{ fontSize: 14, color: 'var(--td-text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <p><strong>Email:</strong> {user?.email}</p>
              <p><strong>Member since:</strong> {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}</p>
            </div>
            <div style={{ borderTop: '1px solid var(--td-border)', paddingTop: 'var(--td-space-md)' }}>
              <div className="settings-danger" style={{ marginTop: 'var(--td-space-md)' }}>
                <h3>Danger Zone</h3>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-outline" onClick={() => { logout(); navigate('/'); }}><FaSignOutAlt size={14} /> Log Out</button>
                  <button type="button" className="btn btn-outline" style={{ color: 'var(--td-error)', borderColor: 'var(--td-error)' }} onClick={handleDeleteAccount}><FaTrash size={14} /> Delete Account</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab !== 'account' && (
          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading} style={{ marginTop: 'var(--td-space-lg)' }}>
            {loading ? <><span className="spinner spinner-sm" /> Saving...</> : <><FaSave /> Save Changes</>}
          </button>
        )}
      </form>
    </div>
  );
}

export default Settings;