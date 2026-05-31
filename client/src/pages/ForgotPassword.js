import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import api from '../services/api';
import { FaEnvelope, FaPaperPlane, FaArrowLeft } from 'react-icons/fa';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) return toast.error('Please enter your email');
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (error) {
      toast.error('Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
        {sent ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16, animation: 'scaleIn 0.3s ease-out' }}>📧</div>
            <h1>Check Your Email</h1>
            <p className="auth-subtitle">
              We've sent a password reset link to<br />
              <strong>{email}</strong>
            </p>
            <p style={{ fontSize: 13, color: 'var(--td-text-tertiary)', marginBottom: 24 }}>
              Didn't receive it? Check your spam folder or{' '}
              <button onClick={() => setSent(false)} style={{ color: 'var(--td-primary)', fontWeight: 600, background: 'none', border: 'none' }}>
                try again
              </button>
            </p>
            <Link to="/login" className="btn btn-primary btn-block">
              <FaArrowLeft /> Back to Login
            </Link>
          </div>
        ) : (
          <>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🔐</div>
              <h1>Forgot Password?</h1>
              <p className="auth-subtitle">No worries! Enter your email and we'll send you a reset link.</p>
            </div>
            <form className="auth-form" onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <div style={{ position: 'relative' }}>
                  <FaEnvelope style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--td-text-tertiary)' }} />
                  <input type="email" className="form-input" placeholder="you@example.com" value={email}
                    onChange={(e) => setEmail(e.target.value)} style={{ paddingLeft: 36 }} required />
                </div>
              </div>
              <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
                {loading ? <><span className="spinner spinner-sm" /> Sending...</> : <><FaPaperPlane /> Send Reset Link</>}
              </button>
            </form>
            <div className="auth-footer">
              <Link to="/login"><FaArrowLeft style={{ marginRight: 6 }} /> Back to Login</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ForgotPassword;