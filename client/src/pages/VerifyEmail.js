import React, { useState, useEffect } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';

const VerifyEmail = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login: authLogin } = useAuth();
  const [status, setStatus] = useState('verifying'); // verifying, success, error
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
          // Auto-login after verification
          localStorage.setItem('token', res.data.token);
          authLogin(res.data.user.email, ''); // Will be handled by AuthContext
          toast.success('Email verified! Welcome to TrendDrop!');
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
    <div className="page-container" style={{ maxWidth: 500, margin: '60px auto', textAlign: 'center', padding: 20 }}>
      <div style={{
        background: '#fff',
        borderRadius: 16,
        padding: 40,
        boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
      }}>
        {status === 'verifying' && (
          <>
            <div className="spinner" style={{ margin: '0 auto 20px' }}></div>
            <h2>{message}</h2>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
            <h2 style={{ color: '#10b981', marginBottom: 12 }}>Email Verified!</h2>
            <p style={{ color: '#555', lineHeight: 1.6 }}>{message}</p>
            <p style={{ color: '#888', fontSize: 14, marginTop: 12 }}>Redirecting you to your feed...</p>
            <Link to="/login" className="btn btn-primary" style={{ marginTop: 20, display: 'inline-block' }}>
              Go to Login
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{ fontSize: 64, marginBottom: 16 }}>❌</div>
            <h2 style={{ color: '#ef4444', marginBottom: 12 }}>Verification Failed</h2>
            <p style={{ color: '#555', lineHeight: 1.6 }}>{message}</p>
            <div style={{ marginTop: 20, display: 'flex', gap: 12, justifyContent: 'center' }}>
              <Link to="/login" className="btn btn-primary">Go to Login</Link>
              <Link to="/forgot-password" className="btn btn-outline">Resend Email</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default VerifyEmail;