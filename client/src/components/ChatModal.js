import React, { useState, useEffect, useRef } from 'react';
import { FaTimes, FaPaperPlane, FaSpinner, FaUserCircle, FaStore } from 'react-icons/fa';
import { startConversation, sendMessage, getConversation, markAsRead } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { defaultAvatar, timeAgo, formatPrice } from '../utils/helpers';
import { toast } from 'react-toastify';

const ChatModal = ({ isOpen, onClose, listing, seller }) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const messagesEndRef = useRef(null);
  const pollIntervalRef = useRef(null);

  useEffect(() => {
    if (isOpen && user) {
      loadConversation();
      // Poll for new messages every 5 seconds
      pollIntervalRef.current = setInterval(loadConversation, 5000);
    }
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
    // eslint-disable-next-line
  }, [isOpen, user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadConversation = async () => {
    if (!user || !listing) return;
    try {
      const res = await getConversation(seller._id || seller.id, listing._id);
      if (res.data && res.data.messages) {
        setMessages(res.data.messages);
        if (res.data._id) setConversationId(res.data._id);
        // Mark as read
        if (res.data._id) {
          try { await markAsRead(res.data._id); } catch (e) {}
        }
      } else {
        setMessages(res.data ? [res.data] : []);
      }
    } catch (error) {
      // No conversation yet - that's fine
      setMessages([]);
    }
    setLoading(false);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || sending) return;

    setSending(true);
    try {
      let msg;
      if (conversationId) {
        msg = await sendMessage(conversationId, { text: newMessage.trim() });
      } else {
        msg = await startConversation({
          listingId: listing._id,
          recipientId: seller._id || seller.id,
          text: newMessage.trim(),
        });
        if (msg.data && msg.data._id) setConversationId(msg.data._id);
      }
      setNewMessage('');
      loadConversation();
    } catch (error) {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  const sellerName = seller?.name || seller?.username || 'Seller';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal" 
        onClick={(e) => e.stopPropagation()} 
        style={{ maxWidth: 500, height: '80vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <div className="modal-header" style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img
              src={seller?.avatar || defaultAvatar}
              alt={sellerName}
              style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }}
            />
            <div>
              <h2 style={{ fontSize: 16, marginBottom: 0 }}>{sellerName}</h2>
              {listing && (
                <div style={{ fontSize: 11, color: 'var(--td-text-tertiary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <FaStore size={10} /> {listing.title?.substring(0, 30)}...
                </div>
              )}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}><FaTimes /></button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--td-space-md)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--td-text-tertiary)' }}>
              <FaSpinner className="spinner" />
            </div>
          ) : messages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--td-text-tertiary)' }}>
              <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>💬</div>
              <p>Start a conversation with {sellerName}</p>
              <p style={{ fontSize: 12, marginTop: 4 }}>Ask about the item, negotiate a price, or say hello!</p>
            </div>
          ) : (
            messages.map((msg, i) => {
              const isOwn = msg.sender?._id === (user?.id || user?._id) || msg.sender === (user?.id || user?._id);
              const showAvatar = i === 0 || messages[i-1]?.sender?._id !== msg.sender?._id;
              
              return (
                <div
                  key={msg._id || i}
                  style={{
                    display: 'flex',
                    justifyContent: isOwn ? 'flex-end' : 'flex-start',
                    marginBottom: 4,
                  }}
                >
                  <div
                    style={{
                      maxWidth: '75%',
                      padding: '10px 14px',
                      borderRadius: isOwn ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                      background: isOwn 
                        ? 'linear-gradient(135deg, var(--td-primary), var(--td-primary-dark))'
                        : 'var(--td-surface-secondary)',
                      color: isOwn ? '#fff' : 'var(--td-text)',
                      boxShadow: isOwn 
                        ? '0 2px 8px var(--td-primary-glow)'
                        : 'var(--td-shadow-sm)',
                      position: 'relative',
                    }}
                  >
                    <div style={{ fontSize: 14, lineHeight: 1.4 }}>{msg.text}</div>
                    <div style={{ 
                      fontSize: 10, 
                      marginTop: 4, 
                      opacity: 0.7,
                      textAlign: isOwn ? 'right' : 'left',
                    }}>
                      {timeAgo(msg.createdAt)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form 
          onSubmit={handleSend}
          style={{
            flexShrink: 0,
            padding: 'var(--td-space-sm) var(--td-space-md)',
            borderTop: '1px solid var(--td-border)',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <input
            type="text"
            className="form-input"
            placeholder="Type a message..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            maxLength={1000}
            style={{ borderRadius: '24px !important' }}
          />
          <button
            type="submit"
            className="btn btn-primary btn-icon"
            disabled={sending || !newMessage.trim()}
            style={{ flexShrink: 0, width: 44, height: 44 }}
          >
            {sending ? <FaSpinner className="spinner-sm" /> : <FaPaperPlane />}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatModal;