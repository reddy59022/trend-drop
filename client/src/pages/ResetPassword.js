import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FaArrowLeft, FaLock } from 'react-icons/fa';
import api from '../services/api';

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');

    const token = searchParams.get('token');
    if (!token) {
      setError('This password reset link is invalid or incomplete.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmation) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const response = await api.post('/auth/reset-password', { token, password });
      setMessage(response.data?.message || 'Password reset successful.');
      setPassword('');
      setConfirmation('');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to reset your password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
        {message ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔐</div>
            <h1>Password Reset Successful</h1>
            <p className="auth-subtitle">{message}</p>
            <Link to="/login" className="btn btn-primary btn-block"><FaArrowLeft /> Back to Login</Link>
          </div>
        ) : (
          <>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🔐</div>
              <h1>Reset Your Password</h1>
              <p className="auth-subtitle">Choose a new password for your TrendDrop account.</p>
            </div>
            {error && <div role="alert" className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
            <form className="auth-form" onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label" htmlFor="new-password">New Password</label>
                <div style={{ position: 'relative' }}>
                  <FaLock style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--td-text-tertiary)' }} />
                  <input id="new-password" aria-label="New Password" type="password" className="form-input" value={password} onChange={(event) => setPassword(event.target.value)} style={{ paddingLeft: 36 }} required />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="confirm-password">Confirm Password</label>
                <div style={{ position: 'relative' }}>
                  <FaLock style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--td-text-tertiary)' }} />
                  <input id="confirm-password" aria-label="Confirm Password" type="password" className="form-input" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} style={{ paddingLeft: 36 }} required />
                </div>
              </div>
              <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
                {loading ? 'Resetting…' : 'Reset Password'}
              </button>
            </form>
            <div className="auth-footer"><Link to="/login"><FaArrowLeft style={{ marginRight: 6 }} /> Back to Login</Link></div>
          </>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
