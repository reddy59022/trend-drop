import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import {
  getSavedSearches,
  getSavedSearchResults,
  saveSearch,
  updateSavedSearch,
  deleteSavedSearch,
} from '../services/api';
import ListingCard from '../components/ListingCard';
import { FaSearch, FaBell, FaTrash, FaEdit, FaTimes, FaSave } from 'react-icons/fa';

const SavedSearches = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [searches, setSearches] = useState([]);
  const [activeSearch, setActiveSearch] = useState(null);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    name: '',
    query: '',
    filters: {},
    notificationFrequency: 'daily',
  });

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    fetchSearches();
  }, [user, navigate]); // eslint-disable-line

  const fetchSearches = async () => {
    try {
      const res = await getSavedSearches();
      setSearches(res.data || []);
      if (res.data?.length > 0 && !activeSearch) {
        setActiveSearch(res.data[0]);
      }
    } catch (error) {
      console.error('Error fetching saved searches:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeSearch?._id) {
      fetchResults(activeSearch._id);
    }
  }, [activeSearch?._id]); // eslint-disable-line

  const fetchResults = async (id) => {
    try {
      const res = await getSavedSearchResults(id);
      setResults(res.data.listings || res.data.results || []);
    } catch (error) {
      console.error('Error fetching results:', error);
      setResults([]);
    }
  };

  const handleCreate = async () => {
    if (!form.name.trim() || !form.query.trim()) return;
    try {
      await saveSearch({
        name: form.name,
        query: form.query,
        filters: form.filters,
        notificationFrequency: form.notificationFrequency,
      });
      setForm({ name: '', query: '', filters: {}, notificationFrequency: 'daily' });
      setShowCreateForm(false);
      fetchSearches();
    } catch (error) {
      console.error('Error creating saved search:', error);
    }
  };

  const handleUpdate = async (id) => {
    if (!form.name.trim()) return;
    try {
      await updateSavedSearch(id, {
        name: form.name,
        notificationFrequency: form.notificationFrequency,
      });
      setEditingId(null);
      setForm({ name: '', query: '', filters: {}, notificationFrequency: 'daily' });
      fetchSearches();
    } catch (error) {
      console.error('Error updating saved search:', error);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this saved search?')) return;
    try {
      await deleteSavedSearch(id);
      if (activeSearch?._id === id) setActiveSearch(null);
      fetchSearches();
    } catch (error) {
      console.error('Error deleting saved search:', error);
    }
  };

  const startEdit = (s) => {
    setEditingId(s._id);
    setForm({
      name: s.name || '',
      query: s.query || '',
      filters: s.filters || {},
      notificationFrequency: s.notificationFrequency || 'daily',
    });
  };

  const freqOptions = [
    { value: 'instant', label: 'Instant' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'never', label: 'Never' },
  ];

  if (loading) {
    return (
      <div className="page-container" style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div className="skeleton" style={{ height: 100, borderRadius: 'var(--td-radius-lg)', marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 300, borderRadius: 'var(--td-radius-lg)' }} />
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 1000, margin: '0 auto' }}>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
        <span><FaSearch /> Saved Searches</span>
        <button onClick={() => { setShowCreateForm(!showCreateForm); setEditingId(null); setForm({ name: '', query: '', filters: {}, notificationFrequency: 'daily' }); }} className="btn btn-primary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FaSearch /> New Search
        </button>
      </h1>

      {/* Create Form */}
      {showCreateForm && (
        <div className="glass-card" style={{ padding: 'var(--td-space-lg)', marginBottom: 'var(--td-space-lg)', animation: 'fadeInUp 0.2s ease-out' }}>
          <h3 style={{ marginBottom: 12, fontWeight: 600 }}>Save a Search</h3>
          <input
            type="text"
            placeholder="Search name (e.g., 'Nike Air Max under $100')"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            className="input"
            style={{ marginBottom: 8 }}
          />
          <input
            type="text"
            placeholder="Search query"
            value={form.query}
            onChange={e => setForm({ ...form, query: e.target.value })}
            className="input"
            style={{ marginBottom: 8 }}
          />
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Notification Frequency</label>
            <select
              value={form.notificationFrequency}
              onChange={e => setForm({ ...form, notificationFrequency: e.target.value })}
              className="input"
              style={{ width: '100%' }}
            >
              {freqOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleCreate} className="btn btn-primary btn-sm"><FaSave /> Save Search</button>
            <button onClick={() => setShowCreateForm(false)} className="btn btn-outline btn-sm"><FaTimes /> Cancel</button>
          </div>
        </div>
      )}

      {searches.length === 0 ? (
        <div className="empty-state" style={{ padding: 'var(--td-space-xxl)' }}>
          <div className="empty-state-icon"><FaSearch /></div>
          <h3>No saved searches</h3>
          <p>Save searches to get notified when new items match your criteria</p>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 'var(--td-space-lg)' }}>
          {/* Sidebar */}
          <div style={{ width: 280, flexShrink: 0 }}>
            <div className="glass-card" style={{ overflow: 'hidden' }}>
              {searches.map(s => (
                <div
                  key={s._id}
                  onClick={() => setActiveSearch(s)}
                  style={{
                    padding: '14px 16px',
                    cursor: 'pointer',
                    borderLeft: activeSearch?._id === s._id ? '3px solid var(--td-primary)' : '3px solid transparent',
                    background: activeSearch?._id === s._id ? 'rgba(108, 92, 231, 0.08)' : 'transparent',
                    transition: 'all 0.2s',
                    borderBottom: '1px solid var(--td-border-light)',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', marginTop: 2 }}>
                    Query: <code style={{ background: 'rgba(0,0,0,0.06)', padding: '1px 4px', borderRadius: 3 }}>{s.query}</code>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--td-text-tertiary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <FaBell size={10} />
                    {freqOptions.find(f => f.value === s.notificationFrequency)?.label || s.notificationFrequency}
                  </div>
                  {editingId !== s._id && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button onClick={e => { e.stopPropagation(); startEdit(s); }} className="btn btn-sm" style={{ background: 'rgba(108,92,231,0.1)', color: 'var(--td-primary)', border: 'none', padding: '2px 8px' }}>
                        <FaEdit size={11} />
                      </button>
                      <button onClick={e => { e.stopPropagation(); handleDelete(s._id); }} className="btn btn-sm" style={{ background: 'rgba(255,23,68,0.1)', color: 'var(--td-error)', border: 'none', padding: '2px 8px' }}>
                        <FaTrash size={11} />
                      </button>
                    </div>
                  )}
                  {editingId === s._id && (
                    <div style={{ marginTop: 8 }}>
                      <input
                        type="text"
                        value={form.name}
                        onChange={e => setForm({ ...form, name: e.target.value })}
                        className="input"
                        style={{ fontSize: 12, padding: '4px 8px', marginBottom: 4 }}
                        onClick={e => e.stopPropagation()}
                      />
                      <select
                        value={form.notificationFrequency}
                        onChange={e => setForm({ ...form, notificationFrequency: e.target.value })}
                        className="input"
                        style={{ fontSize: 12, padding: '4px 8px', marginBottom: 4 }}
                        onClick={e => e.stopPropagation()}
                      >
                        {freqOptions.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={e => { e.stopPropagation(); handleUpdate(s._id); }} className="btn btn-sm" style={{ background: 'rgba(0,200,83,0.1)', color: 'var(--td-success)', border: 'none', padding: '2px 8px' }}>
                          <FaSave size={11} />
                        </button>
                        <button onClick={e => { e.stopPropagation(); setEditingId(null); }} className="btn btn-sm" style={{ background: 'rgba(255,23,68,0.1)', color: 'var(--td-error)', border: 'none', padding: '2px 8px' }}>
                          <FaTimes size={11} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Results */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {activeSearch ? (
              <div>
                <div className="glass-card" style={{ padding: 'var(--td-space-lg)', marginBottom: 'var(--td-space-md)' }}>
                  <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{activeSearch.name}</h2>
                  <div style={{ fontSize: 13, color: 'var(--td-text-secondary)', marginBottom: 4 }}>
                    <Link to={`/search?q=${encodeURIComponent(activeSearch.query || '')}`} style={{ color: 'var(--td-primary)' }}>
                      View all results →
                    </Link>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--td-text-tertiary)' }}>
                    {results.length} matching item{results.length !== 1 ? 's' : ''}
                  </div>
                </div>

                {results.length === 0 ? (
                  <div className="empty-state" style={{ padding: 'var(--td-space-xl)' }}>
                    <FaSearch size={48} color="var(--td-text-tertiary)" />
                    <h3>No matching items</h3>
                    <p>Items matching "{activeSearch.query}" will appear here</p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
                    {results.map(listing => (
                      <ListingCard key={listing._id} listing={listing} />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="glass-card" style={{ padding: 'var(--td-space-xl)', textAlign: 'center' }}>
                <FaSearch size={48} color="var(--td-text-tertiary)" />
                <h3 style={{ marginTop: 12 }}>Select a saved search</h3>
                <p style={{ color: 'var(--td-text-tertiary)' }}>Choose a search from the sidebar to view its results</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SavedSearches;