import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import api from '../services/api';
import { formatPrice } from '../utils/helpers';
import { toast } from 'react-toastify';
import { FaCamera, FaUpload, FaRulerHorizontal, FaTimes, FaHistory, FaMagic } from 'react-icons/fa';
import { isNative, requestCameraPermission } from '../services/native';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

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
  const [nativePhoto, setNativePhoto] = useState(null); // File from native camera for upload/save
  const [cameraError, setCameraError] = useState(null); // 'denied' | 'nodevice' | 'busy' | null
  // Heuristic availability: null = unknown (assume available, let getUserMedia decide),
  // true = devices seen, false = user has no camera hardware at all.
  const [cameraAvailable, setCameraAvailable] = useState(null);
  const [settings, setSettings] = useState(null);
  const streamRef = useRef(null);

  // Non-blocking hint: enumerate devices (labels need prior permission, so an
  // empty list is NOT proof of no camera). Only ever downgrade to false;
  // never set an error here — the real check happens in startCamera.
  const refreshDevices = async () => {
    try {
      if (!isNative() && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter((d) => d.kind === 'videoinput');
        // Only trust a POSITIVE signal. Empty/label-less lists happen when
        // permission hasn't been granted yet (Chrome/Safari hide devices).
        if (cams.length > 0) setCameraAvailable(true);
      }
    } catch { /* best-effort hint only */ }
  };

  useEffect(() => {
    fetchSettings();
    refreshDevices();
    let onChange = null;
    try {
      if (!isNative() && navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        onChange = () => refreshDevices();
        navigator.mediaDevices.addEventListener('devicechange', onChange);
      }
    } catch { /* older Safari */ }
    if (listingId) {
      fetchListing(listingId);
    }
    if (user) {
      fetchTryOnHistory();
    }
    return () => {
      try {
        if (onChange && navigator.mediaDevices && navigator.mediaDevices.removeEventListener) {
          navigator.mediaDevices.removeEventListener('devicechange', onChange);
        }
      } catch { /* noop */ }
    };
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
      // Server wraps in { listing, similar } — ListingDetail uses
      // res.data.listing; this page previously stored the wrapper itself.
      setListing(res.data?.listing || res.data);
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

  const startNativeCamera = async () => {
    // Explicitly trigger the OS camera permission prompt first so the user
    // sees a real allow/deny dialog on iOS + Android (user-gesture context).
    const perm = await requestCameraPermission();
    if (perm === 'denied') {
      setCameraError('denied');
      toast.error('Camera permission denied. Please enable it in Settings or use upload instead.');
      setSelectedTab('upload');
      return;
    }
    try {
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        // CAMERA source opens the device camera directly (= "try actually").
        // Prompt lets the user choose camera vs gallery on iOS/Android.
        source: CameraSource.Prompt,
        quality: 85,
        allowEditing: false,
        saveToGallery: false,
      });
      if (!photo || !photo.dataUrl) return; // user cancelled
      const file = dataUrlToFile(photo.dataUrl, `tryon-${Date.now()}.jpg`);
      setCapturedImage(photo.dataUrl);
      setNativePhoto(file);
      setCameraError(null);
    } catch (err) {
      if (err && err.message && /cancel|cancelled|dismissed/i.test(err.message)) return;
      setCameraError('denied');
      toast.error('Could not open the camera. Please use upload instead.');
      setSelectedTab('upload');
    }
  };

  const startCamera = async () => {
    setCameraError(null);
    // Native iOS/Android apps: Capacitor Camera opens the real device
    // camera with its OS permission dialog — getUserMedia does NOT work
    // reliably inside the WebView.
    if (isNative()) {
      await startNativeCamera();
      return;
    }
    // Web: feature-detect first so insecure contexts / old browsers fall
    // back to upload instead of hanging on a silent failure.
    // NOTE: do NOT gate on enumerateDevices() here — before permission is
    // granted browsers return an empty device list (privacy), which caused
    // the false "No camera found" on real laptops. getUserMedia is the
    // source of truth. Browsers also require a secure origin (HTTPS, localhost,
    // file://) for getUserMedia, so check that lazily — when the user actually
    // pushes the camera button — so the page still works on plain HTTP for
    // normal browsing, and only reveal the HTTPS outcome at that moment
    // (network-isolated previews/stripping can make even localhost look insecure).
    if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      setCameraError('nodevice');
      toast.error('Live camera needs a secure connection (HTTPS or localhost). Please use upload instead.');
      setSelectedTab('upload');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('nodevice');
      toast.error('Live camera is not available in this browser or network context. Please use upload instead.');
      setSelectedTab('upload');
      return;
    }
    // NOTE: facingMode must be `ideal`, not exact — desktop webcams (e.g.
    // MacBook FaceTime camera) report no facing, and exact 'user' throws
    // OverconstrainedError which looks like "no camera". Also relax width/height
    // to ideal in case the environment rejects any specific constraint.
    const primary = { video: { facingMode: { ideal: 'user' }, width: { ideal: 1080 }, height: { ideal: 720 } }, audio: false };
    const openStream = async (constraints) => {
      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = mediaStream;
      setStream(mediaStream);
      setCameraActive(true);
      setCameraAvailable(true);
      setCameraError(null);
      refreshDevices();
    };
    try {
      await openStream(primary);
    } catch (error) {
      const name = error && error.name;
      // Retry once with bare constraints before concluding anything — this
      // recovers Safari/Chrome where a specific constraint is unsupported
      // even though a camera exists.
      if (name === 'OverconstrainedError' || name === 'NotFoundError') {
        try {
          await openStream({ video: true, audio: false });
          return;
        } catch (retryErr) {
          error = retryErr;
        }
      }
      const n2 = error && error.name;
      if (n2 === 'NotAllowedError' || n2 === 'SecurityError') {
        setCameraError('denied');
        toast.error('Camera access denied. Allow camera permission or use upload instead.');
      } else if (n2 === 'NotFoundError' || n2 === 'OverconstrainedError') {
        setCameraError('nodevice');
        toast.error('No camera found on this device. Please use upload instead.');
      } else if (n2 === 'NotReadableError' || n2 === 'AbortError') {
        setCameraError('busy');
        toast.error('Camera is busy (another app may be using it). Close other apps and retry, or use upload.');
      } else {
        setCameraError('denied');
        toast.error('Could not start the camera. Please use upload instead.');
      }
    }
  };

  const stopCamera = () => {
    const s = streamRef.current || stream;
    if (s) {
      s.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setStream(null);
    }
    setCameraActive(false);
  };

  // Attach the live stream whenever it becomes available (ref callbacks only
  // run on mount, so a state-only change would otherwise leave video black).
  useEffect(() => {
    const el = streamRef.current || stream; // video element not used for srcObject here
    const str = streamRef.current || stream;
    if (str) { /* stream tracking only */ }
  }, [stream, cameraActive]);

  // Stop the live stream if the user leaves the page/mode.
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const dataUrlToFile = (dataUrl, filename) => {
    try {
      const arr = dataUrl.split(',');
      const mimeMatch = arr[0].match(/:(.*?);/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) u8arr[n] = bstr.charCodeAt(n);
      return new File([u8arr], filename, { type: mime });
    } catch {
      return null;
    }
  };

  const capturePhoto = () => {
    if (!stream && !streamRef.current) return;

    const video = document.getElementById('vt-camera-video');
    const canvas = document.getElementById('vt-camera-canvas');
    if (video && canvas) {
      const ctx = canvas.getContext('2d');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imageData = canvas.toDataURL('image/jpeg', 0.8);
      setCapturedImage(imageData);
      setNativePhoto(dataUrlToFile(imageData, `tryon-${Date.now()}.jpg`));
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
      const photoFile = nativePhoto; // File when photo came from the native device camera
      const res = await api.post('/virtual-try-on/session', {
        listingId: listingId || (listing && listing._id),
        sessionType: capturedImage ? 'camera' : 'ar',
        measurements: Object.values(measurements).some(v => v) ? measurements : undefined,
        hasUserPhoto: Boolean(capturedImage || photoFile),
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
          <Link
            to="/login"
            state={{ from: listingId ? '/virtual-try-on/' + listingId : '/virtual-try-on' }}
            className="btn btn-primary"
          >
            Login
          </Link>
          {listingId && (
            <div style={{ marginTop: 12 }}>
              <Link to={'/listing/' + listingId} className="btn btn-outline btn-sm">Back to listing</Link>
            </div>
          )}
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
                muted
                ref={(el) => { if (el && (streamRef.current || stream)) el.srcObject = streamRef.current || stream; }}
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
                <button className="btn btn-secondary" onClick={() => { setCapturedImage(null); setNativePhoto(null); startCamera(); }}>
                  Retake
                </button>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 'var(--td-space-xl)' }}>
              <FaCamera size={48} style={{ opacity: 0.5, marginBottom: 'var(--td-space-md)' }} />
              <p>Click to start camera for AR try-on experience</p>
              <button className="btn btn-primary" onClick={startCamera} data-testid="vt-start-camera">
                <FaCamera /> {isNative() ? 'Open Camera' : 'Start Camera'}
              </button>
            {cameraError === 'denied' && (
              <div className="alert alert-warning" style={{ marginTop: 12, textAlign: 'left' }}>
                <strong>Camera blocked.</strong> Use Upload instead or enable camera access.
                <div style={{ marginTop: 8 }}>
                  <button onClick={() => setSelectedTab('upload')} className="btn btn-outline btn-sm">
                    <FaUpload /> Use Upload Instead
                  </button>
                </div>
              </div>
            )}
            {cameraError === 'busy' && (
            <div className="alert alert-warning" style={{ marginTop: 'var(--td-space-md)', textAlign: 'left' }}>
              <strong>Camera is busy.</strong> Another app (FaceTime, Zoom, etc.) may be using it.
              Close other apps and try again — or use Upload.
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button onClick={startCamera} className="btn btn-outline btn-sm">
                  <FaCamera /> Retry Camera
                </button>
                <button onClick={() => setSelectedTab('upload')} className="btn btn-outline btn-sm">
                  <FaUpload /> Use Upload Instead
                </button>
              </div>
            </div>
          )}
          {cameraError === 'nodevice' && (
              <div className="alert alert-warning" style={{ marginTop: 12, textAlign: 'left' }}>
                <strong>No camera found</strong> on this device. Please use Upload instead.
                <div style={{ marginTop: 8 }}>
                  <button onClick={() => setSelectedTab('upload')} className="btn btn-outline btn-sm">
                    <FaUpload /> Use Upload Instead
                  </button>
                </div>
              </div>
            )}
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