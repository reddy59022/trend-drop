import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { getConversations, getConversation, startConversation, sendMessage, markAsRead } from '../services/api';
import { useNavigate } from 'react-router-dom';
import { defaultAvatar, timeAgo, formatPrice } from '../utils/helpers';
import { FaEnvelope, FaSearch, FaPaperPlane, FaSpinner, FaTimes, FaStore, FaArrowLeft } from 'react-icons/fa';
import { toast } from 'react-toastify';
import moment from 'moment';

const Messages = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [convLoading, setConvLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    fetchConversations();
    const iv = setInterval(fetchConversations, 10000);
    return () => clearInterval(iv);
  }, [user, navigate]); // eslint-disable-line

  useEffect(() => {
    if (activeConversation) loadConversation(activeConversation);
  }, [activeConversation]); // eslint-disable-line

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchConversations = async () => {
    try {
      const res = await getConversations();
      setConversations(res.data);
    } catch (error) { console.error(error); }
    finally { setLoading(false); }
  };

  const loadConversation = async (conv) => {
    if (!user || !conv.listing?._id || !conv.otherUser?._id) return;
    setConvLoading(true);
    try {
      const res = await getConversation(conv.otherUser._id, conv.listing._id);
      if (res.data && res.data.messages) {
        setMessages(res.data.messages);
        if (res.data._id) { try { await markAsRead(res.data._id); } catch (e) {} }
      } else {
        setMessages([]);
      }
    } catch (error) {
      setMessages([]);
    }
    setConvLoading(false);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || sending || !activeConversation) return;
    setSending(true);
    try {
      const convId = activeConversation._id;
      if (convId) {
        await sendMessage(convId, { text: newMessage.trim() });
      } else {
        await startConversation({
          listingId: activeConversation.listing._id,
          sellerId: activeConversation.otherUser._id,
          text: newMessage.trim(),
        });
      }
      setNewMessage('');
      loadConversation(activeConversation);
      fetchConversations();
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (error) {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleSelectConversation = (conv) => {
    setActiveConversation(conv);
    setMessages([]);
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

  // Conversation detail view
  if (activeConversation) {
    const sellerName = activeConversation.otherUser?.name || 'Unknown';
    const listing = activeConversation.listing;

    return (
      <div className="page-container" style={{ maxWidth: 700, margin: '0 auto', padding: '0 16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button onClick={() => setActiveConversation(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', color: 'var(--td-text)' }}>
            <FaArrowLeft />
          </button>
          <img src={activeConversation.otherUser?.avatar || defaultAvatar} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--td-border)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{sellerName}</div>
            <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', display: 'flex', alignItems: 'center', gap: 4 }}><FaStore size={10} /> Seller</div>
          </div>
          {listing && (
            <button onClick={() => navigate(`/listing/${listing._id}`)} style={{ padding: '6px 12px', fontSize: 12, border: '1px solid var(--td-border)', borderRadius: 'var(--td-radius-sm)', background: 'var(--td-surface)', cursor: 'pointer', color: 'var(--td-primary)' }}>
              View Item
            </button>
          )}
        </div>

        {/* Listing info */}
        {listing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--td-surface)', borderRadius: 'var(--td-radius-md)', border: '1px solid var(--td-border)', marginBottom: 16 }}>
            {listing.images?.[0] && <img src={listing.images[0]} alt="" style={{ width: 48, height: 48, borderRadius: 'var(--td-radius-sm)', objectFit: 'cover' }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{listing.title}</div>
              <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>{formatPrice(listing.price, listing.currency || 'USD')}</div>
            </div>
          </div>
        )}

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', background: 'var(--td-surface-secondary)', borderRadius: 'var(--td-radius-md)', border: '1px solid var(--td-border)', minHeight: 300, maxHeight: '50vh', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {convLoading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--td-text-tertiary)' }}><FaSpinner className="spinner" /></div>
          ) : messages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--td-text-tertiary)' }}>
              <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>💬</div>
              <p style={{ fontSize: 14 }}>No messages yet. Start the conversation!</p>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => {
                const isOwn = msg.sender?._id === (user?.id || user?._id) || msg.sender === (user?.id || user?._id);
                const showAvatar = i === 0 || messages[i - 1]?.sender?._id !== msg.sender?._id;
                const isLast = i === messages.length - 1 || messages[i + 1]?.sender?._id !== msg.sender?._id;
                return (
                  <div key={msg._id || i} style={{ display: 'flex', justifyContent: isOwn ? 'flex-end' : 'flex-start', alignItems: isOwn ? 'flex-end' : 'flex-start', gap: 8, marginBottom: isLast ? 8 : 2 }}>
                    {!isOwn && showAvatar && <img src={activeConversation.otherUser?.avatar || defaultAvatar} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />}
                    {!isOwn && !showAvatar && <div style={{ width: 28, flexShrink: 0 }} />}
                    <div style={{ maxWidth: '75%', padding: '10px 14px', borderRadius: isOwn ? '18px 18px 4px 18px' : '18px 18px 18px 4px', background: isOwn ? 'linear-gradient(135deg, var(--td-primary), var(--td-primary-dark))' : '#fff', color: isOwn ? '#fff' : 'var(--td-text)', boxShadow: isOwn ? '0 4px 12px rgba(108,59,255,0.3)' : 'var(--td-shadow-sm)' }}>
                      <div style={{ fontSize: 14, lineHeight: 1.5, wordBreak: 'break-word' }}>{msg.text}</div>
                      <div style={{ fontSize: 10, marginTop: 4, opacity: isOwn ? 0.8 : 0.5, textAlign: isOwn ? 'right' : 'left' }}>
                        {timeAgo(msg.createdAt)}
                        {isOwn && msg.read && <span style={{ marginLeft: 4, fontSize: 9 }}>✓✓</span>}
                      </div>
                    </div>
                    {isOwn && showAvatar && <img src={user?.avatar || defaultAvatar} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />}
                    {isOwn && !showAvatar && <div style={{ width: 28, flexShrink: 0 }} />}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input */}
        <form onSubmit={handleSend} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input ref={inputRef} type="text" placeholder="Type a message..." value={newMessage} onChange={(e) => setNewMessage(e.target.value)} maxLength={2000} autoComplete="off" style={{ flex: 1, padding: '12px 18px', borderRadius: '24px', border: '1px solid var(--td-border)', fontSize: 14, background: 'var(--td-surface)', outline: 'none' }} />
          <button type="submit" disabled={sending || !newMessage.trim()} style={{ flexShrink: 0, width: 46, height: 46, borderRadius: '50%', border: 'none', background: newMessage.trim() ? 'linear-gradient(135deg, var(--td-primary), var(--td-primary-dark))' : 'var(--td-surface-tertiary)', color: newMessage.trim() ? '#fff' : 'var(--td-text-tertiary)', cursor: newMessage.trim() ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: newMessage.trim() ? '0 4px 12px rgba(108,59,255,0.35)' : 'none' }}>
            {sending ? <FaSpinner className="spinner-sm" /> : <FaPaperPlane size={16} />}
          </button>
        </form>
      </div>
    );
  }

  // Conversation list view
  return (
    <div className="page-container" style={{ maxWidth: 700, margin: '0 auto' }}>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}><FaEnvelope /> Messages {conversations.length > 0 && <span style={{ fontSize: 16, color: 'var(--td-text-tertiary)', fontWeight: 400 }}>({conversations.length})</span>}</h1>

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
              onClick={() => handleSelectConversation(conv)}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--td-surface-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = conv.unreadCount > 0 ? 'rgba(255, 56, 92, 0.03)' : 'transparent'}
            >
              <img src={conv.otherUser?.avatar || defaultAvatar} alt="" style={{ width: 48, height: 48, borderRadius: 'var(--td-radius-full)', objectFit: 'cover', flexShrink: 0, border: '2px solid var(--td-border)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: conv.unreadCount > 0 ? 700 : 500, fontSize: 15 }}>{conv.otherUser?.name || 'Unknown'}</span>
                  <span style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>{conv.lastMessage ? timeAgo(conv.updatedAt) : ''}</span>
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
