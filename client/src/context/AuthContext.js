import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    if (token) {
      try {
        const res = await api.get('/auth/me');
        setUser(res.data);
      } catch (error) {
        localStorage.removeItem('token');
        setToken(null);
        setUser(null);
      }
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
    return res.data;
  };

  const register = async (formData) => {
    const config = {
      headers: { 'Content-Type': 'multipart/form-data' },
    };
    const res = await api.post('/auth/register', formData, config);
    // Registration returns { message, emailSent, userId } - no token yet.
    // Token is obtained after email verification and login.
    // Do NOT store undefined token in localStorage or state.
    return res.data;
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  const updateProfile = async (data) => {
    const res = await api.put('/auth/profile', data);
    setUser(res.data);
    return res.data;
  };

  const updateAvatar = async (formData) => {
    const config = {
      headers: { 'Content-Type': 'multipart/form-data' },
    };
    const res = await api.put('/auth/avatar', formData, config);
    setUser(res.data);
    return res.data;
  };

  const loginWithGoogle = async () => {
    // Google login is handled via redirect to Google OAuth
    // Frontend receives callback and exchanges code for token
    const redirectUri = `${window.location.origin}/auth/google/callback`;
    window.location.href = `/api/auth/google?redirect_uri=${encodeURIComponent(redirectUri)}`;
  };

  const loginWithApple = async () => {
    // Apple Sign-In uses OAuth flow
    const redirectUri = `${window.location.origin}/auth/apple/callback`;
    window.location.href = `/api/auth/apple?redirect_uri=${encodeURIComponent(redirectUri)}`;
  };

  const loginWithFacebook = async () => {
    // Facebook login uses OAuth flow
    const redirectUri = `${window.location.origin}/auth/facebook/callback`;
    window.location.href = `/api/auth/facebook?redirect_uri=${encodeURIComponent(redirectUri)}`;
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, updateProfile, updateAvatar, loginWithGoogle, loginWithApple, loginWithFacebook }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};