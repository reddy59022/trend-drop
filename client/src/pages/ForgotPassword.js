import React, { useState } from 'react';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    // In a real app, this would call an API endpoint
    setSubmitted(true);
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#f8f8f8', padding: 20,
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: 32,
        width: '100%', maxWidth: 400, boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
      }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>
          Forgot Password
        </h1>
        <p style={{ color: '#666', textAlign: 'center', marginBottom: 24, fontSize: 14 }}>
          Enter your email address and we'll send you a link to reset your password.
        </p>

        {submitted ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✉️</div>
            <h3 style={{ fontSize: 18, marginBottom: 8 }}>Check your email</h3>
            <p style={{ color: '#666', fontSize: 14 }}>
              If an account exists with <strong>{email}</strong>, you will receive a password reset link shortly.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="Email address"
              style={{
                width: '100%', padding: 12, border: '1px solid #ddd',
                borderRadius: 8, fontSize: 14, marginBottom: 16, boxSizing: 'border-box',
              }}
            />
            <button type="submit" style={{
              width: '100%', padding: 12, background: '#FF4D6D', color: '#fff',
              border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
              fontSize: 15,
            }}>
              Send Reset Link
            </button>
          </form>
        )}

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <a href="/login" style={{ color: '#FF4D6D', fontSize: 14, textDecoration: 'none' }}>
            ← Back to Login
          </a>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;