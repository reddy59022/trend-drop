import React, { useState, useEffect, useRef } from 'react';
import { startConversation, sendMessage, getConversation, markAsRead } from '../services/api';
import { useAuth } from '../context/AuthContext';

const ChatModal = ({ isOpen, onClose, listing, seller }) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [conversationId, setConversationId] = useState(null);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (isOpen && listing && seller && user) {
      loadConversation();
    }
  }, [isOpen, listing, seller, user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadConversation = async () => {
    try {
      setLoading(true);
      const res = await getConversation(seller._id, listing._id);
      setConversationId(res.data._id);
      setMessages(res.data.messages || []);
      await markAsRead(res.data._id);
    } catch {
      // Conversation doesn't exist yet
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    try {
      if (conversationId) {
        const res = await sendMessage(conversationId, { text: newMessage });
        setMessages(res.data);
      } else {
        const res = await startConversation({
          listingId: listing._id,
          sellerId: seller._id,
          text: newMessage,
        });
        setConversationId(res.data._id);
        setMessages(res.data.messages);
      }
      setNewMessage('');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to send message');
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 9999,
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 12, width: '90%', maxWidth: 420,
        height: '70vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid #eee',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={seller?.avatar || '/default-avatar.png'} alt=""
              style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{seller?.name}</div>
              <div style={{ fontSize: 12, color: '#888' }}>{listing?.title}</div>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#888',
          }}>×</button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: '#888', padding: 20 }}>Loading...</div>
          ) : messages.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#888', padding: 20 }}>
              Start a conversation about this item
            </div>
          ) : (
            messages.map((msg, i) => (
              <div key={i} style={{
                marginBottom: 12,
                textAlign: msg.sender?._id === user?._id || msg.sender === user?._id ? 'right' : 'left',
              }}>
                <div style={{
                  display: 'inline-block', padding: '8px 14px', borderRadius: 16,
                  maxWidth: '75%', fontSize: 14,
                  background: (msg.sender?._id === user?._id || msg.sender === user?._id) ? '#FF4D6D' : '#f0f0f0',
                  color: (msg.sender?._id === user?._id || msg.sender === user?._id) ? '#fff' : '#333',
                }}>
                  {msg.text}
                </div>
                <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSend} style={{
          padding: 12, borderTop: '1px solid #eee',
          display: 'flex', gap: 8,
        }}>
          <input
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            style={{
              flex: 1, padding: '10px 14px', border: '1px solid #ddd',
              borderRadius: 20, fontSize: 14, outline: 'none',
            }}
          />
          <button type="submit" style={{
            background: '#FF4D6D', color: '#fff', border: 'none',
            borderRadius: 20, padding: '10px 20px', fontWeight: 600,
            cursor: 'pointer',
          }}>Send</button>
        </form>
      </div>
    </div>
  );
};

export default ChatModal;