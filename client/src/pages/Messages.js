import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getConversations } from '../services/api';
import { useNavigate } from 'react-router-dom';

const Messages = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    fetchConversations();
  }, [user, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchConversations = async () => {
    try {
      const res = await getConversations();
      setConversations(res.data);
    } catch (error) {
      console.error('Failed to load messages', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading messages...</div>;

  return (
    <div style={{ padding: '20px 16px', maxWidth: 600, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 20, fontSize: 24, fontWeight: 700 }}>Messages</h2>

      {conversations.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>💬</div>
          <p style={{ fontSize: 18, marginBottom: 8 }}>No conversations yet</p>
          <p style={{ fontSize: 14 }}>Start chatting by messaging a seller on their listing</p>
        </div>
      ) : (
        conversations.map(conv => (
          <div key={conv._id} style={{
            display: 'flex', gap: 12, padding: 14, borderBottom: '1px solid #eee',
            cursor: 'pointer', alignItems: 'center',
            background: conv.unreadCount > 0 ? '#FFF5F7' : '#fff',
          }}
            onClick={() => navigate(`/listing/${conv.listing?._id}`)}
          >
            <img src={conv.otherUser?.avatar || 'defaultAvatar'} alt=""
              style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: conv.unreadCount > 0 ? 700 : 400, fontSize: 15 }}>
                  {conv.otherUser?.name || 'Unknown'}
                </span>
                <span style={{ fontSize: 12, color: '#aaa' }}>
                  {conv.lastMessage ? new Date(conv.updatedAt).toLocaleDateString() : ''}
                </span>
              </div>
              {conv.listing && (
                <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>
                  Re: {conv.listing.title}
                </div>
              )}
              <div style={{
                fontSize: 13, color: conv.unreadCount > 0 ? '#333' : '#888',
                fontWeight: conv.unreadCount > 0 ? 600 : 400,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {conv.lastMessage?.text || 'No messages yet'}
              </div>
            </div>
            {conv.unreadCount > 0 && (
              <span style={{
                background: '#FF4D6D', color: '#fff', borderRadius: 12,
                padding: '2px 8px', fontSize: 12, fontWeight: 600,
              }}>{conv.unreadCount}</span>
            )}
          </div>
        ))
      )}
    </div>
  );
};

export default Messages;