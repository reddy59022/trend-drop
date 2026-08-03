import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { getPayoutDashboard, getCommissionInfo, getRatingsBySeller, getBundleRules, createBundleRule, updateBundleRule, deleteBundleRule, getPromos, createPromo, updatePromo, deletePromo, sendOfferToLikers, getBulkOffers } from '../services/api';
import StarRating from '../components/StarRating';
import { formatPrice } from '../utils/helpers';
import { useTheme } from '../context/ThemeContext';
import { FaStore, FaDollarSign, FaChartLine, FaHistory, FaRocket, FaQuestionCircle, FaTags, FaBoxes, FaBullhorn, FaTrash, FaPlus, FaEdit, FaTimes, FaCheckCircle, FaSpinner } from 'react-icons/fa';
import { toast } from 'react-toastify';

const SellerDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { currency } = useTheme();
  const [dashboard, setDashboard] = useState(null);
  const [commissionInfo, setCommissionInfo] = useState(null);
  const [reviews, setReviews] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  // Bundle rules state
  const [bundleRules, setBundleRules] = useState([]);
  const [showBundleForm, setShowBundleForm] = useState(false);
  const [editingBundle, setEditingBundle] = useState(null);
  const [bundleForm, setBundleForm] = useState({ name: '', minQuantity: 2, discountPercent: 10, applicableCategories: [], description: '' });

  // Promo codes state
  const [promos, setPromos] = useState([]);
  const [showPromoForm, setShowPromoForm] = useState(false);
  const [editingPromo, setEditingPromo] = useState(null);
  const [promoForm, setPromoForm] = useState({ code: '', discountType: 'percentage', discountValue: 10, minPurchaseAmount: 0, usageLimit: 0, description: '' });

  // Offers to likers state
  const [listings, setListings] = useState([]);
  const [selectedListing, setSelectedListing] = useState('');
  const [offerToLikersForm, setOfferToLikersForm] = useState({ discountType: 'percentage', discountValue: 10, validHours: 48 });
  const [sendingOffer, setSendingOffer] = useState(false);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    fetchData();
  }, [user, navigate]); // eslint-disable-line

  const fetchData = async () => {
    try {
      const [dashRes, commRes] = await Promise.all([
        getPayoutDashboard().catch(() => ({ data: { commissionRate: 0.10, commissionPercent: 10, totalSales: 0, totalCommission: 0, totalEarnings: 0, pendingAmount: 0, payoutHistory: [], recentTransactions: [] } })),
        getCommissionInfo().catch(() => ({ data: { commissionPercent: 10, sellerKeeps: '90%', comparedTo: {} } })),
      ]);
      setDashboard(dashRes.data);
      setCommissionInfo(commRes.data);
      try { const revRes = await getRatingsBySeller(user._id); setReviews(revRes.data); } catch { setReviews({ averageRating: 0, count: 0 }); }
      
      // Fetch bundle rules and promos
      fetchBundleRules();
      fetchPromos();
      fetchListings();
    } catch (error) { console.error(error); }
    finally { setLoading(false); }
  };

  const fetchBundleRules = async () => {
    try { const res = await getBundleRules(); setBundleRules(res.data); } catch {}
  };

  const fetchPromos = async () => {
    try { const res = await getPromos(); setPromos(res.data); } catch {}
  };

  const fetchListings = async () => {
    try {
      const api = (await import('../services/api')).default;
      const res = await api.get('/listings/user/' + user._id);
      setListings(res.data.listings || []);
    } catch {}
  };

  // Bundle CRUD
  const handleCreateBundle = async () => {
    if (!bundleForm.name || !bundleForm.discountPercent) return toast.error('Name and discount are required');
    try {
      if (editingBundle) {
        await updateBundleRule(editingBundle._id, bundleForm);
        toast.success('Bundle rule updated');
      } else {
        await createBundleRule(bundleForm);
        toast.success('Bundle rule created');
      }
      setShowBundleForm(false);
      setEditingBundle(null);
      setBundleForm({ name: '', minQuantity: 2, discountPercent: 10, applicableCategories: [], description: '' });
      fetchBundleRules();
    } catch (error) { toast.error(error.response?.data?.message || 'Error'); }
  };

  const handleEditBundle = (rule) => {
    setEditingBundle(rule);
    setBundleForm({
      name: rule.name,
      minQuantity: rule.minQuantity,
      discountPercent: rule.discountPercent,
      applicableCategories: rule.applicableCategories || [],
      description: rule.description || '',
    });
    setShowBundleForm(true);
  };

  const handleDeleteBundle = async (id) => {
    try { await deleteBundleRule(id); toast.success('Bundle rule deleted'); fetchBundleRules(); } catch { toast.error('Error deleting bundle rule'); }
  };

  // Promo CRUD
  const handleCreatePromo = async () => {
    if (!promoForm.code || !promoForm.discountValue) return toast.error('Code and discount value are required');
    try {
      if (editingPromo) {
        await updatePromo(editingPromo._id, promoForm);
        toast.success('Promo code updated');
      } else {
        await createPromo(promoForm);
        toast.success('Promo code created');
      }
      setShowPromoForm(false);
      setEditingPromo(null);
      setPromoForm({ code: '', discountType: 'percentage', discountValue: 10, minPurchaseAmount: 0, usageLimit: 0, description: '' });
      fetchPromos();
    } catch (error) { toast.error(error.response?.data?.message || 'Error'); }
  };

  const handleEditPromo = (promo) => {
    setEditingPromo(promo);
    setPromoForm({
      code: promo.code,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
      minPurchaseAmount: promo.minPurchaseAmount || 0,
      usageLimit: promo.usageLimit || 0,
      description: promo.description || '',
    });
    setShowPromoForm(true);
  };

  const handleDeletePromo = async (id) => {
    try { await deletePromo(id); toast.success('Promo code deleted'); fetchPromos(); } catch { toast.error('Error deleting promo code'); }
  };

  // Send offer to likers
  const handleSendOfferToLikers = async () => {
    if (!selectedListing) return toast.error('Select a listing');
    setSendingOffer(true);
    try {
      await sendOfferToLikers({
        listingId: selectedListing,
        discountType: offerToLikersForm.discountType,
        discountValue: Number(offerToLikersForm.discountValue),
        validHours: Number(offerToLikersForm.validHours),
      });
      toast.success('Exclusive offer sent to all likers!');
      setSelectedListing('');
    } catch (error) { toast.error(error.response?.data?.message || 'Error sending offer'); }
    finally { setSendingOffer(false); }
  };

  if (loading) return (
    <div className="page-container">
      <h1 className="page-title"><FaStore /> Seller Dashboard</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        {[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ height: 100, borderRadius: 'var(--td-radius-lg)' }} />)}
      </div>
    </div>
  );

  if (!dashboard) return <div className="page-container"><div className="empty-state"><h2>Failed to load</h2></div></div>;

  const stats = [
    { label: 'Total Sales', value: formatPrice(dashboard.totalSales || 0, currency || 'USD'), color: 'var(--td-primary)', icon: <FaDollarSign /> },
    { label: 'Your Earnings', value: formatPrice(dashboard.totalEarnings || 0, currency || 'USD'), color: 'var(--td-success)', icon: <FaChartLine /> },
    { label: 'Commission', value: formatPrice(dashboard.totalCommission || 0, currency || 'USD'), color: 'var(--td-error)', icon: <FaDollarSign /> },
    { label: 'Pending Payout', value: formatPrice(dashboard.pendingAmount || 0, currency || 'USD'), color: 'var(--td-warning)', icon: <FaHistory /> },
  ];

  const tabs = [
    { id: 'overview', label: 'Overview', icon: FaStore },
    { id: 'bundles', label: 'Bundle Rules', icon: FaBoxes },
    { id: 'promos', label: 'Promo Codes', icon: FaTags },
    { id: 'offer-likers', label: 'Offers to Likers', icon: FaBullhorn },
  ];

  const categories = ['Women', 'Men', 'Kids', 'Electronics', 'Home', 'Beauty', 'Accessories'];

  return (
    <div className="page-container" style={{ maxWidth: 960, margin: '0 auto' }}>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}><FaStore /> Seller Dashboard</h1>

      {/* Tabs */}
      <div className="tabs" style={{ display: 'flex', gap: 4, marginBottom: 'var(--td-space-lg)', flexWrap: 'wrap' }}>
        {tabs.map(tab => (
          <button key={tab.id} className={`btn ${activeTab === tab.id ? 'btn-primary' : 'btn-outline'}`} style={{ fontSize: 13 }} onClick={() => setActiveTab(tab.id)}>
            <tab.icon size={14} style={{ marginRight: 6 }} />{tab.label}
          </button>
        ))}
      </div>

      {/* ===== TAB: Overview ===== */}
      {activeTab === 'overview' && (
        <>
          {/* Commission Banner */}
          {commissionInfo && (
            <div className="commission-section" style={{ borderRadius: 'var(--td-radius-xl)', marginBottom: 'var(--td-space-lg)', animation: 'fadeInUp 0.3s ease-out' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 14, opacity: 0.9, marginBottom: 4 }}>AURAVEST Commission</div>
                <div style={{ fontSize: 48, fontWeight: 800, marginBottom: 4 }}>Only {commissionInfo.commissionPercent}%</div>
                <div style={{ fontSize: 16, marginBottom: 16 }}>You keep {commissionInfo.sellerKeeps} of every sale</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, background: 'rgba(255,255,255,0.12)', borderRadius: 'var(--td-radius-md)', padding: 16, maxWidth: 400, margin: '0 auto' }}>
                  {Object.entries(commissionInfo.comparedTo || {}).map(([platform, rate]) => (
                    <div key={platform} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, textTransform: 'uppercase', opacity: 0.8, marginBottom: 4, letterSpacing: 1 }}>{platform}</div>
                      <div style={{ fontSize: platform === 'trenddrop' ? 22 : 18, fontWeight: platform === 'trenddrop' ? 800 : 600 }}>{rate}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Stats Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 'var(--td-space-lg)' }}>
            {stats.map((stat, i) => (
              <div key={i} className="glass-card" style={{ padding: 'var(--td-space-lg)', textAlign: 'center', animation: `fadeInUp 0.3s ease-out ${i * 0.05}s both` }}>
                <div style={{ color: stat.color, marginBottom: 8 }}>{stat.icon}</div>
                <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{stat.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: stat.color }}>{stat.value}</div>
              </div>
            ))}
          </div>

          {/* Reviews & Quick Links */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 'var(--td-space-lg)' }}>
            {reviews && (
              <div className="glass-card" style={{ padding: 'var(--td-space-lg)', display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--td-primary)' }}>{reviews.averageRating?.toFixed(1) || '0.0'}</div>
                <div><StarRating rating={reviews.averageRating || 0} size={18} readonly /><div style={{ fontSize: 13, color: 'var(--td-text-tertiary)', marginTop: 4 }}>{reviews.count || 0} reviews</div></div>
              </div>
            )}
            <div className="glass-card" style={{ padding: 'var(--td-space-lg)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--td-text-secondary)' }}>Quick Actions</h4>
              <Link to="/sell" className="btn btn-primary btn-sm btn-block"><FaRocket size={14} /> List New Item</Link>
              <button className="btn btn-outline btn-sm btn-block" onClick={() => setActiveTab('bundles')}><FaBoxes size={14} /> Manage Bundle Rules</button>
              <button className="btn btn-outline btn-sm btn-block" onClick={() => setActiveTab('promos')}><FaTags size={14} /> Manage Promo Codes</button>
            </div>
          </div>

          {/* Payout History */}
          <div className="glass-card" style={{ overflow: 'hidden', marginBottom: 'var(--td-space-lg)' }}>
            <div style={{ padding: 'var(--td-space-md) var(--td-space-lg)', borderBottom: '1px solid var(--td-border)', fontWeight: 700, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <FaHistory size={16} /> Payout History
            </div>
            {dashboard.payoutHistory?.length === 0 ? (
              <div className="empty-state" style={{ padding: 'var(--td-space-xxl)' }}>
                <div className="empty-state-icon">💰</div>
                <h3>No payouts yet</h3>
                <p>Complete your first sale to see payouts here</p>
              </div>
            ) : (
              dashboard.payoutHistory?.map((p, i) => (
                <div key={i} style={{ padding: 'var(--td-space-md) var(--td-space-lg)', borderBottom: i < dashboard.payoutHistory.length - 1 ? '1px solid var(--td-border-light)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{p.listing?.title || 'Sale'}</div>
                    <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>Sale: {formatPrice(p.salePrice, p.currency || currency)} • Fee: {formatPrice(p.commissionAmount, p.currency || currency)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, color: 'var(--td-success)', fontSize: 16 }}>+{formatPrice(p.payoutAmount, p.currency || currency)}</div>
                    <div style={{ fontSize: 11, color: 'var(--td-text-tertiary)' }}>{p.paidAt ? new Date(p.paidAt).toLocaleDateString() : ''}</div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* How Payouts Work */}
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}><FaQuestionCircle /> How Payouts Work</h3>
            <div style={{ fontSize: 14, color: 'var(--td-text-secondary)', lineHeight: 2 }}>
              <div>1️⃣ <strong>List your item</strong> — It's free to list</div>
              <div>2️⃣ <strong>Buyer purchases</strong> — Payment is held securely</div>
              <div>3️⃣ <strong>Ship within 7 days</strong> — Use prepaid shipping label</div>
              <div>4️⃣ <strong>Buyer confirms delivery</strong> — Funds are released</div>
              <div>5️⃣ <strong>Get paid</strong> — Only {commissionInfo?.commissionPercent || 10}% commission deducted</div>
            </div>
          </div>
        </>
      )}

      {/* ===== TAB: Bundle Rules ===== */}
      {activeTab === 'bundles' && (
        <div className="glass-card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: 'var(--td-space-md) var(--td-space-lg)', borderBottom: '1px solid var(--td-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}><FaBoxes /> Bundle Rules</span>
            <button className="btn btn-primary btn-sm" onClick={() => { setEditingBundle(null); setBundleForm({ name: '', minQuantity: 2, discountPercent: 10, applicableCategories: [], description: '' }); setShowBundleForm(!showBundleForm); }}>
              <FaPlus size={12} /> {showBundleForm ? 'Cancel' : 'New Rule'}
            </button>
          </div>

          {/* Create/Edit form */}
          {showBundleForm && (
            <div style={{ padding: 'var(--td-space-lg)', borderBottom: '1px solid var(--td-border-light)', background: 'var(--td-surface-2)' }}>
              <h4 style={{ marginBottom: 12 }}>{editingBundle ? 'Edit Bundle Rule' : 'Create Bundle Rule'}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <input className="form-input" placeholder="Rule name (e.g., Summer Bundle)" value={bundleForm.name} onChange={e => setBundleForm({...bundleForm, name: e.target.value})} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span>Buy</span>
                  <input className="form-input" type="number" min={2} style={{ width: 70 }} value={bundleForm.minQuantity} onChange={e => setBundleForm({...bundleForm, minQuantity: Number(e.target.value)})} />
                  <span>+ items, get</span>
                  <input className="form-input" type="number" min={1} max={100} style={{ width: 70 }} value={bundleForm.discountPercent} onChange={e => setBundleForm({...bundleForm, discountPercent: Number(e.target.value)})} />
                  <span>% off</span>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <label style={{ fontSize: 13, color: 'var(--td-text-tertiary)', marginBottom: 6, display: 'block' }}>Applicable Categories (leave empty for all):</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {categories.map(cat => (
                    <label key={cat} className="checkbox-label" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                      <input type="checkbox" checked={bundleForm.applicableCategories.includes(cat)} onChange={e => {
                        const cats = bundleForm.applicableCategories;
                        setBundleForm({...bundleForm, applicableCategories: e.target.checked ? [...cats, cat] : cats.filter(c => c !== cat)});
                      }} />
                      {cat}
                    </label>
                  ))}
                </div>
              </div>
              <textarea className="form-input" style={{ marginTop: 12, minHeight: 60 }} placeholder="Description shown to buyers (optional)" value={bundleForm.description} onChange={e => setBundleForm({...bundleForm, description: e.target.value})} />
              <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={handleCreateBundle}>
                {editingBundle ? 'Update Rule' : 'Create Rule'}
              </button>
            </div>
          )}

          {/* Bundle rules list */}
          {bundleRules.length === 0 && !showBundleForm ? (
            <div className="empty-state" style={{ padding: 'var(--td-space-xxl)' }}>
              <div className="empty-state-icon">📦</div>
              <h3>No bundle rules yet</h3>
              <p>Create bundle discounts like "Buy 2+ items, get 15% off"</p>
            </div>
          ) : (
            bundleRules.map(rule => (
              <div key={rule._id} style={{ padding: 'var(--td-space-md) var(--td-space-lg)', borderBottom: '1px solid var(--td-border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{rule.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>
                    Buy {rule.minQuantity}+ items → {rule.discountPercent}% off
                    {rule.applicableCategories?.length > 0 && ` (${rule.applicableCategories.join(', ')})`}
                    {rule.usageCount > 0 && ` • Used ${rule.usageCount} times`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-outline btn-sm" onClick={() => handleEditBundle(rule)}><FaEdit size={12} /></button>
                  <button className="btn btn-outline btn-sm" style={{ color: 'var(--td-error)' }} onClick={() => handleDeleteBundle(rule._id)}><FaTrash size={12} /></button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ===== TAB: Promo Codes ===== */}
      {activeTab === 'promos' && (
        <div className="glass-card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: 'var(--td-space-md) var(--td-space-lg)', borderBottom: '1px solid var(--td-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}><FaTags /> Promo Codes</span>
            <button className="btn btn-primary btn-sm" onClick={() => { setEditingPromo(null); setPromoForm({ code: '', discountType: 'percentage', discountValue: 10, minPurchaseAmount: 0, usageLimit: 0, description: '' }); setShowPromoForm(!showPromoForm); }}>
              <FaPlus size={12} /> {showPromoForm ? 'Cancel' : 'New Promo'}
            </button>
          </div>

          {/* Create/Edit promo form */}
          {showPromoForm && (
            <div style={{ padding: 'var(--td-space-lg)', borderBottom: '1px solid var(--td-border-light)', background: 'var(--td-surface-2)' }}>
              <h4 style={{ marginBottom: 12 }}>{editingPromo ? 'Edit Promo Code' : 'Create Promo Code'}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <input className="form-input" placeholder="Code (e.g., SAVE10)" value={promoForm.code} onChange={e => setPromoForm({...promoForm, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')})} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select className="form-input" style={{ width: 'auto' }} value={promoForm.discountType} onChange={e => setPromoForm({...promoForm, discountType: e.target.value})}>
                    <option value="percentage">% Off</option>
                    <option value="fixed">$ Off</option>
                  </select>
                  <input className="form-input" type="number" min={0.01} step={promoForm.discountType === 'percentage' ? 1 : 0.01} style={{ width: 80 }} value={promoForm.discountValue} onChange={e => setPromoForm({...promoForm, discountValue: Number(e.target.value)})} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 13 }}>Min purchase:</span>
                  <input className="form-input" type="number" min={0} style={{ width: 80 }} value={promoForm.minPurchaseAmount} onChange={e => setPromoForm({...promoForm, minPurchaseAmount: Number(e.target.value)})} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 13 }}>Usage limit:</span>
                  <input className="form-input" type="number" min={0} style={{ width: 80 }} value={promoForm.usageLimit} onChange={e => setPromoForm({...promoForm, usageLimit: Number(e.target.value)})} />
                  <span style={{ fontSize: 11, color: 'var(--td-text-tertiary)' }}>(0 = unlimited)</span>
                </div>
              </div>
              <textarea className="form-input" style={{ marginTop: 12, minHeight: 60 }} placeholder="Description (optional)" value={promoForm.description} onChange={e => setPromoForm({...promoForm, description: e.target.value})} />
              <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={handleCreatePromo}>
                {editingPromo ? 'Update Promo' : 'Create Promo'}
              </button>
            </div>
          )}

          {/* Promo codes list */}
          {promos.length === 0 && !showPromoForm ? (
            <div className="empty-state" style={{ padding: 'var(--td-space-xxl)' }}>
              <div className="empty-state-icon">🏷️</div>
              <h3>No promo codes yet</h3>
              <p>Create codes like SAVE10 or SUMMER20 for your buyers</p>
            </div>
          ) : (
            promos.map(promo => (
              <div key={promo._id} style={{ padding: 'var(--td-space-md) var(--td-space-lg)', borderBottom: '1px solid var(--td-border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="badge badge-primary">{promo.code}</span>
                    <span style={{ fontSize: 12, color: promo.isActive ? 'var(--td-success)' : 'var(--td-text-tertiary)' }}>
                      {promo.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>
                    {promo.discountType === 'percentage' ? `${promo.discountValue}% off` : `$${promo.discountValue} off`}
                    {promo.usageLimit > 0 && ` • Used ${promo.usageCount}/${promo.usageLimit}`}
                    {promo.minPurchaseAmount > 0 && ` • Min $${promo.minPurchaseAmount}`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-outline btn-sm" onClick={() => handleEditPromo(promo)}><FaEdit size={12} /></button>
                  <button className="btn btn-outline btn-sm" style={{ color: 'var(--td-error)' }} onClick={() => handleDeletePromo(promo._id)}><FaTrash size={12} /></button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ===== TAB: Offers to Likers ===== */}
      {activeTab === 'offer-likers' && (
        <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}><FaBullhorn /> Send Offer to Likers</h3>
          <p style={{ fontSize: 14, color: 'var(--td-text-tertiary)', marginBottom: 16 }}>
            Send a time-limited exclusive discount to everyone who liked a listing. Max 1 per week.
          </p>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' }}>Select Listing</label>
            <select className="form-input" value={selectedListing} onChange={e => setSelectedListing(e.target.value)}>
              <option value="">Choose a listing...</option>
              {listings.map(l => (
                <option key={l._id} value={l._id}>{l.title} (${l.price})</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' }}>Discount Type</label>
              <select className="form-input" value={offerToLikersForm.discountType} onChange={e => setOfferToLikersForm({...offerToLikersForm, discountType: e.target.value})}>
                <option value="percentage">Percentage (%)</option>
                <option value="fixed">Fixed Amount ($)</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' }}>Discount Value</label>
              <input className="form-input" type="number" min={1} value={offerToLikersForm.discountValue} onChange={e => setOfferToLikersForm({...offerToLikersForm, discountValue: e.target.value})} />
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' }}>Valid For (hours)</label>
            <select className="form-input" style={{ width: 150 }} value={offerToLikersForm.validHours} onChange={e => setOfferToLikersForm({...offerToLikersForm, validHours: e.target.value})}>
              <option value={24}>24 hours</option>
              <option value={48}>48 hours</option>
              <option value={72}>72 hours</option>
            </select>
          </div>

          <button className="btn btn-primary" disabled={!selectedListing || sendingOffer} onClick={handleSendOfferToLikers}>
            {sendingOffer ? <><FaSpinner className="spin" /> Sending...</> : <><FaBullhorn /> Send Offer to Likers</>}
          </button>
        </div>
      )}
    </div>
  );
};

export default SellerDashboard;