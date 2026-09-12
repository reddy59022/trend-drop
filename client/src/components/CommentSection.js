import React, { useState } from 'react';
import { FaPaperPlane, FaTrash, FaSpinner, FaUserCircle } from 'react-icons/fa';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { toast } from 'react-toastify';
import { defaultAvatar, timeAgo, normalizeComment } from '../utils/helpers';

const CommentSection = ({ listingId, comments, onCommentsUpdate }) => {
  const { user } = useAuth();
  const confirmDialog = useConfirm();
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(null);

  // Realtime comment events for this listing are handled by the parent (ClientDetail),
  // which joins the socket room and owns the comments state. This component appends the
  // created comment locally on successful POST (and lets the parent's listener also handle
  // server broadcasts for other viewers). The duplicate listener here was removed to avoid
  // double-adding comments when the parent and child both listened on the same socket.
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) {
      toast.error('Please login to comment');
      return;
    }
    if (!newComment.trim()) return;

    setSubmitting(true);
    try {
      const res = await api.post(`/comments/${listingId}`, {
        text: newComment.trim(),
      });
      // POST /api/comments/:listingId returns the created comment document (not a comments[]
      // envelope), so append it locally / let the realtime event also add it (deduped).
      const created = normalizeComment(res.data);
      onCommentsUpdate((prev) => {
        const ids = prev.map((c) => c._id?.toString?.());
        if (ids.includes(created._id?.toString?.())) return prev;
        return [created, ...prev];
      });
      setNewComment('');
      toast.success('Comment added!');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to add comment');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (commentId) => {
    const ok = await confirmDialog({
      title: 'Delete comment?',
      message: 'Delete this comment?',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setDeleting(commentId);
    try {
      await api.delete(`/comments/${commentId}`);
      // DELETE returns { message: 'Comment deleted' } — remove locally / let the realtime
      // event also remove it (idempotent).
      onCommentsUpdate((prev) => prev.filter((c) => c._id?.toString?.() !== commentId));
      toast.success('Comment deleted');
    } catch (error) {
      toast.error('Failed to delete comment');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="comment-section">
      <h3>Comments ({comments?.length || 0})</h3>

      {/* Comment Form */}
      {user ? (
        <form className="comment-form" onSubmit={handleSubmit} data-testid="comment-form">
          <img
            src={user.avatar || defaultAvatar}
            alt=""
            className="comment-avatar"
          />
          <div className="comment-input-wrap">
            <input
              type="text"
              className="comment-input"
              placeholder="Add a comment..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              maxLength={500}
              data-testid="comment-input"
            />
            <button
              type="submit"
              className="btn btn-primary btn-icon"
              disabled={submitting || !newComment.trim()}
              style={{ flexShrink: 0 }}
              data-testid="comment-submit"
            >
              {submitting ? <FaSpinner className="spinner-sm" /> : <FaPaperPlane />}
            </button>
          </div>
        </form>
      ) : (
        <div style={{
          textAlign: 'center',
          padding: 'var(--td-space-md)',
          color: 'var(--td-text-tertiary)',
          fontSize: 14,
          marginBottom: 16,
        }}>
          <FaUserCircle size={24} style={{ marginRight: 8, opacity: 0.5 }} />
          <a href="/login" style={{ color: 'var(--td-primary)', fontWeight: 600 }}>Login</a> to leave a comment
        </div>
      )}

      {/* Comments List */}
      {comments?.length > 0 ? (
        <div className="comments-list" data-testid="comments-list">
          {comments.map((comment) => (
            <div key={comment._id} className="comment" data-testid={`comment-${comment._id}`}>
              <img
                src={comment.user?.avatar || defaultAvatar}
                alt=""
                className="comment-avatar"
              />
              <div className="comment-content">
                <div className="comment-header">
                  <span className="comment-author">{comment.user?.name || 'Anonymous'}</span>
                  <span className="comment-time">{timeAgo(comment.createdAt)}</span>
                </div>
                <p className="comment-text">{comment.text}</p>
              </div>
              {user && (user.id || user._id) === (comment.user?._id || comment.user?.id) && (
                <button
                  className="comment-delete"
                  onClick={() => handleDelete(comment._id)}
                  disabled={deleting === comment._id}
                  title="Delete"
                >
                  {deleting === comment._id ? <FaSpinner className="spinner-sm" /> : <FaTrash size={12} />}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="no-comments" data-testid="no-comments">
          <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.3 }}>💬</div>
          <p>No comments yet. Be the first to share your thoughts!</p>
        </div>
      )}
    </div>
  );
};

export default CommentSection;