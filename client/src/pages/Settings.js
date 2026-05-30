import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import { countries, formatPrice } from '../utils/helpers';

const currenciesList = [
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR', 'MXN', 'BRL', 'KRW', 'CNY', 'CHF',
  'SEK', 'NOK', 'DKK', 'NZD', 'SGD', 'HKD', 'THB', 'ZAR', 'AED', 'SAR', 'PLN', 'TRY',
  'RUB', 'NGN', 'EGP', 'KES', 'PHP', 'IDR', 'MYR', 'VND', 'TWD', 'PKR', 'BDT', 'COP',
  'ARS', 'CLP', 'PEN', 'UAH', 'CZK', 'HUF', 'RON', 'ILS',
];

const languages = [
  { code: 'en', name: 'English' }, { code: 'es', name: 'Spanish' }, { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' }, { code: 'it', name: 'Italian' }, { code: 'pt', name: 'Portuguese' },
  { code: 'ja', name: 'Japanese' }, { code: 'ko', name: 'Korean' }, { code: 'zh', name: 'Chinese' },
  { code: 'ar', name: 'Arabic' }, { code: 'hi', name: 'Hindi' }, { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' }, { code: 'tr', name: 'Turkish' }, { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' }, { code: 'ru', name: 'Russian' }, { code: 'sv', name: 'Swedish' },
];

function Settings() {
  const { user, updateProfile, updateAvatar, logout } = useAuth();
  const navigate = useNavigate();
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
        name: user.name || '',
        bio: user.bio || '',
        location: user.location || '',
        closetName: user.closetName || '',
        country: user.country || 'US',
        phone: user.phone || '',
        phoneCode: user.phoneCode || '+1',
        currency: user.currency || 'USD',
        language: user.language || 'en',
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
    } catch (err) {
      toast.error('Failed to update avatar');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await updateProfile({
        name: formData.name,
        bio: formData.bio,
        location: formData.location,
        closetName: formData.closetName,
        country: formData.country,
        phone: formData.phone,
        phoneCode: formData.phoneCode,
        currency: formData.currency,
        language: formData.language,
        shippingAddress: formData.shippingAddress,
        payoutMethod: formData.payoutMethod,
      });
      toast.success('Profile updated!');
    } catch (err) {
      toast.error('Failed to update profile');
    }
    setLoading(false);
  };

  const tabs = [
    { id: 'profile', label: 'Profile' },
    { id: 'shipping', label: 'Shipping Address' },
    { id: 'preferences', label: 'Country & Currency' },
    { id: 'payout', label: 'Payout Method' },
    { id: 'account', label: 'Account' },
  ];

  const selectedCountry = countries.find(c => c.code === formData.country);

  return (
    <div className="page-container" style={{ maxWidth: 700, margin: '0 auto', padding: '20px' }}>
      <h1 style={{ marginBottom: 20 }}>Settings</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ padding: '8px 16px', borderRadius: 20, border: 'none', cursor: 'pointer',
              background: activeTab === tab.id ? '#e91e63' : '#f0f0f0',
              color: activeTab === tab.id ? '#fff' : '#333', fontWeight: activeTab === tab.id ? 600 : 400 }}>
            {tab.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        {activeTab === 'profile' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <img src={user?.avatar || ''} alt="" style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover', marginBottom: 8 }} />
              <div><input type="file" accept="image/*" onChange={handleAvatarChange} /></div>
            </div>
            <input name="name" value={formData.name} onChange={handleChange} placeholder="Full Name" style={{ padding: 12, borderRadius: 8, border: '1px solid #ddd' }} />
            <input name="closetName" value={formData.closetName} onChange={handleChange} placeholder="Closet Name" style={{ padding: 12, borderRadius: 8, border: '1px solid #ddd' }} />
            <textarea name="bio" value={formData.bio} onChange={handleChange} placeholder="Bio" rows={3} style={{ padding: 12, borderRadius: 8, border: '1px solid #ddd' }} />
            <input name="location" value={formData.location} onChange={handleChange} placeholder="Location (city, state)" style={{ padding: 12, borderRadius: 8, border: '1px solid #ddd' }} />
          </div>
        )}

        {activeTab === 'shipping' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3>Shipping Address</h3>
            <input name="shippingAddress.fullName" value={formData.shippingAddress.fullName} onChange={handleChange} placeholder="Full Name" style={{ padding: 12, borderRadius: 8, border: '1px solid #ddd' }} />
            <input name="shippingAddress.street1" value={formData.shippingAddress.street1} onChange={handleChange} placeholder="Street Address" style={{ padding: 12, borderRadius: 8, border: '1px solid #ddd' }} />
            <input name="shippingAddress.street2" value={formData.shippingAddress.street2} onChange={handleChange} placeholder="Apt, Suite, etc. (optional)" style={{ padding: 12, borderRadius: 8, border: '1px solid #ddd' }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <input name="shippingAddress.city" value={formData.shippingAddress.city} onChange={handleChange} placeholder="City" style={{ padding: 12, borderRadius: 8, border: '1px solid #ddd' }} />
              <input name="shippingAddress.state" value={formData.shippingAddress.state} onChange={handleChange} placeholder="State/Province" style={{ padding: 12, borderRadius: 8, border: '1px solid #ddd' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <input name="shippingAddress.postalCode" value={formData.shippingAddress.postalCode} onChange={handleChange} placeholder="Postal Code" style={{ padding: 12, borderRadius: 8, border: '1px solid #ddd' }} />
              <select name="shippingAddress.country" value={formData.shippingAddress.country} onChange={handleChange} style={{ padding: 12, borderRadius: 8, border: '1px solid #ddd' }}>
                {countries.map(c => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
              </select>
            </div>
            <input name="shippingAddress.phone" value={formData.shippingAddress.phone} onChange={handleChange} placeholder="Phone for delivery" style={{ padding: 12, borderRadius: 8, border: '1px solid #ddd' }} />
          </div>
        )}

        {activeTab === 'preferences' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3>Country & Currency</h3>
            <label style={{ fontWeight: 600 }}>Country</label>
            <select name="country" value={formData.country} onChange={handleChange} style={{ padding: 12, borderRadius: 8, border: '1px solid #ddd' }}>
              {countries.map(c => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
            </select>
            <label style={{ fontWeight: 600 }}>Phone</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={formData.phoneCode} readOnly style={{ width: 70, padding: 12, borderRadius: 8, border: '1px solid #ddd', background: '#f5f5f5' }} />
              <input name="phone" value={formData.phone} onChange={handleChange} placeholder={selectedCountry?.phoneFormat || 'Phone number'} style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid #ddd' }} />
            </div>
            <label style={{ fontWeight: 600 }}>Currency</label>
            <select name="currency" value={formData.currency} onChange={handleChange} style={{ padding: 12, borderRadius: 8, border: '1px solid #ddd' }}>
              {currenciesList.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <p style={{ color: '#666', fontSize: 13 }}>All prices will be displayed in {formData.currency}</p>
            <label style={{ fontWeight: 600 }}>Language</label>
            <select name="language" value={formData.language} onChange={handleChange} style={{ padding: 12, borderRadius: 8, border: '1px solid #ddd' }}>
              {languages.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </div>
        )}

        {activeTab === 'payout' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3>Payout Method</h3>
            <p style={{ color: '#666', fontSize: 13 }}>Choose how you want to receive your earnings. Platform fee: 10%</p>
            {user?.balance && (
              <div style={{ background: '#f8f9fa', padding: 16, borderRadius: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span>Available Balance:</span><strong>{formatPrice(user.balance.available, user.currency)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span>Pending:</span><strong>{formatPrice(user.balance.pending, user.currency)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Total Earned:</span><strong>{formatPrice(user.balance.totalEarned, user.currency)}</strong>
                </div>
              </div>
            )}
            <select name="payoutMethod.type" value={formData.payoutMethod.type} onChange={handleChange} style={{ padding: 12, borderRadius: 8, border: '1px solid #ddd' }}>
              <option value="">Select payout method</option>
              <option value="paypal">PayPal</option>
              <option value="bank">Bank Transfer</option>
            </select>
            {formData.payoutMethod.type === 'paypal' && (
              <input name="payoutMethod.paypalEmail" value={formData.payoutMethod.paypalEmail} onChange={handleChange} placeholder="PayPal Email" style={{ padding: 12, borderRadius: 8, border: '1px solid #ddd' }} />
            )}
            {formData.payoutMethod.type === 'bank' && (
              <>
                <input name="payoutMethod.bankName" value={formData.payoutMethod.bankName} onChange={handleChange} placeholder="Bank Name" style={{ padding: 12, borderRadius: 8, border: '1px solid #ddd' }} />
                <input name="payoutMethod.accountHolder" value={formData.payoutMethod.accountHolder} onChange={handleChange} placeholder="Account Holder Name" style={{ padding: 12, borderRadius: 8, border: '1px solid #ddd' }} />
                <input name="payoutMethod.accountNumber" value={formData.payoutMethod.accountNumber} onChange={handleChange} placeholder="Account Number" style={{ padding: 12, borderRadius: 8, border: '1px solid #ddd' }} />
                <input name="payoutMethod.routingNumber" value={formData.payoutMethod.routingNumber} onChange={handleChange} placeholder="Routing/SWIFT Code" style={{ padding: 12, borderRadius: 8, border: '1px solid #ddd' }} />
              </>
            )}
          </div>
        )}

        {activeTab === 'account' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3>Account</h3>
            <div style={{ color: '#666' }}>
              <p><strong>Email:</strong> {user?.email}</p>
              <p><strong>Member since:</strong> {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}</p>
            </div>
            <button type="button" onClick={() => { logout(); navigate('/'); }} style={{ padding: 12, borderRadius: 8, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
              Log Out
            </button>
            <button type="button" style={{ padding: 12, borderRadius: 8, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}>
              Delete Account
            </button>
          </div>
        )}

        {activeTab !== 'account' && (
          <button type="submit" disabled={loading} style={{ marginTop: 20, padding: 14, borderRadius: 8, border: 'none', background: '#e91e63', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 16, width: '100%' }}>
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        )}
      </form>
    </div>
  );
}

export default Settings;