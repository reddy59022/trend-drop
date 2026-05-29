import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { FaTrash } from 'react-icons/fa';
import moment from 'moment';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';

const CommentSection = ({ listingId, comments, onCommentsUpdate }) => {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (!user) {
      toast.error('Please login to comment');
      return;
    }

    setLoading(true);
    try {
      const res = await api.post(`/listings/${listingId}/comment`, { text });
      onCommentsUpdate(res.data);
      setText('');
    } catch (error) {
      toast.error('Failed to add comment');
    }
    setLoading(false);
  };

  const handleDelete = async (commentId) => {
    try {
      const res = await api.delete(`/listings/${listingId}/comments/${commentId}`);
      onCommentsUpdate(res.data);
      toast.success('Comment deleted');
    } catch (error) {
      toast.error('Failed to delete comment');
    }
  };

  return (
    <div className="comment-section">
      <h3>Comments ({comments?.length || 0})</h3>

      {user && (
        <form className="comment-form" onSubmit={handleSubmit}>
          <img
            src={user.avatar || 'https://via.placeholder.com/32'}
            alt=""
            className="comment-avatar"
          />
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add a comment..."
            className="comment-input"
          />
          <button type="submit" className="btn btn-sm" disabled={loading || !text.trim()}>
            Post
          </button>
        </form>
      )}

      <div className="comments-list">
        {comments?.map((comment) => (
          <div key={comment._id} className="comment">
            <Link to={`/profile/${comment.user?._id}`}>
              <img
                src={comment.user?.avatar || 'https://via.placeholder.com/32'}
                alt=""
                className="comment-avatar"
              />
            </Link>
            <div className="comment-content">
              <div className="comment-header">
                <Link to={`/profile/${comment.user?._id}`} className="comment-author">
                  {comment.user?.name}
                </Link>
                <span className="comment-time">
                  {moment(comment.createdAt).fromNow()}
                </span>
              </div>
              <p className="comment-text">{comment.text}</p>
            </div>
            {user && comment.user?._id === user.id && (
              <button
                className="comment-delete"
                onClick={() => handleDelete(comment._id)}
              >
                <FaTrash />
              </button>
            )}
          </div>
        ))}
        {(!comments || comments.length === 0) && (
          <p className="no-comments">No comments yet. Be the first to comment!</p>
        )}
      </div>
    </div>
  );
};

export default CommentSection;