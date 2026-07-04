import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { FaComment, FaHeart, FaReply, FaHashtag, FaPaperPlane } from 'react-icons/fa';

const Comments = ({ listingId }) => {
  const { user } = useAuth();
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [replyTo, setReplyTo] = useState(null);

  useEffect(() => {
    fetchComments();
  }, [listingId]);

  const fetchComments = async () => {
    try {
      const res = await api.get(`/comments/${listingId}`);
      setComments(res.data.comments || []);
    } catch (error) {
      console.error('Failed to fetch comments', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    
    setLoading(true);
    try {
      const res = await api.post(`/comments/${listingId}`, {
        text: newComment,
        parentId: replyTo,
      });
      if (replyTo) {
        setComments(comments.map(c => 
          c._id === replyTo 
            ? { ...c, replies: [...(c.replies || []), res.data] }
            : c
        ));
      } else {
        setComments([res.data, ...comments]);
      }
      setNewComment('');
      setReplyTo(null);
    } catch (error) {
      console.error('Failed to post comment', error);
    }
    setLoading(false);
  };

  const handleLike = async (commentId) => {
    try {
      await api.put(`/comments/${commentId}/like`);
      fetchComments();
    } catch (error) {
      console.error('Failed to like comment', error);
    }
  };

  return (
    <div className="comments-section">
      <h3 style={{ marginBottom: 'var(--td-space-md)' }}>
        <FaComment /> Comments ({comments.length})
      </h3>
      
      {user && (
        <form onSubmit={handleSubmit} style={{ marginBottom: 'var(--td-space-lg)' }}>
          <div className="form-group">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              className="form-input"
              placeholder="Add a comment... Use #hashtags to join conversations"
              rows={3}
            />
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={loading || !newComment.trim()}
              style={{ marginTop: 'var(--td-space-sm)' }}
            >
              <FaPaperPlane /> Post Comment
            </button>
          </div>
        </form>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--td-space-md)' }}>
        {comments.map(comment => (
          <div key={comment._id} className="glass-card" style={{ padding: 'var(--td-space-sm)' }}>
            <div style={{ display: 'flex', gap: 'var(--td-space-sm)' }}>
              {comment.userId?.avatar && (
                <img 
                  src={comment.userId.avatar} 
                  alt={comment.userId.name}
                  style={{ width: 40, height: 40, borderRadius: '50%' }}
                />
              )}
              <div style={{ flex: 1 }}>
                <strong>{comment.userId?.name}</strong>
                <p style={{ margin: 'var(--td-space-xs) 0' }}>{comment.text}</p>
                <div style={{ display: 'flex', gap: 'var(--td-space-sm)', alignItems: 'center' }}>
                  <button
                    onClick={() => handleLike(comment._id)}
                    className="btn btn-ghost btn-sm"
                  >
                    <FaHeart /> {comment.likes?.length || 0}
                  </button>
                  <button
                    onClick={() => setReplyTo(comment._id)}
                    className="btn btn-ghost btn-sm"
                  >
                    <FaReply /> Reply
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Comments;