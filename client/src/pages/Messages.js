import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { getConversations, getConversationWithUser, startConversation } from '../services/api';
import { useNavigate } from 'react-router-dom';
import { defaultAvatar, timeAgo, formatPrice } from '../utils/helpers';
import { FaEnvelope, FaSearch, FaPaperPlane, FaSpinner, FaStore, FaArrowLeft, FaTag, FaClock, FaImage } from 'react-icons/fa';
import { toast } from 'react-toastify';
import moment from 'moment';

const OFFER_STATUSES = {
  pending: { color: 'var(--td-warning)', bg: 'rgba(255,176,32,0.12)', label: 'Offer Pending' },
  countered: { color: 'var(--td-info)', bg: 'rgba(61,155,255,0.12)', label: 'Counter Offer' },
  buyer_countered: { color: 'var(--td-info)', bg: 'rgba(61,155,255,0.12)', label: 'Counter Sent' },
  accepted: { color: 'var(--td-success)', bg: 'rgba(16,217,142,0.12)', label: 'Offer Accepted' },
  declined: { color: 'var(--td-error)', bg: 'rgba(255,77,109,0.12)', label: 'Offer Declined' },
  expired: { color: 'var(--td-text-tertiary)', bg: 'rgba(148,148,184,0.12)', label: 'Expired' },
  completed: { color: 'var(--td-success)', bg: 'rgba(16,217,142,0.12)', label: 'Purchased' },
};

