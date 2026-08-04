import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getSellerCollections,
  getCollection,
  createCollection,
  updateCollection,
  removeListingFromCollection,
  deleteCollection,
} from '../services/api';
import ListingCard from '../components/ListingCard';
import { FaStore, FaPlus, FaTrash, FaEdit, FaTimes, FaSave, FaImage } from 'react-icons/fa';

const Collections = () => {
  const { user } = useAuth();
  const confirmDialog = useConfirm();
  const navigate = useNavigate();
  const { sellerId } = useParams();
  const isOwner = user?._id === sellerId;

  const [collections, setCollections] = useState([]);
  const [activeCollection, setActiveCollection] = useState(null);
  const [collectionListings, setCollectionListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', description: '' });

  useEffect(() => {
    if (!sellerId) { navigate('/'); return; }
    fetchCollections();
  }, [sellerId]); // eslint-disable-line

  const fetchCollections = async () => {
    try {
      const res = await getSellerCollections(sellerId);
      setCollections(res.data || []);
      if (res.data?.length > 0 && !activeCollection) {
        setActiveCollection(res.data[0]);
      }
    } catch (error) {
      console.error('Error fetching collections:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeCollection?._id) {
      fetchCollectionListings(activeCollection._id);
    }
  }, [activeCollection?._id]); // eslint-disable-line

  const fetchCollectionListings = async (id) => {
    try {
      const res = await getCollection(id);
      setCollectionListings(res.data.listings || []);
    } catch (error) {
      console.error('Error fetching collection listings:', error);
      setCollectionListings([]);
    }
  };

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    try {
      await createCollection({ name: form.name, description: form.description });
      setForm({ name: '', description: '' });
      setShowCreateForm(false);
      fetchCollections();
    } catch (error) {
      console.error('Error creating collection:', error);
    }
  };

  const handleUpdate = async (id) => {
    if (!form.name.trim()) return;
    try {
      await updateCollection(id, { name: form.name, description: form.description });
      setEditingId(null);
      setForm({ name: '', description: '' });
      fetchCollections();
    } catch (error) {
      console.error('Error updating collection:', error);
    }
  };

  const handleDelete = async (id) => {
    const ok = await confirmDialog({
      title: 'Delete collection?',
      message: 'Delete this collection?',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteCollection(id);
      if (activeCollection?._id === id) setActiveCollection(null);
      fetchCollections();
    } catch (error) {
      console.error('Error deleting collection:', error);
    }
  };

  const handleRemoveListing = async (collectionId, listingId) => {
    try {
      await removeListingFromCollection(collectionId, listingId);
      fetchCollectionListings(collectionId);
    } catch (error) {
      console.error('Error removing listing:', error);
    }
  };

  const startEdit = (col) => {
    setEditingId(col._id);
    setForm({ name: col.name || '', description: col.description || '' });
  };

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
        <span><FaStore /> Collections</span>
        {isOwner && (
          <button onClick={() => { setShowCreateForm(!showCreateForm); setEditingId(null); setForm({ name: '', description: '' }); }} className="btn btn-primary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <FaPlus /> New Collection
          </button>
        )}
      </h1>

      {/* Create/Edit Form */}
      {showCreateForm && (
        <div className="glass-card" style={{ padding: 'var(--td-space-lg)', marginBottom: 'var(--td-space-lg)', animation: 'fadeInUp 0.2s ease-out' }}>
          <h3 style={{ marginBottom: 12, fontWeight: 600 }}>New Collection</h3>
          <input
            type="text"
            placeholder="Collection name"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            className="input"
            style={{ marginBottom: 8 }}
          />
          <textarea
            placeholder="Description (optional)"
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            className="input"
            style={{ marginBottom: 12, minHeight: 60 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleCreate} className="btn btn-primary btn-sm"><FaSave /> Create</button>
            <button onClick={() => setShowCreateForm(false)} className="btn btn-outline btn-sm"><FaTimes /> Cancel</button>
          </div>
        </div>
      )}

      {collections.length === 0 ? (
        <div className="empty-state" style={{ padding: 'var(--td-space-xxl)' }}>
          <div className="empty-state-icon"><FaStore /></div>
          <h3>No collections yet</h3>
          <p>{isOwner ? 'Create your first collection to organize your listings' : 'This seller hasn\'t created any collections yet'}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 'var(--td-space-lg)' }}>
          {/* Sidebar - Collection List */}
          <div style={{ width: 260, flexShrink: 0 }}>
            <div className="glass-card" style={{ overflow: 'hidden' }}>
              {collections.map(col => (
                <div
                  key={col._id}
                  onClick={() => setActiveCollection(col)}
                  style={{
                    padding: '14px 16px',
                    cursor: 'pointer',
                    borderLeft: activeCollection?._id === col._id ? '3px solid var(--td-primary)' : '3px solid transparent',
                    background: activeCollection?._id === col._id ? 'rgba(108, 92, 231, 0.08)' : 'transparent',
                    transition: 'all 0.2s',
                    borderBottom: '1px solid var(--td-border-light)',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{col.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', marginTop: 2 }}>
                    {col.listingCount || 0} items
                    {col.active === false && <span style={{ color: 'var(--td-warning)', marginLeft: 6 }}>(hidden)</span>}
                  </div>
                  {isOwner && editingId !== col._id && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button onClick={e => { e.stopPropagation(); startEdit(col); }} className="btn btn-sm" style={{ background: 'rgba(108,92,231,0.1)', color: 'var(--td-primary)', border: 'none', padding: '2px 8px' }}>
                        <FaEdit size={11} />
                      </button>
                      <button onClick={e => { e.stopPropagation(); handleDelete(col._id); }} className="btn btn-sm" style={{ background: 'rgba(255,23,68,0.1)', color: 'var(--td-error)', border: 'none', padding: '2px 8px' }}>
                        <FaTrash size={11} />
                      </button>
                    </div>
                  )}
                  {isOwner && editingId === col._id && (
                    <div style={{ marginTop: 8 }}>
                      <input
                        type="text"
                        value={form.name}
                        onChange={e => setForm({ ...form, name: e.target.value })}
                        className="input"
                        style={{ fontSize: 12, padding: '4px 8px', marginBottom: 4 }}
                        onClick={e => e.stopPropagation()}
                      />
                      <textarea
                        value={form.description}
                        onChange={e => setForm({ ...form, description: e.target.value })}
                        className="input"
                        style={{ fontSize: 12, padding: '4px 8px', marginBottom: 4, minHeight: 40 }}
                        onClick={e => e.stopPropagation()}
                      />
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={e => { e.stopPropagation(); handleUpdate(col._id); }} className="btn btn-sm" style={{ background: 'rgba(0,200,83,0.1)', color: 'var(--td-success)', border: 'none', padding: '2px 8px' }}>
                          <FaSave size={11} />
                        </button>
                        <button onClick={e => { e.stopPropagation(); setEditingId(null); setForm({ name: '', description: '' }); }} className="btn btn-sm" style={{ background: 'rgba(255,23,68,0.1)', color: 'var(--td-error)', border: 'none', padding: '2px 8px' }}>
                          <FaTimes size={11} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Main - Collection Listings */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {activeCollection ? (
              <div>
                <div className="glass-card" style={{ padding: 'var(--td-space-lg)', marginBottom: 'var(--td-space-md)' }}>
                  <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{activeCollection.name}</h2>
                  {activeCollection.description && (
                    <p style={{ color: 'var(--td-text-secondary)', fontSize: 14 }}>{activeCollection.description}</p>
                  )}
                  <div style={{ fontSize: 13, color: 'var(--td-text-tertiary)', marginTop: 8 }}>
                    {collectionListings.length} item{collectionListings.length !== 1 ? 's' : ''}
                  </div>
                </div>

                {collectionListings.length === 0 ? (
                  <div className="empty-state" style={{ padding: 'var(--td-space-xl)' }}>
                    <FaImage size={48} color="var(--td-text-tertiary)" />
                    <h3>Collection is empty</h3>
                    <p>Add listings to this collection to showcase them</p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
                    {collectionListings.map(listing => (
                      <div key={listing._id} style={{ position: 'relative' }}>
                        <ListingCard listing={listing} />
                        {isOwner && (
                          <button
                            onClick={() => handleRemoveListing(activeCollection._id, listing._id)}
                            className="btn btn-sm"
                            style={{
                              position: 'absolute', top: 8, right: 8, zIndex: 2,
                              background: 'rgba(255,23,68,0.9)', color: '#fff', border: 'none',
                              borderRadius: '50%', width: 28, height: 28, display: 'flex',
                              alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                            }}
                          >
                            <FaTimes size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="glass-card" style={{ padding: 'var(--td-space-xl)', textAlign: 'center' }}>
                <FaStore size={48} color="var(--td-text-tertiary)" />
                <h3 style={{ marginTop: 12 }}>Select a collection</h3>
                <p style={{ color: 'var(--td-text-tertiary)' }}>Choose a collection from the sidebar to view its items</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Collections;