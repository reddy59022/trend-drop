import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getConversations } from '../services/api';
import { useNavigate } from 'react-router-dom';
import { defaultAvatar } from '../utils/helpers';
import { FaEnvelope, FaSearch } from 'react-icons/fa';

const Messages = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    fetchConversations();
  }, [user, navigate]); // eslint-disable-line

  const fetchConversations = async () => {
    try {
      const res = await getConversations();
      setConversations(res.data);
    } catch (error) { console.error(error); }
    finally { setLoading(false); }
  };

  const filtered = conversations.filter(c =>
    c.otherUser?.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.listing?.title?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return (
    <div className="page-container">
      <h1 className="page-title"><FaEnvelope /> Messages</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[...Array(5)].map((_, i) => <div key={i} className="skeleton" style={{ height: 72, borderRadius: 'var(--td-radius-sm)' }} />)}
      </div>
    </div>
  );

  return (
    <div className="page-container" style={{ maxWidth: 700, margin: '0 auto' }}>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}><FaEnvelope /> Messages {conversations.length > 0 && <span style={{ fontSize: 16, color: 'var(--td-text-tertiary)', fontWeight: 400 }}>({conversations.length})</span>}</h1>

      {/* Search */}
      {conversations.length > 3 && (
        <div style={{ position: 'relative', marginBottom: 'var(--td-space-lg)' }}>
          <FaSearch style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--td-text-tertiary)' }} />
          <input className="form-input" placeholder="Search conversations..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 36 }} />
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty-state" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
          <div className="empty-state-icon">💬</div>
          <h2>No conversations yet</h2>
          <p>Start chatting by messaging a seller on their listing.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 'var(--td-radius-lg)', overflow: 'hidden', border: '1px solid var(--td-border)', background: 'var(--td-surface)' }}>
          {filtered.map((conv, i) => (
            <div key={conv._id}
              style={{
                display: 'flex', gap: 12, padding: '14px 16px', alignItems: 'center',
                cursor: 'pointer', borderBottom: i < filtered.length - 1 ? '1px solid var(--td-border-light)' : 'none',
                background: conv.unreadCount > 0 ? 'rgba(255, 56, 92, 0.03)' : 'transparent',
                transition: 'background 0.2s',
              }}
              onClick={() => navigate(`/listing/${conv.listing?._id}`)}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--td-surface-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = conv.unreadCount > 0 ? 'rgba(255, 56, 92, 0.03)' : 'transparent'}
            >
              <img src={conv.otherUser?.avatar || defaultAvatar} alt="" style={{ width: 48, height: 48, borderRadius: 'var(--td-radius-full)', objectFit: 'cover', flexShrink: 0, border: '2px solid var(--td-border)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: conv.unreadCount > 0 ? 700 : 500, fontSize: 15 }}>{conv.otherUser?.name || 'Unknown'}</span>
                  <span style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>{conv.lastMessage ? new Date(conv.updatedAt).toLocaleDateString() : ''}</span>
                </div>
                {conv.listing && <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', marginBottom: 2 }}>Re: {conv.listing.title}</div>}
                <div style={{ fontSize: 13, color: conv.unreadCount > 0 ? 'var(--td-text)' : 'var(--td-text-tertiary)', fontWeight: conv.unreadCount > 0 ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {conv.lastMessage?.text || 'No messages yet'}
                </div>
              </div>
              {conv.unreadCount > 0 && (
                <span className="badge badge-primary">{conv.unreadCount}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Messages;