import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { FaRobot, FaHeart, FaSave, FaPlus, FaTrash, FaCalendarAlt, FaShoppingBag, FaMagic } from 'react-icons/fa';
import { getAIPreferences, updateAIPreferences, getAIRecommendations, generateAIRecommendations, getAITrends, getUserOutfits, createOutfit } from '../services/api';
import ListingCard from '../components/ListingCard';
import { toast } from 'react-toastify';

const AIStylist = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('recommendations');
  const [recommendations, setRecommendations] = useState([]);
  const [outfits, setOutfits] = useState([]);
  const [trends, setTrends] = useState([]);
  const [preferences, setPreferences] = useState({
    categories: [],
    brands: [],
    priceRange: { min: 0, max: 1000 },
  });
  const [outfitModalOpen, setOutfitModalOpen] = useState(false);
  const [outfitName, setOutfitName] = useState('');

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    fetchData();
  }, [user, navigate, activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'recommendations') {
        const res = await getAIRecommendations();
        setRecommendations(res.data || []);
      } else if (activeTab === 'outfits') {
        const res = await getUserOutfits();
        setOutfits(res.data || []);
      } else if (activeTab === 'trends') {
        const res = await getAITrends();
        setTrends(res.data || []);
      }
    } catch (error) {
      console.error('Error fetching AI stylist data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateRecommendations = async () => {
    try {
      const res = await generateAIRecommendations();
      setRecommendations(res.data || []);
    } catch (error) {
      console.error('Error generating recommendations:', error);
    }
  };

  const handlePreferenceChange = async () => {
    try {
      await updateAIPreferences(preferences);
    } catch (error) {
      console.error('Error updating preferences:', error);
    }
  };

  const handleSubmitOutfit = async () => {
    if (!outfitName.trim()) return;
    try {
      await createOutfit({ name: outfitName.trim(), items: [] });
      toast.success('Outfit created!');
      setOutfitModalOpen(false);
      setOutfitName('');
      fetchUserOutfits();
    } catch (error) {
      console.error('Error creating outfit:', error);
      toast.error('Failed to create outfit');
    }
  };

  const fetchUserOutfits = async () => {
    try {
      const res = await getUserOutfits();
      setOutfits(res.data || []);
    } catch (error) {
      console.error('Error fetching outfits:', error);
    }
  };

  if (loading) {
    return (
      <div className="page-container" style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div className="skeleton" style={{ height: 60, borderRadius: 'var(--td-radius-lg)', marginBottom: 20 }} />
        <div className="skeleton" style={{ height: 400, borderRadius: 'var(--td-radius-lg)' }} />
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 1000, margin: '0 auto' }}>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <FaRobot /> AI Stylist
      </h1>

      {/* Tabs */}
      <div className="glass-card" style={{ padding: 4, marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => setActiveTab('recommendations')}
            className={`btn ${activeTab === 'recommendations' ? 'btn-primary' : 'btn-outline'}`}
            style={{ flex: 1 }}
          >
            <FaMagic /> Recommendations
          </button>
          <button
            onClick={() => setActiveTab('outfits')}
            className={`btn ${activeTab === 'outfits' ? 'btn-primary' : 'btn-outline'}`}
            style={{ flex: 1 }}
          >
            <FaHeart /> My Outfits
          </button>
          <button
            onClick={() => setActiveTab('trends')}
            className={`btn ${activeTab === 'trends' ? 'btn-primary' : 'btn-outline'}`}
            style={{ flex: 1 }}
          >
            <FaCalendarAlt /> Seasonal Trends
          </button>
        </div>
      </div>

      {/* Recommendations Tab */}
      {activeTab === 'recommendations' && (
        <div>
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)', marginBottom: 'var(--td-space-lg)' }}>
            <h3 style={{ marginBottom: 12 }}>Your Style Preferences</h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
              <select
                multiple
                value={preferences.categories || []}
                onChange={e => setPreferences({...preferences, categories: Array.from(e.target.selectedOptions, o => o.value)})}
                className="form-input"
                style={{ flex: 1, minWidth: 200 }}
              >
                <option value="Women">Women</option>
                <option value="Men">Men</option>
                <option value="Kids">Kids</option>
                <option value="Electronics">Electronics</option>
                <option value="Home">Home</option>
              </select>
              <input
                type="text"
                placeholder="Favorite brands (comma separated)"
                value={preferences.brands?.join(', ') || ''}
                onChange={e => setPreferences({...preferences, brands: e.target.value.split(',').map(b => b.trim()).filter(Boolean)})}
                className="form-input"
                style={{ flex: 1, minWidth: 200 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <input
                type="number"
                placeholder="Min price"
                value={preferences.priceRange?.min || ''}
                onChange={e => setPreferences({...preferences, priceRange: {...preferences.priceRange, min: Number(e.target.value)}})}
                className="form-input"
                style={{ flex: 1 }}
              />
              <input
                type="number"
                placeholder="Max price"
                value={preferences.priceRange?.max || ''}
                onChange={e => setPreferences({...preferences, priceRange: {...preferences.priceRange, max: Number(e.target.value)}})}
                className="form-input"
                style={{ flex: 1 }}
              />
              <button onClick={handlePreferenceChange} className="btn btn-primary">Save</button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2>Recommended For You</h2>
            <button onClick={handleGenerateRecommendations} className="btn btn-outline btn-sm">
              <FaPlus /> Refresh
            </button>
          </div>

          {recommendations.length === 0 ? (
            <div className="empty-state" style={{ padding: 'var(--td-space-xl)' }}>
              <div className="empty-state-icon">✨</div>
              <h3>No recommendations yet</h3>
              <p>Set your preferences and click "Refresh" to get personalized recommendations</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
              {recommendations.map(rec => (
                rec.listing && <ListingCard key={rec.listing._id} listing={rec.listing} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Outfits Tab */}
      {activeTab === 'outfits' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2>Your Outfits</h2>
            <button onClick={() => setOutfitModalOpen(true)} className="btn btn-primary btn-sm">
              <FaPlus /> Create Outfit
            </button>
          </div>

          {outfits.length === 0 ? (
            <div className="empty-state" style={{ padding: 'var(--td-space-xl)' }}>
              <div className="empty-state-icon">👗</div>
              <h3>No outfits created</h3>
              <p>Create outfits to save your favorite combinations</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {outfits.map(outfit => (
                <div key={outfit._id} className="glass-card" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <h3 style={{ margin: 0 }}>{outfit.name}</h3>
                    <button className="btn btn-icon btn-ghost" style={{ color: 'var(--td-error)' }}>
                      <FaTrash size={12} />
                    </button>
                  </div>
                  {outfit.items?.length > 0 ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      {outfit.items.map(item => (
                        item.images?.[0] ? (
                          <img key={item._id} src={item.images[0]} alt={item.title}
                            style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6 }} />
                        ) : null
                      ))}
                    </div>
                  ) : (
                    <p style={{ color: 'var(--td-text-tertiary)', fontSize: 13 }}>Add items to this outfit</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Trends Tab */}
      {activeTab === 'trends' && (
        <div>
          <h2 style={{ marginBottom: 16 }}>Seasonal Trends (Last 30 Days)</h2>
          {trends.length === 0 ? (
            <div className="empty-state" style={{ padding: 'var(--td-space-xl)' }}>
              <div className="empty-state-icon">📊</div>
              <h3>No trending data yet</h3>
              <p>Trends will appear as items are listed and sold</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {trends.map((trend, i) => (
                <div key={i} className="glass-card" style={{ padding: 16, textAlign: 'center' }}>
                  <h3 style={{ margin: 0, color: 'var(--td-primary)' }}>{trend._id}</h3>
                  <div style={{ fontSize: 24, fontWeight: 700, margin: '12px 0' }}>{trend.count} items</div>
                  <div style={{ fontSize: 12, color: 'var(--td-text-secondary)' }}>
                    Avg. ${trend.avgPrice?.toFixed(2) || 'N/A'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Outfit Modal */}
      {outfitModalOpen && (
        <div className="modal-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: 16,
        }}>
          <div className="glass-card" style={{ padding: 'var(--td-space-xl)', maxWidth: 400, width: '100%' }}>
            <h3 style={{ marginBottom: 12 }}>Create Outfit</h3>
            <input
              type="text"
              className="form-input"
              value={outfitName}
              onChange={(e) => setOutfitName(e.target.value)}
              placeholder="Outfit name"
              style={{ marginBottom: 12 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSubmitOutfit} disabled={!outfitName.trim()}>
                Create
              </button>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => { setOutfitModalOpen(false); setOutfitName(''); }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AIStylist;
