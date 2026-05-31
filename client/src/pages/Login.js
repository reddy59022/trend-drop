import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import api from '../services/api';
import { FaGoogle, FaEnvelope, FaLock, FaEye, FaEyeSlash } from 'react-icons/fa';

const Login = () => {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (user) navigate('/');
  }, [user, navigate]);

  const handleGoogleLogin = async () => {
    try {
      const res = await api.post('/auth/google');
      if (res.data.token) {
        localStorage.setItem('token', res.data.token);
        window.location.href = '/';
      }
    } catch (error) {
      toast.error('Google login failed');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.email || !formData.password) {
      toast.error('Please fill in all fields');
      return;
    }
    setLoading(true);
    try {
      const data = await login(formData.email, formData.password);
      if (data.needsVerification) {
        setNeedsVerification(true);
        setVerificationEmail(formData.email);
        toast.info('Please verify your email before logging in');
      } else if (data.token) {
        toast.success('Welcome back!');
        navigate('/');
      }
    } catch (error) {
      const msg = error.response?.data?.message || 'Login failed';
      toast.error(msg);
      if (msg.toLowerCase().includes('verify') || error.response?.status === 403) {
        setNeedsVerification(true);
        setVerificationEmail(formData.email);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    try {
      await api.post('/auth/resend-verification', { email: verificationEmail });
      toast.success('Verification email resent!');
    } catch (error) {
      toast.error('Failed to resend verification email');
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
        {needsVerification ? (
          <>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div className="empty-state-icon" style={{ fontSize: 48 }}>📧</div>
              <h1>Verify Your Email</h1>
              <p className="auth-subtitle">
                We sent a verification email to <strong>{verificationEmail}</strong>
              </p>
            </div>
            <button className="btn btn-primary btn-block" onClick={handleResendVerification}>
              Resend Verification Email
            </button>
            <button className="btn btn-ghost btn-block" style={{ marginTop: 12 }} onClick={() => setNeedsVerification(false)}>
              Back to Login
            </button>
          </>
        ) : (
          <>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <svg width="48" height="48" viewBox="0 0 32 32" fill="none" style={{ margin: '0 auto 12px' }}>
                <circle cx="16" cy="16" r="16" fill="#FF385C"/>
                <path d="M10 22V12l6-4 6 4v10H10z" fill="white" opacity="0.9"/>
                <path d="M12 18h8v4h-8z" fill="white"/>
              </svg>
              <h1>Welcome Back</h1>
              <p className="auth-subtitle">Sign in to continue shopping</p>
            </div>

            <form className="auth-form" onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Email</label>
                <div style={{ position: 'relative' }}>
                  <FaEnvelope style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--td-text-tertiary)' }} />
                  <input
                    type="email"
                    className="form-input"
                    placeholder="you@example.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    style={{ paddingLeft: 36 }}
                    required
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <div style={{ position: 'relative' }}>
                  <FaLock style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--td-text-tertiary)' }} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="form-input"
                    placeholder="Enter your password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    style={{ paddingLeft: 36, paddingRight: 36 }}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--td-text-tertiary)', background: 'none', border: 'none' }}
                  >
                    {showPassword ? <FaEyeSlash size={16} /> : <FaEye size={16} />}
                  </button>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <Link to="/forgot-password" style={{ fontSize: 13, color: 'var(--td-primary)', fontWeight: 600 }}>Forgot password?</Link>
              </div>
              <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
                {loading ? <><span className="spinner spinner-sm" /> Signing in...</> : 'Sign In'}
              </button>
            </form>

            <div className="auth-divider">or continue with</div>

            <div className="social-auth-buttons">
              <button className="btn-social" onClick={handleGoogleLogin}>
                <FaGoogle /> Sign in with Google
              </button>
            </div>

            <div className="auth-footer">
              Don't have an account? <Link to="/register">Create one</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Login;