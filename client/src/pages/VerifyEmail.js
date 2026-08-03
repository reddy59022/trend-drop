import React, { useState, useEffect } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import { FaCheckCircle, FaTimesCircle } from 'react-icons/fa';

const VerifyEmail = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login: authLogin } = useAuth();
  const [status, setStatus] = useState('verifying');
  const [message, setMessage] = useState('Verifying your email...');

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setStatus('error');
      setMessage('No verification token found. Please check the link in your email.');
      return;
    }
    const verify = async () => {
      try {
        const res = await api.post('/auth/verify-email', { token });
        if (res.data.token) {
          localStorage.setItem('token', res.data.token);
          authLogin(res.data.user.email, '');
          toast.success('Email verified! Welcome to AURAVEST!');
          setStatus('success');
          setMessage('Email verified successfully!');
          setTimeout(() => navigate('/feed'), 2000);
        } else {
          setStatus('success');
          setMessage('Email verified successfully! You can now login.');
        }
      } catch (error) {
        setStatus('error');
        setMessage(error.response?.data?.message || 'Verification failed. The link may have expired.');
      }
    };
    verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <div className="auth-page">
      <div className="auth-container" style={{ animation: 'fadeInUp 0.4s ease-out', textAlign: 'center' }}>
        {status === 'verifying' && (
          <div style={{ animation: 'fadeInUp 0.3s ease-out' }}>
            <div className="spinner" style={{ margin: '0 auto 20px' }} />
            <h1>Verifying Email</h1>
            <p className="auth-subtitle">{message}</p>
          </div>
        )}
        {status === 'success' && (
          <div style={{ animation: 'scaleIn 0.3s ease-out' }}>
            <div style={{
              width: 72, height: 72, borderRadius: '50%',
              background: 'rgba(0, 200, 83, 0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <FaCheckCircle size={36} color="var(--td-success)" />
            </div>
            <h1 style={{ color: 'var(--td-success)' }}>Verified!</h1>
            <p className="auth-subtitle">{message}</p>
            <p style={{ fontSize: 13, color: 'var(--td-text-tertiary)' }}>Redirecting you to your feed...</p>
            <Link to="/login" className="btn btn-primary btn-block" style={{ marginTop: 24 }}>Go to Login</Link>
          </div>
        )}
        {status === 'error' && (
          <div style={{ animation: 'fadeInUp 0.3s ease-out' }}>
            <div style={{
              width: 72, height: 72, borderRadius: '50%',
              background: 'rgba(255, 23, 68, 0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <FaTimesCircle size={36} color="var(--td-error)" />
            </div>
            <h1 style={{ color: 'var(--td-error)' }}>Verification Failed</h1>
            <p className="auth-subtitle">{message}</p>
            <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Link to="/login" className="btn btn-primary btn-block">Go to Login</Link>
              <Link to="/forgot-password" className="btn btn-outline btn-block">Request New Link</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VerifyEmail;