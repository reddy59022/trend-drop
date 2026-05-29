import { defaultAvatar } from "../utils/helpers";
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FaHeart, FaComment, FaUserPlus, FaTag, FaShoppingBag, FaShareAlt } from 'react-icons/fa';
import moment from 'moment';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';

const Notifications = () => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    fetchNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fetchNotifications = async () => {
    try {
      const res = await api.get(`/users/${user.id || user._id}/notifications`);
      setNotifications(res.data || []);
    } catch (error) {
      console.error(error);
    }
    setLoading(false);
  };

  const markAllRead = async () => {
    try {
      await api.put(`/users/${user.id || user._id}/notifications/read`);
      setNotifications(notifications.map(n => ({ ...n, read: true })));
      toast.success('All notifications marked as read');
    } catch (error) {
      toast.error('Failed to mark as read');
    }
  };

  const getIcon = (type) => {
    switch (type) {
      case 'like': return <FaHeart style={{ color: '#E24455' }} />;
      case 'comment': return <FaComment style={{ color: '#45B7D1' }} />;
      case 'follow': return <FaUserPlus style={{ color: '#4ECDC4' }} />;
      case 'offer': return <FaTag style={{ color: '#FF8C42' }} />;
      case 'sale': return <FaShoppingBag style={{ color: '#28a745' }} />;
      case 'share': return <FaShareAlt style={{ color: '#98D8C8' }} />;
      default: return <FaHeart />;
    }
  };

  const getNotificationLink = (notification) => {
    switch (notification.type) {
      case 'follow':
        return `/profile/${notification.from?._id || notification.from}`;
      case 'like':
      case 'comment':
      case 'offer':
      case 'sale':
      case 'share':
        return `/listing/${notification.listing?._id}`;
      default:
        return '#';
    }
  };

  if (!user) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <h2>Notifications</h2>
          <p>Sign in to view your notifications</p>
          <Link to="/login" className="btn btn-primary">Sign In</Link>
        </div>
      </div>
    );
  }

  if (loading) return <div className="page-container"><div className="spinner"></div></div>;

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="page-container">
      <div className="notifications-header">
        <h1 className="page-title">Notifications</h1>
        {unreadCount > 0 && (
          <button className="btn btn-sm btn-outline" onClick={markAllRead}>
            Mark All Read ({unreadCount})
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="empty-state">
          <p>No notifications yet</p>
        </div>
      ) : (
        <div className="notifications-list">
          {notifications.map((notification) => (
            <Link
              key={notification._id}
              to={getNotificationLink(notification)}
              className={`notification-item ${!notification.read ? 'unread' : ''}`}
            >
              <div className="notification-icon">
                {getIcon(notification.type)}
              </div>
              <div className="notification-content">
                <div className="notification-message">
                  <img
                    src={notification.from?.avatar || defaultAvatar}
                    alt=""
                    className="notification-avatar"
                  />
                  <p>{notification.message}</p>
                </div>
                <span className="notification-time">
                  {moment(notification.createdAt).fromNow()}
                </span>
              </div>
              {notification.listing?.images?.[0] && (
                <img
                  src={notification.listing.images[0]}
                  alt=""
                  className="notification-listing-image"
                />
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default Notifications;