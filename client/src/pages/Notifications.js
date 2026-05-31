import { defaultAvatar } from "../utils/helpers";
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FaHeart, FaComment, FaUserPlus, FaTag, FaShoppingBag, FaShareAlt, FaBell, FaCheck, FaEnvelope, FaDollarSign, FaStar } from 'react-icons/fa';
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
    } catch (error) { console.error(error); }
    setLoading(false);
  };

  const markAllRead = async () => {
    try {
      await api.put(`/users/${user.id || user._id}/notifications/read`);
      setNotifications(notifications.map(n => ({ ...n, read: true })));
      toast.success('All notifications marked as read');
    } catch (error) { toast.error('Failed to mark as read'); }
  };

  const getIcon = (type) => {
    switch (type) {
      case 'like': return <FaHeart size={16} />;
      case 'comment': return <FaComment size={16} />;
      case 'follow': return <FaUserPlus size={16} />;
      case 'offer': return <FaTag size={16} />;
      case 'sale': return <FaShoppingBag size={16} />;
      case 'share': return <FaShareAlt size={16} />;
      case 'purchase': return <FaDollarSign size={16} />;
      case 'shipping': return <FaEnvelope size={16} />;
      case 'review': return <FaStar size={16} />;
      default: return <FaBell size={16} />;
    }
  };

  const getIconColor = (type) => {
    const colors = { like: '#FF385C', comment: '#2979FF', follow: '#00BCD4', offer: '#FF9100', sale: '#00C853', share: '#6C63FF', purchase: '#00C853', shipping: '#2979FF', review: '#FFD700' };
    return colors[type] || '#8E8EA0';
  };

  const getNotificationLink = (notification) => {
    switch (notification.type) {
      case 'follow': return `/profile/${notification.from?._id || notification.from}`;
      case 'like': case 'comment': case 'offer': case 'sale': case 'share':
        return `/listing/${notification.listing?._id}`;
      default: return '#';
    }
  };

  if (!user) return (
    <div className="page-container">
      <div className="empty-state">
        <div className="empty-state-icon">🔔</div>
        <h2>Notifications</h2>
        <p>Sign in to view your notifications</p>
        <Link to="/login" className="btn btn-primary btn-lg">Sign In</Link>
      </div>
    </div>
  );

  if (loading) return (
    <div className="page-container">
      <h1 className="page-title">Notifications</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 72, borderRadius: 'var(--td-radius-sm)' }} />
        ))}
      </div>
    </div>
  );

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="page-container">
      <div className="flex-between" style={{ marginBottom: 'var(--td-space-lg)' }}>
        <h1 className="page-title" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
          <FaBell /> Notifications
          {unreadCount > 0 && <span className="badge badge-primary">{unreadCount}</span>}
        </h1>
        {unreadCount > 0 && (
          <button className="btn btn-sm btn-outline" onClick={markAllRead}><FaCheck size={12} /> Mark All Read</button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="empty-state" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
          <div className="empty-state-icon">🔔</div>
          <h2>No notifications yet</h2>
          <p>When someone interacts with your listings, you'll see it here.</p>
          <Link to="/feed" className="btn btn-primary">Browse Listings</Link>
        </div>
      ) : (
        <div className="notifications-list" style={{ animation: 'fadeInUp 0.3s ease-out' }}>
          {notifications.map((notification, i) => (
            <Link key={notification._id} to={getNotificationLink(notification)}
              className={`notification-item ${!notification.read ? 'unread' : ''}`}
              style={{ animationDelay: `${i * 0.03}s`, animation: 'fadeInUp 0.3s ease-out both' }}>
              <div className="notification-icon" style={{ background: `${getIconColor(notification.type)}15`, color: getIconColor(notification.type) }}>
                {getIcon(notification.type)}
              </div>
              <div className="notification-content">
                <div className="notification-message">
                  <img src={notification.from?.avatar || defaultAvatar} alt="" className="notification-avatar" />
                  <p>{notification.message}</p>
                </div>
                <span className="notification-time">{moment(notification.createdAt).fromNow()}</span>
              </div>
              {notification.listing?.images?.[0] && (
                <img src={notification.listing.images[0]} alt="" className="notification-listing-image" />
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default Notifications;