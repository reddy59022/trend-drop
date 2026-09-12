import React, { useState, useEffect, useRef } from 'react';
import { FaTimes, FaPaperPlane, FaSpinner, FaStore, FaCheck, FaTimesCircle, FaExchangeAlt, FaClock, FaTag, FaShoppingBag } from 'react-icons/fa';
import { startConversation, getConversationWithUser } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { defaultAvatar, timeAgo, formatPrice } from '../utils/helpers';
import { toast } from 'react-toastify';
import moment from 'moment';

const ChatModal = ({ isOpen, onClose, listing, seller }) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [offer, setOffer] = useState(null);
  const [offerExpired, setOfferExpired] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const pollIntervalRef = useRef(null);

  useEffect(() => {
    if (isOpen && user) {
      loadConversation();
      pollIntervalRef.current = setInterval(loadConversation, 3000);
    }
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
    // eslint-disable-next-line
  }, [isOpen, user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (offer?.expiresAt && (offer.status === 'pending' || offer.status === 'countered')) {
      const checkExp = () => setOfferExpired(new Date() > new Date(offer.expiresAt));
      checkExp();
      const iv = setInterval(checkExp, 1000);
      return () => clearInterval(iv);
    }
  }, [offer]);

  const loadConversation = async () => {
    if (!user || !listing || !seller) return;
    try {
      // Unified thread: ALL past/current/future messages with this person,
      // across every listing, plus every offer exchanged between us. The
      // server marks everything as read on load.
      const res = await getConversationWithUser(seller._id || seller.id);
      const data = res.data || {};
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      // Offers come back as an array (one per listing discussed) — surface the
      // one that belongs to the listing this chat was opened from, falling
      // back to the newest active offer between the two users.
      const offers = Array.isArray(data.offers) ? data.offers : [];
      const currentListingId = listing._id || listing.id;
      const currentOffer =
        offers.find((o) => (o.listing?._id || o.listing) === currentListingId) ||
        offers.find((o) => ['pending', 'countered', 'buyer_countered'].includes(o.status)) ||
        offers[0] || null;
      setOffer(currentOffer);
    } catch (error) {
      setMessages([]);
    }
    setLoading(false);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || sending) return;
    setSending(true);
    try {
      // Always send via startConversation for THIS listing: the server
      // find-or-creates the per-listing thread and appends, so every message
      // stays tied to the right item inside the unified per-person view.
      await startConversation({
        listingId: listing._id,
        sellerId: seller._id || seller.id,
        text: newMessage.trim(),
      });
      setNewMessage('');
      loadConversation();
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (error) {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleAcceptOffer = async () => {
    try {
      const api = (await import('../services/api')).default;
      await api.patch(`/offers/${offer._id}/accept`);
      toast.success('Offer accepted! Buyer can now purchase.');
      setOffer({ ...offer, status: 'accepted', acceptedAt: new Date() });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to accept offer');
    }
  };

  const handleDeclineOffer = async () => {
    try {
      const api = (await import('../services/api')).default;
      await api.patch(`/offers/${offer._id}/decline`);
      toast.success('Offer declined');
      setOffer({ ...offer, status: 'declined' });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to decline');
    }
  };

  if (!isOpen) return null;

  const sellerName = seller?.name || seller?.username || 'Seller';
  const isSeller = (user?.id || user?._id) === (seller._id || seller.id);

  const getStatusBadge = (status) => {
    const configs = {
      pending: { color: 'var(--td-warning)', bg: 'rgba(255,176,32,0.1)', icon: <FaClock size={11} />, label: 'Offer Pending' },
      countered: { color: 'var(--td-info)', bg: 'rgba(61,155,255,0.1)', icon: <FaExchangeAlt size={11} />, label: 'Counter Offer' },
      buyer_countered: { color: 'var(--td-info)', bg: 'rgba(61,155,255,0.1)', icon: <FaExchangeAlt size={11} />, label: 'Counter Sent' },
      accepted: { color: 'var(--td-success)', bg: 'rgba(16,217,142,0.1)', icon: <FaCheck size={11} />, label: 'Offer Accepted' },
      declined: { color: 'var(--td-error)', bg: 'rgba(255,77,109,0.1)', icon: <FaTimesCircle size={11} />, label: 'Offer Declined' },
      expired: { color: 'var(--td-text-tertiary)', bg: 'rgba(148,148,184,0.1)', icon: <FaClock size={11} />, label: 'Expired' },
      completed: { color: 'var(--td-success)', bg: 'rgba(16,217,142,0.1)', icon: <FaShoppingBag size={11} />, label: 'Purchased' },
    };
    const c = configs[status] || configs.pending;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 'var(--td-radius-full)', fontSize: 10, fontWeight: 600, color: c.color, background: c.bg }}>
        {c.icon} {c.label}
      </span>
    );
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, width: '100%', height: '85vh', display: 'flex', flexDirection: 'column', borderRadius: 'var(--td-radius-xl)', overflow: 'hidden', background: 'var(--td-surface)', boxShadow: 'var(--td-shadow-xxl)' }}>
        
        {/* Header */}
        <div style={{ flexShrink: 0, padding: '16px 20px', background: 'linear-gradient(135deg, var(--td-primary) 0%, var(--td-primary-dark) 100%)', color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <img src={seller?.avatar || defaultAvatar} alt={sellerName} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,0.3)' }} />
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{sellerName}</h2>
                <div style={{ fontSize: 12, opacity: 0.8, display: 'flex', alignItems: 'center', gap: 4 }}><FaStore size={10} /> Seller</div>
              </div>
            </div>
            <button onClick={onClose} style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.2)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FaTimes /></button>
          </div>
          {listing && (
            <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(255,255,255,0.15)', borderRadius: 'var(--td-radius-sm)', display: 'flex', alignItems: 'center', gap: 10 }}>
              {listing.images?.[0] && <img src={listing.images[0]} alt="" style={{ width: 32, height: 32, borderRadius: 'var(--td-radius-xs)', objectFit: 'cover' }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{listing.title}</div>
                <div style={{ fontSize: 11, opacity: 0.8 }}>Listed at {formatPrice(listing.price, listing.currency || 'USD')}</div>
              </div>
            </div>
          )}
        </div>

        {/* Offer Status Banner */}
        {offer && (
          <div style={{ flexShrink: 0, padding: '12px 20px', background: offerExpired ? 'rgba(148,148,184,0.05)' : offer.status === 'accepted' ? 'rgba(16,217,142,0.06)' : offer.status === 'declined' ? 'rgba(255,77,109,0.06)' : 'rgba(108,59,255,0.04)', borderBottom: '1px solid var(--td-border-light)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FaTag size={13} style={{ color: 'var(--td-primary)' }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--td-text)' }}>Offer: {formatPrice(offer.counterAmount || offer.amount, offer.currency || 'USD')}</span>
                {getStatusBadge(offerExpired && offer.status === 'pending' ? 'expired' : offer.status)}
              </div>
              {offer.expiresAt && offer.status === 'pending' && !offerExpired && (
                <span style={{ fontSize: 11, color: 'var(--td-text-tertiary)', display: 'flex', alignItems: 'center', gap: 4 }}><FaClock size={10} /> Expires {moment(offer.expiresAt).fromNow()}</span>
              )}
            </div>
            {offer.status === 'pending' && !offerExpired && isSeller && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={handleAcceptOffer} style={{ flex: 1, padding: '8px 16px', background: 'var(--td-success)', color: '#fff', border: 'none', borderRadius: 'var(--td-radius-sm)', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><FaCheck size={12} /> Accept</button>
                <button onClick={handleDeclineOffer} style={{ flex: 1, padding: '8px 16px', background: 'transparent', color: 'var(--td-error)', border: '1px solid var(--td-error)', borderRadius: 'var(--td-radius-sm)', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><FaTimesCircle size={12} /> Decline</button>
              </div>
            )}
            {offerExpired && (offer.status === 'pending' || offer.status === 'countered') && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(148,148,184,0.1)', borderRadius: 'var(--td-radius-sm)', fontSize: 12, color: 'var(--td-text-secondary)', textAlign: 'center' }}>
                ⏰ This offer has expired. A new offer can be made.
              </div>
            )}
          </div>
        )}

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', background: 'var(--td-surface-secondary)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--td-text-tertiary)' }}><FaSpinner className="spinner" /></div>
          ) : messages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--td-text-tertiary)' }}>
              <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>💬</div>
              <p style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>Start a conversation with {sellerName}</p>
              <p style={{ fontSize: 13 }}>Ask about the item, negotiate a price, or say hello!</p>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => {
                const isOwn = msg.sender?._id === (user?.id || user?._id) || msg.sender === (user?.id || user?._id);
                const showAvatar = i === 0 || messages[i - 1]?.sender?._id !== msg.sender?._id;
                const isLast = i === messages.length - 1 || messages[i + 1]?.sender?._id !== msg.sender?._id;
                return (
                  <div key={msg._id || i} style={{ display: 'flex', justifyContent: isOwn ? 'flex-end' : 'flex-start', alignItems: isOwn ? 'flex-end' : 'flex-start', gap: 8, marginBottom: isLast ? 12 : 4 }}>
                    {!isOwn && showAvatar && <img src={seller?.avatar || defaultAvatar} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />}
                    {!isOwn && !showAvatar && <div style={{ width: 28, flexShrink: 0 }} />}
                    <div style={{ maxWidth: '72%', padding: '10px 14px', borderRadius: isOwn ? '18px 18px 4px 18px' : '18px 18px 18px 4px', background: isOwn ? 'linear-gradient(135deg, var(--td-primary), var(--td-primary-dark))' : '#fff', color: isOwn ? '#fff' : 'var(--td-text)', boxShadow: isOwn ? '0 4px 12px rgba(108,59,255,0.3)' : 'var(--td-shadow-sm)' }}>
                      {msg.listing && (msg.listing._id || msg.listing) !== (listing?._id || listing?.id) && (
                        <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.8, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <FaTag size={9} /> Re: {msg.listing.title}
                        </div>
                      )}
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
        <form onSubmit={handleSend} style={{ flexShrink: 0, padding: '12px 16px', background: 'var(--td-surface)', borderTop: '1px solid var(--td-border-light)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <input ref={inputRef} type="text" placeholder="Type a message..." value={newMessage} onChange={(e) => setNewMessage(e.target.value)} maxLength={2000} autoComplete="off" style={{ flex: 1, padding: '12px 18px', borderRadius: '24px', border: '1px solid var(--td-border)', fontSize: 14, background: 'var(--td-surface-secondary)', outline: 'none' }} />
          <button type="submit" disabled={sending || !newMessage.trim()} style={{ flexShrink: 0, width: 46, height: 46, borderRadius: '50%', border: 'none', background: newMessage.trim() ? 'linear-gradient(135deg, var(--td-primary), var(--td-primary-dark))' : 'var(--td-surface-tertiary)', color: newMessage.trim() ? '#fff' : 'var(--td-text-tertiary)', cursor: newMessage.trim() ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: newMessage.trim() ? '0 4px 12px rgba(108,59,255,0.35)' : 'none' }}>
            {sending ? <FaSpinner className="spinner-sm" /> : <FaPaperPlane size={16} />}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatModal;
