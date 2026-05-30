import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import api from '../services/api';

const Login = () => {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const googleBtnRef = useRef(null);
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState('');

  useEffect(() => {
    if (user) navigate('/feed');
  }, [user, navigate]);

  // Google Sign-In (works on all platforms via Google Identity Services)
  useEffect(() => {
    // Load Google Identity Services script
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);

    script.onload = () => {
      if (window.google && googleBtnRef.current) {
        window.google.accounts.id.initialize({
          client_id: process.env.REACT_APP_GOOGLE_CLIENT_ID || '487607537714-b2tnckkbnbkona6he8eju37al9k8j8vb.apps.googleusercontent.com',
          callback: handleGoogleSignIn,
          ux_mode: 'popup',
        });
        window.google.accounts.id.renderButton(
          googleBtnRef.current,
          { theme: 'outline', size: 'large', text: 'continue_with', width: 350 }
        );
      }
    };

    return () => {
      document.body.removeChild(script);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGoogleSignIn = async (response) => {
    try {
      const res = await api.post('/auth/google', {
        idToken: response.credential,
        email: '', // Will be extracted from token on server
        name: '',
      });
      const { token, user: userData } = res.data;
      localStorage.setItem('token', token);
      toast.success(`Welcome ${userData.name}!`);
      navigate('/feed');
      window.location.reload();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Google sign-in failed');
    }
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.email || !formData.password) {
      toast.error('Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      const res = await api.post('/auth/login', formData);
      const { token, user: userData } = res.data;
      localStorage.setItem('token', token);
      toast.success(`Welcome back, ${userData.name}!`);
      navigate('/feed');
      window.location.reload();
    } catch (error) {
      const data = error.response?.data;
      if (data?.needsVerification) {
        setNeedsVerification(true);
        setVerificationEmail(data.email);
        toast.error('Please verify your email before logging in.');
      } else {
        toast.error(data?.message || 'Login failed');
      }
    }
    setLoading(false);
  };

  const resendVerification = async () => {
    try {
      await api.post('/auth/resend-verification', { email: verificationEmail });
      toast.success('Verification email resent! Check your inbox.');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to resend');
    }
  };

  return (
    <div className="auth-page">
      <div className="login-card">
        <div className="auth-form">
          <h1>Welcome Back</h1>
          <p className="auth-subtitle">Sign in to continue buying and selling</p>

          {needsVerification && (
            <div style={{
              background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8,
              padding: 16, marginBottom: 20, fontSize: 14, textAlign: 'center',
            }}>
              <strong>Email not verified!</strong>
              <p style={{ margin: '8px 0', color: '#92400e' }}>
                Please check your inbox for the verification email.
              </p>
              <button
                className="btn btn-sm"
                onClick={resendVerification}
                style={{ background: '#f59e0b', color: '#fff', border: 'none', padding: '8px 16', borderRadius: 6, cursor: 'pointer' }}
              >
                Resend Verification Email
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="your@email.com"
              required
              className="form-input"
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="••••••••"
              required
              className="form-input"
            />
          </div>
          {/* Centered Sign‑In button placed below the password field */}
          <button type="submit" className="btn btn-primary btn-lg btn-center" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
          </form>

          <div className="auth-divider">
            <span>or continue with</span>
          </div>

          {/* Google Sign-In Button */}
          <div ref={googleBtnRef} style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}></div>

          <p className="auth-link">
            Don't have an account? <Link to="/register">Sign up</Link>
          </p>
          <p className="auth-link">
            <Link to="/forgot-password">Forgot password?</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;