const Messages = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeThread, setActiveThread] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);
  const [threadOffers, setThreadOffers] = useState([]);
  const [threadListings, setThreadListings] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [convLoading, setConvLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const stateRef = useRef(null);
  stateRef.current = { activeThread, threadListings };

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    fetchConversations();
    const iv = setInterval(fetchConversations, 10000);
    return () => clearInterval(iv);
  }, [user, navigate]); // eslint-disable-line

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [threadMessages]);

  const fetchConversations = async (silent) => {
    try {
      const res = await getConversations();
      const raw = Array.isArray(res.data) ? res.data : [];
      // Defensive grouping: the API returns one thread per person already, but
      // merge again client-side as a safety net — GUARANTEED one row per
      // person, no matter what legacy data exists.
      const byPerson = new Map();
      for (const conv of raw) {
        const other = conv.otherUser || {};
        const key = other._id || other.id || 'unknown';
        if (!byPerson.has(key)) {
          byPerson.set(key, { ...conv, unreadCount: conv.unreadCount || 0 });
        } else {
          const g = byPerson.get(key);
          g.unreadCount += conv.unreadCount || 0;
          const a = g.lastMessage ? new Date(g.lastMessage.createdAt || 0).getTime() : 0;
          const b = conv.lastMessage ? new Date(conv.lastMessage.createdAt || 0).getTime() : 0;
          if (b >= a) { g.lastMessage = conv.lastMessage; g.updatedAt = conv.updatedAt; g.listing = conv.listing || g.listing; }
        }
      }
      const merged = Array.from(byPerson.values()).sort((a, b) => {
        const ta = a.lastMessage ? new Date(a.lastMessage.createdAt || a.updatedAt || 0).getTime() : 0;
        const tb = b.lastMessage ? new Date(b.lastMessage.createdAt || b.updatedAt || 0).getTime() : 0;
        return tb - ta;
      });
      setConversations(merged);
    } catch (error) { console.error(error); }
    finally { if (!silent) setLoading(false); }
  };

  const openThread = async (thread) => {
    if (!thread?.otherUser?._id) return;
    setActiveThread(thread);
    setConvLoading(true);
    try {
      // Unified thread: ALL past/current/future messages with this person
      // across every listing, plus every offer and every listing discussed.
      // The server auto-marks everything as read on load.
      const res = await getConversationWithUser(thread.otherUser._id);
      const data = res.data || {};
      setThreadMessages(Array.isArray(data.messages) ? data.messages : []);
      setThreadOffers(Array.isArray(data.offers) ? data.offers : []);
      setThreadListings(Array.isArray(data.listings) ? data.listings : []);
      fetchConversations(true);
    } catch (error) {
      setThreadMessages([]);
    }
    setConvLoading(false);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || sending || !activeThread) return;
    setSending(true);
    const { activeThread: thread, threadListings: listings } = stateRef.current;
    try {
      // Send within the context of the most recent listing in this thread so
      // the message lands on the right per-listing conversation server-side,
      // while this per-person view keeps everything in one place.
      const contextListing = thread?.listing?._id ? thread.listing : listings[0];
      const listingId = contextListing?._id || contextListing?.id;
      if (listingId) {
        await startConversation({
          listingId,
          sellerId: thread.otherUser._id,
          text: newMessage.trim(),
        });
        setNewMessage('');
        await openThread(thread);
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    } catch (error) {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleSelectConversation = (conv) => {
    openThread(conv);
  };

  const filtered = conversations.filter(c =>
    c.otherUser?.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.listing?.title?.toLowerCase().includes(search.toLowerCase()) ||
    c.lastMessage?.text?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return (
    <div className="page-container">
      <h1 className="page-title"><FaEnvelope /> Messages</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[...Array(5)].map((_, i) => <div key={i} className="skeleton" style={{ height: 72, borderRadius: 'var(--td-radius-sm)' }} />)}
      </div>
    </div>
  );

  // Unified thread detail view — one person, all messages, all offers, all listings
  if (activeThread) {
    const other = activeThread.otherUser || {};
    const threadTitle = other.name || 'Unknown';

    return (
      <div className="page-container" style={{ maxWidth: 700, margin: '0 auto', padding: '0 16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button onClick={() => setActiveThread(null)} aria-label="Back to conversations" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', color: 'var(--td-text)' }}>
            <FaArrowLeft />
          </button>
          <img src={other.avatar || defaultAvatar} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--td-border)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{threadTitle}</div>
            <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', display: 'flex', alignItems: 'center', gap: 4 }}><FaStore size={10} /> {threadMessages.length} message{threadMessages.length === 1 ? '' : 's'} · {threadListings.length} item{threadListings.length === 1 ? '' : 's'}</div>
          </div>
        </div>

        {/* Items discussed in this thread */}
        {threadListings.length > 0 && (
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '4px 0 12px', marginBottom: 8 }}>
            {threadListings.map((l) => (
              <div key={l._id || l.id} onClick={() => navigate(`/listing/${l._id || l.id}`)} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 6px 6px', background: 'var(--td-surface)', borderRadius: 'var(--td-radius-full)', border: '1px solid var(--td-border)', cursor: 'pointer' }}>
                {l.images?.[0]
                  ? <img src={l.images[0]} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                  : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--td-surface-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FaImage size={11} style={{ color: 'var(--td-text-tertiary)' }} /></div>}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{l.title}</div>
                  <div style={{ fontSize: 10, color: 'var(--td-text-tertiary)' }}>{formatPrice(l.price, l.currency || 'USD')}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Offers — past and present, 24h expiry shown live */}
        {threadOffers.length > 0 && (
          <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {threadOffers.map((o) => {
              const expired = o.status === 'expired' || (['pending', 'countered', 'buyer_countered'].includes(o.status) && o.expiresAt && new Date(o.expiresAt) < new Date());
              const cfg = OFFER_STATUSES[expired ? 'expired' : o.status] || OFFER_STATUSES.pending;
              return (
                <div key={o._id} style={{ padding: '10px 14px', background: cfg.bg, borderRadius: 'var(--td-radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <FaTag size={12} style={{ color: cfg.color }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--td-text)' }}>Offer: {formatPrice(o.counterAmount || o.amount, o.currency || 'USD')}</span>
                    {o.listing?.title && <span style={{ fontSize: 11, color: 'var(--td-text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>· {o.listing.title}</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {expired && <span style={{ fontSize: 11, color: cfg.color, display: 'flex', alignItems: 'center', gap: 4 }}><FaClock size={10} /> {cfg.label}</span>}
                    {!expired && o.status === 'pending' && o.expiresAt && (
                      <span style={{ fontSize: 11, color: cfg.color, display: 'flex', alignItems: 'center', gap: 4 }}><FaClock size={10} /> {moment(o.expiresAt).fromNow()}</span>
                    )}
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 'var(--td-radius-full)', color: cfg.color, background: 'var(--td-surface)' }}>{cfg.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', background: 'var(--td-surface-secondary)', borderRadius: 'var(--td-radius-md)', border: '1px solid var(--td-border)', minHeight: 300, maxHeight: '50vh', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {convLoading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--td-text-tertiary)' }}><FaSpinner className="spinner" /></div>
          ) : threadMessages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--td-text-tertiary)' }}>
              <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>💬</div>
              <p style={{ fontSize: 14 }}>No messages yet. Start the conversation!</p>
            </div>
          ) : (
            <>
              {threadMessages.map((msg, i) => {
                const senderId = msg.sender?._id || msg.sender;
                const isOwn = senderId === (user?.id || user?._id);
                const showAvatar = i === 0 || (threadMessages[i - 1].sender?._id || threadMessages[i - 1].sender) !== senderId;
                const isLast = i === threadMessages.length - 1 || (threadMessages[i + 1].sender?._id || threadMessages[i + 1].sender) !== senderId;
                return (
                  <div key={msg._id || i} style={{ display: 'flex', justifyContent: isOwn ? 'flex-end' : 'flex-start', alignItems: isOwn ? 'flex-end' : 'flex-start', gap: 8, marginBottom: isLast ? 8 : 2 }}>
                    {!isOwn && showAvatar && <img src={other.avatar || defaultAvatar} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />}
                    {!isOwn && !showAvatar && <div style={{ width: 28, flexShrink: 0 }} />}
                    <div style={{ maxWidth: '75%', padding: '10px 14px', borderRadius: isOwn ? '18px 18px 4px 18px' : '18px 18px 18px 4px', background: isOwn ? 'linear-gradient(135deg, var(--td-primary), var(--td-primary-dark))' : '#fff', color: isOwn ? '#fff' : 'var(--td-text)', boxShadow: isOwn ? '0 4px 12px rgba(108,59,255,0.3)' : 'var(--td-shadow-sm)' }}>
                      {msg.listing && <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.8, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}><FaTag size={9} /> Re: {msg.listing.title}</div>}
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
            <div key={conv.otherUser?._id || `c-${i}`}
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
                {conv.listing && (
                  <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', marginBottom: 2 }}>
                    Re: {conv.listing.title}{conv.listingCount > 1 ? ` +${conv.listingCount - 1} more item${conv.listingCount - 1 === 1 ? '' : 's'}` : ''}
                  </div>
                )}
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
