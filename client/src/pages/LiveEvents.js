import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { FaVideo, FaCalendarAlt, FaUsers, FaTag, FaPlay, FaClock, FaChartBar, FaPlus } from 'react-icons/fa';
import api from '../services/api';

const LiveEvents = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('upcoming');
  const [myEvents, setMyEvents] = useState([]);
  const [liveEvents, setLiveEvents] = useState([]);
  const [eventStats, setEventStats] = useState({
    totalEvents: 0,
    liveEvents: 0,
    totalViewers: 0,
  });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newEvent, setNewEvent] = useState({
    title: '',
    description: '',
    listingIds: [],
    startTime: '',
    endTime: '',
    discount: 10,
    maxViewers: 100,
  });

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    fetchData();
  }, [user, navigate, activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'upcoming') {
        const res = await api.get('/live-events/upcoming');
        setMyEvents(res.data || []);
      } else if (activeTab === 'live') {
        const res = await api.get('/live-events?status=live');
        setLiveEvents(res.data?.events || []);
      } else if (activeTab === 'stats') {
        const res = await api.get(`/live-events/stats/${user._id}`);
        setEventStats(res.data || {});
      }
    } catch (error) {
      console.error('Error fetching live events data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    try {
      const eventData = {
        ...newEvent,
        startTime: new Date(newEvent.startTime),
        endTime: new Date(newEvent.endTime),
        listingIds: newEvent.listingIds.map(id => id.trim()).filter(Boolean),
      };
      await api.post('/live-events', eventData);
      setShowCreateModal(false);
      setNewEvent({
        title: '',
        description: '',
        listingIds: [],
        startTime: '',
        endTime: '',
        discount: 10,
        maxViewers: 100,
      });
      fetchData();
    } catch (error) {
      console.error('Error creating event:', error);
    }
  };

  const handleJoinEvent = async (eventId) => {
    try {
      await api.post(`/live-events/${eventId}/join`);
      fetchData();
    } catch (error) {
      console.error('Error joining event:', error);
    }
  };

  const formatDateTime = (date) => {
    return new Date(date).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="page-container" style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div className="skeleton" style={{ height: 60, borderRadius: 'var(--td-radius-lg)', marginBottom: 20 }} />
        <div className="skeleton" style={{ height: 400, borderRadius: 'var(--td-radius-lg)' }} />
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 12, margin: 0 }}>
          <FaVideo /> Live Shopping Events
        </h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <FaPlus /> Host Event
        </button>
      </div>

      {/* Tabs */}
      <div className="glass-card" style={{ padding: 4, marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => setActiveTab('upcoming')}
            className={`btn ${activeTab === 'upcoming' ? 'btn-primary' : 'btn-outline'}`}
            style={{ flex: 1 }}
          >
            <FaCalendarAlt /> My Events
          </button>
          <button
            onClick={() => setActiveTab('live')}
            className={`btn ${activeTab === 'live' ? 'btn-primary' : 'btn-outline'}`}
            style={{ flex: 1 }}
          >
            <FaPlay /> Live Now
          </button>
          <button
            onClick={() => setActiveTab('stats')}
            className={`btn ${activeTab === 'stats' ? 'btn-primary' : 'btn-outline'}`}
            style={{ flex: 1 }}
          >
            <FaChartBar /> Statistics
          </button>
        </div>
      </div>

      {/* Upcoming Events Tab */}
      {activeTab === 'upcoming' && (
        <div>
          {myEvents.length === 0 ? (
            <div className="empty-state" style={{ padding: 'var(--td-space-xl)' }}>
              <div className="empty-state-icon">📅</div>
              <h3>No upcoming events</h3>
              <p>Create your first live shopping event to showcase your items to buyers</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {myEvents.map(event => (
                <div key={event._id} className="glass-card" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <h3 style={{ margin: 0 }}>{event.title}</h3>
                      <p style={{ color: 'var(--td-text-secondary)', fontSize: 14, margin: '4px 0' }}>
                        {event.description}
                      </p>
                    </div>
                    <span className={`badge ${event.status === 'live' ? 'badge-success' : 'badge-outline'}`}>
                      {event.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 24, fontSize: 14, color: 'var(--td-text-tertiary)' }}>
                    <span><FaClock /> {formatDateTime(event.startTime)}</span>
                    <span><FaUsers /> {event.viewers?.length || 0} viewers</span>
                    {event.discount > 0 && <span><FaTag /> {event.discount}% off</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Live Events Tab */}
      {activeTab === 'live' && (
        <div>
          {liveEvents.length === 0 ? (
            <div className="empty-state" style={{ padding: 'var(--td-space-xl)' }}>
              <div className="empty-state-icon">🔴</div>
              <h3>No live events right now</h3>
              <p>Check back later for live shopping events from your favorite sellers</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {liveEvents.map(event => (
                <div key={event._id} className="glass-card" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <h3 style={{ margin: 0 }}>{event.title}</h3>
                      <p style={{ color: 'var(--td-text-secondary)', fontSize: 14, margin: '4px 0' }}>
                        Hosted by: {event.host?.name}
                      </p>
                    </div>
                    <span className="badge badge-success">LIVE</span>
                  </div>
                  <div style={{ display: 'flex', gap: 24, fontSize: 14, color: 'var(--td-text-tertiary)', marginBottom: 12 }}>
                    <span><FaUsers /> {event.viewers?.length || 0} watching</span>
                    {event.discount > 0 && <span><FaTag /> {event.discount}% off</span>}
                  </div>
                  <button
                    onClick={() => handleJoinEvent(event._id)}
                    className="btn btn-primary btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <FaPlay /> Join Event
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stats Tab */}
      {activeTab === 'stats' && (
        <div>
          <div className="glass-card" style={{ padding: 24, marginBottom: 24 }}>
            <h3 style={{ marginBottom: 16 }}>Your Live Event Statistics</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--td-primary)' }}>
                  {eventStats.totalEvents}
                </div>
                <div style={{ fontSize: 14, color: 'var(--td-text-secondary)' }}>Total Events</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--td-success)' }}>
                  {eventStats.liveEvents}
                </div>
                <div style={{ fontSize: 14, color: 'var(--td-text-secondary)' }}>Live Events</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--td-info)' }}>
                  {eventStats.totalViewers}
                </div>
                <div style={{ fontSize: 14, color: 'var(--td-text-secondary)' }}>Total Viewers</div>
              </div>
            </div>
          </div>

          <div className="glass-card" style={{ padding: 24 }}>
            <h3>Tips for Successful Live Events</h3>
            <ul style={{ paddingLeft: 20, color: 'var(--td-text-secondary)' }}>
              <li>Schedule events in advance and promote on social media</li>
              <li>Showcase popular items and exclusive discounts</li>
              <li>Engage with viewers by answering questions in real-time</li>
              <li>Keep events between 30-60 minutes for optimal engagement</li>
            </ul>
          </div>
        </div>
      )}

      {/* Create Event Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content glass-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Create Live Shopping Event</h2>
              <button className="modal-close btn btn-icon btn-ghost" onClick={() => setShowCreateModal(false)}>
                ×
              </button>
            </div>
            <form onSubmit={handleCreateEvent}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Event Title</label>
                  <input
                    type="text"
                    value={newEvent.title}
                    onChange={e => setNewEvent({...newEvent, title: e.target.value})}
                    className="form-input"
                    required
                    placeholder="Summer Collection Live"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <textarea
                    value={newEvent.description}
                    onChange={e => setNewEvent({...newEvent, description: e.target.value})}
                    className="form-textarea"
                    placeholder="Describe what you'll showcase in this event"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Listing IDs (comma separated)</label>
                  <input
                    type="text"
                    value={newEvent.listingIds.join(', ')}
                    onChange={e => setNewEvent({...newEvent, listingIds: e.target.value.split(',')})}
                    className="form-input"
                    placeholder="64a1b2c3d4e5f6..., 64a1b2c3d4e5f7..."
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Start Time</label>
                    <input
                      type="datetime-local"
                      value={newEvent.startTime}
                      onChange={e => setNewEvent({...newEvent, startTime: e.target.value})}
                      className="form-input"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">End Time</label>
                    <input
                      type="datetime-local"
                      value={newEvent.endTime}
                      onChange={e => setNewEvent({...newEvent, endTime: e.target.value})}
                      className="form-input"
                      required
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Discount % (optional)</label>
                    <input
                      type="number"
                      min="0"
                      max="50"
                      value={newEvent.discount}
                      onChange={e => setNewEvent({...newEvent, discount: Number(e.target.value)})}
                      className="form-input"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Max Viewers</label>
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      value={newEvent.maxViewers}
                      onChange={e => setNewEvent({...newEvent, maxViewers: Number(e.target.value)})}
                      className="form-input"
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn btn-outline">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create Event
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveEvents;