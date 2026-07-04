import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import api from '../services/api';
import { formatPrice } from '../utils/helpers';
import { toast } from 'react-toastify';
import { FaCamera, FaUpload, FaRulerHorizontal, FaCheck, FaTimes, FaHistory, FaMagic } from 'react-icons/fa';

const VirtualTryOn = () => {
  const { user } = useAuth();
  const { currency } = useTheme();
  const navigate = useNavigate();
  const { listingId } = useParams();
  
  const [selectedTab, setSelectedTab] = useState('camera'); // camera, upload, history
  const [listing, setListing] = useState(null);
  const [measurements, setMeasurements] = useState({
    bust: '',
    waist: '',
    hip: '',
    inseam: '',
  });
  const [fitAnalysis, setFitAnalysis] = useState(null);
  const [tryOnHistory, setTryOnHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [stream, setStream] = useState(null);
  const [capturedImage, setCapturedImage] = useState(null);
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    fetchSettings();
    if (listingId) {
      fetchListing(listingId);
    }
    if (user) {
      fetchTryOnHistory();
    }
  }, [listingId, user]);

  const fetchSettings = async () => {
    try {
      const res = await api.get('/virtual-try-on/settings');
      setSettings(res.data);
    } catch (error) {
      console.error('Failed to fetch settings', error);
    }
  };

  const fetchListing = async (id) => {
    try {
      const res = await api.get(`/listings/${id}`);
      setListing(res.data);
    } catch (error) {
      toast.error('Listing not found');
      navigate('/');
    }
  };

  const fetchTryOnHistory = async () => {
    try {
      const res = await api.get('/virtual-try-on');
      setTryOnHistory(res.data);
    } catch (error) {
      // No history yet
    }
  };

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: { ideal: 1080 } } 
      });
      setStream(mediaStream);
      setCameraActive(true);
    } catch (error) {
      toast.error('Camera access denied. Please use upload instead.');
      setSelectedTab('upload');
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setCameraActive(false);
  };

  const capturePhoto = () => {
    if (!stream) return;
    
    const video = document.getElementById('vt-camera-video');
    const canvas = document.getElementById('vt-camera-canvas');
    if (video && canvas) {
      const ctx = canvas.getContext('2d');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imageData = canvas.toDataURL('image/jpeg', 0.8);
      setCapturedImage(imageData);
      stopCamera();
    }
  };

  const handleUploadImage = (e) => {
    const file = e.target.files[0];
    if (file && file.size <= (settings?.maxSizeFileSizeMB || 10) * 1024 * 1024) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setCapturedImage(event.target.result);
      };
      reader.readAsDataURL(file);
    } else {
      toast.error('File too large. Maximum size is 10MB.');
    }
  };

  const handleSaveMeasurements = async () => {
    setLoading(true);
    try {
      const res = await api.post('/virtual-try-on/session', {
        listingId: listingId || (listing && listing._id),
        sessionType: capturedImage ? 'camera' : 'ar',
        measurements: Object.values(measurements).some(v => v) ? measurements : undefined,
      });
      setFitAnalysis(res.data.fitAnalysis);
      if (listingId) {
        setListing(res.data.listingId);
      }
      toast.success('Try-on session saved! ✨');
    } catch (error) {
      toast.error('Failed to save try-on session');
    }
    setLoading(false);
  };

  const handleDeleteSession = async (id) => {
    try {
      await api.delete(`/virtual-try-on/${id}`);
      setTryOnHistory(tryOnHistory.filter(item => item._id !== id));
      toast.success('Session removed');
    } catch (error) {
      toast.error('Failed to delete session');
    }
  };

  if (!user) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="empty-state-icon">👗</div>
          <h2>Virtual Try-On</h2>
          <p>Please login to use virtual try-on features.</p>
          <Link to="/login" className="btn btn-primary">Login</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <FaMagic /> Virtual Try-On
      </h1>

      {!listingId && (
        <div className="glass-card" style={{ padding: 'var(--td-space-lg)', marginBottom: 'var(--td-space-lg)' }}>
          <h3 style={{ marginBottom: 'var(--td-space-md)' }}>How it works</h3>
          <p style={{ color: 'var(--td-text-secondary)', marginBottom: 'var(--td-space-md)' }}>
            Our AR-powered virtual try-on helps you visualize how clothes will fit before purchasing.
            Add your measurements for personalized size recommendations.
          </p>
          <div style={{ display: 'flex', gap: 'var(--td-space-md)', flexWrap: 'wrap' }}>
            <span className="badge badge-primary">📱 Camera try-on</span>
            <span className="badge badge-primary">📸 Photo upload</span>
            <span className="badge badge-primary">📏 Size recommendation</span>
          </div>
        </div>
      )}

      <div className="tabs" style={{ marginBottom: 'var(--td-space-lg)' }}>
        <button 
          className={`tab ${selectedTab === 'camera' ? 'active' : ''}`}
          onClick={() => { setSelectedTab('camera'); startCamera(); }}
        >
          <FaCamera /> Camera
        </button>
        <button 
          className={`tab ${selectedTab === 'upload' ? 'active' : ''}`}
          onClick={() => setSelectedTab('upload')}
        >
          <FaUpload /> Upload
        </button>
        <button 
          className={`tab ${selectedTab === 'history' ? 'active' : ''}`}
          onClick={() => setSelectedTab('history')}
        >
          <FaHistory /> History
        </button>
      </div>

      {selectedTab === 'camera' && (
        <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
          {cameraActive ? (
            <div style={{ textAlign: 'center' }}>
              <video 
                id="vt-camera-video"
                autoPlay 
                playsInline 
                style={{ 
                  width: '100%', 
                  maxHeight: '400px', 
                  borderRadius: 'var(--td-radius-md)',
                  marginBottom: 'var(--td-space-md)'
                }}
              />
              <canvas id="vt-camera-canvas" style={{ display: 'none' }} />
              <div style={{ display: 'flex', gap: 'var(--td-space-md)', justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={capturePhoto}>
                  Capture
                </button>
                <button className="btn btn-secondary" onClick={stopCamera}>
                  <FaTimes /> Cancel
                </button>
              </div>
            </div>
          ) : capturedImage ? (
            <div style={{ textAlign: 'center' }}>
              <img 
                src={capturedImage} 
                alt="Captured" 
                style={{ 
                  maxWidth: '100%', 
                  maxHeight: '300px',
                  borderRadius: 'var(--td-radius-md)',
                  marginBottom: 'var(--td-space-md)'
                }}
              />
              <div style={{ display: 'flex', gap: 'var(--td-space-md)', justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={handleSaveMeasurements} disabled={loading}>
                  {loading ? 'Saving...' : 'Save Try-On'}
                </button>
                <button className="btn btn-secondary" onClick={() => { setCapturedImage(null); startCamera(); }}>
                  Retake
                </button>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 'var(--td-space-xl)' }}>
              <FaCamera size={48} style={{ opacity: 0.5, marginBottom: 'var(--td-space-md)' }} />
              <p>Click to start camera for AR try-on experience</p>
              <button className="btn btn-primary" onClick={startCamera}>
                Start Camera
              </button>
            </div>
          )}
        </div>
      )}

      {selectedTab === 'upload' && (
        <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
          <div className="form-group" style={{ marginBottom: 'var(--td-space-lg)' }}>
            <label className="form-label">Upload Photo</label>
            <input 
              type="file" 
              accept="image/*" 
              onChange={handleUploadImage}
              className="form-input"
              style={{ padding: 'var(--td-space-md)' }}
            />
            <small style={{ color: 'var(--td-text-secondary)' }}>
              Max size: {settings?.maxSizeFileSizeMB || 10}MB
            </small>
          </div>

          {capturedImage && (
            <div style={{ textAlign: 'center', marginBottom: 'var(--td-space-lg)' }}>
              <img 
                src={capturedImage} 
                alt="Uploaded" 
                style={{ 
                  maxWidth: '100%', 
                  maxHeight: '300px',
                  borderRadius: 'var(--td-radius-md)'
                }}
              />
            </div>
          )}

          <div className="form-group" style={{ marginBottom: 'var(--td-space-md)' }}>
            <h4 style={{ marginBottom: 'var(--td-space-sm)' }}>Measurements (optional)</h4>
            <div className="form-grid">
              <div>
                <label className="form-label">Bust (in)</label>
                <input
                  type="number"
                  className="form-input"
                  value={measurements.bust}
                  onChange={e => setMeasurements({...measurements, bust: e.target.value})}
                  placeholder="34"
                  step="0.5"
                />
              </div>
              <div>
                <label className="form-label">Waist (in)</label>
                <input
                  type="number"
                  className="form-input"
                  value={measurements.waist}
                  onChange={e => setMeasurements({...measurements, waist: e.target.value})}
                  placeholder="26"
                  step="0.5"
                />
              </div>
              <div>
                <label className="form-label">Hip (in)</label>
                <input
                  type="number"
                  className="form-input"
                  value={measurements.hip}
                  onChange={e => setMeasurements({...measurements, hip: e.target.value})}
                  placeholder="36"
                  step="0.5"
                />
              </div>
              <div>
                <label className="form-label">Inseam (in)</label>
                <input
                  type="number"
                  className="form-input"
                  value={measurements.inseam}
                  onChange={e => setMeasurements({...measurements, inseam: e.target.value})}
                  placeholder="32"
                  step="0.5"
                />
              </div>
            </div>
          </div>

          <button 
            className="btn btn-primary" 
            onClick={handleSaveMeasurements} 
            disabled={loading || !capturedImage}
          >
            {loading ? 'Saving...' : 'Save Try-On'}
          </button>
        </div>
      )}

      {selectedTab === 'history' && (
        <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
          <h3 style={{ marginBottom: 'var(--td-space-md)' }}>Your Try-On History</h3>
          
          {tryOnHistory.length === 0 ? (
            <div className="empty-state">
              <p>No try-on sessions yet. Try using the camera or upload feature!</p>
            </div>
          ) : (
            <div className="listing-grid">
              {tryOnHistory.map(session => (
                <div key={session._id} className="listing-card" style={{ position: 'relative' }}>
                  {session.listingId?.images?.[0] && (
                    <img 
                      src={session.listingId.images[0]} 
                      alt={session.listingId.title}
                      className="listing-card-image"
                    />
                  )}
                  <div className="listing-card-content">
                    <h4 className="listing-card-title">{session.listingId?.title}</h4>
                    <p className="listing-card-price">
                      {formatPrice(session.listingId?.price || 0, currency)}
                    </p>
                    {session.fitAnalysis?.recommendedSize && (
                      <div style={{ marginTop: 'var(--td-space-sm)' }}>
                        <span className="badge badge-success">
                          Size: {session.fitAnalysis.recommendedSize}
                        </span>
                        <span className="badge" style={{ marginLeft: 'var(--td-space-xs)' }}>
                          Confidence: {session.fitAnalysis.confidenceScore}%
                        </span>
                      </div>
                    )}
                    <button 
                      onClick={() => handleDeleteSession(session._id)}
                      className="btn btn-secondary"
                      style={{ 
                        position: 'absolute', 
                        top: 'var(--td-space-sm)', 
                        right: 'var(--td-space-sm)',
                        padding: 'var(--td-space-xs)'
                      }}
                    >
                      <FaTimes />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {fitAnalysis && selectedTab !== 'history' && (
        <div className="glass-card" style={{ 
          marginTop: 'var(--td-space-lg)', 
          padding: 'var(--td-space-lg)',
          background: 'linear-gradient(135deg, var(--td-primary), var(--td-secondary))',
          color: '#fff'
        }}>
          <h3 style={{ marginBottom: 'var(--td-space-md)' }}>
            <FaRulerHorizontal /> Fit Analysis
          </h3>
          <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 'var(--td-space-sm)' }}>
            Recommended Size: {fitAnalysis.recommendedSize}
          </div>
          <div style={{ fontSize: 16, opacity: 0.9, marginBottom: 'var(--td-space-md)' }}>
            Confidence Score: {fitAnalysis.confidenceScore}%
          </div>
          {fitAnalysis.fitNotes?.map((note, i) => (
            <div key={i} style={{ fontSize: 14, opacity: 0.8 }}>
              • {note}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default VirtualTryOn;